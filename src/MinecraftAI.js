const { SkillLibrary } = require('./SkillLibrary');
const { TaskPlanner } = require('./TaskPlanner');
const { EnvironmentObserver } = require('./EnvironmentObserver');
const { VoyagerAI } = require('./VoyagerAI');
const { StateManager } = require('./StateManager');
const InventoryUtils = require('./InventoryUtils');
const { NLUProcessor } = require('./NLUProcessor');
const PerformanceMonitor = require('./PerformanceMonitor');
const { Logger } = require('./utils/Logger');
const { OperationRunner, sleep: wait } = require('./utils/OperationRunner');
const { inventory: inventorySnapshot } = require('./skills/BasicSkills');

class MinecraftAI {
  constructor(bot, coordinator = null, sharedEnvironment = null, pathfindingCache = null) {
    this.bot = bot;
    this.playerId = bot.username || 'unknown';
    this.operations = new OperationRunner(bot);
    this.lifecycle = new AbortController();
    this.paused = process.env.AI_AUTOSTART === 'false';
    this.isShuttingDown = false;
    this.commandEpoch = 0;
    this.taskResults = [];
    this.stateManager = new StateManager(bot);
    this.pathfindingCache = pathfindingCache;
    this.skillLibrary = new SkillLibrary(pathfindingCache);
    this.taskPlanner = new TaskPlanner(bot, pathfindingCache);
    this.observer = new EnvironmentObserver(bot, sharedEnvironment);
    this.voyagerAI = new VoyagerAI(bot);
    this.coordinator = coordinator; // Multi-player coordinator (optional)
    this.sharedEnvironment = sharedEnvironment; // Shared environment for performance optimization
    this.nluProcessor = new NLUProcessor(); // Natural Language Understanding processor
    this.performanceMonitor = new PerformanceMonitor({
      enabled: process.env.PERFORMANCE_MONITORING !== 'false',
      logInterval: parseInt(process.env.PERF_LOG_INTERVAL) || 10000, // 10秒間隔
      eventLoopThreshold: parseInt(process.env.EVENT_LOOP_THRESHOLD) || 50 // 50ms閾値
    });

    // Legacy properties for backward compatibility
    this.currentTask = null;
    this.goals = [];
    this.inventory = new Map();
    this.exploredAreas = new Set();

    this.isInitialized = false;
    this.debugMode = process.env.DEBUG_MODE === 'true';
    this.logger = Logger.createLogger(`MinecraftAI-${this.playerId}`);
    this.failedTargets = new Map(); // To track recently failed targets
    this.taskFailureCounts = new Map(); // To track generic task failures

    // Enhanced socket safety to prevent EPIPE errors - comprehensive protection
    this.setupComprehensiveEPIPEProtection();

    // Enhanced disconnect handling with immediate shutdown
    const handleDisconnect = (reason) => {
      this.logger.warn(`Connection lost: ${reason}`);
      this.shutdown(reason);
    };

    // Graceful shutdown handling: stop AI loop when bot disconnects
    this.bot.on('end', () => handleDisconnect('end'));
    this.bot.on('kicked', () => handleDisconnect('kicked'));
    this.bot.on('error', (err) => {
      this.logger.error(`Bot error: ${err.message}`);
      handleDisconnect('error');
    });

    // Death and respawn handling
    this.deathCount = 0;
    this.lastDeathTime = 0;
    this.isRespawning = false;

    this.bot.on('death', () => {
      this.handleDeath();
    });

    this.bot.on('respawn', () => {
      this.handleRespawn();
    });

    // Additional socket-level error handling for EPIPE prevention
    if (this.bot._client && this.bot._client.socket) {
      this.bot._client.socket.on('error', (err) => {
        if (err.code === 'EPIPE') {
          this.logger.warn('Socket EPIPE error detected, initiating graceful shutdown');
          handleDisconnect('socket_epipe');
        } else {
          this.logger.error(`Socket error: ${err.message}`);
        }
      });
    }
    // playerId is not available until login; set placeholder
    this.playerId = bot.username || 'unknown';

    // Delay coordinator registration until login so username is defined
    bot.once('login', () => {
      this.playerId = bot.username;
      this.logger = Logger.createLogger(`MinecraftAI-${this.playerId}`);

      // EnvironmentObserverのbotIdを更新してSharedEnvironmentに登録
      this.observer.initializeAfterLogin();

      if (this.coordinator) {
        this.coordinator.registerPlayer(this.playerId, bot, this);
      }
    });

    // Set up state synchronization
    this.setupStateSync();
  }

  async initialize() {
    if (this.isInitialized || this.isShuttingDown) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeOnce().catch(error => {
      if (!this.isShuttingDown) throw error;
    });
    return this.initializing;
  }

  async initializeOnce() {
    this.logger.log('AIシステムを初期化中...');
    if (this.coordinator?.syncStartEnabled) {
      const result = this.coordinator.reportPlayerReady(this.playerId);
      if (!result.canStart) await this.waitForAllPlayersReady();
    }
    if (this.isShuttingDown) return;
    await this.waitForWorldReady();
    if (this.isShuttingDown) return;
    this.skillLibrary.loadBasicSkills();
    this.goals = this.paused ? [] : this.defaultGoals();
    this.observer.update();
    this.stateManager.syncWithBot();
    this.observationTimer = setInterval(() => {
      this.observer.update();
      this.stateManager.syncWithBot();
    }, 250);
    this.isInitialized = true;
    this.logger.log('AIシステムの初期化が完了しました');
    this.loopPromise = this.startMainLoop();
  }

  async waitForWorldReady() {
    const deadline = Date.now() + 30000;
    while (!this.isShuttingDown) {
      const pos = this.bot.entity?.position;
      let loaded = Boolean(pos && this.bot.entity.height && this.bot.world);
      if (loaded) {
        for (let x = -2; x <= 2; x++) {
          for (let z = -2; z <= 2; z++) {
            if (!this.bot.world.getColumnAt(pos.offset(x * 16, 0, z * 16))) loaded = false;
          }
        }
      }
      if (loaded) return;
      if (Date.now() > deadline) throw new Error('Initial chunks did not load within 30s');
      await wait(50, this.lifecycle.signal);
    }
  }

  defaultGoals() {
    return [
      { type: 'gather_wood', amount: 3 },
      { type: 'craft_workbench' },
      { type: 'place_workbench' },
      { type: 'craft_basic_tools', tools: ['wooden_pickaxe'] },
      { type: 'find_stone', amount: 3 }
    ];
  }

  async stop(reason = 'Stopped by command') {
    this.paused = true;
    this.commandEpoch++;
    this.goals = [];
    await this.operations.cancel(reason);
  }

  onSpawn() {
    this.logger.log('ボットがスポーンしました。ワールドを初期化します...');
    this.observer.updatePosition();
  }

  async onChat(username, message) {
    this.logger.log(`${username}からのチャット: ${message}`);

    // Simple command processing
    if (message.startsWith('!')) {
      await this.processCommand(username, message.slice(1));
    }
  }

  onDeath() {
    this.inventory.clear();
  }

  async processCommand(username, command) {
    const [cmd, ...args] = command.split(' ');

    // 1. 静的コマンドの処理（後方互換性維持）
    const staticCommands = ['status', 'goto', 'follow', 'stop', 'start', 'resume', 'learn', 'curriculum', 'coord', 'claim', 'release', 'state', 'perf'];
    if (staticCommands.includes(cmd.toLowerCase())) {
      return this.handleStaticCommand(cmd.toLowerCase(), args, username);
    }

    // 2. NLU処理への移行
    try {
      this.bot.chat(`「${command}」を解析中...`);
      const context = this.getContext();
      const nluResult = await this.nluProcessor.parse(command, context);

      if (nluResult && nluResult.intent) {
        // 3. NLU結果をタスクに変換して実行
        const task = this.mapNluToTask(nluResult);
        if (task) {
          await this.executeNluTask(task);
        } else {
          this.bot.chat('意図は理解できましたが、実行可能なタスクに変換できませんでした。');
        }
      } else {
        this.bot.chat('すみません、コマンドを理解できませんでした。`!status`などをお試しください。');
      }
    } catch (error) {
      console.error('[NLU Command Error]', error);
      this.bot.chat('コマンドの解釈中にエラーが発生しました。');
    }
  }

