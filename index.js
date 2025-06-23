const mineflayer = require('mineflayer');
const { MinecraftAI } = require('./src/MinecraftAI');
require('dotenv').config();

// Function to generate random username for offline mode
function generateRandomUsername() {
  const adjectives = ['Smart', 'Quick', 'Brave', 'Swift', 'Bold', 'Wise', 'Cool', 'Fast'];
  const nouns = ['Bot', 'AI', 'Player', 'Miner', 'Builder', 'Explorer', 'Helper', 'Agent'];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNumber = Math.floor(Math.random() * 1000);
  return `${randomAdjective}${randomNoun}${randomNumber}`;
}

// Bot configuration with username flexibility
const botConfig = {
  host: process.env.MINECRAFT_HOST || 'localhost',
  port: parseInt(process.env.MINECRAFT_PORT) || 25565,
  username: process.env.MINECRAFT_USERNAME ||
           (process.env.MINECRAFT_AUTH === 'offline' ? generateRandomUsername() : 'AIPlayer'),
  auth: process.env.MINECRAFT_AUTH || 'offline'
};

// Allow command line username override
if (process.argv.length > 2) {
  const cliUsername = process.argv[2];
  if (cliUsername && cliUsername.length > 0) {
    botConfig.username = cliUsername;
  }
}

console.log('Minecraft AIプレイヤーを起動中...');
console.log('設定:', botConfig);

// Create the bot
const bot = mineflayer.createBot(botConfig);

// Initialize AI system
const ai = new MinecraftAI(bot);

// Bot event handlers
bot.on('login', () => {
  console.log(`ボットが${bot.username}としてログインしました`);
  console.log(`位置: ${bot.entity.position}`);
  ai.initialize();
});

bot.on('spawn', () => {
  console.log('ボットがワールドにスポーンしました');
  ai.onSpawn();
});

bot.on('chat', async (username, message) => {
  if (username === bot.username) return;
  console.log(`<${username}> ${message}`);
  await ai.onChat(username, message);
});

bot.on('error', (err) => {
  console.error('ボットエラー:', err);
});

bot.on('end', () => {
  console.log('ボットが切断されました');
  if (process.env.AUTO_RESPAWN === 'true') {
    setTimeout(() => {
      console.log('再接続を試行中...');
      // Reconnection logic would go here
    }, 5000);
  }
});

bot.on('kicked', (reason) => {
  console.log('ボットがキックされました:', reason);
});

bot.on('death', () => {
  console.log('ボットが死亡しました');
  ai.onDeath();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('シャットダウン中...');
  bot.quit();
  process.exit(0);
});
