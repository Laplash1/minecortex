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
          if (bot.pathfinder && typeof bot.pathfinder.on === 'function' && typeof bot.pathfinder.setGoal === 'function') {
            bot.pathfinder.on('goal_reached', onGoalReached);
            bot.pathfinder.on('path_update', onPathUpdate);
            
            // Actually set the goal to start pathfinding
            console.log(`[移動スキル] パスファインディング目標設定: (${x}, ${y}, ${z})`);
            bot.pathfinder.setGoal(goal);
          } else {
            resolved = true;
            cleanup();
            resolve({ success: false, error: 'PathfinderイベントハンドラーまたはsetGoalが利用できません' });
          }
        } catch (eventError) {
          console.log(`[移動スキル] パスファインディング設定エラー: ${eventError.message}`);
          resolved = true;
          cleanup();
          resolve({ success: false, error: `パスファインディング設定エラー: ${eventError.message}` });
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
      
      if (distance > 100) {
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
  
  // Enhanced water detection and escape system
  async checkAndEscapeWater(bot) {
    try {
      const pos = bot.entity.position;
      const currentBlock = bot.blockAt(pos);
      const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
      
      // Enhanced liquid detection
      const waterBlocks = ['water', 'flowing_water'];
      const lavaBlocks = ['lava', 'flowing_lava'];
      
      const inWater = currentBlock && waterBlocks.includes(currentBlock.name);
      const inLava = currentBlock && lavaBlocks.includes(currentBlock.name);
      const headInWater = blockAbove && waterBlocks.includes(blockAbove.name);
      const headInLava = blockAbove && lavaBlocks.includes(blockAbove.name);
      
      if (!inWater && !inLava && !headInWater && !headInLava) {
        return { success: true, inWater: false };
      }
      
      const fluidType = inLava || headInLava ? 'マグマ' : '水';
      console.log(`[移動スキル] ${fluidType}中検出、強化脱出システム開始`);
      
      // Priority 1: Find nearby land blocks
      const landResult = await this.findNearestLand(bot, pos);
      if (landResult.found) {
        console.log(`[移動スキル] 陸地を発見: ${landResult.direction}方向`);
        const escapeResult = await this.escapeToLand(bot, landResult);
        if (escapeResult.success) {
          return { success: true, inWater: false };
        }
      }
      
      // Priority 2: Enhanced directional escape
      const escapeResult = await this.performEnhancedEscape(bot, pos, fluidType);
      if (escapeResult.success) {
        return { success: true, inWater: false };
      }
      
      // Priority 3: Vertical escape (swim up)
      const verticalResult = await this.performVerticalEscape(bot, pos, fluidType);
      if (verticalResult.success) {
        return { success: true, inWater: false };
      }
      
      console.log(`[移動スキル] 全ての脱出方法が失敗`);
      return { success: false, inWater: true, error: `${fluidType}中脱出に失敗` };
      
    } catch (error) {
      console.log(`[移動スキル] 水中脱出エラー: ${error.message}`);
      return { success: false, inWater: true, error: error.message };
    }
  }
  
  async findNearestLand(bot, currentPos) {
    try {
      console.log(`[移動スキル] 周辺の陸地検索中...`);
      
      // Check 8 directions for land within 16 blocks
      const directions = [
        { x: 1, z: 0, name: '東' },
        { x: -1, z: 0, name: '西' },
        { x: 0, z: 1, name: '南' },
        { x: 0, z: -1, name: '北' },
        { x: 1, z: 1, name: '南東' },
        { x: 1, z: -1, name: '北東' },
        { x: -1, z: 1, name: '南西' },
        { x: -1, z: -1, name: '北西' }
      ];
      
      for (const dir of directions) {
        for (let distance = 2; distance <= 16; distance += 2) {
          const checkX = currentPos.x + (dir.x * distance);
          const checkZ = currentPos.z + (dir.z * distance);
          const checkY = currentPos.y;
          
          const landBlock = bot.blockAt({ x: checkX, y: checkY, z: checkZ });
          const blockAbove = bot.blockAt({ x: checkX, y: checkY + 1, z: checkZ });
          
          // Check if this is solid land with air above
          if (landBlock && landBlock.name !== 'air' && 
              !['water', 'flowing_water', 'lava', 'flowing_lava'].includes(landBlock.name) &&
              blockAbove && blockAbove.name === 'air') {
            
            console.log(`[移動スキル] 陸地発見: ${dir.name}方向 ${distance}ブロック先`);
            return {
              found: true,
              direction: dir.name,
              position: { x: checkX, y: checkY + 1, z: checkZ },
              distance: distance
            };
          }
        }
      }
      
      return { found: false };
      
    } catch (error) {
      console.log(`[移動スキル] 陸地検索エラー: ${error.message}`);
      return { found: false };
    }
  }
  
  async escapeToLand(bot, landInfo) {
    try {
      console.log(`[移動スキル] ${landInfo.direction}の陸地へ脱出中...`);
      
      const currentPos = bot.entity.position;
      const targetPos = landInfo.position;
      
      // Calculate direction to land
      const dirX = targetPos.x - currentPos.x;
      const dirZ = targetPos.z - currentPos.z;
      const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
      
      if (distance === 0) return { success: false };
      
      const normalX = dirX / distance;
      const normalZ = dirZ / distance;
      
      // Escape toward land
      for (let i = 0; i < 10; i++) {
        // Swim up and toward land
        bot.setControlState('jump', true);
        
        try {
          const lookX = currentPos.x + normalX * 5;
          const lookZ = currentPos.z + normalZ * 5;
          await bot.lookAt({ x: lookX, y: currentPos.y + 1, z: lookZ });
        } catch (lookError) {
          // Continue without lookAt if it fails
        }
        
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 800)); // Longer movement time
        bot.setControlState('forward', false);
        
        // Check escape success
        const newPos = bot.entity.position;
        const newBlock = bot.blockAt(newPos);
        
        if (newBlock && newBlock.name !== 'water' && newBlock.name !== 'flowing_water' && 
            newBlock.name !== 'lava' && newBlock.name !== 'flowing_lava') {
          bot.setControlState('jump', false);
          console.log(`[移動スキル] ${landInfo.direction}陸地への脱出成功`);
          return { success: true };
        }
        
        // Adjust direction slightly if stuck
        if (i % 3 === 2) {
          const adjustAngle = (Math.random() - 0.5) * 0.5; // Small random adjustment
          const adjustedX = normalX * Math.cos(adjustAngle) - normalZ * Math.sin(adjustAngle);
          const adjustedZ = normalX * Math.sin(adjustAngle) + normalZ * Math.cos(adjustAngle);
          try {
            await bot.lookAt({ 
              x: currentPos.x + adjustedX * 5, 
              y: currentPos.y + 1, 
              z: currentPos.z + adjustedZ * 5 
            });
          } catch (lookError) {
            // Continue without lookAt
          }
        }
      }
      
      bot.setControlState('jump', false);
      return { success: false };
      
    } catch (error) {
      bot.setControlState('jump', false);
      console.log(`[移動スキル] 陸地脱出エラー: ${error.message}`);
      return { success: false };
    }
  }
  
  async performEnhancedEscape(bot, pos, fluidType) {
    try {
      console.log(`[移動スキル] 強化方向脱出を実行中...`);
      
      // Try 12 directions (more granular than before)
      for (let i = 0; i < 12; i++) {
        const escapeAngle = (i * Math.PI * 2) / 12;
        const escapeX = Math.cos(escapeAngle);
        const escapeZ = Math.sin(escapeAngle);
        
        console.log(`[移動スキル] 方向 ${i + 1}/12 での脱出試行`);
        
        bot.setControlState('jump', true);
        
        try {
          await bot.lookAt({ 
            x: pos.x + escapeX * 3, 
            y: pos.y + 1, 
            z: pos.z + escapeZ * 3 
          });
        } catch (lookError) {
          // Continue without lookAt
        }
        
        // More aggressive movement
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await new Promise(resolve => setTimeout(resolve, 700));
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        
        // Check escape
        const newPos = bot.entity.position;
        const newBlock = bot.blockAt(newPos);
        
        if (newBlock && !['water', 'flowing_water', 'lava', 'flowing_lava'].includes(newBlock.name)) {
          bot.setControlState('jump', false);
          console.log(`[移動スキル] 方向脱出成功 (方向 ${i + 1})`);
          return { success: true };
        }
        
        // Brief pause between attempts
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      bot.setControlState('jump', false);
      return { success: false };
      
    } catch (error) {
      bot.setControlState('jump', false);
      console.log(`[移動スキル] 強化脱出エラー: ${error.message}`);
      return { success: false };
    }
  }
  
  async performVerticalEscape(bot, pos, fluidType) {
    try {
      console.log(`[移動スキル] 垂直脱出を実行中...`);
      
      // Pure vertical escape - swim straight up
      for (let i = 0; i < 15; i++) {
        bot.setControlState('jump', true);
        
        // Look straight up
        try {
          await bot.lookAt({ x: pos.x, y: pos.y + 10, z: pos.z });
        } catch (lookError) {
          // Continue without lookAt
        }
        
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Check if we've reached surface
        const newPos = bot.entity.position;
        const blockAtPos = bot.blockAt(newPos);
        const blockAbove = bot.blockAt(newPos.offset(0, 1, 0));
        
        if (blockAtPos && blockAtPos.name === 'air' &&
            blockAbove && blockAbove.name === 'air') {
          bot.setControlState('jump', false);
          console.log(`[移動スキル] 垂直脱出成功 (${i + 1}回試行)`);
          return { success: true };
        }
        
        // Check if we're making progress upward
        if (newPos.y > pos.y + 2) {
          console.log(`[移動スキル] 上昇中... Y: ${pos.y.toFixed(1)} → ${newPos.y.toFixed(1)}`);
          pos = newPos; // Update position reference
        }
      }
      
      bot.setControlState('jump', false);
      return { success: false };
      
    } catch (error) {
      bot.setControlState('jump', false);
      console.log(`[移動スキル] 垂直脱出エラー: ${error.message}`);
      return { success: false };
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
        
        const blockAhead = bot.blockAt(bot.entity.position.offset(checkX - Math.floor(pos.x), checkY - Math.floor(pos.y), checkZ - Math.floor(pos.z)));
        const blockAbove = bot.blockAt(bot.entity.position.offset(checkX - Math.floor(pos.x), checkY + 1 - Math.floor(pos.y), checkZ - Math.floor(pos.z)));
        
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
      if (!block || block.name !== blockType) {
        console.log(`[マイニング] 指定位置に${blockType}がありません: ${block ? block.name : 'null'}`);
        return { success: false, error: `指定位置に${blockType}がありません` };
      }
    } else {
      // Stage 1: Find block nearby with progressive search
      block = this.findBlockWithProgressiveSearch(bot, blockType);
    }
    
    if (!block) {
      console.log(`[マイニング] ${blockType}が見つかりません。地下探索を試みます...`);
      
      // Stage 2: Try mining downward to find stone/ore
      if (blockType === 'stone' || blockType === 'cobblestone' || blockType.includes('ore')) {
        const result = await this.digDownForStone(bot, blockType);
        if (result.success) {
          return result;
        }
      }
      
      return { success: false, error: `ブロック ${blockType} が見つかりません` };
    }
    
    try {
      console.log(`[マイニング] ${block.position}で${block.name}を採掘中...`);
      await bot.dig(block);
      bot.chat(`${block.name}を採掘しました！ ⛏️`);
      return { success: true, message: `${block.name}を採掘しました` };
    } catch (error) {
      console.log(`[マイニング] 採掘に失敗: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async digDownForStone(bot, blockType) {
    console.log(`[マイニング] ${blockType}を求めて地下探索開始...`);
    
    const startY = bot.entity.position.y;
    const maxDepth = 10; // Maximum blocks to dig down
    
    for (let i = 0; i < maxDepth; i++) {
      const currentPos = bot.entity.position;
      const blockBelow = bot.blockAt(currentPos.offset(0, -1, 0));
      
      if (blockBelow && blockBelow.name !== 'air' && blockBelow.name !== 'water') {
        // Check if this is the block we want
        if (blockBelow.name === blockType || 
            blockBelow.name.includes(blockType) ||
            (blockType === 'stone' && blockBelow.name === 'cobblestone')) {
          
          try {
            console.log(`[マイニング] 地下で${blockBelow.name}を発見！`);
            await bot.dig(blockBelow);
            bot.chat(`地下で${blockBelow.name}を採掘しました！ ⛏️`);
            return { success: true, message: `地下で${blockBelow.name}を採掘しました` };
          } catch (error) {
            console.log(`[マイニング] 地下採掘失敗: ${error.message}`);
            continue;
          }
        }
        
        // Dig the block to go deeper
        try {
          await bot.dig(blockBelow);
        } catch (error) {
          console.log(`[マイニング] 掘削失敗: ${error.message}`);
          break;
        }
        
        // Move down if possible
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for movement
      } else {
        // Hit air or water, stop digging
        break;
      }
    }
    
    console.log(`[マイニング] 地下探索でも${blockType}が見つかりませんでした`);
    return { success: false, error: `地下探索でも${blockType}が見つかりません` };
  }

  findBlockWithProgressiveSearch(bot, blockType) {
    console.log(`[マイニング] ${blockType}の段階的探索を開始...`);
    
    const searchRadii = [16, 32, 64, 96]; // High-performance progressive search distances
    
    for (const radius of searchRadii) {
      console.log(`[マイニング] ${radius}ブロック範囲で${blockType}を探索中...`);
      
      const block = bot.findBlock({
        matching: (candidate) => {
          if (!candidate || !candidate.name) return false;
          
          if (typeof blockType === 'string') {
            // Enhanced string matching for better block detection
            const candidateName = candidate.name.toLowerCase();
            const targetName = blockType.toLowerCase();
            
            // Direct match
            if (candidateName === targetName) return true;
            
            // Contains match
            if (candidateName.includes(targetName)) return true;
            
            // Special cases for common blocks
            if (targetName === 'stone' && 
                (candidateName.includes('stone') || candidateName === 'cobblestone')) {
              return true;
            }
            
            if (targetName === 'wood' && 
                (candidateName.includes('log') || candidateName.includes('wood'))) {
              return true;
            }
            
            if (targetName === 'ore' && candidateName.includes('ore')) {
              return true;
            }
            
            return false;
          } else if (typeof blockType === 'number') {
            return candidate.type === blockType;
          } else if (typeof blockType === 'function') {
            return blockType(candidate);
          }
          return false;
        },
        maxDistance: radius
      });
      
      if (block) {
        console.log(`[マイニング] ${radius}ブロック範囲で発見: ${block.name} at ${block.position}`);
        return block;
      }
    }
    
    // Enhanced fallback search for specific block types
    console.log(`[マイニング] 標準探索失敗、特殊検索開始...`);
    
    if (typeof blockType === 'string') {
      const fallbackBlock = this.findSimilarBlocks(bot, blockType);
      if (fallbackBlock) {
        console.log(`[マイニング] 代替ブロック発見: ${fallbackBlock.name}`);
        return fallbackBlock;
      }
    }
    
    console.log(`[マイニング] 全ての探索方法で${blockType}が見つかりませんでした`);
    return null;
  }
  
  findSimilarBlocks(bot, blockType) {
    const blockTypeLower = blockType.toLowerCase();
    
    // Define similar block groups
    const blockGroups = {
      stone: ['stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate'],
      wood: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 
             'oak_wood', 'birch_wood', 'spruce_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood'],
      ore: ['iron_ore', 'coal_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore'],
      dirt: ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt'],
      sand: ['sand', 'red_sand', 'gravel']
    };
    
    // Find which group the target belongs to
    let targetGroup = null;
    for (const [groupName, blocks] of Object.entries(blockGroups)) {
      if (blocks.some(block => block.includes(blockTypeLower) || blockTypeLower.includes(block))) {
        targetGroup = blocks;
        break;
      }
    }
    
    if (!targetGroup) {
      return null;
    }
    
    console.log(`[マイニング] ${blockType}の代替ブロックを検索中: ${targetGroup.join(', ')}`);
    
    // Search for any block in the same group
    for (const radius of [32, 64, 96]) {
      const block = bot.findBlock({
        matching: (candidate) => {
          if (!candidate || !candidate.name) return false;
          const candidateName = candidate.name.toLowerCase();
          return targetGroup.some(groupBlock => 
            candidateName === groupBlock || candidateName.includes(groupBlock)
          );
        },
        maxDistance: radius
      });
      
      if (block) {
        console.log(`[マイニング] ${radius}ブロック範囲で代替発見: ${block.name}`);
        return block;
      }
    }
    
    return null;
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
    
    // Stage 1: Find wood blocks nearby (optimized progressive search)
    let woodBlock = this.findWoodWithProgressiveSearch(bot);

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
    }

    // Stage 2: If no wood found, try to explore and search again
    console.log(`[木材収集] 近くに木が見つかりません。ワールド生成木を探します...`);
    
    // Check if this is a generated world without trees - try placing wood blocks as emergency fallback
    const hasAnyBlocks = bot.findBlocks({
      matching: (block) => {
        if (!block || !block.name) return false;
        return block.name !== 'air' && block.name !== 'water' && block.name !== 'lava';
      },
      maxDistance: 16,
      count: 10
    });
    
    if (hasAnyBlocks.length === 0) {
      console.log(`[木材収集] 空のワールドを検出、基本リソース確保を試みます`);
      // Try to get starter items from server or other means
      try {
        bot.chat('/give @p oak_log 10');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const woodAfterGive = bot.inventory.items().find(item => 
          item && item.name && (item.name.includes('log') || item.name.includes('wood'))
        );
        
        if (woodAfterGive) {
          console.log(`[木材収集] サーバーコマンドで木材を取得しました: ${woodAfterGive.name}`);
          bot.chat('サーバーから木材を取得しました！ 🌳');
          return { success: true, gathered: woodAfterGive.count };
        }
      } catch (giveError) {
        console.log(`[木材収集] サーバーコマンド失敗: ${giveError.message}`);
      }
    }
    
    // Generate random exploration target with expanded range
    const currentPos = bot.entity.position;
    const searchDirections = [
      { x: currentPos.x + 120, y: currentPos.y, z: currentPos.z },
      { x: currentPos.x - 120, y: currentPos.y, z: currentPos.z },
      { x: currentPos.x, y: currentPos.y, z: currentPos.z + 120 },
      { x: currentPos.x, y: currentPos.y, z: currentPos.z - 120 },
      // Add diagonal directions for better coverage
      { x: currentPos.x + 100, y: currentPos.y, z: currentPos.z + 100 },
      { x: currentPos.x - 100, y: currentPos.y, z: currentPos.z - 100 },
      { x: currentPos.x + 100, y: currentPos.y, z: currentPos.z - 100 },
      { x: currentPos.x - 100, y: currentPos.y, z: currentPos.z + 100 }
    ];
    
    for (const target of searchDirections) {
      console.log(`[木材収集] ${target.x}, ${target.z}方向を探索中...`);
      
      // Move towards target
      try {
        const moveResult = await this.moveToPosition(bot, target, 15000); // 15 second timeout
        if (moveResult.success) {
          // Search for wood at new position with expanded range
          woodBlock = bot.findBlock({
            matching: (block) => {
              return block.name && (
                block.name.includes('_log') ||
                block.name === 'log'
              );
            },
            maxDistance: 64  // Expanded range for movement search
          });
          
          if (woodBlock) {
            console.log(`[木材収集] 探索後に${woodBlock.position}で${woodBlock.name}を発見しました`);
            try {
              await bot.dig(woodBlock);
              bot.chat(`探索して${woodBlock.name}を採取しました！ 🌳`);
              return { success: true, gathered: 1 };
            } catch (error) {
              console.log(`[木材収集] 採掘に失敗: ${error.message}`);
              continue; // Try next direction
            }
          }
        }
      } catch (moveError) {
        console.log(`[木材収集] 探索移動に失敗: ${moveError.message}`);
        continue; // Try next direction
      }
    }
    
    console.log(`[木材収集] 全方向探索後も木が見つかりません`);
    return { success: false, error: '探索後も木が見つかりません' };
  }

  async moveToPosition(bot, target, timeout = 10000) {
    const { pathfinder, Movements, goals: Goals } = require('mineflayer-pathfinder');
    
    if (!bot.pathfinder) {
      console.log('[木材収集] Pathfinder not initialized, using basic movement');
      return await this.basicMovement(bot, target);
    }

    return new Promise((resolve) => {
      const goal = new Goals.GoalNear(target.x, target.y, target.z, 3);
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (bot.pathfinder && bot.pathfinder.stop) {
            bot.pathfinder.stop();
          }
          resolve({ success: false, error: 'Movement timeout' });
        }
      }, timeout);

      const onGoalReached = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve({ success: true });
        }
      };

      const onPathUpdate = (r) => {
        if (!resolved && r.status === 'noPath') {
          resolved = true;
          clearTimeout(timer);
          if (bot.pathfinder && bot.pathfinder.stop) {
            bot.pathfinder.stop();
          }
          cleanup();
          resolve({ success: false, error: 'No path found' });
        }
      };

      const cleanup = () => {
        try {
          if (bot.pathfinder && typeof bot.pathfinder.removeListener === 'function') {
            bot.pathfinder.removeListener('goal_reached', onGoalReached);
            bot.pathfinder.removeListener('path_update', onPathUpdate);
          }
        } catch (cleanupError) {
          console.log(`[木材収集] Event cleanup error: ${cleanupError.message}`);
        }
      };

      try {
        if (bot.pathfinder && typeof bot.pathfinder.on === 'function') {
          if (typeof bot.pathfinder.on === 'function') {
            bot.pathfinder.on('goal_reached', onGoalReached);
            bot.pathfinder.on('path_update', onPathUpdate);
          }
          bot.pathfinder.setGoal(goal);
        } else {
          resolved = true;
          clearTimeout(timer);
          resolve({ success: false, error: 'Pathfinder events not supported' });
        }
      } catch (error) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve({ success: false, error: error.message });
        }
      }
    });
  }

  async basicMovement(bot, target) {
    console.log(`[木材収集] Basic movement to ${target.x}, ${target.z}`);
    const currentPos = bot.entity.position;
    const distance = Math.sqrt(
      Math.pow(target.x - currentPos.x, 2) + 
      Math.pow(target.z - currentPos.z, 2)
    );
    
    if (distance > 80) {
      return { success: false, error: 'Target too far for basic movement' };
    }

    // Simple movement towards target
    const maxSteps = Math.min(Math.ceil(distance / 3), 10);
    const stepX = (target.x - currentPos.x) / maxSteps;
    const stepZ = (target.z - currentPos.z) / maxSteps;

    for (let i = 0; i < maxSteps; i++) {
      const targetX = currentPos.x + stepX * (i + 1);
      const targetZ = currentPos.z + stepZ * (i + 1);
      
      // Look towards target direction
      try {
        const Vec3 = require('vec3');
        const lookDirection = new Vec3(targetX, currentPos.y, targetZ);
        bot.lookAt(lookDirection);
      } catch (lookError) {
        console.log(`[木材収集] Look direction error: ${lookError.message}`);
        // Continue without looking - just move
      }
      
      // Move forward
      bot.setControlState('forward', true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      bot.setControlState('forward', false);
      
      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return { success: true };
  }

  findWoodWithProgressiveSearch(bot) {
    console.log(`[木材収集] 段階的探索を開始...`);
    
    const searchRadii = [16, 32, 64, 96]; // High-performance progressive search distances
    
    for (const radius of searchRadii) {
      console.log(`[木材収集] ${radius}ブロック範囲で探索中...`);
      
      // Enhanced wood block matching with comprehensive patterns
      const woodBlock = bot.findBlock({
        matching: (block) => {
          if (!block || !block.name) return false;
          
          const blockName = block.name.toLowerCase();
          const woodPatterns = [
            'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
            'oak_wood', 'birch_wood', 'spruce_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood',
            'log', 'wood', 'stem'
          ];
          
          return woodPatterns.some(pattern => blockName.includes(pattern));
        },
        maxDistance: radius
      });
      
      if (woodBlock) {
        console.log(`[木材収集] ${radius}ブロック範囲で発見: ${woodBlock.name} at ${woodBlock.position}`);
        return woodBlock;
      }
    }
    
    // Emergency fallback: comprehensive block scan
    console.log(`[木材収集] 段階的探索失敗、緊急フォールバック開始...`);
    
    // Try to find any wooden structure or tree-like blocks
    const fallbackBlock = bot.findBlock({
      matching: (block) => {
        if (!block || !block.name) return false;
        const blockName = block.name.toLowerCase();
        return blockName.includes('leaves') || blockName.includes('sapling') || 
               blockName.includes('bark') || blockName.includes('planks') ||
               blockName.includes('fence') || blockName.includes('door');
      },
      maxDistance: 64
    });
    
    if (fallbackBlock) {
      console.log(`[木材収集] 木材関連ブロック発見: ${fallbackBlock.name}, 周辺を詳細検索...`);
      
      // Look for actual wood near tree-related blocks
      const nearbyWood = bot.findBlock({
        matching: (block) => {
          if (!block || !block.name) return false;
          const blockName = block.name.toLowerCase();
          return blockName.includes('log') || blockName.includes('wood') || blockName.includes('stem');
        },
        maxDistance: 32,
        point: fallbackBlock.position
      });
      
      if (nearbyWood) {
        console.log(`[木材収集] 関連ブロック周辺で木材発見: ${nearbyWood.name}`);
        return nearbyWood;
      }
    }
    
    console.log(`[木材収集] 全ての検索方法で木材が見つかりませんでした`);
    return null;
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
    try {
      console.log(`[クラフトスキル] ${toolName}の作成開始`);
      
      // Find the recipe first
      const mcData = require('minecraft-data')(bot.version);
      const itemByName = mcData.itemsByName[toolName];
      
      if (!itemByName) {
        console.log(`[クラフトスキル] 不明なアイテム: ${toolName}`);
        return { success: false, error: `不明なアイテム: ${toolName}` };
      }

      // Check if we have a crafting table
      const craftingTable = bot.findBlock({
        matching: (block) => block.name === 'crafting_table',
        maxDistance: 32
      });

      const recipes = bot.recipesFor(itemByName.id, null, 1, craftingTable);
      console.log(`[クラフトスキル] ${toolName}のレシピ検索: ${recipes.length}個発見`);
      
      if (recipes.length === 0) {
        // Try without crafting table requirement
        const recipesWithoutTable = bot.recipesFor(itemByName.id, null, 1, null);
        console.log(`[クラフトスキル] 作業台なしレシピ: ${recipesWithoutTable.length}個`);
        
        if (recipesWithoutTable.length === 0) {
          return { success: false, error: `${toolName}のレシピが見つかりません` };
        }
        
        // Use recipe without table if available
        const recipe = recipesWithoutTable[0];
        const materialCheck = await this.checkRecipeMaterials(bot, recipe, toolName);
        if (!materialCheck.canCraft) {
          return { success: false, error: materialCheck.missingItems };
        }
        
        console.log(`[クラフトスキル] 作業台なしで${toolName}をクラフト中...`);
        await bot.craft(recipe, 1, null);
        return { success: true };
      }
      
      const recipe = recipes[0];
      
      // Check if we have required materials
      const materialCheck = await this.checkRecipeMaterials(bot, recipe, toolName);
      if (!materialCheck.canCraft) {
        return { success: false, error: materialCheck.missingItems };
      }

      // Move to crafting table if needed and available
      if (craftingTable) {
        const distance = bot.entity.position.distanceTo(craftingTable.position);
        if (distance > 4) {
          console.log(`[クラフトスキル] 作業台に移動中... (距離: ${distance.toFixed(1)})`);
          try {
            if (bot.pathfinder && typeof bot.pathfinder.setGoal === 'function') {
              const { goals } = require('mineflayer-pathfinder');
              await bot.pathfinder.setGoal(new goals.GoalBlock(
                craftingTable.position.x, 
                craftingTable.position.y, 
                craftingTable.position.z
              ));
            } else {
              // Basic movement fallback
              await this.basicMoveToTable(bot, craftingTable);
            }
          } catch (moveError) {
            console.log(`[クラフトスキル] 作業台への移動に失敗: ${moveError.message}`);
            return { success: false, error: `作業台への移動失敗: ${moveError.message}` };
          }
        }
      } else if (recipe.requiresTable) {
        return { success: false, error: `${toolName}の作成には作業台が必要ですが見つかりません` };
      }

      // Craft the item
      console.log(`[クラフトスキル] ${toolName}をクラフト中...`);
      await bot.craft(recipe, 1, craftingTable);
      console.log(`[クラフトスキル] ${toolName}の作成完了`);
      return { success: true };

    } catch (error) {
      console.log(`[クラフトスキル] ${toolName}作成エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  async checkRecipeMaterials(bot, recipe, toolName) {
    try {
      const inventory = bot.inventory.items();
      const missingMaterials = [];
      const requiredMaterials = [];
      
      console.log(`[クラフトスキル] ${toolName}の材料チェック開始`);
      
      // Check each ingredient in the recipe
      if (recipe.ingredients) {
        for (let i = 0; i < recipe.ingredients.length; i++) {
          const ingredient = recipe.ingredients[i];
          if (!ingredient) continue;
          
          const itemName = this.getItemNameFromId(bot, ingredient.id);
          const requiredCount = ingredient.count || 1;
          
          requiredMaterials.push(`${itemName}×${requiredCount}`);
          
          const availableCount = inventory.reduce((total, item) => {
            if (item && item.type === ingredient.id) {
              return total + item.count;
            }
            return total;
          }, 0);
          
          console.log(`[クラフトスキル] ${itemName}: 必要${requiredCount}個, 所持${availableCount}個`);
          
          if (availableCount < requiredCount) {
            missingMaterials.push(`${itemName}×${requiredCount - availableCount}`);
          }
        }
      }
      
      const canCraft = missingMaterials.length === 0;
      
      if (canCraft) {
        console.log(`[クラフトスキル] ${toolName}の材料は十分です: ${requiredMaterials.join(', ')}`);
      } else {
        console.log(`[クラフトスキル] ${toolName}の材料不足: ${missingMaterials.join(', ')}`);
      }
      
      return {
        canCraft,
        missingItems: canCraft ? '' : `材料不足: ${missingMaterials.join(', ')}`,
        required: requiredMaterials
      };
      
    } catch (error) {
      console.log(`[クラフトスキル] 材料チェックエラー: ${error.message}`);
      return {
        canCraft: false,
        missingItems: `材料チェック失敗: ${error.message}`,
        required: []
      };
    }
  }
  
  getItemNameFromId(bot, itemId) {
    try {
      const mcData = require('minecraft-data')(bot.version);
      const item = mcData.items[itemId];
      return item ? item.name : `unknown_item_${itemId}`;
    } catch (error) {
      return `item_${itemId}`;
    }
  }
  
  async basicMoveToTable(bot, craftingTable) {
    const targetPos = craftingTable.position;
    const currentPos = bot.entity.position;
    
    const distance = Math.sqrt(
      Math.pow(targetPos.x - currentPos.x, 2) + 
      Math.pow(targetPos.z - currentPos.z, 2)
    );
    
    if (distance > 20) {
      throw new Error('作業台が遠すぎます');
    }
    
    // Simple movement towards table
    const steps = Math.ceil(distance / 2);
    const stepX = (targetPos.x - currentPos.x) / steps;
    const stepZ = (targetPos.z - currentPos.z) / steps;
    
    for (let i = 0; i < steps; i++) {
      try {
        const targetX = currentPos.x + stepX * (i + 1);
        const targetZ = currentPos.z + stepZ * (i + 1);
        
        await bot.lookAt({ x: targetX, y: targetPos.y, z: targetZ });
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 500));
        bot.setControlState('forward', false);
        
      } catch (stepError) {
        console.log(`[クラフトスキル] 移動ステップエラー: ${stepError.message}`);
        continue;
      }
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
            await bot.placeBlock(referenceBlock, { x: 0, y: 1, z: 0 });
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
            await bot.placeBlock(referenceBlock, { x: 0, y: 1, z: 0 });
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
        
        const blockAhead = bot.blockAt(bot.entity.position.offset(checkX - Math.floor(pos.x), checkY - Math.floor(pos.y), checkZ - Math.floor(pos.z)));
        const blockAbove = bot.blockAt(bot.entity.position.offset(checkX - Math.floor(pos.x), checkY + 1 - Math.floor(pos.y), checkZ - Math.floor(pos.z)));
        const blockAbove2 = bot.blockAt(bot.entity.position.offset(checkX - Math.floor(pos.x), checkY + 2 - Math.floor(pos.y), checkZ - Math.floor(pos.z)));
        
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
          const checkBlock = bot.blockAt(bot.entity.position.offset(Math.floor(altX) - Math.floor(pos.x), Math.floor(pos.y) - Math.floor(pos.y), Math.floor(altZ) - Math.floor(pos.z)));
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

// Exploration Skills
class ExploreSkill extends Skill {
  constructor() {
    super('explore', 'Explore the world to discover resources and locations');
  }

  async execute(bot, params) {
    const { direction = 'random', distance = 32, purpose = 'general' } = params;
    
    console.log(`[探索スキル] ${purpose}目的で${direction}方向に${distance}ブロック探索開始`);
    
    try {
      // Generate exploration target
      const target = this.generateExplorationTarget(bot, direction, distance);
      console.log(`[探索スキル] (${target.x}, ${target.y}, ${target.z})を探索中...`);
      
      // Attempt to move to target
      const moveResult = await this.moveToTarget(bot, target);
      
      if (moveResult.success) {
        // Exploration successful, scan surroundings
        const discoveries = await this.scanSurroundings(bot, purpose);
        
        if (discoveries.length > 0) {
          const discoveryMsg = discoveries.map(d => d.name).join(', ');
          bot.chat(`探索で発見: ${discoveryMsg} 🔍`);
          console.log(`[探索スキル] 発見: ${discoveryMsg}`);
        }
        
        return { success: true, discoveries, location: bot.entity.position };
      } else {
        console.log(`[探索スキル] 移動失敗、近場で探索続行`);
        // Even if movement failed, still scan nearby
        const discoveries = await this.scanSurroundings(bot, purpose);
        return { success: true, discoveries, location: bot.entity.position, note: '移動制限あり' };
      }
      
    } catch (error) {
      console.log(`[探索スキル] エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  generateExplorationTarget(bot, direction, distance) {
    const pos = bot.entity.position;
    
    if (direction === 'random') {
      // Generate random direction
      const angle = Math.random() * Math.PI * 2;
      return {
        x: Math.floor(pos.x + Math.cos(angle) * distance),
        y: pos.y,
        z: Math.floor(pos.z + Math.sin(angle) * distance)
      };
    } else {
      // Specific direction
      const directions = {
        north: { x: 0, z: -1 },
        south: { x: 0, z: 1 },
        east: { x: 1, z: 0 },
        west: { x: -1, z: 0 },
        northeast: { x: 1, z: -1 },
        northwest: { x: -1, z: -1 },
        southeast: { x: 1, z: 1 },
        southwest: { x: -1, z: 1 }
      };
      
      const dir = directions[direction] || directions.north;
      return {
        x: Math.floor(pos.x + dir.x * distance),
        y: pos.y,
        z: Math.floor(pos.z + dir.z * distance)
      };
    }
  }
  
  async moveToTarget(bot, target) {
    try {
      // Use pathfinder if available
      if (bot.pathfinder && typeof bot.pathfinder.setGoal === 'function') {
        const { goals } = require('mineflayer-pathfinder');
        const goal = new goals.GoalNear(target.x, target.y, target.z, 8);
        
        console.log(`[探索スキル] パスファインディングで目標へ移動中...`);
        
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            if (bot.pathfinder && bot.pathfinder.stop) {
              bot.pathfinder.stop();
            }
            resolve({ success: false, error: 'Movement timeout' });
          }, 15000); // 15 second timeout
          
          const onGoalReached = () => {
            clearTimeout(timeout);
            bot.pathfinder.removeListener('goal_reached', onGoalReached);
            bot.pathfinder.removeListener('path_update', onPathUpdate);
            resolve({ success: true });
          };
          
          const onPathUpdate = (r) => {
            if (r.status === 'noPath') {
              clearTimeout(timeout);
              bot.pathfinder.stop();
              bot.pathfinder.removeListener('goal_reached', onGoalReached);
              bot.pathfinder.removeListener('path_update', onPathUpdate);
              resolve({ success: false, error: 'No path found' });
            }
          };
          
          if (typeof bot.pathfinder.on === 'function') {
            bot.pathfinder.on('goal_reached', onGoalReached);
            bot.pathfinder.on('path_update', onPathUpdate);
          }
          bot.pathfinder.setGoal(goal);
        });
      } else {
        // Fallback to basic movement
        return await this.basicExploreMovement(bot, target);
      }
    } catch (error) {
      console.log(`[探索スキル] 移動エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  async basicExploreMovement(bot, target) {
    const currentPos = bot.entity.position;
    const distance = Math.sqrt(
      Math.pow(target.x - currentPos.x, 2) + 
      Math.pow(target.z - currentPos.z, 2)
    );
    
    console.log(`[探索スキル] 基本移動で探索: 距離${distance.toFixed(1)}`);
    
    if (distance > 50) {
      return { success: false, error: 'Target too far for basic movement' };
    }
    
    // Simple step-by-step movement
    const steps = Math.min(Math.ceil(distance / 4), 8);
    const stepX = (target.x - currentPos.x) / steps;
    const stepZ = (target.z - currentPos.z) / steps;
    
    for (let i = 0; i < steps; i++) {
      try {
        const stepTargetX = currentPos.x + stepX * (i + 1);
        const stepTargetZ = currentPos.z + stepZ * (i + 1);
        
        // Look towards target
        try {
          await bot.lookAt({ x: stepTargetX, y: currentPos.y, z: stepTargetZ });
        } catch (lookError) {
          // Continue without lookAt if it fails
        }
        
        // Move forward
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        bot.setControlState('forward', false);
        
        // Small pause between steps
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (stepError) {
        console.log(`[探索スキル] ステップ${i+1}エラー: ${stepError.message}`);
        continue;
      }
    }
    
    return { success: true };
  }
  
  async scanSurroundings(bot, purpose) {
    const discoveries = [];
    
    try {
      // Scan for different types of resources based on purpose
      if (purpose === 'wood' || purpose === 'general') {
        // Look for trees
        const trees = bot.findBlocks({
          matching: (block) => {
            if (!block || !block.name) return false;
            const name = block.name.toLowerCase();
            return name.includes('log') || name.includes('wood') || name.includes('leaves');
          },
          maxDistance: 32,
          count: 5
        });
        
        if (trees.length > 0) {
          discoveries.push({ name: '木材', count: trees.length, type: 'resource' });
        }
      }
      
      if (purpose === 'stone' || purpose === 'general') {
        // Look for stone
        const stones = bot.findBlocks({
          matching: (block) => {
            if (!block || !block.name) return false;
            const name = block.name.toLowerCase();
            return name.includes('stone') || name.includes('cobblestone') || name.includes('granite') || name.includes('diorite') || name.includes('andesite');
          },
          maxDistance: 24,
          count: 3
        });
        
        if (stones.length > 0) {
          discoveries.push({ name: '石材', count: stones.length, type: 'resource' });
        }
      }
      
      if (purpose === 'food' || purpose === 'general') {
        // Look for animals
        const animals = bot.nearestEntities((entity) => {
          return entity && entity.name && 
                 ['cow', 'pig', 'sheep', 'chicken'].includes(entity.name) &&
                 entity.position.distanceTo(bot.entity.position) <= 24;
        }).slice(0, 3);
        
        if (animals.length > 0) {
          discoveries.push({ name: '動物', count: animals.length, type: 'food' });
        }
      }
      
      // Look for interesting structures
      const structures = bot.findBlocks({
        matching: (block) => {
          if (!block || !block.name) return false;
          const name = block.name.toLowerCase();
          return name.includes('chest') || name.includes('furnace') || 
                 name.includes('crafting_table') || name.includes('door');
        },
        maxDistance: 32,
        count: 3
      });
      
      if (structures.length > 0) {
        discoveries.push({ name: '建造物', count: structures.length, type: 'structure' });
      }
      
    } catch (scanError) {
      console.log(`[探索スキル] スキャンエラー: ${scanError.message}`);
    }
    
    return discoveries;
  }
}

module.exports = { 
  Skill,
  SkillLibrary,
  // Movement Skills
  MoveToSkill,
  FollowSkill,
  // Basic Action Skills
  MineBlockSkill,
  PlaceBlockSkill,
  AttackEntitySkill,
  // Survival Skills
  SimpleGatherWoodSkill,
  SimpleFindFoodSkill,
  // Crafting Skills
  CraftToolsSkill,
  CraftWorkbenchSkill,
  CraftFurnaceSkill,
  // Building Skills
  BuildShelterSkill,
  PlaceBlocksSkill,
  // Advanced Movement Skills
  SmartJumpSkill,
  EscapeWaterSkill,
  NavigateTerrainSkill,
  // Exploration Skills
  ExploreSkill
};
