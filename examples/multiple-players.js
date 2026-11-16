const mineflayer = require('mineflayer');
const { MinecraftAI } = require('../src/MinecraftAI');
const { SharedEnvironment } = require('../src/SharedEnvironment');
const { PathfindingCache } = require('../src/PathfindingCache');
const { OpenAIRequestQueue } = require('../src/OpenAIRequestQueue');
require('dotenv').config();

// プレイヤー管理クラス
class MultiplePlayersManager {
  constructor() {
    this.players = new Map();
    this.isShuttingDown = false;
    this.reconnectTimers = new Set();

    // Performance optimization components for multi-bot scenarios
    const playerCount = parseInt(process.env.MULTIPLE_PLAYERS_COUNT) || 3;
    this.sharedEnvironment = playerCount > 1
      ? new SharedEnvironment()
      : null;
    this.pathfindingCache = playerCount > 1
      ? new PathfindingCache({
        maxCacheSize: 2000, // 多ボット環境では大きなキャッシュ
        maxCacheAge: 600000, // 10分
        hitRadius: 4
      })
      : null;
    this.openAIRequestQueue = process.env.OPENAI_API_KEY
      ? new OpenAIRequestQueue({
        maxConcurrentRequests: 2, // 多ボット環境では制限
        requestsPerMinute: 30 // 控えめなレート設定
      })
      : null;

    if (this.sharedEnvironment) {
      console.log(`[MultiplePlayersManager] SharedEnvironment を初期化 (${playerCount}ボット用パフォーマンス最適化)`);
    }
    if (this.pathfindingCache) {
      console.log(`[MultiplePlayersManager] PathfindingCache を初期化 (${playerCount}ボット用パス最適化)`);
    }
    if (this.openAIRequestQueue) {
      console.log('[MultiplePlayersManager] OpenAIRequestQueue を初期化 (API制御システム)');
    }
  }

  // ランダムユーザーネーム生成
  generateRandomUsername() {
    const adjectives = ['賢い', '素早い', '勇敢な', '機敏な', '大胆な', '賢明な', 'クール', '高速'];
    const nouns = ['ボット', 'AI', 'プレイヤー', 'マイナー', 'ビルダー', '探検家', 'ヘルパー', 'エージェント'];
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNumber = Math.floor(Math.random() * 1000);
    return `${randomAdjective}${randomNoun}${randomNumber}`;
  }

  // プレイヤー設定の読み込み
  getPlayerConfig(playerIndex, configFile = null) {
    // Try to load from config file first
    if (configFile) {
      try {
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        const playerConfig = config.players.find(p => p.id === playerIndex && p.enabled);

        if (playerConfig) {
          return {
            host: playerConfig.host,
            port: playerConfig.port,
            username: playerConfig.username,
            auth: playerConfig.auth,
            personality: playerConfig.aiPersonality,
            spawnDelay: playerConfig.spawnDelay || 0
          };
        }
      } catch (error) {
        console.log(`設定ファイル読み込みエラー: ${error.message}`);
      }
    }

    // Fallback to environment variables
    const prefix = `PLAYER${playerIndex}`;

    return {
      host: process.env[`${prefix}_HOST`] || process.env.MINECRAFT_HOST || 'localhost',
      port: parseInt(process.env[`${prefix}_PORT`]) || parseInt(process.env.MINECRAFT_PORT) || 25565,
      username: process.env[`${prefix}_USERNAME`] || `MineCortexBot${playerIndex}`,
      version: process.env.MINECRAFT_VERSION || '1.21.4',
      auth: process.env[`${prefix}_AUTH`] || process.env.MINECRAFT_AUTH || 'offline',
      personality: process.env[`${prefix}_PERSONALITY`] || 'generalist',
      spawnDelay: parseInt(process.env[`${prefix}_SPAWN_DELAY`]) || (playerIndex * 2000)
    };
  }