  // 静的コマンド処理（既存のロジックを分離）
  async handleStaticCommand(cmd, args, username) {
    switch (cmd) {
    case 'status':
      this.reportStatus();
      break;
    case 'goto':
      if (args.length >= 3) {
        const [x, y, z] = args.map(Number);
        if (![x, y, z].every(Number.isFinite)) {
          this.bot.chat('座標には数値を指定してください');
          break;
        }
        this.setGoal({ type: 'move_to', target: { x, y, z }, priority: 0 });
      }
      break;
    case 'follow':
      this.setGoal({ type: 'follow', target: username, priority: 0 });
      break;
    case 'stop':
      await this.stop();
      this.bot.chat('操作と目標キューを停止しました');
      break;
    case 'start': {
      const epoch = this.commandEpoch + 1;
      await this.stop('Starting basic sequence');
      if (this.isShuttingDown || this.commandEpoch !== epoch) return;
      this.goals = this.defaultGoals();
      this.paused = false;
      break;
    }
    case 'resume':
      this.paused = false;
      break;
    case 'learn':
      this.displayLearningStats();
      break;
    case 'curriculum':
      await this.generateNewCurriculum();
      break;
    case 'coord':
      this.displayCoordinationStatus();
      break;
    case 'claim':
      if (args.length >= 4) {
        const [x, y, z, type] = args;
        await this.requestResourceAccess({ x: parseInt(x), y: parseInt(y), z: parseInt(z) }, type);
      }
      break;
    case 'release':
      this.releaseAllResourceClaims();
      break;
    case 'state':
      this.displayStateStatus();
      break;
    case 'perf':
      this.displayPerformanceStats();
      break;
    default:
      this.bot.chat(`不明なコマンド: ${cmd}`);
    }
  }

  // ボットの現在状態をNLUのコンテキストとして提供
  getContext() {
    try {
      const context = {};

      if (this.bot?.entity?.position) {
        context.position = this.bot.entity.position;
      }

      if (this.bot?.health !== undefined) {
        context.health = this.bot.health;
      }

      if (this.bot?.food !== undefined) {
        context.food = this.bot.food;
      }

      // インベントリの要約
      if (this.bot?.inventory) {
        const inventoryItems = this.bot.inventory.items();
        const inventorySummary = inventoryItems.slice(0, 10).map(item =>
          `${item.name} x${item.count}`
        ).join(', ');
        context.inventory = inventorySummary || '空';
      }

      return context;
    } catch (error) {
      console.error('[Context Error]', error);
      return {};
    }
  }

  // NLU結果をTaskPlannerが理解できる形式に変換
  mapNluToTask(nluResult) {
    const { intent, entities } = nluResult;

    switch (intent) {
    case 'goto':
      if (entities.x !== undefined && entities.y !== undefined && entities.z !== undefined) {
        return { type: 'move_to', params: { x: entities.x, y: entities.y, z: entities.z } };
      }
      break;
    case 'explore':
      return { type: 'explore', params: { target: entities.target, radius: entities.radius || 50 } };
    case 'mine_block':
      return { type: 'mine', params: { name: entities.name, count: entities.count || 1 } };
    case 'gather_wood':
      return { type: 'gather_wood', params: { wood_type: entities.wood_type || 'oak', count: entities.count || 10 } };
    case 'craft_item':
      return { type: 'craft', params: { item: entities.item, count: entities.count || 1 } };
    case 'follow':
      return { type: 'follow', params: { target: entities.player } };
    case 'check_inventory':
      return { type: 'check_inventory', params: {} };
    case 'get_status':
      return { type: 'status', params: {} };
    case 'stop_task':
      return { type: 'stop', params: {} };
    default:
      return null;
    }
  }

  // NLUタスクの実行
  async executeNluTask(task) {
    try {
      switch (task.type) {
      case 'move_to':
        this.setGoal({ type: 'move_to', target: task.params, priority: 0 });
        this.bot.chat(`座標(${task.params.x}, ${task.params.y}, ${task.params.z})に移動します`);
        break;
      case 'explore':
        this.setGoal({ type: 'explore', target: task.params.target, priority: 0 });
        this.bot.chat(`${task.params.target}の探索を開始します`);
        break;
      case 'mine':
        this.setGoal({ type: 'mine', target: task.params.name, count: task.params.count, priority: 0 });
        this.bot.chat(`${task.params.name}を${task.params.count}個採掘します`);
        break;
      case 'gather_wood':
        this.setGoal({ type: 'gather_wood', wood_type: task.params.wood_type, count: task.params.count, priority: 0 });
        this.bot.chat(`${task.params.wood_type}の木材を${task.params.count}個収集します`);
        break;
      case 'craft':
        this.setGoal({ type: 'craft', item: task.params.item, count: task.params.count, priority: 0 });
        this.bot.chat(`${task.params.item}を${task.params.count}個クラフトします`);
        break;
      case 'follow':
        this.setGoal({ type: 'follow', target: task.params.target, priority: 0 });
        this.bot.chat(`${task.params.target}を追跡します`);
        break;
      case 'check_inventory':
        this.reportInventory();
        break;
      case 'status':
        this.reportStatus();
        break;
      case 'stop':
        this.currentTask = null;
        this.bot.chat('現在のタスクを停止します');
        break;
      default:
        this.bot.chat(`タスクタイプ「${task.type}」は実装されていません`);
      }
    } catch (error) {
      console.error('[NLU Task Execution Error]', error);
      this.bot.chat('タスクの実行中にエラーが発生しました');
    }
  }

  // インベントリ状態を報告
  reportInventory() {
    try {
      if (!this.bot?.inventory) {
        this.bot.chat('インベントリ情報を取得できません');
        return;
      }

      const items = this.bot.inventory.items();
      if (items.length === 0) {
        this.bot.chat('インベントリは空です');
        return;
      }

      const itemList = items.slice(0, 10).map(item =>
        `${item.displayName || item.name} x${item.count}`
      ).join(', ');

      this.bot.chat(`インベントリ: ${itemList}${items.length > 10 ? '...' : ''}`);
    } catch (error) {
      console.error('[Inventory Report Error]', error);
      this.bot.chat('インベントリの表示中にエラーが発生しました');
    }
  }

  setGoal(goal) {
    if (this.isShuttingDown) return;
    this.paused = false;
    this.goals.unshift(goal);
    this.logger.log(`新しい目標を設定: ${goal.type}`);
  }

  reportStatus() {
    if (!this.bot?.entity?.position) {
      this.bot.chat('状態取得エラー: プレイヤーが初期化されていません');
      return;
    }

    const pos = this.bot.entity.position;
    const health = this.bot.health ?? 0;
    const food = this.bot.food ?? 0;

    this.bot.chat(`状態: 体力 ${health}/20, 食料 ${food}/20, 位置 (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`);
  }

  displayLearningStats() {
    try {
      // Enhanced safety for !learn command
      if (!this.voyagerAI) {
        this.bot.chat('学習システムが初期化されていません');
        return;
      }

      const stats = this.voyagerAI.getLearningStats();

      if (!stats) {
        this.bot.chat('学習統計の取得に失敗しました');
        return;
      }

      // Safe number handling for display
      const totalExp = stats.totalExperiences || 0;
      const successRate = stats.successRate || 0;
      const taskCount = stats.taskTypes ? stats.taskTypes.size : 0;

      this.bot.chat(`学習状況: ${totalExp}回の経験、成功率 ${Math.round(successRate * 100)}%、${taskCount}種類のタスク`);

      // Additional info if available
      if (stats.recentPerformance && stats.recentPerformance.length > 0) {
        const recentSuccesses = stats.recentPerformance.filter(p => p.success).length;
        this.bot.chat(`直近${stats.recentPerformance.length}タスク中${recentSuccesses}回成功`);
      }
    } catch (error) {
      console.log(`Error in displayLearningStats: ${error.message}`);
      this.bot.chat('学習統計の表示中にエラーが発生しました');
    }
  }

