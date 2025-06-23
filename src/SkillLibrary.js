const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { InventoryUtils } = require('./InventoryUtils');

class SkillLibrary {
  constructor() {
    this.skills = new Map();
  }

  loadBasicSkills() {
    // Movement skills
    this.registerSkill('move_to', new MoveToSkill());
    this.registerSkill('follow', new FollowSkill());
    this.registerSkill('explore', new ExploreSkill());
    
    // Interaction skills
    this.registerSkill('mine_block', new MineBlockSkill());
    this.registerSkill('place_block', new PlaceBlockSkill());
    this.registerSkill('attack_entity', new AttackEntitySkill());
    
    // Advanced movement skills
    this.registerSkill('smart_jump', new SmartJumpSkill());
    this.registerSkill('escape_water', new EscapeWaterSkill());
    this.registerSkill('navigate_terrain', new NavigateTerrainSkill());
    
    // Survival skills
    this.registerSkill('gather_wood', new SimpleGatherWoodSkill());
    this.registerSkill('find_food', new SimpleFindFoodSkill());
    
    // Crafting skills
    this.registerSkill('craft_tools', new CraftToolsSkill());
    this.registerSkill('craft_workbench', new CraftWorkbenchSkill());
    this.registerSkill('craft_furnace', new CraftFurnaceSkill());
    
    // Building skills
    this.registerSkill('build_shelter', new BuildShelterSkill());
    this.registerSkill('place_blocks', new PlaceBlocksSkill());
    
    console.log(`${this.skills.size}個のスキルを読み込みました`);
  }

  registerSkill(name, skill) {
    this.skills.set(name, skill);
  }

  getSkill(name) {
    return this.skills.get(name);
  }

  listSkills() {
    return Array.from(this.skills.keys());
  }
}

// Base skill class
class Skill {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }

  async execute(bot, params = {}) {
    throw new Error('execute method must be implemented');
  }
}

// Movement Skills
class MoveToSkill extends Skill {
  constructor() {
    super('move_to', 'Move to a specific position');
  }