  // 単一プレイヤーの起動
  async spawnPlayer(playerIndex, useConfigFile = false) {
    try {
      const configFile = useConfigFile ? './config/players-config.json' : null;
      const config = this.getPlayerConfig(playerIndex, configFile);

      console.log(`プレイヤー${playerIndex}を起動中...`);
      console.log(`設定: ${JSON.stringify(config)}`);

      const bot = mineflayer.createBot(config);

      // Load essential plugins
      const { pathfinder } = require('mineflayer-pathfinder');
      bot.loadPlugin(pathfinder);

      // Initialize coordinator if multiple players
      let coordinator = this.coordinator;
      if (!coordinator && this.players.size === 0) {
        const { MultiPlayerCoordinator } = require('../src/MultiPlayerCoordinator');
        coordinator = new MultiPlayerCoordinator();
        this.coordinator = coordinator;

        // マルチプレイヤー環境なので同期開始を設定
        const expectedPlayersCount = useConfigFile
          ? this.getExpectedPlayersCount(configFile)
          : (parseInt(process.env.MULTIPLE_PLAYERS_COUNT) || 3);

        coordinator.configureSyncStart(expectedPlayersCount, true);
      }

      const ai = new MinecraftAI(bot, coordinator, this.sharedEnvironment, this.pathfindingCache);

      // プレイヤー情報を保存
      this.players.set(playerIndex, {
        bot,
        ai,
        config,
        connected: false,
        reconnectAttempts: 0
      });

      // イベントハンドラーの設定
      this.setupPlayerEvents(playerIndex, bot, ai);

      return { success: true, config };
    } catch (error) {
      console.error(`プレイヤー${playerIndex}の起動に失敗:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // プレイヤーイベントの設定
  setupPlayerEvents(playerIndex, bot, ai) {
    const playerInfo = this.players.get(playerIndex);

    bot.on('login', () => {
      console.log(`[プレイヤー${playerIndex}] ${bot.username}としてログインしました`);
      console.log(`[プレイヤー${playerIndex}] 位置: ${bot.entity.position}`);
      playerInfo.connected = true;
      playerInfo.reconnectAttempts = 0;
    });

    bot.on('spawn', async () => {
      console.log(`[プレイヤー${playerIndex}] ワールドにスポーンしました`);
      try {
        ai.onSpawn();
        await ai.initialize();
      } catch (error) {
        console.error(`[プレイヤー${playerIndex}] 初期化失敗: ${error.message}`);
        await ai.shutdown('initialization_failed');
        bot.quit('initialization_failed');
      }
    });

    bot.on('chat', async (username, message) => {
      if (username === bot.username) return;
      console.log(`[プレイヤー${playerIndex}] <${username}> ${message}`);
      await ai.onChat(username, message);
    });

    bot.on('error', (err) => {
      console.error(`[プレイヤー${playerIndex}] ボットエラー:`, err.message);
    });

    bot.on('end', () => {
      console.log(`[プレイヤー${playerIndex}] ボットが切断されました`);
      ai.shutdown('end');
      playerInfo.connected = false;

      // 自動再接続（シャットダウン中でなければ）
      if (!this.isShuttingDown && process.env.AUTO_RESPAWN === 'true') {
        this.scheduleReconnect(playerIndex);
      }
    });

    bot.on('kicked', (reason) => {
      console.log(`[プレイヤー${playerIndex}] ボットがキックされました:`, reason);
      ai.shutdown('kicked');
      playerInfo.connected = false;
    });

    bot.on('death', () => {
      console.log(`[プレイヤー${playerIndex}] ボットが死亡しました`);
      ai.onDeath();
    });
  }

  // 再接続のスケジュール
  scheduleReconnect(playerIndex) {
    const playerInfo = this.players.get(playerIndex);
    if (!playerInfo) return;

    playerInfo.reconnectAttempts++;
    const delay = Math.min(5000 * playerInfo.reconnectAttempts, 30000); // 最大30秒

    console.log(`[プレイヤー${playerIndex}] ${delay / 1000}秒後に再接続を試行... (試行回数: ${playerInfo.reconnectAttempts})`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(timer);
      if (!this.isShuttingDown && playerInfo.reconnectAttempts <= 10) {
        console.log(`[プレイヤー${playerIndex}] 再接続中...`);
        if (playerInfo.ai) playerInfo.ai.shutdown('reconnect');
        await this.spawnPlayer(playerIndex);
      }
    }, delay);
    this.reconnectTimers.add(timer);
  }

  // 複数プレイヤーの起動
  async spawnMultiplePlayers(useConfigFile = false) {
    const playerCount = parseInt(process.env.MULTIPLE_PLAYERS_COUNT) || 3;
    const spawnDelay = parseInt(process.env.SPAWN_DELAY) || 2000;

    console.log(`${playerCount}人のAIプレイヤーを起動します...`);
    console.log(`起動間隔: ${spawnDelay}ミリ秒`);
    console.log(`設定ファイル使用: ${useConfigFile ? 'Yes' : 'No'}`);

    // Load enabled players from config if using config file
    let playerIds = [];
    if (useConfigFile) {
      try {
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('./config/players-config.json', 'utf8'));
        playerIds = config.players
          .filter(p => p.enabled)
          .slice(0, Math.min(playerCount, 10))
          .map(p => p.id);

        console.log(`設定ファイルから有効なプレイヤー: ${playerIds.join(', ')}`);
      } catch (error) {
        console.error(`設定ファイル読み込みエラー: ${error.message}`);
        // Fallback to sequential IDs
        playerIds = Array.from({ length: Math.min(playerCount, 10) }, (_, i) => i + 1);
      }
    } else {
      playerIds = Array.from({ length: Math.min(playerCount, 10) }, (_, i) => i + 1);
    }

    for (const playerId of playerIds) {
      const result = await this.spawnPlayer(playerId, useConfigFile);

      if (result.success) {
        console.log(`✅ プレイヤー${playerId} 起動成功`);
      } else {
        console.error(`❌ プレイヤー${playerId} 起動失敗: ${result.error}`);
      }

      // Use individual spawn delay if available
      const individualDelay = result.config?.spawnDelay || spawnDelay;
      if (playerId !== playerIds[playerIds.length - 1]) {
        await this.sleep(individualDelay);
      }
    }

    console.log(`全${playerIds.length}人のプレイヤー起動完了！`);
  }

  // プレイヤーステータスの表示
  showStatus() {
    console.log('\n=== プレイヤーステータス ===');
    for (const [index, playerInfo] of this.players.entries()) {
      const status = playerInfo.connected ? '🟢 接続中' : '🔴 切断中';
      console.log(`プレイヤー${index}: ${playerInfo.config.username} - ${status}`);
    }
    console.log('========================\n');
  }

  // 全プレイヤーの停止
  async shutdown() {
    console.log('全プレイヤーをシャットダウン中...');
    this.isShuttingDown = true;
    for (const timer of this.reconnectTimers) clearTimeout(timer);
    this.reconnectTimers.clear();

    for (const [index, playerInfo] of this.players.entries()) {
      if (playerInfo.bot) {
        console.log(`プレイヤー${index}を停止中...`);

        if (playerInfo.ai) {
          await playerInfo.ai.shutdown('manager_shutdown');
        }

        if (typeof playerInfo.bot.quit === 'function') {
          const bot = playerInfo.bot;
          if (bot._client?.socket && !bot._client.socket.destroyed) {
            await new Promise(resolve => {
              const timer = setTimeout(() => { bot.end('shutdown_timeout'); resolve(); }, 3000);
              bot.once('end', () => { clearTimeout(timer); resolve(); });
              bot.quit('manager_shutdown');
            });
          } else bot.end('manager_shutdown');
        }
      }
    }

    // パフォーマンス最適化コンポーネントをシャットダウン
    if (this.openAIRequestQueue) {
      await this.openAIRequestQueue.shutdown();
      console.log('[MultiplePlayersManager] OpenAIRequestQueue シャットダウン完了');
    }
    if (this.sharedEnvironment) {
      this.sharedEnvironment.shutdown();
      console.log('[MultiplePlayersManager] SharedEnvironment シャットダウン完了');
    }
    if (this.pathfindingCache) {
      this.pathfindingCache.shutdown();
      console.log('[MultiplePlayersManager] PathfindingCache シャットダウン完了');
    }

    this.players.clear();
    console.log('全プレイヤーのシャットダウン完了');
  }

  // 設定ファイルから期待プレイヤー数を取得
  getExpectedPlayersCount(configFile) {
    try {
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      return config.players.filter(p => p.enabled).length;
    } catch (error) {
      console.error(`設定ファイル読み込みエラー: ${error.message}`);
      return parseInt(process.env.MULTIPLE_PLAYERS_COUNT) || 3;
    }
  }

  // ユーティリティ
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { MultiplePlayersManager };

if (require.main === module) {
  const manager = new MultiplePlayersManager();
  const statusTimer = setInterval(() => manager.showStatus(), 30000);
  manager.spawnMultiplePlayers(process.argv.includes('--config')).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
  let shuttingDown = false;
  async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(statusTimer);
    await manager.shutdown();
    process.exitCode = code;
  }
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
    shutdown(1);
  });
}
