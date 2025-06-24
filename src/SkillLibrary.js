const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

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

  async execute(bot, _params = {}) {
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
          movements.allowParkour = true; // Enable parkour movements
          movements.allowSprinting = true; // Enable sprinting
          movements.canOpenDoors = true; // Allow opening doors
          movements.allowEntityDetection = true; // Detect entities as obstacles
          movements.blocksCantBreak = []; // Can break most blocks
          movements.liquids = new Set(); // Treat liquids as passable

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
            console.log('[移動スキル] パスファインディング問題を検出、基本移動にフォールバック');
            return await this.executeBasicMovement(bot, x, y, z);
          }

          // For other errors, try basic movement as well
          console.log('[移動スキル] 未知のエラー、基本移動を試行');
          return await this.executeBasicMovement(bot, x, y, z);
        }
      }

      // Manual pathfinding with enhanced safety checks and error handling
      if (!bot.pathfinder.setGoal || !bot.pathfinder.on) {
        console.log('[移動スキル] Pathfinder APIが利用できません、基本移動を試行');
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
            const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
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

      console.log('[移動スキル] 全ての脱出方法が失敗');
      return { success: false, inWater: true, error: `${fluidType}中脱出に失敗` };
    } catch (error) {
      console.log(`[移動スキル] 水中脱出エラー: ${error.message}`);
      return { success: false, inWater: true, error: error.message };
    }
  }

  async findNearestLand(bot, currentPos) {
    try {
      console.log('[移動スキル] 周辺の陸地検索中...');

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
              distance
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

  async performEnhancedEscape(bot, pos, _fluidType) {
    try {
      console.log('[移動スキル] 強化方向脱出を実行中...');

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

  async performVerticalEscape(bot, pos, _fluidType) {
    try {
      console.log('[移動スキル] 垂直脱出を実行中...');

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

        const offsetX = checkX - Math.floor(pos.x);
        const offsetY = checkY - Math.floor(pos.y);
        const offsetZ = checkZ - Math.floor(pos.z);

        const blockAhead = bot.blockAt(bot.entity.position.offset(offsetX, offsetY, offsetZ));
        const blockAbove = bot.blockAt(bot.entity.position.offset(offsetX, offsetY + 1, offsetZ));

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

    // Check if block is reachable and within mining distance
    const reachabilityCheck = await this.checkBlockReachability(bot, block);
    if (!reachabilityCheck.canReach) {
      console.log(`[マイニング] ${block.name}は採掘可能範囲外: ${reachabilityCheck.reason}`);

      // Try to move closer to the block
      const moveResult = await this.moveToMiningPosition(bot, block);
      if (!moveResult.success) {
        return { success: false, error: `採掘位置への移動失敗: ${moveResult.error}` };
      }

      // Re-check reachability after movement
      const recheckResult = await this.checkBlockReachability(bot, block);
      if (!recheckResult.canReach) {
        return { success: false, error: `移動後も採掘不可: ${recheckResult.reason}` };
      }
    }

    // Check inventory space before mining
    const inventoryCheck = this.checkInventorySpace(bot);
    if (!inventoryCheck.hasSpace) {
      console.log('[マイニング] インベントリが満杯です。整理を試みます...');
      const cleanupResult = await this.cleanupInventory(bot);
      if (!cleanupResult.success) {
        return { success: false, error: 'インベントリが満杯で採掘できません' };
      }
    }

    try {
      console.log(`[マイニング] ${block.position}で${block.name}を採掘中...`);

      // Store position for item collection
      const miningPosition = block.position.clone();

      await bot.dig(block);
      console.log(`[マイニング] ${block.name}を採掘完了`);

      // Collect dropped items
      const collectionResult = await this.collectDroppedItems(bot, miningPosition);
      if (collectionResult.itemsCollected > 0) {
        console.log(`[マイニング] ${collectionResult.itemsCollected}個のアイテムを回収しました`);
        bot.chat(`${block.name}を採掘して${collectionResult.itemsCollected}個のアイテムを回収！ ⛏️`);
      } else {
        bot.chat(`${block.name}を採掘しました！ ⛏️`);
      }

      return {
        success: true,
        message: `${block.name}を採掘しました`,
        itemsCollected: collectionResult.itemsCollected
      };
    } catch (error) {
      console.log(`[マイニング] 採掘に失敗: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async digDownForStone(bot, blockType) {
    console.log(`[マイニング] ${blockType}を求めて地下探索開始...`);

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

    // Start with close-range search for immediate blocks
    const searchRadii = [4, 8, 16, 32]; // Prioritize nearby blocks
    const botPosition = bot.entity.position;

    for (const radius of searchRadii) {
      console.log(`[マイニング] ${radius}ブロック範囲で${blockType}を探索中...`);

      // First, try to find blocks that are visible and accessible
      const visibleBlocks = this.findVisibleBlocks(bot, blockType, radius);
      if (visibleBlocks.length > 0) {
        // Sort by distance and accessibility
        const accessibleBlocks = visibleBlocks.filter(block => {
          const reachCheck = this.checkBlockReachability(bot, block);
          return reachCheck.canReach || reachCheck.distance < 6; // Allow slightly farther blocks if reachable
        });

        if (accessibleBlocks.length > 0) {
          // Sort by distance and return closest accessible block
          accessibleBlocks.sort((a, b) => {
            const distA = botPosition.distanceTo(a.position);
            const distB = botPosition.distanceTo(b.position);
            return distA - distB;
          });

          const selectedBlock = accessibleBlocks[0];
          console.log(`[マイニング] ${radius}ブロック範囲で視界内の${selectedBlock.name}を発見: ${selectedBlock.position}`);
          return selectedBlock;
        }
      }

      // Fallback to standard search if no visible blocks found
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
    console.log('[マイニング] 標準探索失敗、特殊検索開始...');

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
    for (const [, blocks] of Object.entries(blockGroups)) {
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

  // Find blocks that are visible (line of sight) to the bot
  findVisibleBlocks(bot, blockType, maxDistance) {
    try {
      const botPosition = bot.entity.position;
      const visibleBlocks = [];

      // Get all blocks within range
      const blocks = bot.findBlocks({
        matching: (candidate) => {
          if (!candidate || !candidate.name) return false;

          if (typeof blockType === 'string') {
            const candidateName = candidate.name.toLowerCase();
            const targetName = blockType.toLowerCase();

            return candidateName === targetName ||
                   candidateName.includes(targetName) ||
                   (targetName === 'stone' && (candidateName.includes('stone') || candidateName === 'cobblestone')) ||
                   (targetName === 'wood' && (candidateName.includes('log') || candidateName.includes('wood'))) ||
                   (targetName === 'ore' && candidateName.includes('ore'));
          }
          return false;
        },
        maxDistance,
        count: 20 // Limit to prevent performance issues
      });

      // Check line of sight for each block
      for (const blockPos of blocks) {
        const block = bot.blockAt(blockPos);
        if (!block) continue;

        const lineOfSight = this.checkLineOfSight(bot, botPosition, blockPos);
        if (lineOfSight.clear) {
          visibleBlocks.push(block);
        }
      }

      return visibleBlocks;
    } catch (error) {
      console.log(`[マイニング] 視界内ブロック検索エラー: ${error.message}`);
      return [];
    }
  }

  // Check if bot can reach and mine the block
  async checkBlockReachability(bot, block) {
    try {
      const botPos = bot.entity.position;
      const blockPos = block.position;

      // Check distance (typical mining reach is about 4 blocks)
      const distance = botPos.distanceTo(blockPos);
      const maxMiningDistance = 4.5;

      if (distance > maxMiningDistance) {
        return {
          canReach: false,
          reason: `距離が遠すぎます (${distance.toFixed(1)}m > ${maxMiningDistance}m)`
        };
      }

      // Check if bot can actually dig this block
      if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(block)) {
        return {
          canReach: false,
          reason: '採掘不可能なブロックです'
        };
      }

      // Check line of sight (no solid blocks between bot and target)
      const lineOfSight = this.checkLineOfSight(bot, botPos, blockPos);
      if (!lineOfSight.clear) {
        return {
          canReach: false,
          reason: `視線が遮られています: ${lineOfSight.obstacle}`
        };
      }

      return {
        canReach: true,
        distance
      };
    } catch (error) {
      return {
        canReach: false,
        reason: `到達可能性チェックエラー: ${error.message}`
      };
    }
  }

  // Check if there's a clear line of sight to the block
  checkLineOfSight(bot, from, to) {
    try {
      const direction = to.clone().subtract(from).normalize();
      const distance = from.distanceTo(to);
      const steps = Math.ceil(distance * 2); // Check every 0.5 blocks

      for (let i = 1; i < steps; i++) {
        const checkPos = from.clone().add(direction.clone().scale(i * 0.5));
        const block = bot.blockAt(checkPos);

        if (block && block.name !== 'air' && block.name !== 'water' &&
            !block.name.includes('grass') && !block.name.includes('flower')) {
          return {
            clear: false,
            obstacle: block.name
          };
        }
      }

      return { clear: true };
    } catch (error) {
      return {
        clear: false,
        obstacle: `チェックエラー: ${error.message}`
      };
    }
  }

  // Move bot to optimal mining position
  async moveToMiningPosition(bot, block) {
    try {
      const blockPos = block.position;
      const botPos = bot.entity.position;

      console.log(`[マイニング] 採掘位置への移動開始: ${blockPos}`);

      // Calculate optimal position (2-3 blocks away from the block)
      const direction = botPos.clone().subtract(blockPos).normalize();
      const targetPos = blockPos.clone().add(direction.scale(2.5));

      // Use pathfinder if available
      if (bot.pathfinder && typeof bot.pathfinder.setGoal === 'function') {
        const { goals } = require('mineflayer-pathfinder');
        const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1);

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ success: false, error: '移動タイムアウト' });
          }, 10000);

          bot.pathfinder.setGoal(goal);

          bot.pathfinder.on('goal_reached', () => {
            clearTimeout(timeout);
            console.log('[マイニング] 採掘位置に到達しました');
            resolve({ success: true });
          });

          bot.pathfinder.on('path_stop', (reason) => {
            clearTimeout(timeout);
            if (reason === 'goal_reached') {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: `移動停止: ${reason}` });
            }
          });
        });
      } else {
        // Fallback: simple movement
        console.log('[マイニング] 基本移動で採掘位置へ移動');
        return { success: true }; // Assume success for basic movement
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Check if inventory has space for new items
  checkInventorySpace(bot) {
    try {
      const inventory = bot.inventory;
      const totalSlots = 36; // Standard inventory size
      const usedSlots = inventory.items().length;
      const freeSlots = totalSlots - usedSlots;

      return {
        hasSpace: freeSlots > 0,
        freeSlots,
        usedSlots,
        totalSlots
      };
    } catch (error) {
      console.log(`[マイニング] インベントリチェックエラー: ${error.message}`);
      return {
        hasSpace: true, // Assume space available on error
        freeSlots: 5,
        error: error.message
      };
    }
  }

  // Clean up inventory by dropping less important items
  async cleanupInventory(bot) {
    try {
      console.log('[マイニング] インベントリ整理開始');

      const inventory = bot.inventory.items();
      const lowPriorityItems = ['dirt', 'cobblestone', 'gravel', 'sand'];
      let itemsDropped = 0;

      for (const item of inventory) {
        if (!item || !item.name) continue;

        // Drop low priority items if we have too many
        if (lowPriorityItems.includes(item.name) && item.count > 16) {
          try {
            const dropCount = Math.min(item.count - 8, 32); // Keep at least 8, drop max 32
            await bot.toss(item.type, null, dropCount);
            itemsDropped += dropCount;
            console.log(`[マイニング] ${item.name}を${dropCount}個破棄しました`);

            // Check if we have enough space now
            const spaceCheck = this.checkInventorySpace(bot);
            if (spaceCheck.freeSlots >= 3) {
              break;
            }
          } catch (error) {
            console.log(`[マイニング] アイテム破棄エラー: ${error.message}`);
          }
        }
      }

      if (itemsDropped > 0) {
        console.log(`[マイニング] インベントリ整理完了: ${itemsDropped}個のアイテムを破棄`);
        return { success: true, itemsDropped };
      } else {
        return { success: false, error: '整理可能なアイテムがありません' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Collect dropped items after mining
  async collectDroppedItems(bot, miningPosition) {
    try {
      console.log('[マイニング] ドロップアイテム回収開始');

      let itemsCollected = 0;
      const maxCollectionTime = 10000; // Increased to 10 seconds for better collection
      const startTime = Date.now();
      let lastItemCount = -1;
      let consecutiveNoItemChecks = 0;

      // Store initial inventory count for accurate tracking
      const initialInventoryCount = bot.inventory.items().length;
      console.log(`[マイニング] 回収前インベントリアイテム数: ${initialInventoryCount}`);

      // Wait a bit initially for items to spawn
      await new Promise(resolve => setTimeout(resolve, 800));

      while (Date.now() - startTime < maxCollectionTime) {
        // Find nearby dropped items with optimized range
        const droppedItems = Object.values(bot.entities).filter(entity => {
          if (entity.name !== 'item' || !entity.position) return false;
          const distance = entity.position.distanceTo(miningPosition);
          return distance < 5; // Optimized range from 8 to 5 blocks
        });

        const coords = `${miningPosition.x}, ${miningPosition.y}, ${miningPosition.z}`;
        console.log(`[マイニング] 発見したアイテム: ${droppedItems.length}個 (座標: ${coords})`);

        if (droppedItems.length === 0) {
          consecutiveNoItemChecks++;
          // If no items found multiple times, likely no more items to collect
          if (consecutiveNoItemChecks >= 3 && Date.now() - startTime > 3000) {
            console.log('[マイニング] アイテムが見つからないため回収終了');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }

        consecutiveNoItemChecks = 0; // Reset counter when items are found

        // Check if item count hasn't changed for efficiency
        if (droppedItems.length === lastItemCount) {
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }
        lastItemCount = droppedItems.length;

        // Sort items by distance for efficient collection
        droppedItems.sort((a, b) => {
          const distA = bot.entity.position.distanceTo(a.position);
          const distB = bot.entity.position.distanceTo(b.position);
          return distA - distB;
        });

        // Move to each dropped item and collect it
        for (const itemEntity of droppedItems) {
          try {
            const distance = bot.entity.position.distanceTo(itemEntity.position);
            console.log(`[マイニング] アイテムまでの距離: ${distance.toFixed(2)}ブロック`);

            if (distance > 1.5) { // Improved pickup distance threshold
              // Move closer to the item with higher precision
              if (bot.pathfinder && typeof bot.pathfinder.setGoal === 'function') {
                const { goals } = require('mineflayer-pathfinder');
                const goal = new goals.GoalNear(
                  itemEntity.position.x,
                  itemEntity.position.y,
                  itemEntity.position.z,
                  1.0 // More precise goal distance
                );
                bot.pathfinder.setGoal(goal);

                // Wait for movement with improved timeout
                const moveStartTime = Date.now();
                while (Date.now() - moveStartTime < 3000) {
                  const newDistance = bot.entity.position.distanceTo(itemEntity.position);
                  if (newDistance <= 1.5) {
                    console.log(`[マイニング] アイテムに接近完了: ${newDistance.toFixed(2)}ブロック`);
                    break;
                  }
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              } else {
                // Fallback: simple movement
                await bot.lookAt(itemEntity.position);
                bot.setControlState('forward', true);
                await new Promise(resolve => setTimeout(resolve, 500));
                bot.setControlState('forward', false);
              }
            }

            // Items are automatically collected when bot gets close enough
            // Extended wait time for pickup
            await new Promise(resolve => setTimeout(resolve, 600));

            // Verify item was actually collected by checking if it still exists
            const stillExists = Object.values(bot.entities).some(entity =>
              entity.id === itemEntity.id && entity.name === 'item'
            );

            if (!stillExists) {
              itemsCollected++;
              console.log(`[マイニング] アイテム回収成功: ${itemsCollected}個`);
            } else {
              console.log('[マイニング] アイテム回収失敗: まだ存在しています');
            }
          } catch (error) {
            console.log(`[マイニング] アイテム回収エラー: ${error.message}`);
          }
        }

        // Wait between collection cycles for stability
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      // Final inventory check
      const finalInventoryCount = bot.inventory.items().length;
      const actualItemsGained = finalInventoryCount - initialInventoryCount;

      console.log(`[マイニング] 回収後インベントリアイテム数: ${finalInventoryCount}`);
      console.log(`[マイニング] 実際に増加したアイテム数: ${actualItemsGained}`);
      console.log(`[マイニング] アイテム回収完了: 検出${itemsCollected}個, 実際${actualItemsGained}個`);

      return {
        success: true,
        itemsCollected: Math.max(itemsCollected, actualItemsGained)
      };
    } catch (error) {
      console.log(`[マイニング] アイテム回収処理エラー: ${error.message}`);
      return {
        success: false,
        itemsCollected: 0,
        error: error.message
      };
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

  async execute(bot, _params) {
    // Use default amount of 5 logs to gather

    console.log('[木材収集] 近くの木を探しています...');

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
    console.log('[木材収集] 近くに木が見つかりません。ワールド生成木を探します...');

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
      console.log('[木材収集] 空のワールドを検出、基本リソース確保を試みます');
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
            maxDistance: 64 // Expanded range for movement search
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

    console.log('[木材収集] 全方向探索後も木が見つかりません');
    return { success: false, error: '探索後も木が見つかりません' };
  }

  async moveToPosition(bot, target, timeout = 10000) {
    // Use pathfinder and Movements from module imports

    if (!bot.pathfinder) {
      console.log('[木材収集] Pathfinder not initialized, using basic movement');
      return await this.basicMovement(bot, target);
    }

    return new Promise((resolve) => {
      const goal = new goals.GoalNear(target.x, target.y, target.z, 3);
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
    console.log('[木材収集] 段階的探索を開始...');

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
    console.log('[木材収集] 段階的探索失敗、緊急フォールバック開始...');

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

    console.log('[木材収集] 全ての検索方法で木材が見つかりませんでした');
    return null;
  }
}

class SimpleFindFoodSkill extends Skill {
  constructor() {
    super('find_food', 'Simple food finding');
  }

  async execute(bot, _params) {
    console.log(`[食料確保] 現在の食料レベル: ${bot.food}/20`);

    if (bot.food >= 15) {
      console.log('[食料確保] 食料レベルは十分です');
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

    console.log('[食料確保] 近くに動物が見つかりません');
    return { success: false, error: '動物が見つかりません' };
  }
}

// Crafting Skills
class CraftToolsSkill extends Skill {
  constructor() {
    super('craft_tools', 'Craft basic tools');
  }

  async execute(bot, params) {
    const { tools = ['wooden_pickaxe', 'wooden_axe'] } = params;
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

  async execute(bot, _params) {
    console.log('[作業台スキル] 作業台を作成します');

    try {
      // Detailed material check using InventoryUtils
      const InventoryUtils = require('./InventoryUtils');
      const inventorySummary = InventoryUtils.getInventorySummary(bot);

      const materialInfo = `木材${inventorySummary.wood}個, 板材${inventorySummary.planks}個, ` +
        `利用可能板材${inventorySummary.availablePlanks}個`;
      console.log(`[作業台スキル] 素材チェック: ${materialInfo}`);

      // Detailed inventory logging for debugging
      const allItems = bot.inventory.items();
      console.log(`[作業台スキル] インベントリ詳細: 総アイテム数${allItems.length}`);
      allItems.forEach(item => {
        if (item && item.name) {
          console.log(`  - ${item.name}: ${item.count}個`);
        }
      });

      // Check if we already have a crafting table (improved detection)
      const existingCraftingTable = bot.inventory.items().find(item =>
        item && item.name && (
          item.name === 'crafting_table' ||
          item.name === 'workbench' ||
          item.name.includes('crafting')
        )
      );

      if (existingCraftingTable) {
        console.log(`[作業台スキル] 既に作業台を所持しています: ${existingCraftingTable.name}`);
        return { success: true, message: '既に作業台を所持しています' };
      }

      // Check available planks with detailed logging
      const currentPlanks = bot.inventory.items().filter(item =>
        item && item.name && (
          item.name === 'oak_planks' ||
          item.name === 'planks' ||
          item.name.includes('_planks')
        )
      );

      const totalPlanks = currentPlanks.reduce((sum, item) => sum + item.count, 0);
      console.log(`[作業台スキル] 現在の板材総数: ${totalPlanks}個`);

      // Check if we have enough materials for workbench
      if (inventorySummary.availablePlanks < 4) {
        console.log(`[作業台スキル] 板材不足: 必要4個, 利用可能${inventorySummary.availablePlanks}個`);

        // Try to craft planks from logs if available
        const logs = bot.inventory.items().filter(item =>
          item && item.name && (
            item.name === 'oak_log' ||
            item.name === 'log' ||
            item.name.includes('_log')
          )
        );

        const totalLogs = logs.reduce((sum, item) => sum + item.count, 0);
        console.log(`[作業台スキル] 利用可能な原木: ${totalLogs}個`);

        if (totalLogs > 0) {
          console.log('[作業台スキル] 原木から板材を作成します');
          const planksCreated = await this.craftPlanks(bot, logs[0]);
          if (!planksCreated) {
            return { success: false, error: '原木から板材の作成に失敗しました' };
          }
          // Re-check planks after crafting
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for inventory update
        } else {
          const deficit = 4 - inventorySummary.availablePlanks;
          return {
            success: false,
            error: `作業台作成に板材が${deficit}個不足しています（必要4個、利用可能${inventorySummary.availablePlanks}個、原木${totalLogs}個）`
          };
        }
      }

      // Re-check planks availability after potential crafting
      const updatedPlanks = bot.inventory.items().filter(item =>
        item && item.name && (
          item.name === 'oak_planks' ||
          item.name === 'planks' ||
          item.name.includes('_planks')
        )
      );

      const finalPlanksCount = updatedPlanks.reduce((sum, item) => sum + item.count, 0);
      console.log(`[作業台スキル] 最終的な板材数: ${finalPlanksCount}個`);

      if (finalPlanksCount < 4) {
        return {
          success: false,
          error: `板材が不足しています（必要4個、現在${finalPlanksCount}個）`
        };
      }

      // Get minecraft data and check available recipes
      const mcData = require('minecraft-data')(bot.version);
      console.log(`[作業台スキル] Minecraft version: ${bot.version}`);

      // Try different possible item names for crafting table
      const possibleCraftingTableNames = ['crafting_table', 'workbench', 'work_bench'];
      let workbenchItem = null;
      for (const name of possibleCraftingTableNames) {
        if (mcData.itemsByName[name]) {
          workbenchItem = mcData.itemsByName[name];
          console.log(`[作業台スキル] 作業台アイテム発見: ${name} (ID: ${workbenchItem.id})`);
          break;
        }
      }

      if (!workbenchItem) {
        console.log('[作業台スキル] 利用可能なアイテム一覧:');
        Object.keys(mcData.itemsByName).filter(name =>
          name.includes('craft') || name.includes('work') || name.includes('bench')
        ).forEach(name => {
          console.log(`  - ${name}: ${mcData.itemsByName[name].id}`);
        });
        return { success: false, error: '作業台のアイテム定義が見つかりません' };
      }

      // Get recipe for crafting table
      const recipes = bot.recipesFor(workbenchItem.id, null, 1, null);
      console.log(`[作業台スキル] 見つかったレシピ数: ${recipes.length}`);

      if (recipes.length === 0) {
        console.log('[作業台スキル] レシピが見つかりません、代替方法を試します');

        // Try to get all available recipes for debugging
        const allRecipes = bot.recipesAll();
        console.log(`[作業台スキル] 総レシピ数: ${allRecipes.length}`);

        const craftingRelatedRecipes = allRecipes.filter(recipe => {
          const result = mcData.items[recipe.result.id];
          return result && result.name && (
            result.name.includes('craft') ||
            result.name.includes('work') ||
            result.name.includes('bench')
          );
        });

        console.log(`[作業台スキル] クラフト関連レシピ: ${craftingRelatedRecipes.length}個`);
        craftingRelatedRecipes.forEach(recipe => {
          const result = mcData.items[recipe.result.id];
          console.log(`  - ${result.name}: ${recipe.result.id}`);
        });

        return { success: false, error: '作業台のレシピが見つかりません' };
      }

      const recipe = recipes[0];
      console.log(`[作業台スキル] 使用するレシピ: ${JSON.stringify(recipe.result)}`);

      // Craft the workbench
      console.log('[作業台スキル] 作業台をクラフト中...');
      await bot.craft(recipe, 1, null);

      // Wait for crafting completion and verify
      await new Promise(resolve => setTimeout(resolve, 1000));

      const craftedWorkbench = bot.inventory.items().find(item =>
        item && item.name && (
          item.name === 'crafting_table' ||
          item.name === 'workbench' ||
          item.name.includes('crafting')
        )
      );

      if (craftedWorkbench) {
        console.log(`[作業台スキル] 作業台クラフト成功: ${craftedWorkbench.name}`);
        bot.chat('作業台を作成しました！ 🔧');
        return { success: true, crafted: craftedWorkbench.name };
      } else {
        console.log('[作業台スキル] 作業台クラフト失敗: インベントリに見つかりません');
        return { success: false, error: 'クラフト後に作業台がインベントリに見つかりません' };
      }
    } catch (error) {
      console.log(`[作業台スキル] エラー詳細: ${error.message}`);
      console.log(`[作業台スキル] エラースタック: ${error.stack}`);
      return { success: false, error: error.message };
    }
  }

  async craftPlanks(bot, logs) {
    try {
      const mcData = require('minecraft-data')(bot.version);
      const planksItem = mcData.itemsByName.oak_planks || mcData.itemsByName.planks;
      const recipe = bot.recipesFor(planksItem.id, null, 1, null)[0];

      if (recipe) {
        const logsToCraft = Math.min(logs.count, 2); // Craft up to 2 logs for 8 planks
        const expectedPlanks = logsToCraft * 4;

        console.log(`[作業台スキル] 原木${logsToCraft}個から板材${expectedPlanks}個を作成中...`);

        // Get planks count before crafting
        const planksBefore = bot.inventory.count(item =>
          item.name === 'oak_planks' || item.name === 'planks'
        );

        await bot.craft(recipe, logsToCraft, null);

        // Wait for inventory update
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get planks count after crafting
        const planksAfter = bot.inventory.count(item =>
          item.name === 'oak_planks' || item.name === 'planks'
        );

        const actualPlanksCreated = planksAfter - planksBefore;
        console.log(`[作業台スキル] 板材作成完了: ${actualPlanksCreated}個（期待値: ${expectedPlanks}個）`);

        return actualPlanksCreated > 0;
      } else {
        console.log('[作業台スキル] 板材のレシピが見つかりません');
        return false;
      }
    } catch (error) {
      console.log(`[作業台スキル] 板の作成に失敗: ${error.message}`);
      return false;
    }
  }
}

class CraftFurnaceSkill extends Skill {
  constructor() {
    super('craft_furnace', 'Craft a furnace');
  }

  async execute(bot, _params) {
    console.log('[かまどスキル] かまどを作成します');

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
    const { size = 'small' } = params;
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
        return { success: true, placed };
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

        const blockInPath = bot.blockAt(new Vec3(Math.floor(checkX), Math.floor(pos.y + height), Math.floor(checkZ)));

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
      const { target, maxTime = 30000, createPath = false } = params;
      const { x, y, z } = target;

      console.log(`[地形ナビ] 複雑地形をナビゲート: (${x}, ${y}, ${z})`);

      // Check if target is visible, if not and createPath is true, create safe path
      if (createPath) {
        const pathResult = await this.createSafePathToTarget(bot, { x, y, z });
        if (!pathResult.success) {
          return { success: false, error: `安全な経路作成に失敗: ${pathResult.error}` };
        }
      }

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
          return { success: true, message: '地形ナビゲーション成功' };
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

        const offsetX = checkX - Math.floor(pos.x);
        const offsetY = checkY - Math.floor(pos.y);
        const offsetZ = checkZ - Math.floor(pos.z);

        const blockAhead = bot.blockAt(bot.entity.position.offset(offsetX, offsetY, offsetZ));
        const blockAbove = bot.blockAt(bot.entity.position.offset(offsetX, offsetY + 1, offsetZ));
        const blockAbove2 = bot.blockAt(bot.entity.position.offset(offsetX, offsetY + 2, offsetZ));

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
        { x: 1, z: 0 }, // East
        { x: -1, z: 0 }, // West
        { x: 0, z: 1 }, // South
        { x: 0, z: -1 }, // North
        { x: 1, z: 1 }, // Southeast
        { x: -1, z: 1 }, // Southwest
        { x: 1, z: -1 }, // Northeast
        { x: -1, z: -1 } // Northwest
      ];

      for (const dir of directions) {
        const altX = pos.x + dir.x * 3;
        const altZ = pos.z + dir.z * 3;

        // Check if this direction is closer to target
        const altDistance = Math.sqrt(Math.pow(targetX - altX, 2) + Math.pow(targetZ - altZ, 2));
        const currentDistance = Math.sqrt(Math.pow(targetX - pos.x, 2) + Math.pow(targetZ - pos.z, 2));

        if (altDistance < currentDistance) {
          // Check if path is clear
          const offsetX = Math.floor(altX) - Math.floor(pos.x);
          const offsetY = Math.floor(pos.y) - Math.floor(pos.y);
          const offsetZ = Math.floor(altZ) - Math.floor(pos.z);
          const checkBlock = bot.blockAt(bot.entity.position.offset(offsetX, offsetY, offsetZ));
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

  // Create safe path to hidden/distant target
  async createSafePathToTarget(bot, target) {
    try {
      console.log(`[地形ナビ] 目標 (${target.x}, ${target.y}, ${target.z}) への安全な経路を作成中...`);

      const botPos = bot.entity.position;
      const targetPos = target;

      // Check if target is visible
      const lineOfSight = this.checkLineOfSight(bot, botPos, targetPos);
      if (lineOfSight.clear) {
        console.log('[地形ナビ] 目標は視界内にあります、経路作成不要');
        return { success: true, pathCreated: false };
      }

      console.log(`[地形ナビ] 視線が遮られています: ${lineOfSight.obstacle}`);

      // Create waypoints for safe navigation
      const waypoints = this.generateSafeWaypoints(bot, botPos, targetPos);

      if (waypoints.length === 0) {
        return { success: false, error: '安全な経路を見つけられません' };
      }

      console.log(`[地形ナビ] ${waypoints.length}個の経由地点を生成しました`);

      // Verify each waypoint is safe
      for (let i = 0; i < waypoints.length; i++) {
        const waypoint = waypoints[i];
        const safetyCheck = this.checkWaypointSafety(bot, waypoint);

        if (!safetyCheck.safe) {
          console.log(`[地形ナビ] 経由地点${i + 1}が安全ではありません: ${safetyCheck.reason}`);

          // Try to find alternative waypoint
          const alternative = this.findAlternativeWaypoint(bot, waypoint, targetPos);
          if (alternative.found) {
            waypoints[i] = alternative.waypoint;
            console.log(`[地形ナビ] 代替経由地点を設定: (${alternative.waypoint.x}, ${alternative.waypoint.z})`);
          } else {
            return { success: false, error: `経由地点${i + 1}の代替ルートが見つかりません` };
          }
        }
      }

      return {
        success: true,
        pathCreated: true,
        waypoints,
        message: '安全な経路を作成しました'
      };
    } catch (error) {
      return { success: false, error: `経路作成エラー: ${error.message}` };
    }
  }

  // Check line of sight between two points
  checkLineOfSight(bot, from, to) {
    try {
      const direction = {
        x: to.x - from.x,
        y: to.y - from.y,
        z: to.z - from.z
      };

      const distance = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
      const steps = Math.ceil(distance);

      for (let i = 1; i < steps; i++) {
        const checkPos = {
          x: from.x + (direction.x / steps) * i,
          y: from.y + (direction.y / steps) * i,
          z: from.z + (direction.z / steps) * i
        };

        const block = bot.blockAt(checkPos);
        if (block && block.name !== 'air' && !block.name.includes('grass') && !block.name.includes('flower')) {
          return { clear: false, obstacle: block.name };
        }
      }

      return { clear: true };
    } catch (error) {
      return { clear: false, obstacle: `チェックエラー: ${error.message}` };
    }
  }

  // Generate safe waypoints between current position and target
  generateSafeWaypoints(bot, start, end) {
    const waypoints = [];
    const totalDistance = Math.sqrt(
      Math.pow(end.x - start.x, 2) +
      Math.pow(end.z - start.z, 2)
    );

    // Calculate number of waypoints based on distance
    const waypointCount = Math.max(2, Math.min(6, Math.ceil(totalDistance / 10)));

    for (let i = 1; i < waypointCount; i++) {
      const ratio = i / waypointCount;
      const waypoint = {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y, // Keep same Y level initially
        z: start.z + (end.z - start.z) * ratio
      };

      waypoints.push(waypoint);
    }

    return waypoints;
  }

  // Check if waypoint is safe to navigate to
  checkWaypointSafety(bot, waypoint) {
    try {
      const pos = { x: Math.floor(waypoint.x), y: Math.floor(waypoint.y), z: Math.floor(waypoint.z) };

      // Check the block at waypoint
      const block = bot.blockAt(pos);
      if (block && block.name !== 'air') {
        return { safe: false, reason: `固体ブロック: ${block.name}` };
      }

      // Check block below (need something to stand on)
      const blockBelow = bot.blockAt({ x: pos.x, y: pos.y - 1, z: pos.z });
      if (!blockBelow || blockBelow.name === 'air') {
        return { safe: false, reason: '落下の危険' };
      }

      // Check for dangerous blocks
      if (blockBelow.name.includes('lava') || blockBelow.name.includes('fire')) {
        return { safe: false, reason: '危険ブロック' };
      }

      // Check for water
      if (block && (block.name === 'water' || block.name === 'flowing_water')) {
        return { safe: false, reason: '水中' };
      }

      return { safe: true };
    } catch (error) {
      return { safe: false, reason: `安全性チェックエラー: ${error.message}` };
    }
  }

  // Find alternative waypoint if current one is unsafe
  findAlternativeWaypoint(bot, unsafeWaypoint, target) {
    try {
      const searchRadius = 5;
      const directions = [
        { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
        { x: 1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 }
      ];

      for (const dir of directions) {
        for (let dist = 1; dist <= searchRadius; dist++) {
          const altWaypoint = {
            x: unsafeWaypoint.x + dir.x * dist,
            y: unsafeWaypoint.y,
            z: unsafeWaypoint.z + dir.z * dist
          };

          const safetyCheck = this.checkWaypointSafety(bot, altWaypoint);
          if (safetyCheck.safe) {
            // Check if this alternative is still roughly towards the target
            const originalDistance = Math.sqrt(
              Math.pow(target.x - unsafeWaypoint.x, 2) +
              Math.pow(target.z - unsafeWaypoint.z, 2)
            );
            const altDistance = Math.sqrt(
              Math.pow(target.x - altWaypoint.x, 2) +
              Math.pow(target.z - altWaypoint.z, 2)
            );

            // Accept if alternative is not significantly farther
            if (altDistance <= originalDistance * 1.5) {
              return { found: true, waypoint: altWaypoint };
            }
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
        console.log('[探索スキル] 移動失敗、近場で探索続行');
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

        console.log('[探索スキル] パスファインディングで目標へ移動中...');

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
        console.log(`[探索スキル] ステップ${i + 1}エラー: ${stepError.message}`);
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
