const { SkillLibrary } = require('./SkillLibrary');
const { TaskPlanner } = require('./TaskPlanner');
const { EnvironmentObserver } = require('./EnvironmentObserver');
const { VoyagerAI } = require('./VoyagerAI');
const { MultiPlayerCoordinator } = require('./MultiPlayerCoordinator');
const { StateManager } = require('./StateManager');

class MinecraftAI {
  constructor(bot, coordinator = null) {
    this.bot = bot;
    this.stateManager = new StateManager(bot);
    this.skillLibrary = new SkillLibrary();
    this.taskPlanner = new TaskPlanner(bot);
    this.observer = new EnvironmentObserver(bot);
    this.voyagerAI = new VoyagerAI(bot);
    this.coordinator = coordinator; // Multi-player coordinator (optional)
    
    // Legacy properties for backward compatibility
    this.currentTask = null;
    this.goals = [];
    this.inventory = new Map();
    this.exploredAreas = new Set();
    
    this.isInitialized = false;
    this.debugMode = process.env.DEBUG_MODE === 'true';

    // Enhanced socket safety to prevent EPIPE errors - comprehensive protection
    this.setupComprehensiveEPIPEProtection();
    
    // Enhanced disconnect handling with immediate shutdown
    const handleDisconnect = (reason) => {
      this.log(`Connection lost: ${reason}`, 'warn');
      this.shutdown(reason);
    };
    
    // Graceful shutdown handling: stop AI loop when bot disconnects
    this.bot.on('end', () => handleDisconnect('end'));
    this.bot.on('kicked', () => handleDisconnect('kicked'));
    this.bot.on('error', (err) => {
      this.log(`Bot error: ${err.message}`, 'error');
      handleDisconnect('error');
    });
    
    // Additional socket-level error handling for EPIPE prevention
    if (this.bot._client && this.bot._client.socket) {
      this.bot._client.socket.on('error', (err) => {
        if (err.code === 'EPIPE') {
          this.log('Socket EPIPE error detected, initiating graceful shutdown', 'warn');
          handleDisconnect('socket_epipe');
        } else {
          this.log(`Socket error: ${err.message}`, 'error');
        }
      });
    }
    // playerId is not available until login; set placeholder
    this.playerId = bot.username || 'unknown';
    
    // Delay coordinator registration until login so username is defined
    if (this.coordinator) {
      bot.once('login', () => {
        this.playerId = bot.username;
        this.coordinator.registerPlayer(this.playerId, bot, this);
      });
    }
    
    // Set up state synchronization
    this.setupStateSync();
  }

  initialize() {
    if (this.isInitialized) return;
    
    this.log('AIシステムを初期化中...');
    
    // Load basic skills
    this.skillLibrary.loadBasicSkills();
    
    // Set simple exploration goals
    // まず木材収集を優先し、その後探索へ
    this.goals = [
      { type: 'gather_wood', priority: 1, description: '木材を収集する' },
      { type: 'explore', priority: 2, description: '世界を探索する' },
      { type: 'find_food', priority: 3, description: '食料源を探す' }
    ];
    
    this.isInitialized = true;
    this.log('AIシステムの初期化が完了しました');
    
    // Start the main AI loop
    this.startMainLoop();
  }

  onSpawn() {
    this.log('ボットがスポーンしました。探索を開始します...');
    this.observer.updatePosition();
  }

  async onChat(username, message) {
    this.log(`${username}からのチャット: ${message}`);
    
    // Simple command processing
    if (message.startsWith('!')) {
      await this.processCommand(username, message.slice(1));
    }
  }

  onDeath() {
    this.log('ボットが死亡しました。状態をリセットします...');
    this.currentTask = null;
    this.inventory.clear();
  }