  async generateNewCurriculum() {
    this.bot.chat('新しい学習カリキュラムを生成中...');
    const curriculum = await this.voyagerAI.generateCurriculum(this.skillLibrary.skills, this.goals);

    // Add curriculum tasks to goals
    curriculum.forEach((task) => {
      this.goals.push({
        type: task.type,
        priority: task.difficulty,
        description: task.description
      });
    });

    // 一覧をチャットで表示
    const taskList = curriculum.map((t, i) => `${i + 1}. ${t.type}`).join(', ');
    this.bot.chat(`${curriculum.length}個の新しい学習タスクを追加しました: ${taskList}`);
  }

  async startMainLoop() {
    this.logger.log('メインAIループを開始...');

    let loopCount = 0;
    let lastPerformanceReport = Date.now();
    const performanceReportInterval = 300000; // 5 minutes

    while (this.isInitialized) {
      const loopStart = Date.now();

      try {
        await this.mainLoopIteration();

        // Adaptive sleep based on current situation
        const sleepTime = this.calculateAdaptiveSleep();
        await this.sleep(sleepTime);

        loopCount++;

        // Periodic performance reporting
        if (Date.now() - lastPerformanceReport > performanceReportInterval) {
          this.reportPerformanceMetrics();
          lastPerformanceReport = Date.now();
        }

        // Memory cleanup every 200 iterations (reduced CPU load)
        if (loopCount % 200 === 0) {
          this.performMaintenanceCleanup();
        }
      } catch (error) {
        this.logger.log(`メインループでエラー: ${error.message}`);

        // Optimized exponential backoff with reduced maximum delay
        // Reduced max from 30s to 10s, base from 1000ms to 500ms
        const errorSleep = Math.min(10000, 500 * Math.pow(1.3, this.consecutiveErrors || 0));
        await this.sleep(errorSleep);

        this.consecutiveErrors = (this.consecutiveErrors || 0) + 1;

        // Reset error count after successful iteration
        if (this.consecutiveErrors > 5) {
          this.logger.log('連続エラーが多すぎます。状態をリセットします。');
          this.performEmergencyReset();
        }
      }

      const loopTime = Date.now() - loopStart;
      this.updatePerformanceMetrics(loopTime);
    }
  }

  calculateAdaptiveSleep() {
    const baseSleep = 200; // Reduced from 300ms to 200ms for better responsiveness

    // Adjust based on current situation
    let multiplier = 1.0;

    // Sleep less when in danger
    if (this.observer.isDangerous()) {
      multiplier = 0.2; // Reduced from 0.3 for faster danger response
    }

    // Sleep more when idle to prevent high CPU usage from rapid task planning loops
    if (!this.currentTask) {
      multiplier = 2.0; // Reduced from 3.0 for better balance
    }

    // Sleep less when low on health/food
    if (this.bot.health < 10 || this.bot.food < 10) {
      multiplier = 0.2; // Keep urgent response
    }

    // Sleep more at night (if not urgent tasks)
    const state = this.stateManager.getState(['timeOfDay']);
    if (state.timeOfDay === 'night' && !this.hasUrgentTasks()) {
      multiplier = 1.2; // Keep nighttime responsiveness
    }

    return Math.floor(baseSleep * multiplier);
  }

  hasUrgentTasks() {
    return this.goals.some(goal => goal.priority === 0 || goal.urgent === true);
  }

  performMaintenanceCleanup() {
    try {
      // Clean up state manager
      if (this.stateManager) {
        // Force garbage collection of old state history
        this.stateManager.cleanup?.();
      }

      // Clean up coordinator if available
      if (this.coordinator) {
        this.coordinator.cleanup();
      }

      // Clean up observer data
      if (this.observer.observationHistory && this.observer.observationHistory.length > 500) {
        this.observer.observationHistory.splice(0, this.observer.observationHistory.length - 500);
      }

      // Reset consecutive errors on successful cleanup
      this.consecutiveErrors = 0;

      this.logger.log('定期メンテナンスクリーンアップ完了');
    } catch (error) {
      this.logger.error(`メンテナンスクリーンアップエラー: ${error.message}`);
    }
  }

  performEmergencyReset() {
    this.consecutiveErrors = 0;
    this.stop('Repeated loop errors').catch(error => this.logger.error(error.message));
  }

  updatePerformanceMetrics(loopTime) {
    if (!this.performanceMetrics) {
      this.performanceMetrics = {
        totalLoops: 0,
        averageLoopTime: 0,
        maxLoopTime: 0,
        recentLoopTimes: []
      };
    }

    this.performanceMetrics.totalLoops++;
    this.performanceMetrics.maxLoopTime = Math.max(this.performanceMetrics.maxLoopTime, loopTime);

    // Keep recent loop times for calculating average
    this.performanceMetrics.recentLoopTimes.push(loopTime);
    if (this.performanceMetrics.recentLoopTimes.length > 100) {
      this.performanceMetrics.recentLoopTimes.shift();
    }

    // Calculate average
    const sum = this.performanceMetrics.recentLoopTimes.reduce((a, b) => a + b, 0);
    this.performanceMetrics.averageLoopTime = sum / this.performanceMetrics.recentLoopTimes.length;
  }

  reportPerformanceMetrics() {
    if (!this.performanceMetrics || !this.debugMode) return;

    const metrics = this.performanceMetrics;
    const avgTime = Math.round(metrics.averageLoopTime);
    const maxTime = metrics.maxLoopTime;
    const totalLoops = metrics.totalLoops;
    this.logger.log(`パフォーマンス: 平均ループ時間 ${avgTime}ms, 最大 ${maxTime}ms, 総ループ ${totalLoops}`);

    // Report state manager stats if available
    if (this.stateManager) {
      const stats = this.stateManager.getPerformanceStats();
      this.logger.log(`状態統計: スキル ${stats.totalSkills}, 成功率 ${Math.round(stats.overallSuccessRate)}%`);
    }
  }

  setupComprehensiveEPIPEProtection() {
    // Conservative EPIPE protection - remove caching for real-time safety

    // Store original methods for cleanup
    this.originalMethods = new Map();

    // Protect chat function with real-time socket checks
    if (typeof this.bot.chat === 'function') {
      const originalChat = this.bot.chat.bind(this.bot);
      this.originalMethods.set('chat', originalChat);
      this.bot.chat = (message) => {
        if (!this.isSocketSafe()) {
          if (this.debugMode) console.log('[SafeChat] Socket unsafe, suppressing chat');
          return;
        }
        try {
          originalChat(message);
        } catch (err) {
          if (err.code === 'EPIPE') {
            this.logger.warn('EPIPE error in chat, initiating graceful shutdown');
            this.handleEPIPEError();
          } else {
            console.log(`[SafeChat] Error: ${err.message}`);
          }
        }
      };
    }

    // Conservative protection for all write operations
    const protectedMethods = ['activateItem', 'deactivateItem', 'useOn', 'attack', 'dig'];

    protectedMethods.forEach(method => {
      if (typeof this.bot[method] === 'function') {
        const original = this.bot[method].bind(this.bot);
        this.originalMethods.set(method, original);
        this.bot[method] = (...args) => {
          if (!this.isSocketSafe()) {
            if (this.debugMode) console.log(`[Safe${method}] Socket unsafe, suppressing ${method}`);
            return Promise.resolve();
          }
          try {
            return original(...args);
          } catch (err) {
            if (err.code === 'EPIPE') {
              this.logger.warn(`EPIPE error in ${method}, initiating graceful shutdown`);
              this.handleEPIPEError();
              return Promise.reject(err);
            }
            throw err;
          }
        };
      }
    });
  }

