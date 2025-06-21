const mineflayer = require('mineflayer');
const { MinecraftAI } = require('../src/MinecraftAI');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Multi-server configuration
const defaultConfigs = [
  {
    host: 'localhost',
    port: 25565,
    username: 'AIPlayer1',
    auth: 'offline'
  },
  {
    host: 'localhost',
    port: 25566,
    username: 'AIPlayer2',
    auth: 'offline'
  },
  {
    host: 'localhost',
    port: 25567,
    username: 'AIPlayer3',
    auth: 'offline'
  }
];

// Function to generate random username
function generateRandomUsername() {
  const adjectives = ['Smart', 'Quick', 'Brave', 'Swift', 'Bold', 'Wise', 'Cool', 'Fast'];
  const nouns = ['Bot', 'AI', 'Player', 'Miner', 'Builder', 'Explorer', 'Helper', 'Agent'];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNumber = Math.floor(Math.random() * 1000);
  return `${randomAdjective}${randomNoun}${randomNumber}`;
}

// Load server configurations
function loadServerConfigs() {
  const configPath = path.join(__dirname, 'servers.json');
  
  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.warn('Failed to load servers.json, using default configs:', error.message);
      return defaultConfigs;
    }
  } else {
    console.log('servers.json not found, creating default configuration...');
    fs.writeFileSync(configPath, JSON.stringify(defaultConfigs, null, 2));
    console.log('Created servers.json with default configuration');
    return defaultConfigs;
  }
}

// Create bot instance
class BotInstance {
  constructor(config, instanceId) {
    this.config = config;
    this.instanceId = instanceId;
    this.bot = null;
    this.ai = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
  }

  async start() {
    try {
      console.log(`[Instance ${this.instanceId}] Starting bot with config:`, this.config);
      
      // Apply environment variable overrides
      const botConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username || generateRandomUsername(),
        auth: this.config.auth || 'offline'
      };

      this.bot = mineflayer.createBot(botConfig);
      this.ai = new MinecraftAI(this.bot);

      this.setupEventHandlers();
      
    } catch (error) {
      console.error(`[Instance ${this.instanceId}] Failed to start:`, error);
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.bot.on('login', () => {
      console.log(`[Instance ${this.instanceId}] Bot logged in as ${this.bot.username}`);
      this.ai.initialize();
      this.reconnectAttempts = 0;
    });

    this.bot.on('spawn', () => {
      console.log(`[Instance ${this.instanceId}] Bot spawned in the world`);
      this.ai.onSpawn();
    });

    this.bot.on('chat', async (username, message) => {
      if (username === this.bot.username) return;
      console.log(`[Instance ${this.instanceId}] <${username}> ${message}`);
      await this.ai.onChat(username, message);
    });

    this.bot.on('error', (err) => {
      console.error(`[Instance ${this.instanceId}] Bot error:`, err);
      this.scheduleReconnect();
    });

    this.bot.on('end', () => {
      console.log(`[Instance ${this.instanceId}] Bot disconnected`);
      this.scheduleReconnect();
    });

    this.bot.on('kicked', (reason) => {
      console.log(`[Instance ${this.instanceId}] Bot was kicked:`, reason);
      this.scheduleReconnect();
    });

    this.bot.on('death', () => {
      console.log(`[Instance ${this.instanceId}] Bot died`);
      if (this.ai) {
        this.ai.onDeath();
      }
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[Instance ${this.instanceId}] Max reconnect attempts reached, giving up`);
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Instance ${this.instanceId}] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
    
    setTimeout(() => {
      this.start();
    }, this.reconnectDelay);
  }

  stop() {
    if (this.bot) {
      this.bot.quit('Multi-server shutdown');
    }
  }
}

// Main multi-server manager
class MultiServerManager {
  constructor() {
    this.instances = [];
    this.configs = loadServerConfigs();
  }

  start() {
    console.log('Starting Multi-Server Minecraft AI Manager...');
    console.log(`Found ${this.configs.length} server configurations`);

    this.configs.forEach((config, index) => {
      const instance = new BotInstance(config, index + 1);
      this.instances.push(instance);
      
      // Stagger bot connections to avoid overwhelming servers
      setTimeout(() => {
        instance.start();
      }, index * 2000);
    });

    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    const shutdown = () => {
      console.log('Shutting down all bot instances...');
      this.instances.forEach(instance => {
        instance.stop();
      });
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  getStatus() {
    return this.instances.map((instance, index) => ({
      instanceId: index + 1,
      config: instance.config,
      connected: instance.bot && instance.bot.entity ? true : false,
      username: instance.bot ? instance.bot.username : 'Not connected',
      reconnectAttempts: instance.reconnectAttempts
    }));
  }
}

// Start the multi-server manager
if (require.main === module) {
  const manager = new MultiServerManager();
  manager.start();

  // Status report every 30 seconds
  setInterval(() => {
    const status = manager.getStatus();
    console.log('\n=== Multi-Server Status ===');
    status.forEach(s => {
      console.log(`Instance ${s.instanceId}: ${s.connected ? '✅' : '❌'} ${s.username} (${s.config.host}:${s.config.port})`);
    });
    console.log('==========================\n');
  }, 30000);
}

module.exports = { MultiServerManager, BotInstance };