  async processCommand(username, command) {
    const [cmd, ...args] = command.split(' ');
    
    switch (cmd.toLowerCase()) {
      case 'status':
        this.reportStatus();
        break;
      case 'goto':
        if (args.length >= 3) {
          const [x, y, z] = args.map(Number);
          this.setGoal({ type: 'move_to', target: { x, y, z }, priority: 0 });
        }
        break;
      case 'follow':
        this.setGoal({ type: 'follow', target: username, priority: 0 });
        break;
      case 'stop':
        this.currentTask = null;
        this.bot.chat('現在のタスクを停止します');
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

  setGoal(goal) {
    this.goals.unshift(goal);
    this.log(`新しい目標を設定: ${goal.type}`);
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
    curriculum.forEach((task, index) => {
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
    this.log('メインAIループを開始...');
    
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
        
        // Memory cleanup every 100 iterations
        if (loopCount % 100 === 0) {
          this.performMaintenanceCleanup();
        }
        
      } catch (error) {
        this.log(`メインループでエラー: ${error.message}`);
        
        // Optimized exponential backoff with reduced maximum delay
        const errorSleep = Math.min(10000, 500 * Math.pow(1.3, this.consecutiveErrors || 0)); // Reduced max from 30s to 10s, base from 1000ms to 500ms
        await this.sleep(errorSleep);
        
        this.consecutiveErrors = (this.consecutiveErrors || 0) + 1;
        
        // Reset error count after successful iteration
        if (this.consecutiveErrors > 5) {
          this.log('連続エラーが多すぎます。状態をリセットします。');
          this.performEmergencyReset();
        }
      }
      
      const loopTime = Date.now() - loopStart;
      this.updatePerformanceMetrics(loopTime);
    }
  }

  calculateAdaptiveSleep() {
    const baseSleep = 300; // Reduced from 1000ms to 300ms for better responsiveness
    
    // Adjust based on current situation
    let multiplier = 1.0;
    
    // Sleep less when in danger
    if (this.observer.isDangerous()) {
      multiplier = 0.3; // Reduced from 0.5 for faster danger response
    }
    
    // Sleep more when idle, but not too much
    if (!this.currentTask && this.goals.length === 0) {
      multiplier = 1.5; // Reduced from 2.0 to stay responsive
    }
    
    // Sleep less when low on health/food
    if (this.bot.health < 10 || this.bot.food < 10) {
      multiplier = 0.2; // Reduced from 0.7 for urgent response
    }
    
    // Sleep more at night (if not urgent tasks)
    const state = this.stateManager.getState(['timeOfDay']);
    if (state.timeOfDay === 'night' && !this.hasUrgentTasks()) {
      multiplier = 1.2; // Reduced from 1.5 for better nighttime responsiveness
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
      
      this.log('定期メンテナンスクリーンアップ完了');
    } catch (error) {
      this.log(`メンテナンスクリーンアップエラー: ${error.message}`);
    }
  }

  performEmergencyReset() {
    try {
      // Clear current task and goals
      this.currentTask = null;
      this.goals = [];
      
      // Reset state if needed
      if (this.stateManager && this.stateManager.rollbackToLastValid) {
        this.stateManager.rollbackToLastValid();
      }
      
      // Reset consecutive errors
      this.consecutiveErrors = 0;
      
      // Set basic survival goals
      this.goals = [
        { type: 'find_food', priority: 1, description: '緊急：食料確保' },
        { type: 'explore', priority: 2, description: '安全な探索' }
      ];
      
      this.log('緊急リセット完了');
    } catch (error) {
      this.log(`緊急リセットエラー: ${error.message}`);
    }
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
    this.log(`パフォーマンス: 平均ループ時間 ${Math.round(metrics.averageLoopTime)}ms, 最大 ${metrics.maxLoopTime}ms, 総ループ ${metrics.totalLoops}`);
    
    // Report state manager stats if available
    if (this.stateManager) {
      const stats = this.stateManager.getPerformanceStats();
      this.log(`状態統計: スキル ${stats.totalSkills}, 成功率 ${Math.round(stats.overallSuccessRate)}%`);
    }
  }

  setupComprehensiveEPIPEProtection() {
    // Conservative EPIPE protection - remove caching for real-time safety
    
    // Protect chat function with real-time socket checks
    if (typeof this.bot.chat === 'function') {
      const originalChat = this.bot.chat.bind(this.bot);
      this.bot.chat = (message) => {
        if (!this.isSocketSafe()) {
          if (this.debugMode) console.log('[SafeChat] Socket unsafe, suppressing chat');
          return;
        }
        try {
          originalChat(message);
        } catch (err) {
          if (err.code === 'EPIPE') {
            this.log('EPIPE error in chat, initiating graceful shutdown', 'warn');
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
        this.bot[method] = (...args) => {
          if (!this.isSocketSafe()) {
            if (this.debugMode) console.log(`[Safe${method}] Socket unsafe, suppressing ${method}`);
            return Promise.resolve();
          }
          try {
            return original(...args);
          } catch (err) {
            if (err.code === 'EPIPE') {
              this.log(`EPIPE error in ${method}, initiating graceful shutdown`, 'warn');
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
    this.log('EPIPE error detected, initiating graceful shutdown', 'error');
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
      this.log(`Error during EPIPE cleanup: ${e.message}`, 'debug');
    }
  }

  async mainLoopIteration() {
    try {
      // Synchronize state with bot
      this.stateManager.syncWithBot();
      
      // Update observations with safety checks
      this.observer.updatePosition();
      
      // Update coordinator with current status
      if (this.coordinator) {
        const state = this.stateManager.getState(['position', 'health', 'food']);
        this.coordinator.updatePlayer(this.playerId, {
          position: state.position,
          currentTask: this.currentTask?.type || null,
          health: state.health,
          food: state.food
        });
      }
      
      // Handle immediate threats first
      const dangerResult = await this.handleImmediateThreats();
      if (dangerResult.shouldContinue === false) {
        return; // Skip normal processing if in danger mode
      }
      
      // Check if current task is complete or failed
      if (this.currentTask && this.taskPlanner.isTaskComplete(this.currentTask)) {
        this.log(`タスク完了: ${this.currentTask.type}`);
        this.taskPlanner.addTaskToHistory(this.currentTask, { success: true, completed: true });
        this.currentTask = null;
      }
      
      // Check for task timeout
      if (this.currentTask && this.currentTask.timeout && Date.now() > this.currentTask.timeout) {
        this.log(`タスクタイムアウト: ${this.currentTask.type}`);
        this.taskPlanner.addTaskToHistory(this.currentTask, { success: false, reason: 'timeout' });
        this.currentTask = null;
      }
      
      // Select next task if none active with enhanced validation
      if (!this.currentTask && this.goals.length > 0) {
        const nextGoal = this.goals.shift();
        
        // Enhanced goal validation with detailed logging
        if (!nextGoal) {
          this.log('Goal is null or undefined, regenerating default goals', 'warn');
          this.regenerateDefaultGoals();
          return;
        }
        
        if (!nextGoal.type || typeof nextGoal.type !== 'string') {
          this.log(`Invalid goal type detected: ${JSON.stringify(nextGoal)}, skipping`, 'warn');
          return;
        }
        
        try {
          this.currentTask = await this.taskPlanner.planTask(nextGoal);
          
          if (this.currentTask && this.currentTask.type) {
            // Add startTime for proper lifecycle tracking
            this.currentTask.startTime = Date.now();
            this.log(`新しいタスクを開始: ${this.currentTask.type}`);
          } else {
            this.log('Task planning returned invalid task', 'warn');
            this.currentTask = null;
          }
        } catch (planError) {
          this.log(`Task planning failed: ${planError.message}`, 'error');
          this.currentTask = null;
        }
      }
      
      // Execute current task
      if (this.currentTask) {
        await this.executeCurrentTask();
      } else {
        // Idle behavior - simple exploration with safety checks
        await this.safeExploration();
      }
      
    } catch (error) {
      this.log(`メインループエラー: ${error.message}`);
      // Add delay to prevent rapid error loops
      await this.sleep(5000);
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
        this.log('低体力状態を検出、食料探索を優先');
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
          this.log(`敵対MOB ${nearest.entityType} が接近中、回避行動`);
          await this.performEvasiveAction(nearest);
          return { shouldContinue: false }; // Skip normal processing
        }
      }
      
      return { shouldContinue: true };
      
    } catch (error) {
      this.log(`脅威処理エラー: ${error.message}`);
      return { shouldContinue: true };
    }
  }

  async performEvasiveAction(threat) {
    try {
      if (!this.bot?.entity?.position) {
        this.log('回避行動エラー: プレイヤー位置が取得できません');
        return;
      }
      
      if (!threat?.position) {
        this.log('回避行動エラー: 脅威の位置が不明です');
        return;
      }
      
      const currentPos = this.bot.entity.position;
      const threatPos = threat.position;
      
      // Calculate escape direction (opposite from threat)
      const escapeX = currentPos.x + (currentPos.x - threatPos.x) * 2;
      const escapeZ = currentPos.z + (currentPos.z - threatPos.z) * 2;
      
      this.log(`回避行動: (${Math.round(escapeX)}, ${Math.round(escapeZ)})方向に移動`);
      
      // Use move skill for evasion
      const moveSkill = this.skillLibrary.getSkill('move_to');
      if (moveSkill) {
        await Promise.race([
          moveSkill.execute(this.bot, { x: escapeX, y: currentPos.y, z: escapeZ }),
          this.sleep(5000) // Max 5 seconds for evasion
        ]);
      }
      
    } catch (error) {
      this.log(`回避行動エラー: ${error.message}`);
    }
  }

  async executeCurrentTask() {
    // Enhanced validation to prevent null reference errors
    if (!this.currentTask || typeof this.currentTask !== 'object') {
      this.log('executeCurrentTask: 無効なタスク', 'warn');
      return;
    }
    
    if (!this.currentTask.type) {
      this.log('executeCurrentTask: タスクタイプが空です', 'warn');
      this.currentTask = null;
      return;
    }
    
    const taskName = this.currentTask.type;
    this.log(`タスク実行中: ${taskName}`);
    
    try {
      // Check if bot is still connected before executing
      if (!this.isSocketSafe()) {
        this.log('ソケットが安全ではないため、タスクをスキップします', 'warn');
        this.currentTask = null;
        return;
      }
      
      const skill = await this.getOrGenerateSkill(taskName);
      if (!skill) {
        this.handleTaskFailure(taskName, 'No skill available');
        return;
      }
      
      const result = await this.executeSkillSafely(skill, taskName);
      await this.processTaskResult(result, taskName);
      
    } catch (error) {
      await this.handleTaskError(error, taskName);
    }
    
    // Always clear the current task when done
    this.currentTask = null;
  }

  async getOrGenerateSkill(taskName) {
    let skill = this.skillLibrary.getSkill(taskName);
    
    // If no predefined skill exists, try to generate one with Voyager AI
    if (!skill) {
      this.log(`${taskName}の事前定義スキルがありません。AIで生成中...`);
      try {
        const context = this.observer.getObservationSummary();
        skill = await this.voyagerAI.generateSkill(this.currentTask, context);
      } catch (aiError) {
        this.log(`AIスキル生成に失敗: ${aiError.message}`);
        this.currentTask = null;
        return null;
      }
    }
    
    return skill;
  }

  async executeSkillSafely(skill, taskName) {
    // Calculate dynamic timeout based on task complexity
    const dynamicTimeout = this.calculateSkillTimeout(this.currentTask);
    
    // Execute the skill with dynamic timeout and proper error handling
    return await this.executeSkillWithTimeout(skill, this.currentTask.params, dynamicTimeout);
  }

  async processTaskResult(result, taskName) {
    // Guard against null task before any processing
    if (!this.currentTask) {
      this.log(`processTaskResult: currentTask is null, aborting result processing`, 'warn');
      return;
    }
    
    // Learn from the experience if Voyager AI is available with comprehensive null protection
    try {
      if (this.currentTask && this.currentTask.type) {
        const context = this.observer.getObservationSummary();
        await this.voyagerAI.learnFromExperience(this.currentTask, result, context);
      } else {
        this.log('Skipping learning: current task is null or invalid', 'debug');
      }
    } catch (learningError) {
      this.log(`Learning failed: ${learningError.message}`);
    }
    
    // Calculate execution time safely
    let executionTime = 0;
    if (this.currentTask && this.currentTask.startTime) {
      executionTime = Date.now() - this.currentTask.startTime;
    } else {
      this.log(`processTaskResult: currentTask missing startTime`, 'warn');
    }
    
    if (result && result.success) {
      // currentTask may have been cleared by skill internals
      if (!this.currentTask) {
        this.log(`processTaskResult: currentTask lost before success handling`, 'warn');
        return;
      }
      this.log(`タスクが正常に完了: ${taskName}`);
      this.announceTaskCompletion(taskName, result);
      
      // Update state manager with successful task completion
      this.stateManager.completeCurrentTask(result);
      this.stateManager.updateSkillPerformance(taskName, true, executionTime);
    } else {
      if (!this.currentTask) {
        this.log(`processTaskResult: currentTask lost before failure handling`, 'warn');
        return;
      }
      this.log(`タスクが失敗: ${taskName} - ${result?.error || '不明なエラー'}`);
      this.handleTaskFailure(taskName, result?.error);
      
      // Update state manager with failed task
      this.stateManager.completeCurrentTask(result || { success: false, error: '不明なエラー' });
      this.stateManager.updateSkillPerformance(taskName, false, executionTime);
    }
  }

  async handleTaskError(error, taskName) {
    this.log(`タスク実行で致命的エラー ${taskName}: ${error.message}`);
    
    // Enhanced error handling with better logging
    if (!this.currentTask) {
      this.log('handleTaskError: currentTask is null, skipping learning/progress updates', 'warn');
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
        this.log(`失敗から学習中にエラー: ${learningError.message}`);
      }
    } else {
      this.log('Skipping learning from failure: task name is invalid', 'debug');
    }
    
    this.log(`タスク ${taskName} が失敗: ${error.message}`);
    this.handleTaskFailure(taskName, error.message);
  }

  async executeSkillWithTimeout(skill, params, timeoutMs) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Skill execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const result = await skill.execute(this.bot, params);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        resolve({ success: false, error: error.message });
      }
    });
  }

  announceTaskCompletion(taskName, result) {
    const messages = {
      'gather_wood': `${result.gathered || 'いくつかの'}木材を収集しました！ 🌳`,
      'craft_basic_tools': `${result.crafted || 'いくつかの'}基本ツールを作成しました！ 🔨`,
      'find_stone': `${result.mined || 'いくつかの'}石を発見・採掘しました！ ⛏️`,
      'craft_stone_tools': `${result.crafted || 'いくつかの'}石製ツールにアップグレードしました！ ⚒️`,
      'find_food': `食料を確保しました！ 🍖`,
      'build_shelter': `避難所を建設しました！ 🏠`,
      'mine_safely': `安全な採掘作業を完了しました！ 💎`
    };

    const message = messages[taskName] || `タスク完了: ${taskName}`;
    this.bot.chat(message);
  }

  handleTaskFailure(taskName, error) {
    this.log(`タスク ${taskName} が失敗: ${error}`);
    
    // Add recovery logic based on task type
    const recoveryStrategies = {
      'gather_wood': () => {
        this.log('木材収集が失敗しました。探索を試します');
        this.goals.unshift({ type: 'explore', priority: 0, description: '木を探すための探索' });
      },
      'find_stone': () => {
        this.log('石探しが失敗しました。ツール要件を確認中');
        if (!this.hasPickaxe()) {
          this.goals.unshift({ type: 'craft_basic_tools', priority: 0, description: '採掘用ツールが必要' });
        }
      },
      'craft_basic_tools': () => {
        this.log('ツール作成が失敗しました。木材がもっと必要です');
        this.goals.unshift({ type: 'gather_wood', priority: 0, amount: 10, description: 'ツール用の木材が必要' });
      }
    };

    const recovery = recoveryStrategies[taskName];
    if (recovery) {
      recovery();
    }
  }

  hasPickaxe() {
    const pickaxes = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'];
    return pickaxes.some(pickaxe => this.bot.inventory.findInventoryItem(pickaxe));
  }

  async safeExploration() {
    try {
      // Check if it's safe to explore
      if (this.observer.isDangerous()) {
        this.log('危険な状況のため探索を中止');
        return;
      }
      
      // Validate bot position before exploration
      if (!this.bot?.entity?.position) {
        this.log('探索エラー: プレイヤー位置が取得できません');
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
        this.log('探索目標が安全でないため中止');
        return;
      }
      
      this.log(`安全探索中: (${targetX}, ${targetY}, ${targetZ})に移動`);
      
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
        this.log('探索ゴールが多すぎるため新規追加をスキップ');
      }
      
    } catch (error) {
      this.log(`探索エラー: ${error.message}`);
    }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [AI-${this.playerId}] [${level.toUpperCase()}] ${message}`;
    
    // Always log errors and warnings
    if (level === 'error' || level === 'warn') {
      console.log(formattedMessage);
    } else if (this.debugMode) {
      console.log(formattedMessage);
    }
    
    // Store important logs in state manager for debugging
    if (this.stateManager && (level === 'error' || level === 'warn' || level === 'important')) {
      const state = this.stateManager.getState();
      if (!state.logHistory) {
        this.stateManager.updateState({ logHistory: [] }, 'logging');
      }
      
      const logEntry = {
        timestamp: Date.now(),
        level: level,
        message: message,
        context: {
          currentTask: this.currentTask?.type || null,
          position: state.position,
          health: state.health,
          food: state.food
        }
      };
      
      const newHistory = [...(state.logHistory || []), logEntry];
      
      // Keep only last 100 important logs
      if (newHistory.length > 100) {
        newHistory.shift();
      }
      
      this.stateManager.updateState({ logHistory: newHistory }, 'logging');
    }
  }

  calculateSkillTimeout(task) {
    const baseTimeout = 30000; // Reduced from 60000ms to 30000ms for faster response
    const taskType = task.type;
    const params = task.params || {};
    
    // Task-specific timeout multipliers - reduced for better performance
    const timeoutMultipliers = {
      'explore': 1.2,      // Reduced from 1.5
      'gather_wood': 1.5,  // Reduced from 2.0
      'craft_tools': 2.0,  // Reduced from 3.0
      'mine_block': 1.8,   // Reduced from 2.5
      'build_shelter': 2.5, // Reduced from 4.0
      'move_to': 0.8,      // Reduced from 1.0
      'follow': 2.0,       // Reduced from 5.0
      'find_food': 1.3     // Reduced from 2.0
    };
    
    let multiplier = timeoutMultipliers[taskType] || 1.5; // Reduced default from 2.0
    
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
      this.log(`リソースアクセス許可: ${resourceType} at ${JSON.stringify(location)}`);
    } else {
      this.log(`リソースアクセス拒否: ${result.reason}. 待機時間: ${Math.round(result.waitTime / 1000)}秒`);
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
          this.log(`リソース待機中: ${accessResult.waitTime / 1000}秒`);
          await this.sleep(accessResult.waitTime);
          return await this.executeResourceAwareTask(task); // Retry
        } else {
          // Find alternative task or location
          this.log('代替リソースを探索中...');
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
        
      case 'gather_wood':
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
    
    this.bot.chat(`パフォーマンス統計:`);
    this.bot.chat(`スキル: ${stats.totalSkills}, 完了タスク: ${stats.totalTasksCompleted}`);
    this.bot.chat(`成功率: ${Math.round(stats.overallSuccessRate)}%, 平均時間: ${Math.round(stats.averageTaskTime / 1000)}秒`);
    this.bot.chat(`協力スコア: ${stats.cooperationScore}, アクティブ要求: ${stats.activeClaims}`);
  }

  // Enhanced task management with state tracking
  setGoal(goal) {
    // Add timestamp and tracking info
    const enhancedGoal = {
      ...goal,
      id: Date.now() + Math.random(),
      createdAt: Date.now(),
      source: 'user_command'
    };
    
    this.goals.unshift(enhancedGoal);
    this.stateManager.addGoal(enhancedGoal);
    this.log(`新しい目標を設定: ${goal.type}`);
  }

  async executeCurrentTask() {
    if (!this.currentTask) return;
    
    // Mark task start time for performance tracking
    this.currentTask.startTime = Date.now();
    this.stateManager.setCurrentTask(this.currentTask);
    
    const taskName = this.currentTask.type;
    this.log(`タスク実行中: ${taskName}`);
    
    try {
      let skill = this.skillLibrary.getSkill(taskName);
      
      // Register skill if not already known
      if (skill && !this.stateManager.getState('knownSkills').has(taskName)) {
        this.stateManager.addSkill(taskName, skill);
      }
      
      // If no predefined skill exists, try to generate one with Voyager AI
      if (!skill) {
        this.log(`${taskName}の事前定義スキルがありません。AIで生成中...`);
        try {
          const context = this.observer.getObservationSummary();
          skill = await this.voyagerAI.generateSkill(this.currentTask, context);
          
          if (skill) {
            this.stateManager.addSkill(taskName, skill);
          }
        } catch (aiError) {
          this.log(`AIスキル生成に失敗: ${aiError.message}`);
          this.currentTask = null;
          this.stateManager.setCurrentTask(null);
          return;
        }
      }
      
      if (skill) {
        // Calculate dynamic timeout based on task complexity
        const dynamicTimeout = this.calculateSkillTimeout(this.currentTask);
        
        // Execute the skill with dynamic timeout and proper error handling
        const result = await this.executeSkillWithTimeout(skill, this.currentTask.params, dynamicTimeout);
        
        // Learn from the experience if Voyager AI is available with null protection
        try {
          if (this.currentTask && this.currentTask.type) {
            const context = this.observer.getObservationSummary();
            await this.voyagerAI.learnFromExperience(this.currentTask, result, context);
          } else {
            this.log('Skipping learning: current task is null or invalid', 'debug');
          }
        } catch (learningError) {
          this.log(`Learning failed: ${learningError.message}`);
        }
        
        if (result && result.success) {
          this.log(`タスクが正常に完了: ${taskName}`);
          this.announceTaskCompletion(taskName, result);
          
          // Update state manager with successful task completion
          this.stateManager.completeCurrentTask(result);
          this.stateManager.updateSkillPerformance(taskName, true, Date.now() - (this.currentTask.startTime || Date.now()));
        } else {
          this.log(`タスクが失敗: ${taskName} - ${result?.error || '不明なエラー'}`);
          this.handleTaskFailure(taskName, result?.error);
          
          // Update state manager with failed task
          this.stateManager.completeCurrentTask(result || { success: false, error: '不明なエラー' });
          this.stateManager.updateSkillPerformance(taskName, false, Date.now() - (this.currentTask.startTime || Date.now()));
        }
        
      } else {
        this.log(`タスク用のスキルが利用できません: ${taskName}`);
        this.handleTaskFailure(taskName, 'No skill available');
      }
      
    } catch (error) {
      this.log(`タスク実行で致命的エラー ${taskName}: ${error.message}`);
      this.handleTaskFailure(taskName, error.message);
      
      // Learn from the critical error with null protection
      try {
        if (this.currentTask && this.currentTask.type) {
          const context = this.observer.getObservationSummary();
          const errorResult = { success: false, error: error.message, critical: true };
          await this.voyagerAI.learnFromExperience(this.currentTask, errorResult, context);
        } else {
          this.log('Skipping learning from critical error: current task is null or invalid', 'debug');
        }
        this.stateManager.completeCurrentTask(errorResult);
        this.stateManager.updateSkillPerformance(taskName, false, Date.now() - (this.currentTask.startTime || Date.now()));
      } catch (learningError) {
        this.log(`失敗から学習中にエラー: ${learningError.message}`);
      }
    }
    
    // Always clear the current task when done
    this.currentTask = null;
    this.stateManager.setCurrentTask(null);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Stop the main AI loop gracefully
  shutdown(reason = 'manual') {
    if (!this.isInitialized) return;
    this.log(`Shutting down AI loop (${reason})`, 'warn');
    this.isInitialized = false;

    // Detach all bot listeners and ensure socket closed to avoid EPIPE
    try {
      this.bot.removeAllListeners();
      if (!this.bot._client.socket.destroyed) {
        // Gracefully end connection; prevents lingering writes
        this.bot.quit('shutdown');
      }
    } catch (e) {
      // Ignore errors during shutdown
    }
  }

  regenerateDefaultGoals() {
    this.log('Regenerating default goals', 'info');
    this.goals = [
      { type: 'gather_wood', priority: 1, description: '木材を収集する' },
      { type: 'explore', priority: 2, description: '世界を探索する' },
      { type: 'find_food', priority: 3, description: '食料源を探す' }
    ];
  }
}

module.exports = { MinecraftAI };