  isSocketSafe() {
    return this.bot._client &&
           this.bot._client.socket &&
           !this.bot._client.socket.destroyed &&
           this.bot._client.socket.readyState !== 'closed' &&
           this.bot._client.socket.writable;
  }

  handleEPIPEError() {
    this.logger.error('EPIPE error detected, initiating graceful shutdown');
    this.isInitialized = false;

    // More conservative socket cleanup
    try {
      if (this.bot && typeof this.bot.quit === 'function') {
        this.bot.quit('EPIPE error shutdown');
      } else if (this.bot._client && this.bot._client.socket && !this.bot._client.socket.destroyed) {
        this.bot._client.socket.destroy();
      }
    } catch (e) {
      // Ignore errors during cleanup
      this.logger.debug(`Error during EPIPE cleanup: ${e.message}`);
    }
  }

  async mainLoopIteration() {
    this.observer.update();
    this.stateManager.syncWithBot();
    if (this.paused || this.isShuttingDown || this.goals.length === 0) return;
    const epoch = this.commandEpoch;
    const goal = this.goals.shift();
    try {
      const task = await this.taskPlanner.planTask(goal);
      if (epoch !== this.commandEpoch || this.isShuttingDown) return;
      if (!task) throw new Error(`Unsupported goal: ${goal.type}`);
      this.currentTask = task;
      this.stateManager.setCurrentTask(task);
      await this.executeCurrentTask();
    } catch (error) {
      this.logger.error(error.message);
      if (epoch === this.commandEpoch) await this.stop(error.message);
    }
  }

  async handleImmediateThreats() {
    try {
      const dangers = this.observer.getNearbyDangers();

      if (dangers.length === 0) {
        return { shouldContinue: true };
      }

      // Handle low health
      const lowHealth = dangers.find(d => d.type === 'low_health');
      if (lowHealth && this.bot.health < 6) {
        this.logger.log('低体力状態を検出、食料探索を優先');
        this.goals.unshift({
          type: 'find_food',
          priority: 0,
          urgent: true,
          description: '緊急：体力回復のための食料確保'
        });
        return { shouldContinue: true };
      }

      // Handle hostile entities
      const hostileEntities = dangers.filter(d => d.type === 'hostile_entity');
      if (hostileEntities.length > 0) {
        const nearest = hostileEntities.reduce((closest, current) =>
          current.distance < closest.distance ? current : closest
        );

        if (nearest.distance < 8) {
          this.logger.log(`敵対MOB ${nearest.entityType} が接近中、回避行動`);
          await this.performEvasiveAction(nearest);
          return { shouldContinue: false }; // Skip normal processing
        }
      }

      return { shouldContinue: true };
    } catch (error) {
      this.logger.log(`脅威処理エラー: ${error.message}`);
      return { shouldContinue: true };
    }
  }

  async performEvasiveAction(threat) {
    try {
      if (!this.bot?.entity?.position) {
        this.logger.log('回避行動エラー: プレイヤー位置が取得できません');
        return;
      }

      if (!threat?.position) {
        this.logger.log('回避行動エラー: 脅威の位置が不明です');
        return;
      }

      const currentPos = this.bot.entity.position;
      const threatPos = threat.position;

      // Calculate escape direction (opposite from threat)
      const escapeX = currentPos.x + (currentPos.x - threatPos.x) * 2;
      const escapeZ = currentPos.z + (currentPos.z - threatPos.z) * 2;

      this.logger.log(`回避行動: (${Math.round(escapeX)}, ${Math.round(escapeZ)})方向に移動`);

      // Use move skill for evasion
      const moveSkill = this.skillLibrary.getSkill('move_to');
      if (moveSkill) {
        await Promise.race([
          moveSkill.execute(this.bot, { x: escapeX, y: currentPos.y, z: escapeZ }),
          this.sleep(5000) // Max 5 seconds for evasion
        ]);
      }
    } catch (error) {
      this.logger.log(`回避行動エラー: ${error.message}`);
    }
  }