  async execute(bot, params) {
    try {
      const { target } = params;
      const { x, y, z } = target || params;
      
      // Check if movement is necessary (distance threshold)
      const currentPos = bot.entity.position;
      const distance = Math.sqrt(
        Math.pow(x - currentPos.x, 2) + 
        Math.pow(y - currentPos.y, 2) +
        Math.pow(z - currentPos.z, 2)
      );
      
      // If already close enough, don't move
      if (distance < 3) {
        console.log(`[移動スキル] 既に目的地に近いため移動をスキップ (距離: ${distance.toFixed(1)})`);
        return { success: true, message: '既に目的地付近にいます' };
      }
      
      console.log(`[移動スキル] (${x}, ${y}, ${z})に移動中... (距離: ${distance.toFixed(1)})`);
      
      // Ensure pathfinder and movement settings are ready with proper error handling
      if (!bot.pathfinder) {
        try {
          bot.loadPlugin(pathfinder);
          // Wait for plugin to fully initialize
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (loadError) {
          console.log(`[移動スキル] Pathfinder読み込み失敗: ${loadError.message}`);
          return { success: false, error: `Pathfinder初期化エラー: ${loadError.message}` };
        }
      }
      
      // Verify pathfinder is properly initialized
      if (!bot.pathfinder || typeof bot.pathfinder !== 'object') {
        console.log('[移動スキル] Pathfinderが正しく初期化されていません');
        return { success: false, error: 'Pathfinder初期化が不完全です' };
      }
      
      if (!bot.pathfinder.movements) {
        try {
          const mcData = require('minecraft-data')(bot.version);
          const movements = new Movements(bot, mcData);
          
          // Enhanced movement settings for better navigation
          movements.canDig = true;
          movements.allow1by1towers = true;
          movements.allowFreeMotion = true;
          movements.allowParkour = true;             // Enable parkour movements
          movements.allowSprinting = true;           // Enable sprinting
          movements.canOpenDoors = true;             // Allow opening doors
          movements.allowEntityDetection = true;     // Detect entities as obstacles
          movements.blocksCantBreak = [];            // Can break most blocks
          movements.liquids = new Set();             // Treat liquids as passable
          
          // Jumping and safety settings
          movements.maxJumpDistance = 2;
          movements.maxFallDistance = 3;
          movements.dontMineUnderFallingBlock = true; // Safety
          movements.infiniteLiquidDropdownDistance = true;
          
          bot.pathfinder.setMovements(movements);
        } catch (movementError) {
          console.log(`[移動スキル] Movement設定エラー: ${movementError.message}`);
          return { success: false, error: `Movement設定失敗: ${movementError.message}` };
        }
      }

      // Prefer the high-level `goto` helper when available to avoid
      // manual event wiring issues that caused “bot.pathfinder.on is not a function”
      if (typeof bot.pathfinder.goto === 'function') {
        try {
          // Clear any existing goals to prevent conflicts
          bot.pathfinder.stop();
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Check for water before pathfinding
          const waterCheck = await this.checkAndEscapeWater(bot);
          if (waterCheck.inWater && !waterCheck.success) {
            console.log('[移動スキル] 水中でpathfinding困難、基本移動にフォールバック');
            return await this.executeBasicMovement(bot, x, y, z);
          }
          
          // Use appropriate goal type based on distance and height difference
          const currentPos = bot.entity.position;
          const heightDiff = Math.abs(y - currentPos.y);
          
          let goal;
          if (heightDiff > 2) {
            // For significant height differences, use GoalBlock
            goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
          } else {
            // For same level or small height differences, use GoalNear for more flexibility
            goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1);
          }
          
          await bot.pathfinder.goto(goal, { timeout: 12000 }); // Extended timeout for complex terrain
          return { success: true, message: '目的地に到着しました' };
        } catch (gotoErr) {
          console.log(`[移動スキル] goto失敗: ${gotoErr.message}`);
          
          // Enhanced error handling with specific fallback strategies
          if (gotoErr.message.includes('timeout') || 
              gotoErr.message.includes('path') ||
              gotoErr.message.includes('goal') ||
              gotoErr.message.includes('changed')) {
            console.log(`[移動スキル] パスファインディング問題を検出、基本移動にフォールバック`);
            return await this.executeBasicMovement(bot, x, y, z);
          }
          
          // For other errors, try basic movement as well
          console.log(`[移動スキル] 未知のエラー、基本移動を試行`);
          return await this.executeBasicMovement(bot, x, y, z);
        }
      }
      
      // Manual pathfinding with enhanced safety checks and error handling
      if (!bot.pathfinder.setGoal || !bot.pathfinder.on) {
        console.log(`[移動スキル] Pathfinder APIが利用できません、基本移動を試行`);
        return await this.executeBasicMovement(bot, x, y, z);
      }
      
      // Clear any existing goals and setup new one
      try {
        bot.pathfinder.stop();
        await new Promise(resolve => setTimeout(resolve, 50)); // Brief pause
        
        const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
        bot.pathfinder.setGoal(goal);
      } catch (setupError) {
        console.log(`[移動スキル] 目標設定エラー、基本移動を試行: ${setupError.message}`);
        return await this.executeBasicMovement(bot, x, y, z);
      }
      
      return new Promise((resolve) => {
        let resolved = false;
        
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            bot.pathfinder.stop();
            resolve({ success: false, error: 'パスファインディングタイムアウト (3秒)' });
          }
        }, 8000); // Extended timeout to 8 seconds for more stable pathfinding
        
        const onGoalReached = () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve({ success: true, message: '目的地に到着しました' });
          }
        };
        
        const onPathUpdate = (r) => {
          if (!resolved && r.status === 'noPath') {
            resolved = true;
            cleanup();
            bot.pathfinder.stop();
            resolve({ success: false, error: '目的地への経路が見つかりません' });
          }
        };
        
        const cleanup = () => {
          clearTimeout(timeout);
          try {
            if (bot.pathfinder && typeof bot.pathfinder.removeListener === 'function') {
              bot.pathfinder.removeListener('goal_reached', onGoalReached);
              bot.pathfinder.removeListener('path_update', onPathUpdate);
            }
          } catch (cleanupError) {
            console.log(`[移動スキル] イベントリスナー削除エラー: ${cleanupError.message}`);
          }
        };
        
        try {
          if (bot.pathfinder && typeof bot.pathfinder.on === 'function') {
            bot.pathfinder.on('goal_reached', onGoalReached);
            bot.pathfinder.on('path_update', onPathUpdate);
          } else {
            resolved = true;
            cleanup();
            resolve({ success: false, error: 'Pathfinderイベントハンドラーが利用できません' });
          }
        } catch (eventError) {
          resolved = true;
          cleanup();
          resolve({ success: false, error: `イベントハンドラー設定エラー: ${eventError.message}` });
        }
      });
      
    } catch (error) {
      console.log(`[移動スキル] エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Enhanced movement with obstacle detection, stuck detection, and water escape
  async executeBasicMovement(bot, x, y, z) {
    try {
      console.log(`[移動スキル] 強化基本移動: (${x}, ${y}, ${z})`);
      
      // Check if we're in water and need to escape first
      const waterEscapeResult = await this.checkAndEscapeWater(bot);
      if (!waterEscapeResult.success && waterEscapeResult.inWater) {
        return { success: false, error: '水中から脱出できませんでした' };
      }
      
      const currentPos = bot.entity.position;
      const distance = Math.sqrt(
        Math.pow(x - currentPos.x, 2) + 
        Math.pow(z - currentPos.z, 2)
      );
      
      if (distance > 50) {
        return { success: false, error: '目的地が遠すぎます (基本移動)' };
      }
      
      const maxSteps = Math.min(Math.ceil(distance / 2), 10);
      const stepX = (x - currentPos.x) / maxSteps;
      const stepZ = (z - currentPos.z) / maxSteps;
      
      let lastPos = { ...currentPos };
      let stuckCount = 0;
      
      for (let i = 0; i < maxSteps; i++) {
        const targetX = currentPos.x + stepX * (i + 1);
        const targetZ = currentPos.z + stepZ * (i + 1);
        
        try {
          // Check for water before each step
          const inWater = await this.checkAndEscapeWater(bot);
          if (inWater.inWater && !inWater.success) {
            console.log('[移動スキル] 水中で移動困難、脱出を試行');
            continue;
          }
          
          // Look at target and move
          await bot.lookAt(new Vec3(targetX, currentPos.y, targetZ));
          
          // Check for obstacles ahead
          const obstacleCheck = await this.checkObstacleAhead(bot, targetX, targetZ);
          if (obstacleCheck.hasObstacle) {
            console.log(`[移動スキル] 障害物検出: ${obstacleCheck.reason}`);
            
            // Try jumping over obstacle
            if (obstacleCheck.canJump) {
              console.log('[移動スキル] ジャンプで障害物を回避');
              bot.setControlState('jump', true);
              await new Promise(resolve => setTimeout(resolve, 200));
              bot.setControlState('jump', false);
            }
          }
          
          // Move forward
          bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, 1500));
          bot.setControlState('forward', false);
          
          // Check if we moved (stuck detection)
          const newPos = bot.entity.position;
          const moved = Math.sqrt(
            Math.pow(newPos.x - lastPos.x, 2) + 
            Math.pow(newPos.z - lastPos.z, 2)
          );
          
          if (moved < 0.5) {
            stuckCount++;
            console.log(`[移動スキル] スタック検出 ${stuckCount}/3`);
            
            if (stuckCount >= 3) {
              // Try unstuck maneuvers
              const unstuckResult = await this.performUnstuckManeuvers(bot);
              if (!unstuckResult.success) {
                return { success: false, error: 'スタック状態から脱出できませんでした' };
              }
              stuckCount = 0;
            }
          } else {
            stuckCount = 0;
            lastPos = { ...newPos };
          }
          
          // Check if we're close enough to target
          const targetDistance = Math.sqrt(
            Math.pow(x - newPos.x, 2) + 
            Math.pow(z - newPos.z, 2)
          );
          
          if (targetDistance < 3) {
            return { success: true, message: '強化基本移動で目的地に到着' };
          }
          
        } catch (moveError) {
          console.log(`[移動スキル] 移動ステップエラー: ${moveError.message}`);
          continue;
        }
      }
      
      return { success: false, error: '強化基本移動でも目的地に到達できませんでした' };
      
    } catch (error) {
      console.log(`[移動スキル] 強化基本移動エラー: ${error.message}`);
      return { success: false, error: `強化基本移動失敗: ${error.message}` };
    }
  }
  
  // Water detection and escape system
  async checkAndEscapeWater(bot) {
    try {
      const pos = bot.entity.position;
      const currentBlock = bot.blockAt(pos);
      const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
      
      // Check if we're in water or lava
      const inWater = currentBlock && (currentBlock.name === 'water' || currentBlock.name === 'flowing_water');
      const inLava = currentBlock && (currentBlock.name === 'lava' || currentBlock.name === 'flowing_lava');
      const headInWater = blockAbove && (blockAbove.name === 'water' || blockAbove.name === 'flowing_water');
      
      if (!inWater && !inLava && !headInWater) {
        return { success: true, inWater: false };
      }
      
      console.log(`[移動スキル] ${inLava ? 'マグマ' : '水'}中検出、脱出を試行`);
      
      // Emergency escape maneuvers
      for (let i = 0; i < 10; i++) {
        // Swim up
        bot.setControlState('jump', true);
        
        // Try to move in different directions to find shore
        const escapeAngle = (i * Math.PI * 2) / 8; // 8 directions
        const escapeX = Math.cos(escapeAngle);
        const escapeZ = Math.sin(escapeAngle);
        
        await bot.lookAt(new Vec3(pos.x + escapeX, pos.y + 1, pos.z + escapeZ));
        
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 500));
        bot.setControlState('forward', false);
        
        // Check if we escaped
        const newPos = bot.entity.position;
        const newBlock = bot.blockAt(newPos);
        
        if (newBlock && newBlock.name !== 'water' && newBlock.name !== 'flowing_water' && 
            newBlock.name !== 'lava' && newBlock.name !== 'flowing_lava') {
          bot.setControlState('jump', false);
          console.log('[移動スキル] 水中から脱出成功');
          return { success: true, inWater: false };
        }
      }
      
      bot.setControlState('jump', false);
      return { success: false, inWater: true, error: '水中脱出に失敗' };
      
    } catch (error) {
      console.log(`[移動スキル] 水中脱出エラー: ${error.message}`);
      return { success: false, inWater: true, error: error.message };
    }
  }
  
  // Obstacle detection ahead
  async checkObstacleAhead(bot, targetX, targetZ) {
    try {
      const pos = bot.entity.position;
      const dirX = targetX - pos.x;
      const dirZ = targetZ - pos.z;
      const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
      
      if (distance === 0) return { hasObstacle: false };
      
      const normalX = dirX / distance;
      const normalZ = dirZ / distance;
      
      // Check 1-2 blocks ahead
      for (let d = 1; d <= 2; d++) {
        const checkX = Math.floor(pos.x + normalX * d);
        const checkY = Math.floor(pos.y);
        const checkZ = Math.floor(pos.z + normalZ * d);
        
        const blockAhead = bot.blockAt(new Vec3(checkX, checkY, checkZ));
        const blockAbove = bot.blockAt(new Vec3(checkX, checkY + 1, checkZ));
        
        if (blockAhead && blockAhead.name !== 'air' && 
            !['water', 'flowing_water', 'lava', 'flowing_lava'].includes(blockAhead.name)) {
          
          // Check if we can jump over it (1 block high)
          if (blockAbove && blockAbove.name === 'air') {
            return { hasObstacle: true, canJump: true, reason: `${blockAhead.name}を検出、ジャンプ可能` };
          } else {
            return { hasObstacle: true, canJump: false, reason: `${blockAhead.name}を検出、ジャンプ不可` };
          }
        }
      }
      
      return { hasObstacle: false };
      
    } catch (error) {
      console.log(`[移動スキル] 障害物検出エラー: ${error.message}`);
      return { hasObstacle: false };
    }
  }
  
  // Unstuck maneuvers when bot gets stuck
  async performUnstuckManeuvers(bot) {
    try {
      console.log('[移動スキル] スタック解除マニューバを実行');
      
      const maneuvers = [
        // Jump
        async () => {
          bot.setControlState('jump', true);
          await new Promise(resolve => setTimeout(resolve, 300));
          bot.setControlState('jump', false);
        },
        // Back up
        async () => {
          bot.setControlState('back', true);
          await new Promise(resolve => setTimeout(resolve, 1000));
          bot.setControlState('back', false);
        },
        // Turn and move
        async () => {
          const pos = bot.entity.position;
          await bot.lookAt(new Vec3(pos.x + Math.random() * 4 - 2, pos.y, pos.z + Math.random() * 4 - 2));
          bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, 1000));
          bot.setControlState('forward', false);
        },
        // Jump and move
        async () => {
          bot.setControlState('jump', true);
          bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, 500));
          bot.setControlState('jump', false);
          bot.setControlState('forward', false);
        }
      ];
      
      const startPos = bot.entity.position;
      
      for (const maneuver of maneuvers) {
        await maneuver();
        
        // Check if we moved
        const newPos = bot.entity.position;
        const moved = Math.sqrt(
          Math.pow(newPos.x - startPos.x, 2) + 
          Math.pow(newPos.z - startPos.z, 2)
        );
        
        if (moved > 1) {
          console.log('[移動スキル] スタック解除成功');
          return { success: true };
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      console.log('[移動スキル] スタック解除失敗');
      return { success: false };
      
    } catch (error) {
      console.log(`[移動スキル] スタック解除エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

class FollowSkill extends Skill {
  constructor() {
    super('follow', 'Follow a player');
  }

  async execute(bot, params) {
    const { target } = params;
    const player = bot.players[target];
    
    if (!player || !player.entity) {
      throw new Error(`Player ${target} not found`);
    }

    try {
      if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        bot.pathfinder.setMovements(movements);
      }
      
      // Start following the target continuously for a fixed duration or until cancelled
      const goal = new goals.GoalFollow(player.entity, 3);
      bot.pathfinder.setGoal(goal, true); // "true" enables dynamic replanning
      
      const followDuration = params.durationMs || 30000; // default 30 sec
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          resolve({ success: true, message: `${target} の追跡を終了しました` });
        }, followDuration);
        
        // If caller passes cancelToken (an AbortController.signal), stop early
        if (params.cancelToken) {
          params.cancelToken.addEventListener('abort', () => {
            clearTimeout(timeout);
            bot.pathfinder.setGoal(null);
            resolve({ success: true, message: `${target} の追跡を中断しました` });
          });
        }
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class ExploreSkill extends Skill {
  constructor() {
    super('explore', 'Explore the surrounding area');
  }

  async execute(bot, params) {
    try {
      const { radius = 30, timeout = 8000 } = params; // Reduced default radius and added timeout
      
      if (!bot.entity || !bot.entity.position) {
        return { success: false, error: 'ボットの位置情報が取得できません' };
      }
      
      const pos = bot.entity.position;
      
      // Generate random exploration target with safer bounds
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * radius;
      
      const targetX = Math.floor(pos.x + Math.cos(angle) * distance);
      const targetZ = Math.floor(pos.z + Math.sin(angle) * distance);
      const targetY = pos.y;
      
      console.log(`[探索スキル] (${targetX}, ${targetY}, ${targetZ})を探索中...`);
      
      const moveSkill = new MoveToSkill();
      
      // Execute with timeout protection
      const movePromise = moveSkill.execute(bot, { x: targetX, y: targetY, z: targetZ });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('探索タイムアウト')), timeout)
      );
      
      const result = await Promise.race([movePromise, timeoutPromise]);
      
      if (result.success) {
        // Safe chat with EPIPE protection
        try {
          if (bot.chat && typeof bot.chat === 'function') {
            bot.chat(`新しいエリアを探索しました！ 🗺️`);
          }
        } catch (chatError) {
          console.log(`[探索スキル] チャットエラー: ${chatError.message}`);
        }
      }
      
      return result;
      
    } catch (error) {
      console.log(`[探索スキル] エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// Interaction Skills
class MineBlockSkill extends Skill {
  constructor() {
    super('mine_block', 'Mine a specific block');
  }

  async execute(bot, params) {
    const { blockType, position } = params;
    let block;
    
    if (position) {
      block = bot.blockAt(position);
    } else {
      block = bot.findBlock({
        matching: blockType,
        maxDistance: 32
      });
    }
    
    if (!block) {
      return { success: false, error: `ブロック ${blockType} が見つかりません` };
    }
    
    try {
      await bot.dig(block);
      return { success: true, message: `${block.name}を採掘しました` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class PlaceBlockSkill extends Skill {
  constructor() {
    super('place_block', 'Place a block at a position');
  }

  async execute(bot, params) {
    const { blockType, position } = params;
    const item = bot.inventory.items().find(itemObj => itemObj && itemObj.name === blockType);
    
    if (!item) {
      return { success: false, error: `インベントリに${blockType}がありません` };
    }
    
    try {
      const referenceBlock = bot.blockAt(position);
      await bot.placeBlock(referenceBlock, new bot.Vec3(0, 1, 0));
      return { success: true, message: `${blockType}を設置しました` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class AttackEntitySkill extends Skill {
  constructor() {
    super('attack_entity', 'Attack a nearby entity');
  }

  async execute(bot, params) {
    const { entityType, maxDistance = 16 } = params;
    
    const entity = bot.nearestEntity(e => 
      e.name === entityType && 
      e.position.distanceTo(bot.entity.position) <= maxDistance
    );
    
    if (!entity) {
      return { success: false, error: `近くに${entityType}が見つかりません` };
    }
    
    try {
      await bot.attack(entity);
      return { success: true, message: `${entityType}を攻撃しました` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Survival Skills
class SimpleGatherWoodSkill extends Skill {
  constructor() {
    super('gather_wood', 'Simple wood gathering');
  }

  async execute(bot, params) {
    const { amount = 5 } = params;
    
    console.log(`[木材収集] 近くの木を探しています...`);
    
    // Find wood blocks nearby
    const woodBlock = bot.findBlock({
      matching: (block) => {
        return block.name && (
          block.name.includes('_log') ||
          block.name === 'log'
        );
      },
      maxDistance: 32
    });

    if (woodBlock) {
      console.log(`[木材収集] ${woodBlock.position}で${woodBlock.name}を発見しました`);
      try {
        await bot.dig(woodBlock);
        bot.chat(`${woodBlock.name}を採取しました！ 🌳`);
        return { success: true, gathered: 1 };
      } catch (error) {
        console.log(`[木材収集] 採掘に失敗: ${error.message}`);
        return { success: false, error: error.message };
      }
    } else {
      console.log(`[木材収集] 近くに木が見つかりません`);
      return { success: false, error: '木が見つかりません' };
    }
  }
}

class SimpleFindFoodSkill extends Skill {
  constructor() {
    super('find_food', 'Simple food finding');
  }

  async execute(bot, params) {
    console.log(`[食料確保] 現在の食料レベル: ${bot.food}/20`);
    
    if (bot.food >= 15) {
      console.log(`[食料確保] 食料レベルは十分です`);
      return { success: true, message: '食料レベルは十分です' };
    }
    
    // Look for animals to hunt
    const animals = ['cow', 'pig', 'chicken', 'sheep'];
    
    for (const animalType of animals) {
      const animal = bot.nearestEntity(e => 
        e.name === animalType && 
        e.position.distanceTo(bot.entity.position) <= 16
      );
      
      if (animal) {
        console.log(`[食料確保] ${animalType}を発見、攻撃中...`);
        try {
          await bot.attack(animal);
          bot.chat(`${animalType}を狩りました！ 🍖`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return { success: true, hunted: animalType };
        } catch (error) {
          console.log(`[食料確保] 攻撃に失敗: ${error.message}`);
        }
      }
    }
    
    console.log(`[食料確保] 近くに動物が見つかりません`);
    return { success: false, error: '動物が見つかりません' };
  }
}

// Crafting Skills
class CraftToolsSkill extends Skill {
  constructor() {
    super('craft_tools', 'Craft basic tools');
  }

  async execute(bot, params) {
    const { tools = ['wooden_pickaxe', 'wooden_axe'], context } = params;
    console.log(`[クラフトスキル] ${tools.join(', ')}を作成します`);

    let crafted = 0;
    const results = [];

    for (const tool of tools) {
      try {
        const result = await this.craftSingleTool(bot, tool);
        if (result.success) {
          crafted++;
          results.push(tool);
          console.log(`[クラフトスキル] ${tool}の作成に成功`);
        } else {
          console.log(`[クラフトスキル] ${tool}の作成に失敗: ${result.error}`);
        }
      } catch (error) {
        console.log(`[クラフトスキル] ${tool}作成中にエラー: ${error.message}`);
      }
    }

    if (crafted > 0) {
      bot.chat(`${results.join(', ')}を作成しました！ 🔨`);
      return { success: true, crafted: results };
    } else {
      return { success: false, error: '何もクラフトできませんでした' };
    }
  }

  async craftSingleTool(bot, toolName) {
    // Check if we have a crafting table
    const craftingTable = bot.findBlock({
      matching: (block) => block.name === 'crafting_table',
      maxDistance: 32
    });

    try {
      // Find the recipe
      const mcData = require('minecraft-data')(bot.version);
      const itemByName = mcData.itemsByName[toolName];
      
      if (!itemByName) {
        return { success: false, error: `Unknown tool: ${toolName}` };
      }

      const recipes = bot.recipesFor(itemByName.id, null, 1, craftingTable);
      console.log(`[CraftSkill] Searching recipes for ${toolName} (ID: ${itemByName.id})`);
      console.log(`[CraftSkill] Found ${recipes.length} recipes`);
      console.log(`[CraftSkill] Has crafting table: ${!!craftingTable}`);
      
      if (recipes.length === 0) {
        // Try without crafting table requirement
        const recipesWithoutTable = bot.recipesFor(itemByName.id, null, 1, null);
        console.log(`[CraftSkill] Without crafting table: ${recipesWithoutTable.length} recipes`);
        return { success: false, error: `No recipe for ${toolName} (checked ${recipes.length} with table, ${recipesWithoutTable.length} without)` };
      }
      
      const recipe = recipes[0];

      // Move to crafting table if needed
      if (craftingTable) {
        const distance = bot.entity.position.distanceTo(craftingTable.position);
        if (distance > 4) {
          if (bot.pathfinder) {
            const { goals } = require('mineflayer-pathfinder');
            await bot.pathfinder.setGoal(new goals.GoalBlock(
              craftingTable.position.x, 
              craftingTable.position.y, 
              craftingTable.position.z
            ));
          }
        }
      }

      // Craft the item
      await bot.craft(recipe, 1, craftingTable);
      return { success: true };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class CraftWorkbenchSkill extends Skill {
  constructor() {
    super('craft_workbench', 'Craft a workbench');
  }

  async execute(bot, params) {
    console.log(`[作業台スキル] 作業台を作成します`);

    try {
      // Check if we have wood planks
      const planks = bot.inventory.items().find(item => item && item.name === 'oak_planks') || 
                    bot.inventory.items().find(item => item && item.name === 'planks');
      
      if (!planks || planks.count < 4) {
        // Try to make planks from logs first
        const logs = bot.inventory.items().find(item => item && item.name === 'oak_log') || 
                    bot.inventory.items().find(item => item && item.name === 'log');
        
        if (logs && logs.count > 0) {
          await this.craftPlanks(bot, logs);
        } else {
          return { success: false, error: '木材が不足しています' };
        }
      }

      // Craft the workbench
      const mcData = require('minecraft-data')(bot.version);
      const workbenchItem = mcData.itemsByName.crafting_table;
      const recipe = bot.recipesFor(workbenchItem.id, null, 1, null)[0];

      if (!recipe) {
        return { success: false, error: '作業台のレシピが見つかりません' };
      }

      await bot.craft(recipe, 1, null);
      bot.chat('作業台を作成しました！ 🔧');
      return { success: true, crafted: 'crafting_table' };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async craftPlanks(bot, logs) {
    try {
      const mcData = require('minecraft-data')(bot.version);
      const planksItem = mcData.itemsByName.oak_planks || mcData.itemsByName.planks;
      const recipe = bot.recipesFor(planksItem.id, null, 1, null)[0];

      if (recipe) {
        const planksToCraft = Math.min(logs.count, 4);
        await bot.craft(recipe, planksToCraft, null);
        console.log(`[作業台スキル] ${planksToCraft * 4}個の板を作成`);
      }
    } catch (error) {
      console.log(`[作業台スキル] 板の作成に失敗: ${error.message}`);
    }
  }
}

class CraftFurnaceSkill extends Skill {
  constructor() {
    super('craft_furnace', 'Craft a furnace');
  }

  async execute(bot, params) {
    console.log(`[かまどスキル] かまどを作成します`);

    try {
      // Check if we have cobblestone
      const cobblestone = bot.inventory.items().find(item => item && item.name === 'cobblestone');
      
      if (!cobblestone || cobblestone.count < 8) {
        return { success: false, error: 'かまど作成には8個の石が必要です' };
      }

      // Find crafting table
      const craftingTable = bot.findBlock({
        matching: (block) => block.name === 'crafting_table',
        maxDistance: 32
      });

      if (!craftingTable) {
        return { success: false, error: 'かまど作成には作業台が必要です' };
      }

      // Move to crafting table
      const distance = bot.entity.position.distanceTo(craftingTable.position);
      if (distance > 4 && bot.pathfinder) {
        const { goals } = require('mineflayer-pathfinder');
        await bot.pathfinder.setGoal(new goals.GoalBlock(
          craftingTable.position.x, 
          craftingTable.position.y, 
          craftingTable.position.z
        ));
      }

      // Craft the furnace
      const mcData = require('minecraft-data')(bot.version);
      const furnaceItem = mcData.itemsByName.furnace;
      const recipe = bot.recipesFor(furnaceItem.id, null, 1, craftingTable)[0];

      if (!recipe) {
        return { success: false, error: 'かまどのレシピが見つかりません' };
      }

      await bot.craft(recipe, 1, craftingTable);
      bot.chat('かまどを作成しました！ 🔥');
      return { success: true, crafted: 'furnace' };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Building Skills
class BuildShelterSkill extends Skill {
  constructor() {
    super('build_shelter', 'Build a simple shelter');
  }

  async execute(bot, params) {
    const { size = 'small', materials = ['wood'] } = params;
    console.log(`[建築スキル] ${size}サイズの避難所を建設します`);

    try {
      // Check materials
      const planks = bot.inventory.items().find(item => item && item.name === 'oak_planks') || 
                    bot.inventory.items().find(item => item && item.name === 'planks');
      
      if (!planks || planks.count < 20) {
        return { success: false, error: '建築材料が不足しています（20個の板が必要）' };
      }

      const pos = bot.entity.position;
      const shelterPos = {
        x: Math.floor(pos.x) + 3,
        y: Math.floor(pos.y),
        z: Math.floor(pos.z) + 3
      };

      // Build simple 3x3 shelter
      const success = await this.buildSimpleShelter(bot, shelterPos, planks);
      
      if (success) {
        bot.chat('避難所を建設しました！ 🏠');
        return { success: true, built: 'shelter', location: shelterPos };
      } else {
        return { success: false, error: '建設に失敗しました' };
      }

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async buildSimpleShelter(bot, pos, planks) {
    try {
      await bot.equip(planks, 'hand');
      
      // Build walls (simple 3x3x3 structure)
      const wallPositions = [
        // Front wall
        { x: pos.x, y: pos.y + 1, z: pos.z },
        { x: pos.x + 1, y: pos.y + 1, z: pos.z },
        { x: pos.x + 2, y: pos.y + 1, z: pos.z },
        // Back wall
        { x: pos.x, y: pos.y + 1, z: pos.z + 2 },
        { x: pos.x + 1, y: pos.y + 1, z: pos.z + 2 },
        { x: pos.x + 2, y: pos.y + 1, z: pos.z + 2 },
        // Side walls
        { x: pos.x, y: pos.y + 1, z: pos.z + 1 },
        { x: pos.x + 2, y: pos.y + 1, z: pos.z + 1 },
        // Roof
        { x: pos.x, y: pos.y + 2, z: pos.z },
        { x: pos.x + 1, y: pos.y + 2, z: pos.z },
        { x: pos.x + 2, y: pos.y + 2, z: pos.z },
        { x: pos.x, y: pos.y + 2, z: pos.z + 1 },
        { x: pos.x + 1, y: pos.y + 2, z: pos.z + 1 },
        { x: pos.x + 2, y: pos.y + 2, z: pos.z + 1 },
        { x: pos.x, y: pos.y + 2, z: pos.z + 2 },
        { x: pos.x + 1, y: pos.y + 2, z: pos.z + 2 },
        { x: pos.x + 2, y: pos.y + 2, z: pos.z + 2 }
      ];

      let placed = 0;
      for (const wallPos of wallPositions) {
        try {
          const referenceBlock = bot.blockAt({ x: wallPos.x, y: wallPos.y - 1, z: wallPos.z });
          if (referenceBlock) {
            await bot.placeBlock(referenceBlock, new bot.Vec3(0, 1, 0));
            placed++;
            await new Promise(resolve => setTimeout(resolve, 50)); // Optimized delay - reduced from 100ms to 50ms
          }
        } catch (placeError) {
          // Continue placing other blocks even if one fails
          console.log(`[建築スキル] ブロック配置失敗: ${placeError.message}`);
        }
      }

      return placed > 5; // Consider success if at least some blocks were placed

    } catch (error) {
      console.log(`[建築スキル] 建設エラー: ${error.message}`);
      return false;
    }
  }
}

class PlaceBlocksSkill extends Skill {
  constructor() {
    super('place_blocks', 'Place blocks in specified pattern');
  }

  async execute(bot, params) {
    const { blockType, positions, pattern = 'line' } = params;
    console.log(`[配置スキル] ${blockType}を${pattern}パターンで配置します`);

    try {
      const item = bot.inventory.items().find(itemObj => itemObj && itemObj.name === blockType);
      if (!item) {
        return { success: false, error: `${blockType}がインベントリにありません` };
      }

      await bot.equip(item, 'hand');
      
      let placed = 0;
      const targetPositions = positions || this.generatePattern(bot.entity.position, pattern);

      for (const pos of targetPositions) {
        try {
          const referenceBlock = bot.blockAt({ x: pos.x, y: pos.y - 1, z: pos.z });
          if (referenceBlock && referenceBlock.name !== 'air') {
            await bot.placeBlock(referenceBlock, new bot.Vec3(0, 1, 0));
            placed++;
            await new Promise(resolve => setTimeout(resolve, 100)); // Optimized delay - reduced from 200ms to 100ms
          }
        } catch (placeError) {
          console.log(`[配置スキル] 配置失敗: ${placeError.message}`);
        }
      }

      if (placed > 0) {
        bot.chat(`${placed}個のブロックを配置しました！ 🧱`);
        return { success: true, placed: placed };
      } else {
        return { success: false, error: 'ブロックを配置できませんでした' };
      }

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  generatePattern(centerPos, pattern) {
    const positions = [];
    const baseX = Math.floor(centerPos.x);
    const baseY = Math.floor(centerPos.y);
    const baseZ = Math.floor(centerPos.z);

    switch (pattern) {
      case 'line':
        for (let i = 1; i <= 5; i++) {
          positions.push({ x: baseX + i, y: baseY, z: baseZ });
        }
        break;
      case 'square':
        for (let x = 0; x < 3; x++) {
          for (let z = 0; z < 3; z++) {
            positions.push({ x: baseX + x, y: baseY, z: baseZ + z });
          }
        }
        break;
      case 'wall':
        for (let i = 0; i < 5; i++) {
          positions.push({ x: baseX + i, y: baseY + 1, z: baseZ + 1 });
          positions.push({ x: baseX + i, y: baseY + 2, z: baseZ + 1 });
        }
        break;
      default:
        positions.push({ x: baseX + 1, y: baseY, z: baseZ + 1 });
    }

    return positions;
  }
}

// Advanced Movement Skills
class SmartJumpSkill extends Skill {
  constructor() {
    super('smart_jump', 'Intelligent jumping over obstacles and gaps');
  }

  async execute(bot, params) {
    try {
      const { direction = 'forward', distance = 1, height = 1 } = params;
      
      console.log(`[スマートジャンプ] ${direction}方向に${distance}ブロック、高さ${height}ブロックのジャンプ`);
      
      // Pre-jump analysis
      const pos = bot.entity.position;
      const canJump = await this.analyzeJumpPath(bot, direction, distance, height);
      
      if (!canJump.possible) {
        return { success: false, error: `ジャンプ不可: ${canJump.reason}` };
      }
      
      // Execute jump sequence
      if (direction === 'forward') {
        bot.setControlState('forward', true);
      } else if (direction === 'back') {
        bot.setControlState('back', true);
      }
      
      // Timing-based jump
      await new Promise(resolve => setTimeout(resolve, 200)); // Short run-up
      
      bot.setControlState('jump', true);
      await new Promise(resolve => setTimeout(resolve, 300)); // Jump duration
      
      // Continue forward motion during jump
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Release controls
      bot.setControlState('jump', false);
      bot.setControlState('forward', false);
      bot.setControlState('back', false);
      
      // Verify landing
      await new Promise(resolve => setTimeout(resolve, 500));
      const newPos = bot.entity.position;
      const moved = Math.sqrt(
        Math.pow(newPos.x - pos.x, 2) + Math.pow(newPos.z - pos.z, 2)
      );
      
      if (moved > 0.5) {
        return { success: true, message: `ジャンプ成功: ${moved.toFixed(1)}ブロック移動` };
      } else {
        return { success: false, error: 'ジャンプしたが移動できませんでした' };
      }
      
    } catch (error) {
      return { success: false, error: `ジャンプエラー: ${error.message}` };
    }
  }
  
  async analyzeJumpPath(bot, direction, distance, height) {
    try {
      const pos = bot.entity.position;
      
      // Calculate target position based on direction
      let targetX = pos.x;
      let targetZ = pos.z;
      
      if (direction === 'forward') {
        // Use bot's current facing direction
        const yaw = bot.entity.yaw;
        targetX += Math.cos(yaw + Math.PI) * distance;
        targetZ += Math.sin(yaw + Math.PI) * distance;
      }
      
      // Check landing area
      const landingBlock = bot.blockAt(new Vec3(Math.floor(targetX), Math.floor(pos.y), Math.floor(targetZ)));
      
      if (!landingBlock || landingBlock.name === 'air') {
        return { possible: false, reason: '着地地点が空気ブロック' };
      }
      
      // Check for obstacles in path
      for (let i = 1; i <= distance; i++) {
        const checkX = pos.x + (targetX - pos.x) * (i / distance);
        const checkZ = pos.z + (targetZ - pos.z) * (i / distance);
        
        const blockInPath = bot.blockAt(new Vec3(Math.floor(checkX), Math.floor(pos.y + 1), Math.floor(checkZ)));
        
        if (blockInPath && blockInPath.name !== 'air') {
          return { possible: false, reason: `パスに障害物: ${blockInPath.name}` };
        }
      }
      
      return { possible: true, reason: 'ジャンプパスクリア' };
      
    } catch (error) {
      return { possible: false, reason: `分析エラー: ${error.message}` };
    }
  }
}

class EscapeWaterSkill extends Skill {
  constructor() {
    super('escape_water', 'Escape from water or lava');
  }

  async execute(bot, params) {
    try {
      const { maxAttempts = 15, emergencyMode = false } = params;
      
      console.log(`[水中脱出] 水中脱出を開始、最大${maxAttempts}回試行`);
      
      const startPos = bot.entity.position;
      const startTime = Date.now();
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const pos = bot.entity.position;
        const currentBlock = bot.blockAt(pos);
        const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
        
        // Check if we're still in water/lava
        const inLiquid = currentBlock && (
          currentBlock.name === 'water' || currentBlock.name === 'flowing_water' ||
          currentBlock.name === 'lava' || currentBlock.name === 'flowing_lava'
        );
        
        const headInLiquid = blockAbove && (
          blockAbove.name === 'water' || blockAbove.name === 'flowing_water' ||
          blockAbove.name === 'lava' || blockAbove.name === 'flowing_lava'
        );
        
        if (!inLiquid && !headInLiquid) {
          const escapeTime = ((Date.now() - startTime) / 1000).toFixed(1);
          return { success: true, message: `水中脱出成功 (${escapeTime}秒, ${attempt + 1}回目)` };
        }
        
        // Emergency swim-up and movement
        bot.setControlState('jump', true); // Swim up
        
        // Try different escape directions
        const escapeAngle = (attempt * Math.PI * 2) / 8;
        const escapeX = Math.cos(escapeAngle) * 2;
        const escapeZ = Math.sin(escapeAngle) * 2;
        
        await bot.lookAt(new Vec3(pos.x + escapeX, pos.y + 2, pos.z + escapeZ));
        bot.setControlState('forward', true);
        
        // Quick escape burst
        await new Promise(resolve => setTimeout(resolve, emergencyMode ? 300 : 600));
        
        bot.setControlState('forward', false);
        
        // Check progress
        const newPos = bot.entity.position;
        const progress = Math.sqrt(
          Math.pow(newPos.x - startPos.x, 2) + 
          Math.pow(newPos.z - startPos.z, 2) + 
          Math.pow(newPos.y - startPos.y, 2)
        );
        
        if (attempt % 5 === 0) {
          console.log(`[水中脱出] 進行状況: ${attempt + 1}/${maxAttempts}, 距離: ${progress.toFixed(1)}`);
        }
      }
      
      bot.setControlState('jump', false);
      bot.setControlState('forward', false);
      
      return { success: false, error: `水中脱出失敗: ${maxAttempts}回試行後も水中` };
      
    } catch (error) {
      // Clean up controls
      bot.setControlState('jump', false);
      bot.setControlState('forward', false);
      return { success: false, error: `水中脱出エラー: ${error.message}` };
    }
  }
}

class NavigateTerrainSkill extends Skill {
  constructor() {
    super('navigate_terrain', 'Navigate complex terrain with obstacles');
  }

  async execute(bot, params) {
    try {
      const { target, maxTime = 30000, adaptive = true } = params;
      const { x, y, z } = target;
      
      console.log(`[地形ナビ] 複雑地形をナビゲート: (${x}, ${y}, ${z})`);
      
      const startTime = Date.now();
      const smartJump = new SmartJumpSkill();
      const escapeWater = new EscapeWaterSkill();
      
      while (Date.now() - startTime < maxTime) {
        const currentPos = bot.entity.position;
        const distance = Math.sqrt(
          Math.pow(x - currentPos.x, 2) + 
          Math.pow(z - currentPos.z, 2)
        );
        
        // Success if close enough
        if (distance < 2) {
          return { success: true, message: `地形ナビゲーション成功` };
        }
        
        // Check for water
        const currentBlock = bot.blockAt(currentPos);
        if (currentBlock && (currentBlock.name === 'water' || currentBlock.name === 'flowing_water')) {
          console.log('[地形ナビ] 水を検出、脱出を試行');
          const waterResult = await escapeWater.execute(bot, { maxAttempts: 8, emergencyMode: true });
          if (!waterResult.success) {
            return { success: false, error: '水中脱出に失敗' };
          }
          continue;
        }
        
        // Calculate direction to target
        const dirX = x - currentPos.x;
        const dirZ = z - currentPos.z;
        const dirDistance = Math.sqrt(dirX * dirX + dirZ * dirZ);
        
        if (dirDistance === 0) break;
        
        const normalX = dirX / dirDistance;
        const normalZ = dirZ / dirDistance;
        
        // Look towards target
        await bot.lookAt(new Vec3(x, currentPos.y, z));
        
        // Check for obstacles ahead
        const obstacleAhead = await this.checkTerrainAhead(bot, normalX, normalZ);
        
        if (obstacleAhead.hasObstacle) {
          console.log(`[地形ナビ] 障害物検出: ${obstacleAhead.type}`);
          
          if (obstacleAhead.canJump) {
            const jumpResult = await smartJump.execute(bot, { direction: 'forward', distance: 1, height: 1 });
            if (jumpResult.success) {
              console.log('[地形ナビ] ジャンプで障害物を回避');
              continue;
            }
          }
          
          // Try alternative path
          console.log('[地形ナビ] 代替ルートを探索');
          const altResult = await this.findAlternativePath(bot, x, z);
          if (altResult.found) {
            await bot.lookAt(new Vec3(altResult.x, currentPos.y, altResult.z));
          }
        }
        
        // Move forward
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 800));
        bot.setControlState('forward', false);
        
        // Small pause to reassess
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      return { success: false, error: '地形ナビゲーションタイムアウト' };
      
    } catch (error) {
      // Clean up controls
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      return { success: false, error: `地形ナビエラー: ${error.message}` };
    }
  }
  
  async checkTerrainAhead(bot, dirX, dirZ) {
    try {
      const pos = bot.entity.position;
      
      // Check 1-2 blocks ahead
      for (let distance = 1; distance <= 2; distance++) {
        const checkX = Math.floor(pos.x + dirX * distance);
        const checkY = Math.floor(pos.y);
        const checkZ = Math.floor(pos.z + dirZ * distance);
        
        const blockAhead = bot.blockAt(new Vec3(checkX, checkY, checkZ));
        const blockAbove = bot.blockAt(new Vec3(checkX, checkY + 1, checkZ));
        const blockAbove2 = bot.blockAt(new Vec3(checkX, checkY + 2, checkZ));
        
        if (blockAhead && blockAhead.name !== 'air' && 
            !['water', 'flowing_water', 'lava', 'flowing_lava'].includes(blockAhead.name)) {
          
          // Check if we can jump over (1 block obstacle)
          if (blockAbove && blockAbove.name === 'air' && 
              blockAbove2 && blockAbove2.name === 'air') {
            return { hasObstacle: true, canJump: true, type: `${blockAhead.name}(ジャンプ可能)` };
          } else {
            return { hasObstacle: true, canJump: false, type: `${blockAhead.name}(ジャンプ不可)` };
          }
        }
      }
      
      return { hasObstacle: false };
      
    } catch (error) {
      return { hasObstacle: false };
    }
  }
  
  async findAlternativePath(bot, targetX, targetZ) {
    try {
      const pos = bot.entity.position;
      const directions = [
        { x: 1, z: 0 },   // East
        { x: -1, z: 0 },  // West
        { x: 0, z: 1 },   // South
        { x: 0, z: -1 },  // North
        { x: 1, z: 1 },   // Southeast
        { x: -1, z: 1 },  // Southwest
        { x: 1, z: -1 },  // Northeast
        { x: -1, z: -1 }  // Northwest
      ];
      
      for (const dir of directions) {
        const altX = pos.x + dir.x * 3;
        const altZ = pos.z + dir.z * 3;
        
        // Check if this direction is closer to target
        const altDistance = Math.sqrt(Math.pow(targetX - altX, 2) + Math.pow(targetZ - altZ, 2));
        const currentDistance = Math.sqrt(Math.pow(targetX - pos.x, 2) + Math.pow(targetZ - pos.z, 2));
        
        if (altDistance < currentDistance) {
          // Check if path is clear
          const checkBlock = bot.blockAt(new Vec3(Math.floor(altX), Math.floor(pos.y), Math.floor(altZ)));
          if (!checkBlock || checkBlock.name === 'air' || 
              ['water', 'flowing_water'].includes(checkBlock.name)) {
            return { found: true, x: altX, z: altZ };
          }
        }
      }
      
      return { found: false };
      
    } catch (error) {
      return { found: false };
    }
  }
}

module.exports = { SkillLibrary };
