const mineflayer = require('mineflayer');
const { MinecraftAI } = require('../src/MinecraftAI');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 高度な複数プレイヤー管理システム
class AdvancedMultiPlayersManager {
  constructor() {
    this.players = new Map();
    this.isShuttingDown = false;
    this.config = this.loadConfig();
    this.stats = {
      totalSpawned: 0,
      currentActive: 0,
      totalReconnects: 0
    };
  }

  // 設定ファイルの読み込み
  loadConfig() {
    try {
      const configPath = path.join(__dirname, 'players-config.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
      }
    } catch (error) {
      console.warn('設定ファイルの読み込みに失敗。デフォルト設定を使用します:', error.message);
    }

    // デフォルト設定
    return {
      global: {
        spawnDelay: 2000,
        autoReconnect: true,
        maxReconnectAttempts: 10,
        debugMode: true
      },
      players: []
    };
  }

  // ランダムユーザーネーム生成（日本語対応）
  generateRandomUsername() {
    const adjectives = ['賢い', '素早い', '勇敢な', '機敏な', '大胆な', '賢明な', 'クール', '高速', '優秀', '強力'];
    const nouns = ['ボット', 'AI', 'プレイヤー', 'マイナー', 'ビルダー', '探検家', 'ヘルパー', 'エージェント', 'ワーカー', '職人'];
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNumber = Math.floor(Math.random() * 1000);
    return `${randomAdjective}${randomNoun}${randomNumber}`;
  }

  // AIパーソナリティの適用
  applyPersonality(ai, personality) {
    if (!this.config.personalities || !this.config.personalities[personality]) {
      return;
    }

    const personalityConfig = this.config.personalities[personality];

    // 目標の上書き
    if (personalityConfig.primaryGoals) {
      ai.goals = personalityConfig.primaryGoals.map((type, index) => ({
        type,
        priority: index + 1,
        description: `${personality}の主要目標: ${type}`
      }));
    }

    // 行動パラメータの調整
    if (personalityConfig.behaviour) {
      ai.personalityBehaviour = personalityConfig.behaviour;
    }

    console.log(`[AI] パーソナリティ "${personality}" を適用しました`);
  }

  // プレイヤー設定の読み込み（環境変数 + JSON設定）
  getPlayerConfig(playerIndex) {
    // 環境変数から読み込み
    const prefix = `PLAYER${playerIndex}`;
    const envConfig = {
      host: process.env[`${prefix}_HOST`] || process.env.MINECRAFT_HOST || 'localhost',
      port: parseInt(process.env[`${prefix}_PORT`]) || parseInt(process.env.MINECRAFT_PORT) || 25565,
      username: process.env[`${prefix}_USERNAME`] || this.generateRandomUsername(),
      auth: process.env[`${prefix}_AUTH`] || process.env.MINECRAFT_AUTH || 'offline'
    };

    // JSON設定から読み込み
    const jsonConfig = this.config.players.find(p => p.id === playerIndex);
    if (jsonConfig && jsonConfig.enabled) {
      return {
        host: jsonConfig.host || envConfig.host,
        port: jsonConfig.port || envConfig.port,
        username: jsonConfig.username || envConfig.username,
        auth: jsonConfig.auth || envConfig.auth,
        personality: jsonConfig.aiPersonality || 'explorer',
        spawnDelay: jsonConfig.spawnDelay || 0
      };
    }

    return { ...envConfig, personality: 'explorer', spawnDelay: 0 };
  }

  // 単一プレイヤーの起動
  async spawnPlayer(playerIndex) {
    try {
      const config = this.getPlayerConfig(playerIndex);

      console.log(`[管理システム] プレイヤー${playerIndex}を起動中...`);
      console.log(`[管理システム] 設定: ${JSON.stringify(config)}`);

      const bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        auth: config.auth
      });

      const ai = new MinecraftAI(bot);

      // パーソナリティを適用
      this.applyPersonality(ai, config.personality);

      // プレイヤー情報を保存
      this.players.set(playerIndex, {
        bot,
        ai,
        config,
        connected: false,
        reconnectAttempts: 0,
        spawnTime: new Date(),
        personality: config.personality
      });

