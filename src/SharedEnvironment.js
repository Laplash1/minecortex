/**
 * SharedEnvironment - マルチボット共有環境システム
 * 5体ボット環境でのCPU負荷削減を目的とした統合環境観測システム
 */

const { Logger } = require('./utils/Logger');

class SharedEnvironment {
  constructor() {
    this.observers = new Map(); // botId -> observer instance
    this.logger = Logger.createLogger('SharedEnvironment');
    this.sharedData = {
      worldBlocks: new Map(), // 共有ブロック情報
      worldEntities: new Map(), // 共有エンティティ情報
      worldTime: { timeOfDay: 'unknown', weather: 'clear' },
      lastUpdate: 0
    };

    // 更新頻度制御
    this.updateInterval = 2000; // 2秒間隔
    this.lastFullUpdate = 0;
    this.isUpdating = false;

    // パフォーマンス統計
    this.stats = {
      totalUpdates: 0,
      duplicateOperations: 0,
      savedOperations: 0
    };

    // 定期更新タイマー
    this.updateTimer = null;
    this.startPeriodicUpdate();
  }

  /**
   * ボットのEnvironmentObserverを登録
   */
  registerObserver(botId, observer) {
    console.log(`[SharedEnvironment] ボット ${botId} の環境観測を登録`);
    this.observers.set(botId, observer);

    // 既存の共有データを新しいオブザーバーに同期
    this.syncDataToObserver(observer);
  }

  /**
   * ボットの登録解除
   */
  unregisterObserver(botId) {
    console.log(`[SharedEnvironment] ボット ${botId} の環境観測を登録解除`);
    this.observers.delete(botId);

    // 全てのオブザーバーが削除されたら定期更新を停止
    if (this.observers.size === 0) {
      this.stopPeriodicUpdate();
    }
  }

  /**
   * 定期更新開始
   */
  startPeriodicUpdate() {
    if (this.updateTimer) return;

    this.updateTimer = setInterval(() => {
      this.performSharedUpdate();
    }, this.updateInterval);

    console.log(`[SharedEnvironment] 定期更新開始 (${this.updateInterval}ms間隔)`);
  }

