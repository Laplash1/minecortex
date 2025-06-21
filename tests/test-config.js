// Test configuration for running the bot locally
// This simulates a basic test environment without requiring a full Minecraft server

const { MinecraftAI } = require('../src/MinecraftAI');

// Mock bot for testing
class MockBot {
  constructor() {
    this.username = 'TestBot';
    this.entity = {
      position: { x: 0, y: 64, z: 0 }
    };
    this.health = 20;
    this.food = 20;
    this.experience = 0;
    this.time = { timeOfDay: 1000 };
    this.isRaining = false;
    this.thunderState = 0;
    this.inventory = {
      items: () => [],
      findInventoryItem: () => null,
      count: () => 0
    };
    this.entities = {};
    this.players = {};
    
    this.eventHandlers = new Map();
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, ...args) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  chat(message) {
    console.log(`[CHAT] ${message}`);
  }

  look(yaw, pitch) {
    return Promise.resolve();
  }

  blockAt(position) {
    return { name: 'air', position };
  }

  findBlock(options) {
    return null; // Simulate no blocks found
  }

  quit() {
    console.log('Bot disconnected');
  }

  // Mock pathfinder
  loadPlugin(plugin) {
    // Mock plugin loading
  }
}

// Test the AI system
async function testAI() {
  console.log('Testing MineCortex...');
  
  const mockBot = new MockBot();
  const ai = new MinecraftAI(mockBot);
  
  // Simulate login
  mockBot.emit('login');
  
  // Simulate spawn
  mockBot.emit('spawn');
  
  // Test chat commands
  setTimeout(() => {
    mockBot.emit('chat', 'TestUser', '!status');
  }, 1000);
  
  setTimeout(() => {
    mockBot.emit('chat', 'TestUser', '!learn');
  }, 2000);
  
  setTimeout(() => {
    mockBot.emit('chat', 'TestUser', '!stop');
    mockBot.quit();
  }, 10000);
  
  console.log('AI test started. Will run for 10 seconds...');
}

// Run test if this file is executed directly
if (require.main === module) {
  testAI().catch(console.error);
}

module.exports = { MockBot, testAI };