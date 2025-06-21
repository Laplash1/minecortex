class EnvironmentObserver {
  constructor(bot) {
    this.bot = bot;
    this.lastPosition = null;
    this.nearbyEntities = new Map();
    this.nearbyBlocks = new Map();
    this.inventoryState = new Map();
    this.timeOfDay = 'unknown';
    this.weather = 'clear';
    this.health = 20;
    this.food = 20;
    this.experience = 0;
    
    // Observation history
    this.observationHistory = [];
    this.maxHistorySize = 1000;
  }

  update() {
    this.updatePosition();
    this.updateNearbyEntities();
    this.updateNearbyBlocks();
    this.updateInventory();
    this.updatePlayerStats();
    this.updateEnvironment();
    
    this.recordObservation();
  }

  updatePosition() {
    if (!this.bot?.entity?.position) {
      // Keep last known position if current position is unavailable
      return;
    }
    
    const pos = this.bot.entity.position;
    this.lastPosition = {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      timestamp: Date.now()
    };
  }

  updateNearbyEntities() {
    this.nearbyEntities.clear();
    
    // Validate bot position before processing entities
    if (!this.bot?.entity?.position || !this.bot?.entities) {
      return;
    }
    
    // Get all entities within 32 blocks
    for (const entity of Object.values(this.bot.entities)) {
      if (entity === this.bot.entity || !entity?.position) continue;
      
      try {
        const distance = entity.position.distanceTo(this.bot.entity.position);
        if (distance <= 32) {
          this.nearbyEntities.set(entity.id, {
            type: entity.name || entity.type || 'unknown',
            position: entity.position,
            distance: Math.round(distance * 100) / 100,
            health: entity.health ?? 0,
            isHostile: this.isHostileEntity(entity.name),
            isPlayer: entity.type === 'player'
          });
        }
      } catch (error) {
        // Skip entities with invalid position data
        continue;
      }
    }
  }

  updateNearbyBlocks() {
    this.nearbyBlocks.clear();
    
    if (!this.bot?.entity?.position) {
      return;
    }
    
    const pos = this.bot.entity.position;
    const radius = 16;
    
    // Sample blocks in a grid around the bot
    for (let x = -radius; x <= radius; x += 4) {
      for (let z = -radius; z <= radius; z += 4) {
        for (let y = -8; y <= 8; y += 4) {
          try {
            const block = this.bot.blockAt(
              pos.offset(x, y, z)
            );
            
            if (block && block.name !== 'air' && block.position) {
              const key = `${Math.floor(pos.x + x)},${Math.floor(pos.y + y)},${Math.floor(pos.z + z)}`;
              this.nearbyBlocks.set(key, {
                type: block.name,
                position: block.position,
                harvestable: this.canHarvestBlock(block.name)
              });
            }
          } catch (error) {
            // Skip invalid block coordinates
            continue;
          }
        }
      }
    }
  }

  scanDetailedTerrain() {
    try {
      const terrainMap = new Map();
      const pos = this.bot.entity.position;
      const radius = 8;
      
      // Use integer coordinates to avoid floating point errors
      const centerX = Math.floor(pos.x);
      const centerY = Math.floor(pos.y);
      const centerZ = Math.floor(pos.z);
      
      for (let x = -radius; x <= radius; x += 2) {
        for (let z = -radius; z <= radius; z += 2) {
          for (let y = -4; y <= 4; y += 2) {
            try {
              const blockX = centerX + x;
              const blockY = centerY + y;
              const blockZ = centerZ + z;
              
              const block = this.bot.blockAt({ x: blockX, y: blockY, z: blockZ });
              if (block && block.name !== 'air') {
                const key = `${blockX},${blockY},${blockZ}`;
                terrainMap.set(key, {
                  type: block.name,
                  position: { x: blockX, y: blockY, z: blockZ },
                  distance: Math.sqrt(x*x + y*y + z*z),
                  accessible: this.isBlockAccessible(block)
                });
              }
            } catch (blockError) {
              // Skip individual block errors
              continue;
            }
          }
        }
      }
      
      return terrainMap;
      
    } catch (error) {
      console.log(`[EnvironmentObserver] Terrain scan error: ${error.message}`);
      return new Map();
    }
  }

  analyzeHeightDifferences() {
    try {
      const pos = this.bot.entity.position;
      const heightChanges = [];
      const radius = 8;
      
      const centerX = Math.floor(pos.x);
      const centerY = Math.floor(pos.y);
      const centerZ = Math.floor(pos.z);
      
      // Sample height at several points around the bot
      for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 4) {
        const sampleX = centerX + Math.floor(Math.cos(angle) * radius);
        const sampleZ = centerZ + Math.floor(Math.sin(angle) * radius);
        
        try {
          // Find ground level at sample point
          let groundY = centerY;
          for (let y = centerY + 5; y >= centerY - 10; y--) {
            const testBlock = this.bot.blockAt({ x: sampleX, y: y, z: sampleZ });
            if (testBlock && testBlock.name !== 'air') {
              groundY = y + 1; // One block above solid ground
              break;
            }
          }
          
          const heightDiff = groundY - centerY;
          if (Math.abs(heightDiff) > 0.5) {
            heightChanges.push({
              direction: angle,
              heightDifference: heightDiff,
              position: { x: sampleX, y: groundY, z: sampleZ },
              isCliff: Math.abs(heightDiff) > 3,
              isNavigable: Math.abs(heightDiff) <= 2
            });
          }
          
        } catch (sampleError) {
          // Skip individual sample errors
          continue;
        }
      }
      
      return heightChanges;
      
    } catch (error) {
      console.log(`[EnvironmentObserver] Height analysis error: ${error.message}`);
      return [];
    }
  }

  isBlockAccessible(block) {
    if (!block) return false;
    
    try {
      // Check if block is at a reasonable height
      const pos = this.bot.entity.position;
      const blockPos = block.position;
      
      const heightDiff = blockPos.y - pos.y;
      const horizontalDistance = Math.sqrt(
        Math.pow(blockPos.x - pos.x, 2) + 
        Math.pow(blockPos.z - pos.z, 2)
      );
      
      // Basic accessibility rules
      if (Math.abs(heightDiff) > 4) return false; // Too high/low
      if (horizontalDistance > 32) return false; // Too far
      
      // Check if there's a path (simplified)
      const airAbove = this.bot.blockAt({
        x: blockPos.x,
        y: blockPos.y + 1,
        z: blockPos.z
      });
      
      return airAbove && airAbove.name === 'air';
      
    } catch (error) {
      return false;
    }
  }

  updateInventory() {
    this.inventoryState.clear();
    
    if (this.bot.inventory && this.bot.inventory.items) {
      for (const item of this.bot.inventory.items()) {
        if (this.inventoryState.has(item.name)) {
          this.inventoryState.set(item.name, 
            this.inventoryState.get(item.name) + item.count
          );
        } else {
          this.inventoryState.set(item.name, item.count);
        }
      }
    }
  }

  updatePlayerStats() {
    this.health = this.bot.health || 20;
    this.food = this.bot.food || 20;
    this.experience = this.bot.experience || 0;
  }

  updateEnvironment() {
    this.timeOfDay = this.getTimeOfDay();
    this.weather = this.getWeather();
  }

  getTimeOfDay() {
    const time = this.bot.time.timeOfDay;
    if (time < 1000 || time > 23000) return 'night';
    if (time < 6000) return 'morning';
    if (time < 12000) return 'day';
    if (time < 18000) return 'afternoon';
    return 'evening';
  }

  getWeather() {
    if (this.bot.isRaining) return 'rain';
    if (this.bot.thunderState > 0) return 'thunder';
    return 'clear';
  }

  isHostileEntity(entityName) {
    const hostileEntities = [
      'zombie', 'skeleton', 'spider', 'creeper', 'enderman',
      'witch', 'slime', 'phantom', 'drowned', 'husk',
      'stray', 'wither_skeleton', 'blaze', 'ghast'
    ];
    
    return hostileEntities.includes(entityName);
  }

  canHarvestBlock(blockName) {
    const harvestableBlocks = [
      'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
      'stone', 'cobblestone', 'coal_ore', 'iron_ore',
      'wheat', 'carrots', 'potatoes', 'sugar_cane',
      'dirt', 'grass_block', 'sand', 'gravel'
    ];
    
    return harvestableBlocks.includes(blockName);
  }

  recordObservation() {
    const observation = {
      timestamp: Date.now(),
      position: this.lastPosition,
      health: this.health,
      food: this.food,
      timeOfDay: this.timeOfDay,
      weather: this.weather,
      nearbyEntityCount: this.nearbyEntities.size,
      nearbyBlockTypes: Array.from(this.nearbyBlocks.values())
        .map(b => b.type)
        .filter((type, index, arr) => arr.indexOf(type) === index),
      inventoryItems: Array.from(this.inventoryState.keys())
    };
    
    this.observationHistory.push(observation);
    
    // Limit history size
    if (this.observationHistory.length > this.maxHistorySize) {
      this.observationHistory.shift();
    }
  }

  // Query methods for AI decision making
  findNearestEntity(entityType) {
    let nearest = null;
    let minDistance = Infinity;
    
    for (const entity of this.nearbyEntities.values()) {
      if (entity.type === entityType && entity.distance < minDistance) {
        nearest = entity;
        minDistance = entity.distance;
      }
    }
    
    return nearest;
  }

  findNearestBlock(blockType) {
    let nearest = null;
    let minDistance = Infinity;
    
    for (const block of this.nearbyBlocks.values()) {
      if (block.type === blockType) {
        const distance = block.position.distanceTo(this.bot.entity.position);
        if (distance < minDistance) {
          nearest = block;
          minDistance = distance;
        }
      }
    }
    
    return nearest;
  }

  getInventoryCount(itemName) {
    return this.inventoryState.get(itemName) || 0;
  }

  hasItem(itemName, minCount = 1) {
    return this.getInventoryCount(itemName) >= minCount;
  }

  isDangerous() {
    // Check for hostile entities nearby
    for (const entity of this.nearbyEntities.values()) {
      if (entity.isHostile && entity.distance < 10) {
        return true;
      }
    }
    
    // Check health and food levels
    if (this.health < 6 || this.food < 6) {
      return true;
    }
    
    // Check time and weather
    if (this.timeOfDay === 'night' && this.weather === 'thunder') {
      return true;
    }
    
    return false;
  }

  getNearbyDangers() {
    const dangers = [];
    
    for (const entity of this.nearbyEntities.values()) {
      if (entity.isHostile) {
        dangers.push({
          type: 'hostile_entity',
          entityType: entity.type,
          distance: entity.distance,
          position: entity.position
        });
      }
    }
    
    if (this.health < 10) {
      dangers.push({
        type: 'low_health',
        value: this.health
      });
    }
    
    if (this.food < 10) {
      dangers.push({
        type: 'low_food',
        value: this.food
      });
    }
    
    return dangers;
  }

  getResourceOpportunities() {
    const opportunities = [];
    
    // Check for valuable blocks
    const valuableBlocks = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore'];
    for (const blockType of valuableBlocks) {
      const block = this.findNearestBlock(blockType);
      if (block) {
        opportunities.push({
          type: 'valuable_block',
          blockType: block.type,
          position: block.position
        });
      }
    }
    
    // Check for food sources
    const animals = ['cow', 'pig', 'chicken', 'sheep'];
    for (const animalType of animals) {
      const animal = this.findNearestEntity(animalType);
      if (animal) {
        opportunities.push({
          type: 'food_source',
          entityType: animal.type,
          position: animal.position
        });
      }
    }
    
    return opportunities;
  }

  getObservationSummary() {
    return {
      position: this.lastPosition,
      health: this.health,
      food: this.food,
      timeOfDay: this.timeOfDay,
      weather: this.weather,
      nearbyEntities: this.nearbyEntities.size,
      inventoryItems: this.inventoryState.size,
      isDangerous: this.isDangerous(),
      dangers: this.getNearbyDangers(),
      opportunities: this.getResourceOpportunities()
    };
  }
}

module.exports = { EnvironmentObserver };