  /**
   * 定期更新停止
   */
  stopPeriodicUpdate() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
      console.log('[SharedEnvironment] 定期更新停止');
    }
  }

  /**
   * 共有環境の統合更新実行
   */
  async performSharedUpdate() {
    if (this.isUpdating || this.observers.size === 0) return;

    this.isUpdating = true;
    const startTime = Date.now();

    try {
      // 代表ボットを選択（最初のアクティブなボット）
      const representativeObserver = this.selectRepresentativeObserver();
      if (!representativeObserver) {
        this.isUpdating = false;
        return;
      }

      // 代表ボットで環境データを更新
      await this.updateSharedDataFromObserver(representativeObserver);

      // 全ボットに共有データを配布
      this.distributeSharedData();

      this.stats.totalUpdates++;
      this.stats.savedOperations += (this.observers.size - 1) * 3; // entities, blocks, environment

      const updateTime = Date.now() - startTime;
      if (updateTime > 100) { // 100ms以上の場合に警告
        console.log(`[SharedEnvironment] 更新完了 ${updateTime}ms (${this.observers.size}ボット, 節約操作: ${this.stats.savedOperations})`);
      }
    } catch (error) {
      console.error('[SharedEnvironment] 更新エラー:', error.message);
    } finally {
      this.isUpdating = false;
      this.lastFullUpdate = Date.now();
    }
  }

  /**
   * 代表オブザーバーを選択
   */
  selectRepresentativeObserver() {
    for (const observer of this.observers.values()) {
      // ボットが有効でpositionが取得できる場合に選択
      if (observer.bot?.entity?.position && observer.bot.entities) {
        return observer;
      }
    }
    return null;
  }

  /**
   * 代表オブザーバーから共有データを更新
   */
  async updateSharedDataFromObserver(observer) {
    const bot = observer.bot;
    if (!bot?.entity?.position) return;

    // エンティティ情報の統合更新
    this.updateSharedEntities(bot);

    // ブロック情報の統合更新
    this.updateSharedBlocks(bot);

    // 環境情報の更新
    this.updateSharedEnvironment(bot);

    this.sharedData.lastUpdate = Date.now();
  }

  /**
   * 共有エンティティ情報の更新
   */
  updateSharedEntities(bot) {
    this.sharedData.worldEntities.clear();

    if (!bot.entities) return;

    const botPos = bot.entity.position;
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity?.position) continue;

      try {
        const distance = entity.position.distanceTo(botPos);
        if (distance <= 32) {
          this.sharedData.worldEntities.set(entity.id, {
            type: entity.name || entity.type || 'unknown',
            position: {
              x: Math.round(entity.position.x * 100) / 100,
              y: Math.round(entity.position.y * 100) / 100,
              z: Math.round(entity.position.z * 100) / 100
            },
            distance: Math.round(distance * 100) / 100,
            health: entity.health ?? 0,
            isHostile: this.isHostileEntity(entity.name),
            isPlayer: entity.type === 'player',
            lastSeen: Date.now()
          });
        }
      } catch (error) {
        continue; // skip invalid entities
      }
    }
  }

  /**
   * 共有ブロック情報の更新
   */
  updateSharedBlocks(bot) {
    this.sharedData.worldBlocks.clear();

    const pos = bot.entity.position;
    const radius = 16;

    // サンプリングでブロック情報を取得
    for (let x = -radius; x <= radius; x += 4) {
      for (let z = -radius; z <= radius; z += 4) {
        for (let y = -8; y <= 8; y += 4) {
          try {
            const block = bot.blockAt(pos.offset(x, y, z));
            if (block && block.name !== 'air' && block.position) {
              const key = `${Math.floor(pos.x + x)},${Math.floor(pos.y + y)},${Math.floor(pos.z + z)}`;
              this.sharedData.worldBlocks.set(key, {
                type: block.name,
                position: {
                  x: Math.floor(pos.x + x),
                  y: Math.floor(pos.y + y),
                  z: Math.floor(pos.z + z)
                },
                harvestable: this.canHarvestBlock(block.name),
                lastSeen: Date.now()
              });
            }
          } catch (error) {
            continue; // skip invalid coordinates
          }
        }
      }
    }
  }

  /**
   * 共有環境情報の更新
   */
  updateSharedEnvironment(bot) {
    try {
      const time = bot.time?.timeOfDay;
      let timeOfDay = 'unknown';

      if (typeof time === 'number') {
        if (time < 1000 || time > 23000) timeOfDay = 'night';
        else if (time < 6000) timeOfDay = 'morning';
        else if (time < 12000) timeOfDay = 'day';
        else if (time < 18000) timeOfDay = 'afternoon';
        else timeOfDay = 'evening';
      }

      let weather = 'clear';
      if (bot.isRaining) weather = 'rain';
      else if (bot.thunderState > 0) weather = 'thunder';

      this.sharedData.worldTime = { timeOfDay, weather };
    } catch (error) {
      console.log(`[SharedEnvironment] 環境情報更新エラー: ${error.message}`);
    }
  }

  /**
   * 共有データを全オブザーバーに配布
   */
  distributeSharedData() {
    for (const observer of this.observers.values()) {
      this.syncDataToObserver(observer);
    }
  }

  /**
   * 特定のオブザーバーに共有データを同期
   */
  syncDataToObserver(observer) {
    try {
      // 共有エンティティデータを同期
      observer.nearbyEntities.clear();
      for (const [entityId, entityData] of this.sharedData.worldEntities.entries()) {
        observer.nearbyEntities.set(entityId, { ...entityData });
      }

      // 共有ブロックデータを同期
      observer.nearbyBlocks.clear();
      for (const [blockKey, blockData] of this.sharedData.worldBlocks.entries()) {
        observer.nearbyBlocks.set(blockKey, { ...blockData });
      }

      // 環境情報を同期
      observer.timeOfDay = this.sharedData.worldTime.timeOfDay;
      observer.weather = this.sharedData.worldTime.weather;
    } catch (error) {
      console.error(`[SharedEnvironment] データ同期エラー: ${error.message}`);
    }
  }

  /**
   * 個別ボットの位置・体力・インベントリ更新（共有対象外）
   */
  updateBotSpecificData(observer) {
    if (!observer.bot?.entity?.position) return;

    // 個別データのみ更新
    observer.updatePosition();
    observer.updateInventory();
    observer.updatePlayerStats();
    observer.recordObservation();
  }

  /**
   * 敵対エンティティ判定
   */
  isHostileEntity(entityName) {
    const hostileEntities = [
      'zombie', 'skeleton', 'spider', 'creeper', 'enderman',
      'witch', 'slime', 'phantom', 'drowned', 'husk',
      'stray', 'wither_skeleton', 'blaze', 'ghast'
    ];
    return hostileEntities.includes(entityName);
  }

  /**
   * 採掘可能ブロック判定
   */
  canHarvestBlock(blockName) {
    const harvestableBlocks = [
      'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
      'stone', 'cobblestone', 'coal_ore', 'iron_ore',
      'wheat', 'carrots', 'potatoes', 'sugar_cane',
      'dirt', 'grass_block', 'sand', 'gravel'
    ];
    return harvestableBlocks.includes(blockName);
  }

  /**
   * パフォーマンス統計取得
   */
  getPerformanceStats() {
    return {
      ...this.stats,
      activeObservers: this.observers.size,
      lastUpdateAge: Date.now() - this.lastFullUpdate,
      updateInterval: this.updateInterval,
      memoryUsage: {
        entities: this.sharedData.worldEntities.size,
        blocks: this.sharedData.worldBlocks.size
      }
    };
  }

  /**
   * システム終了処理
   */
  shutdown() {
    console.log('[SharedEnvironment] システム終了中...');
    this.stopPeriodicUpdate();
    this.observers.clear();
    this.sharedData.worldEntities.clear();
    this.sharedData.worldBlocks.clear();
    console.log('[SharedEnvironment] システム終了完了');
  }
}

module.exports = { SharedEnvironment };