  // Enhanced movement with terrain-aware navigation
  async smartNavigateTo(x, y, z) {
    try {
      this.logger.log(`スマートナビゲーション: (${x}, ${y}, ${z})`);

      // Check current environment
      const waterStatus = this.observer.getWaterStatus();
      const terrainAnalysis = this.observer.getTerrainAnalysis();

      // If in water, escape first
      if (waterStatus.inWater || waterStatus.inLava) {
        const escapeSkill = this.skillLibrary.getSkill('escape_water');
        if (escapeSkill) {
          const escapeResult = await escapeSkill.execute(this.bot, { emergencyMode: true });
          if (!escapeResult.success) {
            return { success: false, error: '水中脱出失敗' };
          }
        }
      }

      // Choose navigation strategy based on terrain complexity
      let navigationSkill;

      if (terrainAnalysis.navigationDifficulty === 'very_difficult' || terrainAnalysis.navigationDifficulty === 'difficult') {
        navigationSkill = this.skillLibrary.getSkill('navigate_terrain');
        this.logger.log('複雑地形でのナビゲーションスキルを使用');
      } else {
        navigationSkill = this.skillLibrary.getSkill('move_to');
        this.logger.log('標準移動スキルを使用');
      }

      if (!navigationSkill) {
        return { success: false, error: '適切なナビゲーションスキルが見つかりません' };
      }

      const result = await navigationSkill.execute(this.bot, { target: { x, y, z } });

      if (result.success) {
        this.logger.log('スマートナビゲーション成功');
      } else {
        this.logger.log(`スマートナビゲーション失敗: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.log(`スマートナビゲーションエラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async executeCurrentTask() {
    const task = this.currentTask;
    const epoch = this.commandEpoch;
    const before = inventorySnapshot(this.bot);
    const startedAt = Date.now();
    let result;
    try {
      const skill = this.skillLibrary.getSkill(task.type);
      if (!skill) throw new Error(`Unsupported skill: ${task.type}`);
      this.stateManager.addSkill(task.type, skill);
      const timeout = Math.max(1, Math.min(this.calculateSkillTimeout(task), task.timeout - Date.now()));
      result = await this.executeSkillWithTimeout(skill, task.params, timeout);
    } catch (error) {
      result = { success: false, reason: error.code || 'OPERATION_FAILED', error: error.message };
    }
    const record = {
      task: task.type,
      params: task.params,
      startedAt,
      completedAt: Date.now(),
      before,
      after: inventorySnapshot(this.bot),
      result,
      cancelled: epoch !== this.commandEpoch
    };
    this.taskResults.push(record);
    if (this.taskResults.length > 50) this.taskResults.shift();
    this.logger.log(`TASK_RESULT ${JSON.stringify(record)}`);
    this.taskPlanner.addTaskToHistory(task, result);
    this.stateManager.completeCurrentTask(result);
    this.currentTask = null;
    this.observer.update();
    if (epoch === this.commandEpoch && !result?.success) await this.stop(result?.error || result?.reason);
    this.bot.emit('taskResult', record);
    if (!this.paused && this.goals.length === 0) this.bot.emit('goalsComplete', this.taskResults);
  }

  async getOrGenerateSkill(taskName) {
    let skill = this.skillLibrary.getSkill(taskName);

    // If no predefined skill exists, try to generate one with Voyager AI
    if (!skill) {
      this.logger.log(`${taskName}の事前定義スキルがありません。AIで生成中...`);
      try {
        const context = this.observer.getObservationSummary();
        skill = await this.voyagerAI.generateSkill(this.currentTask, context);
      } catch (aiError) {
        this.logger.log(`AIスキル生成に失敗: ${aiError.message}`);
        this.currentTask = null;
        return null;
      }
    }

    return skill;
  }

  async executeSkillSafely(skill, _taskName) {
    // Calculate dynamic timeout based on task complexity
    const dynamicTimeout = this.calculateSkillTimeout(this.currentTask);

    try {
      // Execute the skill with dynamic timeout and proper error handling
      return await this.executeSkillWithTimeout(skill, this.currentTask.params, dynamicTimeout);
    } catch (error) {
      // Convert exceptions back to result objects for consistent error handling
      return { success: false, error: error.message };
    }
  }

  async processTaskResult(result, taskName) {
    // Guard against null task before any processing
    if (!this.currentTask) {
      this.logger.warn('processTaskResult: currentTask is null, aborting result processing');
      return;
    }

    // Learn from the experience if Voyager AI is available with comprehensive null protection
    try {
      if (this.currentTask && this.currentTask.type) {
        const context = this.observer.getObservationSummary();
        await this.voyagerAI.learnFromExperience(this.currentTask, result, context);
      } else {
        this.logger.debug('Skipping learning: current task is null or invalid');
      }
    } catch (learningError) {
      this.logger.log(`Learning failed: ${learningError.message}`);
    }

    // Calculate execution time safely
    let executionTime = 0;
    if (this.currentTask && this.currentTask.startTime) {
      executionTime = Date.now() - this.currentTask.startTime;
    } else {
      this.logger.warn('processTaskResult: currentTask missing startTime');
    }

    if (result && result.success) {
      // Clear failure tracker for this target on success
      if (this.currentTask.params?.position) {
        const pos = this.currentTask.params.position;
        const targetKey = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
        this.failedTargets.delete(targetKey);
      }
      // Also reset generic task failure count on success
      this.taskFailureCounts.delete(taskName);
      // currentTask may have been cleared by skill internals
      if (!this.currentTask) {
        this.logger.warn('processTaskResult: currentTask lost before success handling');
        return;
      }
      this.logger.log(`タスクが正常に完了: ${taskName}`);
      this.announceTaskCompletion(taskName, result);

      // Update state manager with successful task completion
      if (this.stateManager) {
        this.stateManager.completeCurrentTask(result);
        this.stateManager.updateSkillPerformance(taskName, true, executionTime);
      }

      // Schedule tool crafting check after resource gathering tasks
      if (this.isResourceGatheringTask(taskName)) {
        this.logger.log('資源収集タスク完了後、ツール作成をチェックします');
        // Schedule check in next loop iteration to allow inventory to sync
        setTimeout(async () => {
          if (!this.currentTask) { // Only check if not busy
            await this.checkAutoToolCrafting();
          }
        }, 1000);
      }
    } else {
      if (!this.currentTask) {
        this.logger.warn('processTaskResult: currentTask lost before failure handling');
        return;
      }
      this.logger.log(`タスクが失敗: ${taskName} - ${result?.error || result?.reason || '不明なエラー'}`);
      this.handleTaskFailure(taskName, result);

      // Update state manager with failed task
      if (this.stateManager) {
        this.stateManager.completeCurrentTask(result || { success: false, error: '不明なエラー' });
        this.stateManager.updateSkillPerformance(taskName, false, executionTime);
      }
    }
  }

  async handleTaskError(error, taskName) {
    this.logger.log(`タスク実行で致命的エラー ${taskName}: ${error.message}`);

    // Enhanced error handling with better logging
    if (!this.currentTask) {
      this.logger.warn('handleTaskError: currentTask is null, skipping learning/progress updates');
      return;
    }

    // Create a safe task object for learning even if currentTask becomes corrupted
    if (taskName && typeof taskName === 'string') {
      const safeTask = {
        type: taskName,
        startTime: this.currentTask ? this.currentTask.startTime || Date.now() : Date.now(),
        params: this.currentTask ? this.currentTask.params || {} : {}
      };

      try {
        // Learn from the failure with enhanced safety
        const context = this.observer ? this.observer.getObservationSummary() : {};
        await this.voyagerAI.learnFromExperience(
          safeTask,
          { success: false, error: error.message },
          context
        );
      } catch (learningError) {
        this.logger.log(`失敗から学習中にエラー: ${learningError.message}`);
      }
    } else {
      this.logger.debug('Skipping learning from failure: task name is invalid');
    }

    this.logger.log(`タスク ${taskName} が失敗: ${error.message}`);
    this.handleTaskFailure(taskName, error.message);
  }

  async executeSkillWithTimeout(skill, params, timeoutMs) {
    return this.operations.run(skill, params, timeoutMs);
  }

  announceTaskCompletion(taskName, result) {
    const messages = {
      gather_wood: `${result.gathered || 'いくつかの'}木材を収集しました！ 🌳`,
      craft_basic_tools: `${result.crafted || 'いくつかの'}基本ツールを作成しました！ 🔨`,
      find_stone: `${result.mined || 'いくつかの'}石を発見・採掘しました！ ⛏️`,
      craft_stone_tools: `${result.crafted || 'いくつかの'}石製ツールにアップグレードしました！ ⚒️`,
      find_food: '食料を確保しました！ 🍖',
      build_shelter: '避難所を建設しました！ 🏠',
      mine_safely: '安全な採掘作業を完了しました！ 💎'
    };

    const message = messages[taskName] || `タスク完了: ${taskName}`;
    this.bot.chat(message);
  }

  handleTaskFailure(taskName, result) { // result is now the detailed failure object
    const reason = result?.reason || 'UNKNOWN';
    const details = result?.details || {};
    this.logger.log(`タスク ${taskName} が失敗: ${reason}`);

    // Track failed target to prevent position-based loops
    if (details.position) {
      const targetKey = `${Math.round(details.position.x)},${Math.round(details.position.y)},${Math.round(details.position.z)}`;
      const failureCount = (this.failedTargets.get(targetKey) || 0) + 1;
      this.failedTargets.set(targetKey, failureCount);

      if (failureCount >= 3) {
        this.logger.log(`ターゲット ${targetKey} で3回失敗しました。別の場所を探索します。`);
        this.failedTargets.delete(targetKey); // Reset counter after taking action
        this.goals.unshift({ type: 'explore', priority: 0, description: '同じ場所での失敗が続いたため、場所を変更します。' });
        return;
      }
    } else {
      // Track generic task failures to prevent non-position-based loops
      const taskKey = taskName;
      const failureCount = (this.taskFailureCounts.get(taskKey) || 0) + 1;
      this.taskFailureCounts.set(taskKey, failureCount);

      if (failureCount >= 3) {
        this.logger.log(`タスク '${taskKey}' が3回連続で失敗しました。探索に切り替えます。`);
        this.taskFailureCounts.delete(taskKey); // Reset counter
        this.goals.unshift({ type: 'explore', priority: 0, description: `タスク'${taskKey}'の失敗が続いたため、気分転換に探索します。` });
        return;
      }
    }

    const recoveryTask = this.generateRecoveryTask(reason, details);
    if (recoveryTask) {
      this.logger.log(`回復タスクを生成: ${recoveryTask.type} - ${recoveryTask.description}`);
      this.goals.unshift(recoveryTask);
    }
  }

  generateRecoveryTask(reason, details) {
    switch (reason) {
    case 'NO_TOOL': {
      return {
        type: 'craft_tools',
        priority: 0,
        description: `緊急: ${details.required}を作成`,
        params: { tools: [details.required] }
      };
    }
    case 'INSUFFICIENT_MATERIALS': {
      const material = details.missing[0];
      return {
        type: material.item.includes('log') || material.item.includes('planks') ? 'gather_wood' : 'mine_block',
        priority: 0,
        description: `緊急: ${material.item}を${material.needed}個集める`,
        params: {
          amount: material.needed,
          blockType: material.item.includes('log') ? 'oak_log' : 'stone' // Simple mapping
        }
      };
    }
    case 'TARGET_NOT_FOUND':
      return {
        type: 'explore',
        priority: 1,
        description: `探索: ${details.type}を探す`,
        params: { radius: 100 }
      };
    case 'CRAFTING_TABLE_MISSING':
      return {
        type: 'craft_workbench',
        priority: 0,
        description: '緊急: 作業台を作成'
      };
    default:
      this.logger.log(`不明な失敗理由(${reason})のため、回復タスクを生成できません`);
      return null;
    }
  }

  hasPickaxe() {
    return InventoryUtils.hasTool(this.bot, 'pickaxe');
  }

  async safeExploration() {
    try {
      // Check if it's safe to explore
      if (this.observer.isDangerous()) {
        this.logger.log('危険な状況のため探索を中止');
        return;
      }

      // Validate bot position before exploration
      if (!this.bot?.entity?.position) {
        this.logger.log('探索エラー: プレイヤー位置が取得できません');
        return;
      }

      // Simple random movement for exploration with safety checks
      const pos = this.bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      const distance = 10 + Math.random() * 20;

      const targetX = Math.floor(pos.x + Math.cos(angle) * distance);
      const targetZ = Math.floor(pos.z + Math.sin(angle) * distance);
      const targetY = pos.y;

      // Validate target position (basic safety check)
      if (Math.abs(targetY) > 300) { // Avoid extreme heights
        this.logger.log('探索目標が安全でないため中止');
        return;
      }

      this.logger.log(`安全探索中: (${targetX}, ${targetY}, ${targetZ})に移動`);

      // Add exploration as a goal with timeout (limit queue size to avoid flooding)
      if (this.goals.length < 5) {
        this.goals.unshift({
          type: 'move_to',
          priority: 0,
          target: { x: targetX, y: targetY, z: targetZ },
          timeout: Date.now() + 60000, // 1 minute timeout
          description: '安全なランダム探索移動'
        });
      } else {
        this.logger.log('探索ゴールが多すぎるため新規追加をスキップ');
      }
    } catch (error) {
      this.logger.log(`探索エラー: ${error.message}`);
    }
  }

  // StateManagerへの重要メッセージ更新のみ保持
  updateStateWithLog(message, level = 'info') {
    if (this.stateManager && (level === 'error' || level === 'warn' || level === 'important')) {
      const state = this.stateManager.getState();
      if (!state.logHistory) {
        this.stateManager.updateState({ logHistory: [] }, 'logging');
      }

      const logEntry = {
        timestamp: Date.now(),
        level,
        message,
        context: {
          currentTask: this.currentTask?.type || null,
          position: state.position,
          health: state.health,
          food: state.food
        }
      };

      const newHistory = [...(state.logHistory || []), logEntry];

      if (newHistory.length > 100) {
        newHistory.shift();
      }

      this.stateManager.updateState({ logHistory: newHistory }, 'logging');
    }
  }

  calculateSkillTimeout(task) {
    const baseTimeout = 60000; // Reduced from 60000ms to 30000ms for faster response
    const taskType = task.type;
    const params = task.params || {};

    // Task-specific timeout multipliers - reduced for better performance
    const timeoutMultipliers = {
      explore: 0.8, // Further reduced for faster exploration
      gather_wood: 0.6, // Reduced for quicker resource gathering
      craft_tools: 1.5, // Reduced but still generous for crafting
      mine_block: 0.8, // Reduced for quicker mining
      build_shelter: 1.2, // Reduced but adequate for building
      move_to: 0.4, // Reduced for faster movement
      follow: 0.8, // Reduced for more responsive following
      find_food: 0.8 // Reduced for faster food gathering
    };

    let multiplier = timeoutMultipliers[taskType] || 1.0; // Further reduced default for better performance

    // Adjust based on parameters
    if (params.amount && params.amount > 10) {
      multiplier *= 1.2; // Reduced from 1.5
    }

    if (params.radius && params.radius > 50) {
      multiplier *= 1.1; // Reduced from 1.3
    }

    // Adjust based on bot health and conditions
    if (this.bot.health < 10) {
      multiplier *= 0.7; // Reduced from 0.8 for faster response when low health
    }

    if (this.observer.isDangerous()) {
      multiplier *= 0.5; // Reduced from 0.6 for much faster dangerous situation response
    }

    // Minimum and maximum timeout limits - reduced for better performance
    const calculatedTimeout = baseTimeout * multiplier;
    const minTimeout = 15000; // Reduced from 30000ms to 15000ms
    const maxTimeout = 180000; // Reduced from 600000ms (10 minutes) to 180000ms (3 minutes)

    return Math.max(minTimeout, Math.min(maxTimeout, calculatedTimeout));
  }

  // Multi-player coordination methods
  async requestResourceAccess(location, resourceType, estimatedTime = 300000) {
    if (!this.coordinator) {
      return { granted: true }; // No coordination needed in single player
    }

    const result = await this.coordinator.requestResourceAccess(
      this.playerId,
      location,
      resourceType,
      estimatedTime
    );

    if (result.granted) {
      this.logger.log(`リソースアクセス許可: ${resourceType} at ${JSON.stringify(location)}`);
    } else {
      this.logger.log(`リソースアクセス拒否: ${result.reason}. 待機時間: ${Math.round(result.waitTime / 1000)}秒`);
    }

    return result;
  }

  releaseResourceClaim(location, resourceType) {
    if (!this.coordinator) return true;

    const resourceKey = this.coordinator.generateResourceKey(location, resourceType);
    return this.coordinator.releaseResourceClaim(resourceKey, this.playerId);
  }

  releaseAllResourceClaims() {
    if (!this.coordinator) {
      this.bot.chat('マルチプレイヤー調整機能が無効です');
      return;
    }

    const player = this.coordinator.players.get(this.playerId);
    if (player) {
      const claimCount = player.resourceClaims.size;
      for (const resourceKey of Array.from(player.resourceClaims)) {
        this.coordinator.releaseResourceClaim(resourceKey, this.playerId);
      }
      this.bot.chat(`${claimCount}個のリソース要求を解除しました`);
    }
  }

  displayCoordinationStatus() {
    if (!this.coordinator) {
      this.bot.chat('マルチプレイヤー調整機能が無効です');
      return;
    }

    const status = this.coordinator.getStatus();
    const player = this.coordinator.players.get(this.playerId);

    this.bot.chat(`調整状況: プレイヤー ${status.playersCount}名, アクティブ要求 ${status.activeResourceClaims}件`);

    if (player) {
      this.bot.chat(`協力スコア: ${player.cooperationScore}, 現在の要求: ${player.resourceClaims.size}件`);
    }
  }

  async coordinateWithOtherPlayers(taskType, requirements) {
    if (!this.coordinator) return null;

    return await this.coordinator.coordinateTask(taskType, requirements, [this.playerId]);
  }

  async sendMessageToPlayer(targetPlayerId, message, messageType = 'info') {
    if (!this.coordinator) {
      this.bot.chat(`調整機能が無効: ${targetPlayerId}にメッセージを送信できません`);
      return;
    }

    await this.coordinator.sendMessage(this.playerId, targetPlayerId, message, messageType);
  }

  // Enhanced resource-aware task execution
  async executeResourceAwareTask(task) {
    // Check if task requires exclusive resource access
    const resourceRequirements = this.analyzeTaskResourceRequirements(task);

    for (const requirement of resourceRequirements) {
      const accessResult = await this.requestResourceAccess(
        requirement.location,
        requirement.type,
        requirement.estimatedTime
      );

      if (!accessResult.granted) {
        // Wait or find alternative
        if (accessResult.waitTime < 20000) { // Reduced from 60000ms to 20000ms for faster response
          this.logger.log(`リソース待機中: ${accessResult.waitTime / 1000}秒`);
          await this.sleep(accessResult.waitTime);
          return await this.executeResourceAwareTask(task); // Retry
        } else {
          // Find alternative task or location
          this.logger.log('代替リソースを探索中...');
          return { success: false, reason: 'Resource conflict, seeking alternatives' };
        }
      }
    }

    // Execute task with resource protection
    try {
      const result = await this.executeCurrentTask();

      // Release resources after task completion
      for (const requirement of resourceRequirements) {
        this.releaseResourceClaim(requirement.location, requirement.type);
      }

      return result;
    } catch (error) {
      // Release resources on error
      for (const requirement of resourceRequirements) {
        this.releaseResourceClaim(requirement.location, requirement.type);
      }
      throw error;
    }
  }

  analyzeTaskResourceRequirements(task) {
    const requirements = [];

    if (!task) return requirements;

    switch (task.type) {
    case 'mine_block':
      if (task.params.position) {
        requirements.push({
          location: task.params.position,
          type: 'mining_area',
          estimatedTime: 120000 // 2 minutes
        });
      }
      break;

    case 'gather_wood': {
      // Find nearby trees and claim area
      const treeBlock = this.bot.findBlock({
        matching: (block) => block.name && block.name.includes('_log'),
        maxDistance: 32
      });

      if (treeBlock) {
        requirements.push({
          location: treeBlock.position,
          type: 'wood_gathering',
          estimatedTime: 180000 // 3 minutes
        });
      }
      break;
    }

    case 'build_shelter':
      if (task.params.location) {
        requirements.push({
          location: task.params.location,
          type: 'building_area',
          estimatedTime: 600000 // 10 minutes
        });
      }
      break;
    }

    return requirements;
  }

  // State management methods
  setupStateSync() {
    // Subscribe to state changes from various components
    this.stateManager.subscribe('ai_core', (updates, changedKeys, fullState) => {
      // Sync legacy properties for backward compatibility
      if (changedKeys.has('currentTask')) {
        this.currentTask = fullState.currentTask;
      }
      if (changedKeys.has('activeGoals')) {
        this.goals = fullState.activeGoals;
      }
      if (changedKeys.has('inventory')) {
        this.inventory = fullState.inventory;
      }
    }, ['currentTask', 'activeGoals', 'inventory']);
  }

  displayStateStatus() {
    const state = this.stateManager.getState();
    const validation = this.stateManager.validateState();

    this.bot.chat(`状態: 体力 ${state.health}/20, 食料 ${state.food}/20`);
    this.bot.chat(`位置: (${Math.round(state.position.x)}, ${Math.round(state.position.y)}, ${Math.round(state.position.z)})`);
    this.bot.chat(`スキル数: ${state.knownSkills.size}, 完了タスク: ${state.completedTasks.length}`);

    if (validation.length > 0) {
      this.bot.chat(`状態警告: ${validation.join(', ')}`);
    }
  }

  displayPerformanceStats() {
    const stats = this.stateManager.getPerformanceStats();

    this.bot.chat('パフォーマンス統計:');
    this.bot.chat(`スキル: ${stats.totalSkills}, 完了タスク: ${stats.totalTasksCompleted}`);
    this.bot.chat(`成功率: ${Math.round(stats.overallSuccessRate)}%, 平均時間: ${Math.round(stats.averageTaskTime / 1000)}秒`);
    this.bot.chat(`協力スコア: ${stats.cooperationScore}, アクティブ要求: ${stats.activeClaims}`);
  }

  // Enhanced task management with state tracking (duplicate removed)


  // sleep method moved to enhanced version below

  // Stop the main AI loop gracefully
  async shutdown(reason = 'manual') {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.isShuttingDown = true;
    this.isInitialized = false;
    this.lifecycle.abort();
    this.wakeSleep?.();
    clearInterval(this.observationTimer);
    this.performanceMonitor.stopMonitoring();
    this.taskPlanner.pathfindingCache?.shutdown();
    this.observer.shutdown();
    this.releaseAllResourceClaims();
    this.shutdownPromise = (async () => {
      await this.stop(reason);
      await this.initializing?.catch(() => {});
      await this.loopPromise;
    })();
    await this.shutdownPromise;
    // Manager and mineflayer own their listeners and connection lifecycle.
  }

  regenerateDefaultGoals() {
    this.logger.log('Regenerating resource-focused goals');

    // Evaluate current inventory to determine priorities
    const inventorySummary = InventoryUtils.getInventorySummary(this.bot);
    const { wood: woodCount, stone: stoneCount, hasPickaxe, hasAxe } = inventorySummary;

    // Dynamic goal generation based on current needs
    let goals = [];

    // Always prioritize basic resources
    if (woodCount < 20) {
      goals.push({ type: 'gather_wood', priority: 1, description: '木材を収集する' });
    }

    if (stoneCount < 10) {
      goals.push({ type: 'find_stone', priority: 2, description: '石を採取する' });
    }

    // Craft tools if needed and have materials
    if (!hasPickaxe || !hasAxe) {
      goals.push({ type: 'craft_basic_tools', priority: 3, description: '基本道具を作成する' });
    }

    // Food only when actually needed
    if (this.bot.food < 15) {
      goals.push({ type: 'find_food', priority: 4, description: '食料源を探す' });
    }

    // Exploration only as last resort and less frequently
    if (Math.random() < 0.3) { // Only 30% chance to add exploration
      goals.push({ type: 'explore', priority: 5, description: '世界を探索する' });
    }

    // Add crafting opportunities when we have resources
    if (woodCount >= 10 && !inventorySummary.hasCraftingTable) {
      goals.push({ type: 'craft_workbench', priority: 3, description: '作業台を作成する' });
    }

    // Ensure we always have some goals
    if (goals.length === 0) {
      goals = [
        { type: 'gather_wood', priority: 1, description: '木材を収集する' },
        { type: 'find_stone', priority: 2, description: '石を採取する' }
      ];
    }

    this.goals = goals;
    this.logger.log(`新しいゴールを生成: ${goals.map(g => g.type).join(', ')}`);
  }

  async checkCraftingOpportunities() {
    try {
      // Check if we have enough wood for tools but no tools yet
      const inventorySummary = InventoryUtils.getInventorySummary(this.bot);
      const { wood: woodCount, hasPickaxe, hasAxe, hasCraftingTable } = inventorySummary;

      // Priority 1: Craft workbench if we have wood but no workbench
      if (woodCount >= 2 && !hasCraftingTable) {
        this.goals.unshift({
          type: 'craft_workbench',
          priority: 2,
          description: '作業台を作成してクラフトを可能にする'
        });
        this.logger.log('作業台クラフトの機会を検出');
        return;
      }

      // Priority 2: Craft basic tools if we have materials but no tools
      if (woodCount >= 5 && (!hasPickaxe || !hasAxe)) {
        this.goals.unshift({
          type: 'craft_basic_tools',
          priority: 2,
          description: '基本道具を作成して効率を向上させる'
        });
        this.logger.log('道具クラフトの機会を検出');
      }
    } catch (error) {
      this.logger.log(`クラフト機会チェックエラー: ${error.message}`);
      console.error('Full error details:', error);
      console.error('Error stack:', error.stack);
    }
  }

  async performResourceFocusedIdle() {
    try {
      // Instead of random exploration, focus on resource gathering
      const inventorySummary = InventoryUtils.getInventorySummary(this.bot);
      const { wood: woodCount, stone: stoneCount } = inventorySummary;
      // Monitor health status for emergency responses
      const food = this.bot.food || 0;

      // Priority-based idle activities
      if (food < 12) {
        this.goals.unshift({
          type: 'find_food',
          priority: 1,
          description: '体力保持のための食料確保'
        });
        this.logger.log('アイドル中: 食料不足を検出');
        return;
      }

      if (woodCount < 15) {
        this.goals.unshift({
          type: 'gather_wood',
          priority: 2,
          description: 'アイドル中の木材収集'
        });
        this.logger.log('アイドル中: 木材を収集します');
        return;
      }

      if (stoneCount < 10) {
        this.goals.unshift({
          type: 'find_stone',
          priority: 2,
          description: 'アイドル中の石材収集'
        });
        this.logger.log('アイドル中: 石を採取します');
        return;
      }

      // Only explore as absolute last resort and for shorter duration
      if (Math.random() < 0.2) { // Only 20% chance
        this.goals.unshift({
          type: 'explore',
          priority: 6,
          description: '短時間の探索活動',
          radius: 30 // Smaller exploration radius
        });
        this.logger.log('アイドル中: 短時間の探索を実行');
      } else {
        // Most of the time, just rest briefly
        this.logger.log('アイドル中: リソースが十分なため休憩');
        // Log inventory summary during idle to monitor resource levels
        InventoryUtils.logInventoryDetails(this.bot, 'アイドル時');
        await this.sleep(2000);
      }
    } catch (error) {
      this.logger.log(`アイドル処理エラー: ${error.message}`);
      // Fallback to short rest
      await this.sleep(3000);
    }
  }

  async checkAutoToolCrafting() {
    try {
      this.logger.log('自動ツール作成チェック開始');

      const inventorySummary = InventoryUtils.getInventorySummary(this.bot);
      const {
        wood: woodCount,
        availablePlanks,
        hasPickaxe,
        hasAxe,
        hasCraftingTable,
        canCraftWorkbench,
        canCraftBasicTools
      } = inventorySummary;

      this.logger.log(`素材状況: 木材${woodCount}個, 利用可能板材${availablePlanks}個, 作業台${hasCraftingTable ? '有' : '無'}`);

      // Check if we have enough resources for tool upgrades
      const currentTools = this.getCurrentTools();

      // Priority 1: Create workbench if we can craft one
      if (canCraftWorkbench) {
        this.logger.log(`自動作成: 作業台が必要です（板材${availablePlanks}個利用可能）`);
        this.goals.unshift({
          type: 'craft_workbench',
          priority: 1,
          description: '自動作成: 作業台を作成してクラフトを可能にする',
          autoGenerated: true
        });
        return;
      }

      // Priority 2: Create basic tools if we have resources but no tools
      if (canCraftBasicTools && !hasPickaxe && !hasAxe) {
        this.logger.log(`自動作成: 基本ツールが必要です（板材${availablePlanks}個利用可能）`);
        this.goals.unshift({
          type: 'craft_tools',
          priority: 1,
          description: '自動作成: 基本ツール（つるはし、斧）を作成',
          autoGenerated: true,
          tools: ['wooden_pickaxe', 'wooden_axe']
        });
        return;
      }

      // Priority 3: Upgrade tools when possible
      for (const tool of currentTools) {
        const upgradeInfo = InventoryUtils.checkToolUpgradeAvailability(this.bot, tool.name);

        if (upgradeInfo.canUpgrade && upgradeInfo.bestUpgrade) {
          const upgrade = upgradeInfo.bestUpgrade;
          this.logger.log(`自動アップグレード: ${tool.name} → ${upgrade.to}`);

          this.goals.unshift({
            type: 'craft_tools',
            priority: 2,
            description: `自動アップグレード: ${tool.name}を${upgrade.to}にアップグレード`,
            autoGenerated: true,
            upgradeFrom: tool.name,
            tools: [upgrade.to],
            materials: upgrade.materials
          });
          return; // Only upgrade one tool at a time
        }
      }

      // Priority 4: Create missing tool types
      const toolNeeds = this.analyzeToolNeeds(inventorySummary);
      if (toolNeeds.length > 0) {
        const nextTool = toolNeeds[0];
        this.logger.log(`自動作成: ${nextTool.type}が必要です`);

        this.goals.unshift({
          type: 'craft_tools',
          priority: 3,
          description: `自動作成: ${nextTool.type}を作成`,
          autoGenerated: true,
          tools: [nextTool.name],
          reason: nextTool.reason
        });
      }
    } catch (error) {
      this.logger.log(`自動ツール作成チェックエラー: ${error.message}`);
    }
  }

  getCurrentTools() {
    try {
      if (!this.bot || !this.bot.inventory) return [];

      const tools = this.bot.inventory.items().filter(item =>
        item && item.name && (
          item.name.includes('pickaxe') ||
          item.name.includes('axe') ||
          item.name.includes('sword') ||
          item.name.includes('shovel') ||
          item.name.includes('hoe')
        )
      );

      return tools;
    } catch (error) {
      this.logger.log(`現在のツール取得エラー: ${error.message}`);
      return [];
    }
  }

  analyzeToolNeeds(inventorySummary) {
    const needs = [];
    const { wood: woodCount, stone: stoneCount, hasPickaxe, hasAxe } = inventorySummary;

    // Check for missing essential tools
    if (!hasPickaxe && stoneCount >= 3) {
      needs.push({
        type: 'pickaxe',
        name: 'stone_pickaxe',
        reason: '石の採掘にはつるはしが必要',
        priority: 1
      });
    } else if (!hasPickaxe && woodCount >= 3) {
      needs.push({
        type: 'pickaxe',
        name: 'wooden_pickaxe',
        reason: '基本的な採掘作業にはつるはしが必要',
        priority: 2
      });
    }

    if (!hasAxe && woodCount >= 3) {
      needs.push({
        type: 'axe',
        name: stoneCount >= 3 ? 'stone_axe' : 'wooden_axe',
        reason: '木材の効率的な収集には斧が必要',
        priority: 3
      });
    }

    // Check for sword based on hostile entities
    const dangers = this.observer.getNearbyDangers();
    const hostileEntities = dangers.filter(d => d.type === 'hostile_entity');

    if (hostileEntities.length > 0) {
      const hasSword = InventoryUtils.hasTool(this.bot, 'sword');
      if (!hasSword && (woodCount >= 2 || stoneCount >= 2)) {
        needs.push({
          type: 'sword',
          name: stoneCount >= 2 ? 'stone_sword' : 'wooden_sword',
          reason: '敵対MOBとの戦闘には剣が必要',
          priority: 1
        });
      }
    }

    // Sort by priority
    return needs.sort((a, b) => a.priority - b.priority);
  }

  isResourceGatheringTask(taskName) {
    const resourceTasks = [
      'gather_wood',
      'mine_block',
      'collect_item',
      'find_food',
      'harvest',
      'dig',
      'mine_stone',
      'mine_coal',
      'mine_iron'
    ];

    return resourceTasks.includes(taskName);
  }

  handleDeath() {
    this.deathCount++;
    this.isRespawning = true;
    this.stop('death').catch(error => this.logger.error(error.message));
  }

  handleRespawn() {
    this.isRespawning = false;
    // Respawning never overrides an explicit stop or starts new goals.
  }

  enterSafeMode() {
    return this.stop('safe_mode');
  }

  // Enhanced sleep method to handle respawn state
  async sleep(ms) {
    if (this.isShuttingDown) return;
    return new Promise(resolve => {
      this.wakeSleep = () => {
        clearTimeout(this.sleepTimeout);
        this.sleepTimeout = null;
        this.wakeSleep = null;
        resolve();
      };
      this.sleepTimeout = setTimeout(this.wakeSleep, ms);
    });
  }

  // 全プレイヤーの準備完了を待機
  async waitForAllPlayersReady() {
    const maxWaitTime = 120000; // 2分でタイムアウト（5分は長すぎる）
    const checkInterval = 2000; // 2秒間隔でチェック
    const startTime = Date.now();

    while (!this.isShuttingDown && Date.now() - startTime < maxWaitTime) {
      const canStart = this.coordinator.canStartTasks(this.playerId);

      if (canStart.canStart) {
        this.logger.log(`✅ ${canStart.reason} - タスクを開始します！`);
        return;
      }

      this.logger.log(`⏳ ${canStart.reason} (残り${canStart.waitingFor}人)`);
      await this.sleep(checkInterval);
    }

    // タイムアウト後の処理を改善
    if (this.isShuttingDown) return;
    this.logger.warn('⚠️ 同期待機がタイムアウトしました。単独でタスクを開始します。');
    this.logger.log('💡 他のプレイヤーが参加していない可能性があります。');

    // 強制的に開始フラグを設定
    if (this.coordinator && typeof this.coordinator.forceStart === 'function') {
      this.coordinator.forceStart(this.playerId);
    }

    // タイムアウト後もタスクを開始
  }

  // Enhanced shutdown functionality integrated with main shutdown method above
}

module.exports = { MinecraftAI };