      // イベントハンドラーの設定
      this.setupPlayerEvents(playerIndex, bot, ai);

      this.stats.totalSpawned++;
      return { success: true, config };
    } catch (error) {
      console.error(`[管理システム] プレイヤー${playerIndex}の起動に失敗:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // プレイヤーイベントの設定
  setupPlayerEvents(playerIndex, bot, ai) {
    const playerInfo = this.players.get(playerIndex);

    bot.on('login', () => {
      console.log(`[プレイヤー${playerIndex}] ${bot.username}としてログインしました (${playerInfo.personality})`);
      console.log(`[プレイヤー${playerIndex}] 位置: ${bot.entity.position}`);
      playerInfo.connected = true;
      playerInfo.reconnectAttempts = 0;
      this.stats.currentActive++;
      ai.initialize();
    });

    bot.on('spawn', () => {
      console.log(`[プレイヤー${playerIndex}] ワールドにスポーンしました`);
      ai.onSpawn();

      // パーソナリティに応じたカスタムメッセージ
      const personality = this.config.personalities[playerInfo.personality];
      if (personality) {
        bot.chat(`こんにちは！私は${personality.description}です。`);
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
      playerInfo.connected = false;
      this.stats.currentActive = Math.max(0, this.stats.currentActive - 1);

      // 自動再接続
      if (!this.isShuttingDown && this.config.global.autoReconnect) {
        this.scheduleReconnect(playerIndex);
      }
    });

    bot.on('kicked', (reason) => {
      console.log(`[プレイヤー${playerIndex}] ボットがキックされました:`, reason);
      playerInfo.connected = false;
      this.stats.currentActive = Math.max(0, this.stats.currentActive - 1);
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
    const maxAttempts = this.config.global.maxReconnectAttempts || 10;

    if (playerInfo.reconnectAttempts > maxAttempts) {
      console.log(`[プレイヤー${playerIndex}] 最大再接続試行回数に達しました。自動再接続を停止します。`);
      return;
    }

    const delay = Math.min(5000 * playerInfo.reconnectAttempts, 30000);
    console.log(`[プレイヤー${playerIndex}] ${delay / 1000}秒後に再接続を試行... (試行回数: ${playerInfo.reconnectAttempts}/${maxAttempts})`);

    setTimeout(async () => {
      if (!this.isShuttingDown) {
        console.log(`[プレイヤー${playerIndex}] 再接続中...`);
        this.stats.totalReconnects++;
        await this.spawnPlayer(playerIndex);
      }
    }, delay);
  }

  // 複数プレイヤーの起動（環境変数ベース）
  async spawnMultiplePlayersFromEnv() {
    const playerCount = parseInt(process.env.MULTIPLE_PLAYERS_COUNT) || 3;
    const spawnDelay = parseInt(process.env.SPAWN_DELAY) || this.config.global.spawnDelay || 2000;

    console.log(`[管理システム] ${playerCount}人のAIプレイヤーを起動します...`);
    console.log(`[管理システム] 起動間隔: ${spawnDelay}ミリ秒`);

    for (let i = 1; i <= Math.min(playerCount, 10); i++) {
      const result = await this.spawnPlayer(i);

      if (result.success) {
        console.log(`✅ プレイヤー${i} 起動成功`);
      } else {
        console.error(`❌ プレイヤー${i} 起動失敗: ${result.error}`);
      }

      if (i < playerCount) {
        await this.sleep(spawnDelay);
      }
    }

    console.log(`[管理システム] 全${playerCount}人のプレイヤー起動完了！`);
  }

  // 複数プレイヤーの起動（JSON設定ベース）
  async spawnMultiplePlayersFromConfig() {
    const enabledPlayers = this.config.players.filter(p => p.enabled);

    if (enabledPlayers.length === 0) {
      console.log('[管理システム] 有効なプレイヤー設定がありません。環境変数から起動します...');
      return this.spawnMultiplePlayersFromEnv();
    }

    console.log(`[管理システム] ${enabledPlayers.length}人のAIプレイヤーを設定ファイルから起動します...`);

    // 起動遅延でソート
    enabledPlayers.sort((a, b) => (a.spawnDelay || 0) - (b.spawnDelay || 0));

    for (const playerConfig of enabledPlayers) {
      const result = await this.spawnPlayer(playerConfig.id);

      if (result.success) {
        console.log(`✅ プレイヤー${playerConfig.id} (${playerConfig.username}) 起動成功`);
      } else {
        console.error(`❌ プレイヤー${playerConfig.id} 起動失敗: ${result.error}`);
      }

      // 個別の起動遅延
      if (playerConfig.spawnDelay > 0) {
        await this.sleep(playerConfig.spawnDelay);
      }
    }

    console.log(`[管理システム] 全${enabledPlayers.length}人のプレイヤー起動完了！`);
  }

  // 詳細ステータスの表示
  showDetailedStatus() {
    console.log('\n=== プレイヤーステータス詳細 ===');
    console.log(`統計: 起動済み${this.stats.totalSpawned}人 | アクティブ${this.stats.currentActive}人 | 再接続${this.stats.totalReconnects}回`);
    console.log('----------------------------------------');

    for (const [index, playerInfo] of this.players.entries()) {
      const status = playerInfo.connected ? '🟢 接続中' : '🔴 切断中';
      const uptime = playerInfo.spawnTime ? Math.floor((Date.now() - playerInfo.spawnTime.getTime()) / 1000) : 0;
      const personality = playerInfo.personality || 'unknown';

      console.log(`プレイヤー${index}: ${playerInfo.config.username}`);
      console.log(`  状態: ${status} | パーソナリティ: ${personality} | 稼働時間: ${uptime}秒`);
      console.log(`  再接続回数: ${playerInfo.reconnectAttempts} | サーバー: ${playerInfo.config.host}:${playerInfo.config.port}`);
    }
    console.log('=====================================\n');
  }

  // 全プレイヤーの停止
  async shutdown() {
    console.log('[管理システム] 全プレイヤーをシャットダウン中...');
    this.isShuttingDown = true;

    const shutdownPromises = [];
    for (const [index, playerInfo] of this.players.entries()) {
      if (playerInfo.bot) {
        console.log(`[管理システム] プレイヤー${index}を停止中...`);
        shutdownPromises.push(
          new Promise((resolve) => {
            playerInfo.bot.once('end', resolve);
            playerInfo.bot.quit();
            setTimeout(resolve, 3000); // 3秒でタイムアウト
          })
        );
      }
    }

    await Promise.all(shutdownPromises);
    this.players.clear();
    this.stats.currentActive = 0;
    console.log('[管理システム] 全プレイヤーのシャットダウン完了');
  }

  // ユーティリティ
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// メイン実行
const manager = new AdvancedMultiPlayersManager();

console.log('=== 高度な複数AIプレイヤー管理システム ===');
console.log('設定ファイル: players-config.json');
console.log('Ctrl+C で全プレイヤーを停止できます');
console.log('=========================================\n');

// プレイヤー起動
if (process.argv.includes('--config')) {
  // 設定ファイルから起動
  manager.spawnMultiplePlayersFromConfig().catch(error => {
    console.error('[管理システム] プレイヤー起動エラー:', error);
  });
} else {
  // 環境変数から起動（従来の方法）
  manager.spawnMultiplePlayersFromEnv().catch(error => {
    console.error('[管理システム] プレイヤー起動エラー:', error);
  });
}

// 詳細ステータス表示（定期実行）
setInterval(() => {
  if (manager.players.size > 0) {
    manager.showDetailedStatus();
  }
}, 60000); // 60秒ごと

// 優雅なシャットダウン
process.on('SIGINT', async () => {
  console.log('\n[管理システム] シャットダウン信号を受信しました...');
  await manager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[管理システム] 終了信号を受信しました...');
  await manager.shutdown();
  process.exit(0);
});

// 未処理エラーのキャッチ
process.on('unhandledRejection', (reason, promise) => {
  console.error('[管理システム] 未処理のPromise拒否:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[管理システム] 未処理の例外:', error);
  manager.shutdown().then(() => process.exit(1));
});
