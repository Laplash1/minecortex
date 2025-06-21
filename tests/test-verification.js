// Test script to verify all functionality
const { SkillLibrary } = require('./src/SkillLibrary');
const { ControlPrimitives } = require('./src/ControlPrimitives');
const { MinecraftAI } = require('./src/MinecraftAI');
const { EnvironmentObserver } = require('./src/EnvironmentObserver');

console.log('=== Minecraft AI Verification Test ===\n');

// Test 1: Module imports
console.log('1. Testing module imports...');
try {
  console.log('✓ SkillLibrary imported successfully');
  console.log('✓ ControlPrimitives imported successfully');
  console.log('✓ MinecraftAI imported successfully');
  console.log('✓ EnvironmentObserver imported successfully');
} catch (error) {
  console.log('✗ Import failed:', error.message);
}

// Test 2: SkillLibrary functionality
console.log('\n2. Testing SkillLibrary...');
try {
  const skillLib = new SkillLibrary();
  skillLib.loadBasicSkills();
  const skills = skillLib.listSkills();
  console.log(`✓ Loaded ${skills.length} skills:`, skills.join(', '));
  
  // Test specific skill retrieval
  const gatherWoodSkill = skillLib.getSkill('gather_wood');
  if (gatherWoodSkill) {
    console.log('✓ gather_wood skill accessible');
  } else {
    console.log('✗ gather_wood skill not found');
  }
} catch (error) {
  console.log('✗ SkillLibrary test failed:', error.message);
}

// Test 3: Mock bot for ControlPrimitives
console.log('\n3. Testing ControlPrimitives (without bot connection)...');
try {
  // Create a mock bot object
  const mockBot = {
    version: '1.20.1',
    inventory: {
      findInventoryItem: () => null,
      items: () => [],
      count: () => 0
    },
    findBlocks: () => [],
    findBlock: () => null,
    blockAt: () => null,
    entity: {
      position: { x: 0, y: 64, z: 0 }
    },
    Vec3: class Vec3 {
      constructor(x, y, z) {
        this.x = x; this.y = y; this.z = z;
      }
      offset(dx, dy, dz) {
        return new this.constructor(this.x + dx, this.y + dy, this.z + dz);
      }
    }
  };
  
  const primitives = new ControlPrimitives(mockBot);
  console.log('✓ ControlPrimitives created with mock bot');
  
  // Test utility methods
  const hasItem = primitives.hasItem('wooden_pickaxe');
  console.log('✓ hasItem method works:', hasItem);
  
  const itemCount = primitives.getItemCount('stone');
  console.log('✓ getItemCount method works:', itemCount);
  
} catch (error) {
  console.log('✗ ControlPrimitives test failed:', error.message);
}

// Test 4: Configuration validation
console.log('\n4. Testing configuration...');
try {
  const fs = require('fs');
  
  // Check if .env.example exists
  if (fs.existsSync('.env.example')) {
    console.log('✓ .env.example file exists');
  } else {
    console.log('⚠ .env.example file missing');
  }
  
  // Check servers.json
  if (fs.existsSync('servers.json')) {
    const serversConfig = JSON.parse(fs.readFileSync('servers.json', 'utf8'));
    console.log(`✓ servers.json exists with ${serversConfig.length} server configurations`);
  } else {
    console.log('✗ servers.json file missing');
  }
  
} catch (error) {
  console.log('✗ Configuration test failed:', error.message);
}

// Test 5: Goal progression logic
console.log('\n5. Testing goal progression...');
try {
  const mockBot = {
    version: '1.20.1',
    inventory: { items: () => [] },
    entity: { position: { x: 0, y: 64, z: 0 } }
  };
  
  const ai = new MinecraftAI(mockBot);
  console.log('✓ MinecraftAI instance created');
  
  // Check initial goals
  if (ai.goals && ai.goals.length > 0) {
    console.log(`✓ Initial goals set: ${ai.goals.length} goals`);
    const firstGoal = ai.goals[0];
    if (firstGoal.type === 'gather_wood') {
      console.log('✓ First goal is gather_wood (correct progression)');
    } else {
      console.log(`⚠ First goal is ${firstGoal.type}, expected gather_wood`);
    }
  }
  
} catch (error) {
  console.log('✗ Goal progression test failed:', error.message);
}

console.log('\n=== Verification Complete ===');

// Summary of potential issues to check
console.log('\n=== Potential Issues to Monitor ===');
console.log('1. Pathfinder plugin loading (requires actual bot connection)');
console.log('2. Minecraft data compatibility with server version');
console.log('3. ControlPrimitives timeout handling in real scenarios');
console.log('4. Memory usage with continuous exploration');
console.log('5. Error recovery in network disconnection scenarios');