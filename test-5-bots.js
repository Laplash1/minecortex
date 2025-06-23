const mineflayer = require('mineflayer');
const { MinecraftAI } = require('./src/MinecraftAI');

// Create 5 bots with different usernames
const botConfigs = [
  { username: 'TestBot1' },
  { username: 'TestBot2' },
  { username: 'TestBot3' },
  { username: 'TestBot4' },
  { username: 'TestBot5' }
];

const bots = [];
const ais = [];

console.log('Starting 5 MineCortex bots for testing...');

// Create bots with staggered connection
botConfigs.forEach((config, index) => {
  setTimeout(() => {
    console.log(`Creating bot ${index + 1}: ${config.username}`);

    const bot = mineflayer.createBot({
      host: 'localhost',
      port: 25565,
      username: config.username,
      auth: 'offline'
    });

    const ai = new MinecraftAI(bot);

    bot.on('login', () => {
      console.log(`✅ ${config.username} logged in successfully`);
      ai.initialize();
    });

    bot.on('spawn', () => {
      console.log(`🌍 ${config.username} spawned in world`);
      ai.onSpawn();
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      console.log(`💬 [${bot.username}] <${username}> ${message}`);
    });

    bot.on('error', (err) => {
      console.error(`❌ ${config.username} error:`, err.message);
    });

    bot.on('end', () => {
      console.log(`🔚 ${config.username} disconnected`);
    });

    bot.on('kicked', (reason) => {
      console.log(`👢 ${config.username} was kicked: ${reason}`);
    });

    bot.on('death', () => {
      console.log(`💀 ${config.username} died`);
      if (ai) ai.onDeath();
    });

    bots.push(bot);
    ais.push(ai);
  }, index * 1000); // Stagger connections by 1 second
});

// Status reporting every 15 seconds
setInterval(() => {
  console.log('\n=== Bot Status Report ===');
  bots.forEach((bot, i) => {
    const status = bot.entity ? '🟢 Connected' : '🔴 Disconnected';
    const pos = bot.entity ? `(${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)})` : 'N/A';
    const health = bot.health !== undefined ? `HP:${bot.health}/20` : 'N/A';
    const food = bot.food !== undefined ? `Food:${bot.food}/20` : 'N/A';

    console.log(`Bot ${i + 1} (${botConfigs[i].username}): ${status} ${pos} ${health} ${food}`);
  });
  console.log('========================\n');
}, 15000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down all bots...');
  bots.forEach(bot => {
    if (bot && typeof bot.quit === 'function') {
      bot.quit('Test shutdown');
    }
  });
  process.exit(0);
});

console.log('Bots will connect in staggered intervals...');
