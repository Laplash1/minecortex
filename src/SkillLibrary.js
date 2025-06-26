const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const InventoryUtils = require('./InventoryUtils');

class SkillLibrary {
  constructor() {
    this.skills = new Map();
    this.recipeCache = new Map();
    this.aliasConfig = null;
  }

  /**
   * Load item alias configuration
   */
  static loadAliasConfig() {
    if (!SkillLibrary._aliasConfig) {
      try {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, '..', 'config', 'item-alias.json');
        SkillLibrary._aliasConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (error) {
        console.warn(`[レシピ検索] Alias config load failed: ${error.message}`);
        SkillLibrary._aliasConfig = { common_aliases: {}, material_variants: {} };
      }
    }
    return SkillLibrary._aliasConfig;
  }

  /**
   * Enhanced safe recipe search helper with caching and fallback strategies
   * @param {Bot} bot - Mineflayer bot instance
   * @param {number|string} itemIdentifier - Item ID or name to craft
   * @param {number} count - Number of items to craft
   * @param {Block|null} table - Crafting table block (null for inventory crafting)
   * @returns {Object|null} Recipe object or null if not found
   */
  static getRecipeSafe(bot, itemIdentifier, count = 1, table = null) {
    try {
      // Generate cache key
      const cacheKey = `${itemIdentifier}-${count}-${table ? 'table' : 'inventory'}`;
      
      // Check cache first
      if (!SkillLibrary._recipeCache) {
        SkillLibrary._recipeCache = new Map();
      }
      
      if (SkillLibrary._recipeCache.has(cacheKey)) {
        const cached = SkillLibrary._recipeCache.get(cacheKey);
        if (cached.timestamp > Date.now() - 300000) { // 5 minute cache
          return cached.recipe;
        }
        SkillLibrary._recipeCache.delete(cacheKey);
      }

      // Version compatibility check
      const mcData = require('minecraft-data')(bot.version);
      if (!mcData) {
        console.error(`[レシピ検索] minecraft-data for version ${bot.version} not found`);
        return null;
      }

      // Log version info on first call
      if (!SkillLibrary._versionLogged) {
        console.info(`[RecipeDebug] Bot version: ${bot.version}, mcData version: ${mcData.version?.minecraftVersion || 'unknown'}`);
        SkillLibrary._versionLogged = true;
      }

      // Load alias configuration
      const aliasConfig = SkillLibrary.loadAliasConfig();

      // Handle both item ID and item name with alias support
      let itemId = itemIdentifier;
      let itemName = 'unknown';
      
      if (typeof itemIdentifier === 'string') {
        // Check for aliases
        let resolvedName = itemIdentifier;
        if (aliasConfig.common_aliases[itemIdentifier]) {
          resolvedName = aliasConfig.common_aliases[itemIdentifier];
          console.log(`[レシピ検索] Using alias: ${itemIdentifier} -> ${resolvedName}`);
        }
        
        const item = mcData.itemsByName[resolvedName];
        if (!item) {
          console.warn(`[レシピ検索] Item '${resolvedName}' not found in minecraft-data`);
          return null;
        }
        itemId = item.id;
        itemName = item.name;
      } else {
        itemName = mcData.items[itemId]?.name || 'unknown';
      }

      // Multiple fallback strategies for recipe search
      const searchStrategies = [
        () => bot.recipesFor(itemId, null, count, table),
        () => bot.recipesFor(itemId, null, count),
        () => bot.recipesFor(itemId),
        () => count > 1 ? bot.recipesFor(itemId, null, 1, table) : null
      ];

      let foundRecipe = null;
      for (let i = 0; i < searchStrategies.length; i++) {
        try {
          const recipes = searchStrategies[i]();
          if (recipes && recipes.length > 0) {
            foundRecipe = recipes[0];
            if (i > 0) {
              console.log(`[レシピ検索] フォールバック戦略${i}で${itemName}のレシピを発見`);
            }
            break;
          }
        } catch (error) {
          if (i === 0) {
            console.warn(`[レシピ検索] Primary search failed for ${itemName}: ${error.message}`);
          }
        }
      }

      // minecraft-data 3.90.0+ direct recipe search fallback
      if (!foundRecipe && mcData.recipes) {
        try {
          console.log(`[レシピ検索] minecraft-data直接検索を試行: ${itemName}(id:${itemId})`);
          
          // minecraft-data 3.90.0の新構造: data.recipes[itemId] が配列
          const directRecipes = mcData.recipes[itemId];
          if (directRecipes && Array.isArray(directRecipes) && directRecipes.length > 0) {
            // 最初のレシピを変換
            const rawRecipe = directRecipes[0];
            
            // Mineflayer形式に変換
            foundRecipe = {
              id: itemId, // レシピIDとしてitemIdを使用
              result: rawRecipe.result || { id: itemId, count: count },
              delta: [],
              inShape: rawRecipe.inShape || null,
              ingredients: rawRecipe.ingredients || null
            };
            
            // 材料情報を変換
            if (rawRecipe.ingredients) {
              // shapeless recipe
              foundRecipe.delta = rawRecipe.ingredients.map(ingredientId => ({
                id: ingredientId,
                count: 1
              }));
              console.log(`[レシピ検索] Shapeless recipe found for ${itemName}: ingredients ${rawRecipe.ingredients}`);
            } else if (rawRecipe.inShape) {
              // shaped recipe
              const flatIngredients = rawRecipe.inShape.flat().filter(id => id !== null && id !== undefined);
              foundRecipe.delta = flatIngredients.map(ingredientId => ({
                id: ingredientId,
                count: 1
              }));
              console.log(`[レシピ検索] Shaped recipe found for ${itemName}: shape ${JSON.stringify(rawRecipe.inShape)}`);
            }
            
            console.log(`[レシピ検索] minecraft-data直接検索で${itemName}のレシピを発見`);
          }
        } catch (directError) {
          console.warn(`[レシピ検索] Direct minecraft-data search failed: ${directError.message}`);
        }
      }

      // Cache the result (success or failure)
      SkillLibrary._recipeCache.set(cacheKey, {
        recipe: foundRecipe,
        timestamp: Date.now()
      });

      if (!foundRecipe) {
        // Enhanced diagnostics for NO_RECIPE cases
        console.warn(`[レシピ検索] NO_RECIPE: ${itemName}(id:${itemId}) count:${count} table:${table ? 'table' : 'inventory'}`);
        
        // Store failed recipe search for diagnostics
        if (!SkillLibrary._failedRecipes) {
          SkillLibrary._failedRecipes = new Set();
        }
        SkillLibrary._failedRecipes.add(itemName);
      }
      
      return foundRecipe;
    } catch (error) {
      console.error(`[レシピ検索] エラー: ${error.message}`);
      return null;
    }
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

  // Handle out-of-sight blocks: approach and clear obstacles
  async handleOutOfSightBlock(bot, targetBlock, _lineOfSightResult) {
    try {
      console.log(`[視界外対応] ${targetBlock.name}が視界外です。接近と障害物除去を試みます`);

      // Step 1: Move closer to target (within 2 blocks)
      const approachResult = await this.approachTarget(bot, targetBlock.position);
      if (!approachResult.success) {
        console.log(`[視界外対応] 接近に失敗: ${approachResult.error}`);
        return { success: false, error: '接近失敗' };
      }

      // Step 2: Re-check line of sight after approaching
      const newLineOfSight = this.checkLineOfSight(bot, bot.entity.position, targetBlock.position);
      if (newLineOfSight.clear) {
        console.log('[視界外対応] 接近後に視界が確保されました');
        return { success: true, approach: true };
      }

      // Step 3: Clear obstacles if still blocked
      if (newLineOfSight.obstacleBlocks && newLineOfSight.obstacleBlocks.length > 0) {
        console.log(`[視界外対応] ${newLineOfSight.obstacleBlocks.length}個の障害物を除去します`);

        for (const obstacle of newLineOfSight.obstacleBlocks.slice(0, 3)) { // Limit to 3 blocks
          const obstacleDistance = bot.entity.position.distanceTo(obstacle.position);

          if (obstacleDistance <= 3.0) {
            console.log(`[視界外対応] 障害物 ${obstacle.name} を除去中...`);

            try {
              // Equip appropriate tool for obstacle
              await this.equipAppropriateToolForBlock(bot, obstacle.name);
              await bot.dig(obstacle);

              // Wait for obstacle removal
              await new Promise(resolve => setTimeout(resolve, 500));
              console.log(`[視界外対応] 障害物 ${obstacle.name} を除去しました`);
            } catch (digError) {
              console.log(`[視界外対応] 障害物除去失敗: ${digError.message}`);
              continue; // Try next obstacle
            }
          }
        }

        // Final check after obstacle removal
        const finalLineOfSight = this.checkLineOfSight(bot, bot.entity.position, targetBlock.position);
        if (finalLineOfSight.clear) {
          console.log('[視界外対応] 障害物除去後に視界が確保されました');
          return { success: true, obstaclesCleared: true };
        }
      }

      return { success: false, error: '視界確保に失敗' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Approach target block within 2 blocks
  async approachTarget(bot, targetPosition) {
    try {
      console.log(`[接近] 目標位置 ${targetPosition} に接近中...`);

      // Use pathfinder if available
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, 2.0);
        await bot.pathfinder.goto(goal);
        return { success: true };
      } else {
        console.log('[接近] Pathfinder利用不可、基本移動を使用');
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
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
    const { blockType, position, amount = 1 } = params;
    console.log(`[マイニング] ${blockType}を${amount}個採取開始`);

    let successfulMines = 0;
    const targetAmount = amount;
    let consecutiveFailures = 0;

    // Check initial inventory to track collected items
    const initialItems = this.countItemsInInventory(bot, blockType);
    console.log(`[マイニング] 開始時の${blockType}所持数: ${initialItems}個`);

    // Mining loop until we have enough items
    while (successfulMines < targetAmount) {
      let block;

      console.log(`[マイニング] 進捗: ${successfulMines}/${targetAmount}個採取済み`);

      if (position && successfulMines === 0) {
        // Only use position for first block
        block = bot.blockAt(position);
        if (!block || block.name !== blockType) {
          console.log(`[マイニング] 指定位置に${blockType}がありません: ${block ? block.name : 'null'}`);
          return { success: false, reason: 'TARGET_NOT_FOUND', details: { type: blockType, position } };
        }
      } else {
        // Stage 1: Find block nearby with progressive search
        block = this.findBlockWithProgressiveSearch(bot, blockType);
      }

      if (!block) {
        console.log(`[マイニング] ${blockType}が見つかりません。`);
        // Stage 2: Try mining downward to find stone/ore
        if (blockType === 'stone' || blockType === 'cobblestone' || blockType.includes('ore')) {
          const result = await this.digDownForStone(bot, blockType);
          if (result.success) {
            successfulMines++;
            continue; // Continue to next iteration
          }
        }
        return { success: false, reason: 'TARGET_NOT_FOUND', details: { type: blockType } };
      }

      // Check if block is reachable and within mining distance
      const reachabilityCheck = await this.checkBlockReachability(bot, block);
      if (!reachabilityCheck.canReach) {
        console.log(`[マイニング] ${block.name}は採掘可能範囲外: ${reachabilityCheck.reason}`);

        // Try to move closer to the block
        const moveResult = await this.moveToMiningPosition(bot, block);
        if (!moveResult.success) {
          console.log(`[マイニング] 移動失敗、次のブロックを探します: ${moveResult.error}`);
          consecutiveFailures++;
          if (consecutiveFailures > 3) {
            this.bot.chat('同じ場所でスタックしました。探索します。');
            return { success: false, reason: 'STUCK' };
          }
          continue; // Try next block instead of failing completely
        }

        // Re-check reachability after movement
        const recheckResult = await this.checkBlockReachability(bot, block);
        if (!recheckResult.canReach) {
          console.log(`[マイニング] 移動後も採掘不可、次のブロックを探します: ${recheckResult.reason}`);
          continue; // Try next block instead of failing completely
        }
      }

      // Additional strict line of sight check before mining
      const finalLineOfSight = this.checkLineOfSight(bot, bot.entity.position, block.position);
      if (!finalLineOfSight.clear) {
        console.log(`[マイニング] 採掘直前の視線チェック失敗: ${finalLineOfSight.obstacle}`);
        continue;
      }

      // Check inventory space before mining
      const inventoryCheck = this.checkInventorySpace(bot);
      if (!inventoryCheck.hasSpace) {
        console.log('[マイニング] インベントリが満杯です。整理を試みます...');
        const cleanupResult = await this.cleanupInventory(bot);
        if (!cleanupResult.success) {
          console.log('[マイニング] インベントリ整理失敗、次のブロックを探します');
          continue; // Try to continue rather than fail completely
        }
      }

      try {
        // Final distance check before mining - prevent mining from 3+ blocks away
        const finalDistance = bot.entity.position.distanceTo(block.position);
        if (finalDistance >= 3.0) {
          console.log(`[マイニング] 採掘距離が遠すぎます: ${finalDistance.toFixed(2)}ブロック (制限: 3.0ブロック未満)`);
          continue; // Try next block instead of failing completely
        }

        // Check if block requires a tool and equip appropriate tool
        const toolCheck = await this.equipAppropriateToolForBlock(bot, block);
        if (!toolCheck.success) {
          console.log(`[マイニング] ツール装備失敗: ${toolCheck.error}`);
          return { success: false, reason: toolCheck.reason || 'NO_TOOL', details: toolCheck.details };
        }

        const toolInfo = toolCheck.toolUsed ? ` - ツール: ${toolCheck.toolUsed}` : '';
        console.log(`[マイニング] ${block.position}で${block.name}を採掘中... (距離: ${finalDistance.toFixed(2)}ブロック)${toolInfo}`);

        // Store position for item collection
        const miningPosition = block.position.clone();

        // Check tool durability before mining if tool is used
        if (toolCheck.toolUsed) {
          const toolDurabilityCheck = this.checkToolDurability(bot);
          if (!toolDurabilityCheck.usable) {
            console.log(`[マイニング] ツール耐久度不足: ${toolDurabilityCheck.warning}`);
            // Try to craft or find a replacement tool before critical failure
            const replacementResult = await this.handleLowDurabilityTool(bot, toolCheck.toolUsed);
            if (!replacementResult.success) {
              console.log(`[マイニング] ツール交換失敗、次のブロックを探します: ${toolDurabilityCheck.warning}`);
              continue; // Try to continue with next block
            }
          }
        }

        await bot.dig(block);
        console.log(`[マイニング] ${block.name}を採掘完了`);

        // Wait for items to drop and settle
        await new Promise(resolve => setTimeout(resolve, 500));

        // Collect dropped items
        const collectionResult = await this.collectDroppedItems(bot, miningPosition);
        if (collectionResult.itemsCollected > 0) {
          console.log(`[マイニング] ${collectionResult.itemsCollected}個のアイテムを回収しました`);
          bot.chat(`${block.name}を採掘して${collectionResult.itemsCollected}個のアイテムを回収！ ⛏️`);
        } else {
          bot.chat(`${block.name}を採掘しました！ ⛏️`);
        }

        successfulMines++;
        console.log(`[マイニング] 採掘成功! 進捗: ${successfulMines}/${targetAmount}個`);

        // Check if we have enough items in inventory (more accurate than just counting mines)
        const currentItems = this.countItemsInInventory(bot, blockType);
        const itemsGained = currentItems - initialItems;

        if (itemsGained >= targetAmount) {
          console.log(`[マイニング] 目標達成! ${blockType}を${itemsGained}個取得しました`);
          break;
        }

        // Short wait before next mining attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.log(`[マイニング] 採掘に失敗: ${error.message}`);
        // Don't return here, continue to next iteration or exit loop
        continue;
      }
    } // End of while loop

    // Final result calculation
    const finalItems = this.countItemsInInventory(bot, blockType);
    const totalItemsGained = finalItems - initialItems;

    if (totalItemsGained >= targetAmount) {
      console.log(`[マイニング] タスク完了! ${blockType}を${totalItemsGained}個取得 (目標: ${targetAmount}個)`);
      bot.chat(`${blockType}採取完了! ${totalItemsGained}個取得しました！ ⛏️`);
      return {
        success: true,
        message: `${blockType}を${totalItemsGained}個採取しました`,
        itemsCollected: totalItemsGained,
        targetReached: true
      };
    } else {
      console.log(`[マイニング] 部分的成功: ${blockType}を${totalItemsGained}個取得 (目標: ${targetAmount}個)`);
      return {
        success: totalItemsGained > 0,
        message: `${blockType}を${totalItemsGained}個採取しました (目標未達成)`,
        itemsCollected: totalItemsGained,
        targetReached: false
      };
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

    // Start with close-range search and expand for better coverage
    const searchRadii = [16, 32, 64, 128]; // Extended search range

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
        // Check distance before returning the fallback block
        const distance = bot.entity.position.distanceTo(block.position);
        if (distance < 3.0) {
          console.log(`[マイニング] ${radius}ブロック範囲で代替発見: ${block.name} (距離: ${distance.toFixed(2)})`);
          return block;
        } else {
          console.log(`[マイニング] 代替ブロック発見したが距離が遠すぎます: ${distance.toFixed(2)}ブロック (制限: 3.0ブロック未満)`);
        }
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

      // Check distance (strict mining reach limit to prevent long-distance mining)
      const distance = botPos.distanceTo(blockPos);
      const maxMiningDistance = 3.0;

      if (distance >= maxMiningDistance) {
        return {
          canReach: false,
          reason: `距離が遠すぎます (${distance.toFixed(1)}m >= ${maxMiningDistance}m)`
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
      let firstObstacle = null;
      const obstacleBlocks = [];

      for (let i = 1; i < steps; i++) {
        const checkPos = from.clone().add(direction.clone().scale(i * 0.5));
        const block = bot.blockAt(checkPos);

        if (block && block.name !== 'air' && block.name !== 'water' &&
            !block.name.includes('grass') && !block.name.includes('flower')) {
          if (!firstObstacle) {
            firstObstacle = block;
          }
          // Collect obstacle blocks for potential removal
          if (block.name !== 'bedrock' && !block.name.includes('_ore') &&
              block.name !== 'obsidian') {
            obstacleBlocks.push(block);
          }
        }
      }

      if (firstObstacle) {
        return {
          clear: false,
          obstacle: firstObstacle.name,
          obstaclePosition: firstObstacle.position,
          obstacleBlocks,
          targetDistance: distance
        };
      }

      return { clear: true };
    } catch (error) {
      return {
        clear: false,
        obstacle: `チェックエラー: ${error.message}`
      };
    }
  }

  // Handle out-of-sight blocks: approach and clear obstacles
  async handleOutOfSightBlock(bot, targetBlock, _lineOfSightResult) {
    try {
      console.log(`[視界外対応] ${targetBlock.name}が視界外です。接近と障害物除去を試みます`);

      // Step 1: Move closer to target (within 2 blocks)
      const approachResult = await this.approachTarget(bot, targetBlock.position);
      if (!approachResult.success) {
        console.log(`[視界外対応] 接近に失敗: ${approachResult.error}`);
        return { success: false, error: '接近失敗' };
      }

      // Step 2: Re-check line of sight after approaching
      const newLineOfSight = this.checkLineOfSight(bot, bot.entity.position, targetBlock.position);
      if (newLineOfSight.clear) {
        console.log('[視界外対応] 接近後に視界が確保されました');
        return { success: true, approach: true };
      }

      // Step 3: Clear obstacles if still blocked
      if (newLineOfSight.obstacleBlocks && newLineOfSight.obstacleBlocks.length > 0) {
        console.log(`[視界外対応] ${newLineOfSight.obstacleBlocks.length}個の障害物を除去します`);

        for (const obstacle of newLineOfSight.obstacleBlocks.slice(0, 3)) { // Limit to 3 blocks
          const obstacleDistance = bot.entity.position.distanceTo(obstacle.position);

          if (obstacleDistance <= 3.0) {
            console.log(`[視界外対応] 障害物 ${obstacle.name} を除去中...`);

            try {
              // Equip appropriate tool for obstacle
              await this.equipAppropriateToolForBlock(bot, obstacle.name);
              await bot.dig(obstacle);

              // Wait for obstacle removal
              await new Promise(resolve => setTimeout(resolve, 500));
              console.log(`[視界外対応] 障害物 ${obstacle.name} を除去しました`);
            } catch (digError) {
              console.log(`[視界外対応] 障害物除去失敗: ${digError.message}`);
              continue; // Try next obstacle
            }
          }
        }

        // Final check after obstacle removal
        const finalLineOfSight = this.checkLineOfSight(bot, bot.entity.position, targetBlock.position);
        if (finalLineOfSight.clear) {
          console.log('[視界外対応] 障害物除去後に視界が確保されました');
          return { success: true, obstaclesCleared: true };
        }
      }

      return { success: false, error: '視界確保に失敗' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Approach target block within 2 blocks
  async approachTarget(bot, targetPosition) {
    try {
      console.log(`[接近] 目標位置 ${targetPosition} に接近中...`);

      // Use pathfinder if available
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, 2.0);
        await bot.pathfinder.goto(goal);
        return { success: true };
      } else {
        console.log('[接近] Pathfinder利用不可、基本移動を使用');
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Move bot to optimal mining position
  async moveToMiningPosition(bot, block) {
    try {
      const blockPos = block.position;

      console.log(`[マイニング] 採掘位置への移動開始: ${blockPos}`);

      // Move to within 2.5 blocks of the block for reliable mining
      console.log(`[マイニング] 採掘可能距離内(2.5ブロック)への移動を実行: ${blockPos}`);

      // Use pathfinder if available
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 2.5);
        await bot.pathfinder.goto(goal);
        return { success: true };
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
      const maxCollectionTime = 15000; // Increased to 15 seconds for thorough collection
      const startTime = Date.now();
      let lastItemCount = -1;
      let consecutiveNoItemChecks = 0;

      // Store initial inventory count for accurate tracking
      const initialInventoryCount = bot.inventory.items().length;
      console.log(`[マイニング] 回収前インベントリアイテム数: ${initialInventoryCount}`);

      // Wait longer initially for items to spawn and settle
      await new Promise(resolve => setTimeout(resolve, 1500));

      while (Date.now() - startTime < maxCollectionTime) {
        // Find nearby dropped items with expanded range for better detection
        const droppedItems = Object.values(bot.entities).filter(entity => {
          if (entity.name !== 'item' || !entity.position) return false;
          const distance = entity.position.distanceTo(miningPosition);
          return distance < 8; // Expanded range back to 8 blocks for better coverage
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

            if (distance > 2.0) { // Increased pickup distance threshold for better collection
              // Move closer to the item with improved positioning
              if (bot.pathfinder && typeof bot.pathfinder.setGoal === 'function') {
                const { goals } = require('mineflayer-pathfinder');
                const goal = new goals.GoalNear(
                  itemEntity.position.x,
                  itemEntity.position.y,
                  itemEntity.position.z,
                  1.5 // Adjusted goal distance for better pickup
                );
                bot.pathfinder.setGoal(goal);

                // Wait for movement with extended timeout
                const moveStartTime = Date.now();
                while (Date.now() - moveStartTime < 5000) {
                  const newDistance = bot.entity.position.distanceTo(itemEntity.position);
                  if (newDistance <= 2.0) {
                    console.log(`[マイニング] アイテムに接近完了: ${newDistance.toFixed(2)}ブロック`);
                    break;
                  }
                  await new Promise(resolve => setTimeout(resolve, 150));
                }
              } else {
                // Enhanced fallback: look and move towards item
                await bot.lookAt(itemEntity.position);
                bot.setControlState('forward', true);
                await new Promise(resolve => setTimeout(resolve, 800));
                bot.setControlState('forward', false);
              }
            }

            // Items are automatically collected when bot gets close enough
            // Extended wait time for reliable pickup
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify item was actually collected by checking if it still exists
            const stillExists = Object.values(bot.entities).some(entity =>
              entity.id === itemEntity.id && entity.name === 'item'
            );

            if (!stillExists) {
              itemsCollected++;
              console.log(`[マイニング] アイテム回収成功: ${itemsCollected}個目`);
            } else {
              console.log(`[マイニング] アイテム回収失敗: アイテムID ${itemEntity.id} がまだ存在`);
              // Try additional pickup attempts for stubborn items
              await bot.lookAt(itemEntity.position);
              await new Promise(resolve => setTimeout(resolve, 500));
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

  // Tool management for mining different block types
  async equipAppropriateToolForBlock(bot, block) {
    console.log(`[ツール管理] ${block.name}の採掘に適したツールを装備します`);
    const blockName = block.name;

    // Define which blocks require tools and what tools are needed
    const toolRequirements = {
      // Stone and cobblestone can be mined with any pickaxe, faster with better pickaxes
      stone: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],
      cobblestone: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],
      deepslate: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],

      // Iron ore requires stone pickaxe or better
      iron_ore: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
      deepslate_iron_ore: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],

      // Gold ore requires iron pickaxe or better
      gold_ore: ['iron_pickaxe', 'diamond_pickaxe'],
      deepslate_gold_ore: ['iron_pickaxe', 'diamond_pickaxe'],

      // Diamond ore requires iron pickaxe or better
      diamond_ore: ['iron_pickaxe', 'diamond_pickaxe'],
      deepslate_diamond_ore: ['iron_pickaxe', 'diamond_pickaxe'],

      // Coal ore can be mined with any pickaxe
      coal_ore: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],
      deepslate_coal_ore: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],

      // Copper ore can be mined with stone pickaxe or better
      copper_ore: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
      deepslate_copper_ore: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],

      // Lapis lazuli ore requires stone pickaxe or better
      lapis_ore: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
      deepslate_lapis_ore: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],

      // Redstone ore requires iron pickaxe or better
      redstone_ore: ['iron_pickaxe', 'diamond_pickaxe'],
      deepslate_redstone_ore: ['iron_pickaxe', 'diamond_pickaxe'],

      // Emerald ore requires iron pickaxe or better
      emerald_ore: ['iron_pickaxe', 'diamond_pickaxe'],
      deepslate_emerald_ore: ['iron_pickaxe', 'diamond_pickaxe'],

      // Obsidian requires diamond pickaxe
      obsidian: ['diamond_pickaxe'],

      // Nether ores
      nether_quartz_ore: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],
      nether_gold_ore: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'golden_pickaxe'],
      ancient_debris: ['diamond_pickaxe']
    };

    const requiredTools = toolRequirements[blockName];

    // If no specific tool is required, no tool needed (like dirt, grass, etc.)
    if (!requiredTools) {
      console.log(`[ツール管理] ${blockName}は素手で採掘可能`);
      return { success: true, toolUsed: null };
    }

    // Check current equipped item
    const currentItem = bot.heldItem;
    if (currentItem && requiredTools.includes(currentItem.name)) {
      console.log(`[ツール管理] 適切なツールが既に装備されています: ${currentItem.name}`);
      return { success: true, toolUsed: currentItem.name };
    }

    // Find the best available tool from inventory
    const availableTools = bot.inventory.items().filter(item =>
      item && item.name && requiredTools.includes(item.name)
    );

    if (availableTools.length === 0) {
      console.log(`[ツール管理] ${blockName}に必要なツールがありません: ${requiredTools.join(', ')}`);

      // Try to craft basic tools if we have materials
      const craftResult = await this.tryToCraftBasicPickaxe(bot);
      if (craftResult.success) {
        console.log(`[ツール管理] 基本ツールを作成しました: ${craftResult.toolName}`);
        // Try to equip the newly crafted tool
        const newTool = bot.inventory.items().find(item => item.name === craftResult.toolName);
        if (newTool) {
          await bot.equip(newTool, 'hand');
          return { success: true, toolUsed: newTool.name };
        }
      }

      return {
        success: false,
        reason: 'NO_TOOL',
        details: { required: requiredTools.join(', ') },
        error: `${blockName}に必要なツール (${requiredTools.join(', ')}) がありません`
      };
    }

    // Sort tools by preference (better tools first)
    const toolPriority = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe', 'golden_pickaxe'];
    availableTools.sort((a, b) => {
      const priorityA = toolPriority.indexOf(a.name);
      const priorityB = toolPriority.indexOf(b.name);
      return (priorityA === -1 ? 999 : priorityA) - (priorityB === -1 ? 999 : priorityB);
    });

    const bestTool = availableTools[0];

    try {
      await bot.equip(bestTool, 'hand');
      console.log(`[ツール管理] ${bestTool.name}を装備しました (${blockName}採掘用)`);
      return { success: true, toolUsed: bestTool.name };
    } catch (error) {
      console.log(`[ツール管理] ツール装備に失敗: ${error.message}`);
      return { success: false, error: `ツール装備失敗: ${error.message}` };
    }
  }

  // Try to craft a basic pickaxe if materials are available
  async tryToCraftBasicPickaxe(bot) {
    console.log('[ツール作成] 基本ピッケルの作成を試みます...');

    // Step 1: Ensure we have or can get a workbench
    const workbenchResult = await this.ensureWorkbench(bot);
    if (!workbenchResult.success) {
      console.log(`[ツール作成] 作業台の確保に失敗: ${workbenchResult.error}`);
      return { success: false, error: `作業台不足: ${workbenchResult.error}` };
    }

    const inventory = bot.inventory.items();

    // Check for sticks first
    const sticks = inventory.filter(item => item && item.name === 'stick');
    const totalSticks = sticks.reduce((sum, item) => sum + item.count, 0);

    if (totalSticks < 2) {
      console.log(`[ツール作成] スティック不足: 必要2本, 現在${totalSticks}本`);

      // Try to craft sticks from planks
      const planks = inventory.filter(item =>
        item && item.name && item.name.includes('_planks')
      );
      const totalPlanks = planks.reduce((sum, item) => sum + item.count, 0);

      if (totalPlanks >= 2) {
        console.log('[ツール作成] 板材からスティックを作成します...');
        try {
          const mcData = require('minecraft-data')(bot.version);
          const stickItem = mcData.itemsByName.stick;
          if (stickItem) {
            const stickRecipes = bot.recipesFor(stickItem.id, null, 1, null);
            if (stickRecipes.length > 0) {
              await bot.craft(stickRecipes[0], 1, null);
              console.log('[ツール作成] スティックを作成しました');
            }
          }
        } catch (error) {
          console.log(`[ツール作成] スティック作成に失敗: ${error.message}`);
        }
      } else {
        // No planks available, try to get wood
        console.log('[ツール作成] 板材不足、木材の収集を試みます...');
        const woodResult = await this.gatherWoodForCrafting(bot);
        if (woodResult.success) {
          console.log('[ツール作成] 木材収集成功、板材を作成します...');
          await this.craftPlanksFromLogs(bot);
          // Retry stick crafting after getting planks
          const planksAfterWood = bot.inventory.items().filter(item =>
            item && item.name && item.name.includes('_planks')
          );
          if (planksAfterWood.length > 0) {
            try {
              const mcData = require('minecraft-data')(bot.version);
              const stickItem = mcData.itemsByName.stick;
              if (stickItem) {
                const stickRecipes = bot.recipesFor(stickItem.id, null, 1, null);
                if (stickRecipes.length > 0) {
                  await bot.craft(stickRecipes[0], 1, null);
                  console.log('[ツール作成] 木材から板材経由でスティックを作成しました');
                }
              }
            } catch (error) {
              console.log(`[ツール作成] 板材からスティック作成失敗: ${error.message}`);
            }
          }
        }
      }
    }

    // Re-check sticks after potential crafting
    const updatedInventory = bot.inventory.items();
    const updatedSticks = updatedInventory.filter(item => item && item.name === 'stick');
    const updatedTotalSticks = updatedSticks.reduce((sum, item) => sum + item.count, 0);

    if (updatedTotalSticks < 2) {
      return { success: false, error: 'スティック不足でピッケル作成不可' };
    }

    // Now try to craft pickaxe using workbench
    const craftResult = await this.craftPickaxeWithWorkbench(bot);
    return craftResult;
  }

  // Check tool durability and warn if low
  checkToolDurability(bot) {
    const currentTool = bot.heldItem;

    if (!currentTool || !currentTool.nbt) {
      return { usable: true, durability: null };
    }

    // Extract durability from NBT data
    let damage = 0;
    let maxDurability = 0;

    try {
      if (currentTool.nbt && currentTool.nbt.value && currentTool.nbt.value.Damage) {
        damage = currentTool.nbt.value.Damage.value || 0;
      }

      // Get max durability from minecraft-data
      const mcData = require('minecraft-data')(bot.version);
      const itemData = mcData.items[currentTool.type];
      if (itemData && itemData.maxDurability) {
        maxDurability = itemData.maxDurability;
      }
    } catch (error) {
      console.log(`[ツール耐久度] 耐久度情報取得エラー: ${error.message}`);
      return { usable: true, durability: null };
    }

    if (maxDurability === 0) {
      return { usable: true, durability: null }; // Tool doesn't have durability
    }

    const remainingDurability = maxDurability - damage;
    const durabilityPercentage = (remainingDurability / maxDurability) * 100;

    const durabilityInfo = `${remainingDurability}/${maxDurability} (${durabilityPercentage.toFixed(1)}%)`;
    console.log(`[ツール耐久度] ${currentTool.name}: ${durabilityInfo}`);

    if (remainingDurability <= 1) {
      return {
        usable: false,
        durability: remainingDurability,
        warning: `${currentTool.name}が破損寸前です (残り${remainingDurability})`
      };
    } else if (durabilityPercentage < 20) {
      return {
        usable: true,
        durability: remainingDurability,
        warning: `${currentTool.name}の耐久度が低下しています (${durabilityPercentage.toFixed(1)}%)`
      };
    }

    return { usable: true, durability: remainingDurability };
  }

  // Handle low durability tool situation
  async handleLowDurabilityTool(bot, currentToolName) {
    console.log(`[ツール管理] ${currentToolName}の交換または修理を試みます`);

    // First, try to find a replacement tool of the same type
    const replacementTool = bot.inventory.items().find(item =>
      item && item.name === currentToolName && item !== bot.heldItem
    );

    if (replacementTool) {
      console.log(`[ツール管理] 代替ツールを発見: ${replacementTool.name}`);
      try {
        await bot.equip(replacementTool, 'hand');
        console.log(`[ツール管理] ${replacementTool.name}に交換しました`);
        return { success: true, action: 'replaced' };
      } catch (error) {
        console.log(`[ツール管理] ツール交換失敗: ${error.message}`);
      }
    }

    // If no replacement found, try to craft a new one
    console.log('[ツール管理] 代替ツールが見つかりません。新しいツールの作成を試みます');
    const craftResult = await this.tryToCraftBasicPickaxe(bot);

    if (craftResult.success) {
      console.log(`[ツール管理] 新しいツールを作成しました: ${craftResult.toolName}`);
      const newTool = bot.inventory.items().find(item => item.name === craftResult.toolName);
      if (newTool) {
        try {
          await bot.equip(newTool, 'hand');
          console.log(`[ツール管理] 新しいツール ${newTool.name} を装備しました`);
          return { success: true, action: 'crafted' };
        } catch (error) {
          console.log(`[ツール管理] 新ツール装備失敗: ${error.message}`);
        }
      }
    }

    return { success: false, error: 'ツール交換・作成に失敗しました' };
  }

  // Ensure a workbench is available for crafting
  async ensureWorkbench(bot) {
    console.log('[作業台管理] 作業台の確保を開始...');

    // Check if a workbench is already placed nearby
    const workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 8
    });

    if (workbench) {
      console.log(`[作業台管理] 近くに作業台を発見: ${workbench.position}`);
      return { success: true, workbench };
    }

    console.log('[作業台検索] 周辺に作業台が見つかりませんでした');

    // Check if we have a workbench in inventory
    const inventoryWorkbench = bot.inventory.items().find(item =>
      item && item.name === 'crafting_table'
    );

    if (inventoryWorkbench) {
      console.log('[作業台管理] インベントリに作業台があります。設置を試みます...');
      try {
        // Find a suitable place to put the workbench
        const placePosition = bot.entity.position.offset(1, 0, 0);
        await bot.equip(inventoryWorkbench, 'hand');
        await bot.placeBlock(bot.blockAt(placePosition), new Vec3(0, 1, 0));
        console.log(`[作業台管理] 作業台を設置しました: ${placePosition}`);
        return { success: true, workbench: bot.blockAt(placePosition) };
      } catch (error) {
        console.log(`[作業台管理] 作業台の設置に失敗: ${error.message}`);
        return { success: false, error: `作業台設置失敗: ${error.message}` };
      }
    }

    // If no workbench, try to craft one
    console.log('[作業台管理] 作業台の作成を試みます...');
    const craftResult = await this.craftWorkbench(bot);
    if (craftResult.success) {
      console.log('[作業台管理] 作業台の作成に成功しました');
      // Now try to place it
      const newWorkbench = bot.inventory.items().find(item =>
        item && item.name === 'crafting_table'
      );
      if (newWorkbench) {
        try {
          const placePosition = bot.entity.position.offset(1, 0, 0);
          await bot.equip(newWorkbench, 'hand');
          await bot.placeBlock(bot.blockAt(placePosition), new Vec3(0, 1, 0));
          console.log(`[作業台管理] 新しい作業台を設置しました: ${placePosition}`);
          return { success: true, workbench: bot.blockAt(placePosition) };
        } catch (error) {
          console.log(`[作業台管理] 新しい作業台の設置に失敗: ${error.message}`);
          return { success: false, error: `新作業台設置失敗: ${error.message}` };
        }
      }
    }

    return { success: false, error: '作業台の確保に失敗しました' };
  }

  // Craft a workbench if materials are available
  async craftWorkbench(bot) {
    console.log('[作業台作成] 作業台のクラフトを開始...');

    // Check for planks
    const planks = bot.inventory.items().filter(item =>
      item && item.name && item.name.includes('_planks')
    );
    const totalPlanks = planks.reduce((sum, item) => sum + item.count, 0);

    if (totalPlanks < 4) {
      console.log(`[作業台作成] 板材不足: 必要4枚, 現在${totalPlanks}枚`);
      // Try to get wood to make planks
      const woodResult = await this.gatherWoodForCrafting(bot);
      if (woodResult.success) {
        console.log('[作業台作成] 木材収集成功、板材を作成します...');
        await this.craftPlanksFromLogs(bot);
      } else {
        return { success: false, error: '板材不足で作業台作成不可' };
      }
    }

    // Re-check planks after potential crafting
    const updatedPlanks = bot.inventory.items().filter(item =>
      item && item.name && item.name.includes('_planks')
    );
    const updatedTotalPlanks = updatedPlanks.reduce((sum, item) => sum + item.count, 0);

    if (updatedTotalPlanks < 4) {
      return { success: false, error: '板材不足で作業台作成不可' };
    }

    try {
      const mcData = require('minecraft-data')(bot.version);
      const workbenchItem = mcData.itemsByName.crafting_table;
      if (workbenchItem) {
        const workbenchRecipes = bot.recipesFor(workbenchItem.id, null, 1, null);
        if (workbenchRecipes.length > 0) {
          await bot.craft(workbenchRecipes[0], 1, null);
          console.log('[作業台作成] 作業台を作成しました');
          return { success: true };
        }
      }
      return { success: false, error: '作業台のレシピが見つかりません' };
    } catch (error) {
      console.log(`[作業台作成] 作業台作成に失敗: ${error.message}`);
      return { success: false, error: `作業台作成失敗: ${error.message}` };
    }
  }

  // Gather wood for crafting purposes
  async gatherWoodForCrafting(bot) {
    console.log('[木材収集] クラフト用木材の収集を開始...');

    // Find a nearby tree
    const tree = bot.findBlock({
      matching: (block) => block && block.name.includes('_log'),
      maxDistance: 64
    });

    if (!tree) {
      console.log('[木材収集] 近くに木が見つかりません');
      return { success: false, error: '木が見つかりません' };
    }

    // Mine the tree
    try {
      await bot.dig(tree);
      console.log(`[木材収集] ${tree.name}を収集しました`);
      return { success: true };
    } catch (error) {
      console.log(`[木材収集] 木材収集に失敗: ${error.message}`);
      return { success: false, error: `木材収集失敗: ${error.message}` };
    }
  }

  // Craft planks from logs
  async craftPlanksFromLogs(bot) {
    const logs = bot.inventory.items().filter(item =>
      item && item.name && item.name.includes('_log')
    );

    if (logs.length === 0) {
      return;
    }

    try {
      const mcData = require('minecraft-data')(bot.version);
      const plankItem = mcData.itemsByName.oak_planks; // Use a common plank type
      if (plankItem) {
        const plankRecipes = bot.recipesFor(plankItem.id, null, 1, null);
        if (plankRecipes.length > 0) {
          await bot.craft(plankRecipes[0], logs[0].count, null);
          console.log(`[板材作成] ${logs[0].count}個の丸太から板材を作成しました`);
        }
      }
    } catch (error) {
      console.log(`[板材作成] 板材作成に失敗: ${error.message}`);
    }
  }

  // Craft a pickaxe using a workbench
  async craftPickaxeWithWorkbench(bot) {
    const workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 8
    });

    if (!workbench) {
      return { success: false, error: '作業台が見つかりません' };
    }

    try {
      const mcData = require('minecraft-data')(bot.version);
      const pickaxeItem = mcData.itemsByName.wooden_pickaxe;
      if (pickaxeItem) {
        const pickaxeRecipes = bot.recipesFor(pickaxeItem.id, null, 1, workbench);
        if (pickaxeRecipes.length > 0) {
          await bot.craft(pickaxeRecipes[0], 1, workbench);
          console.log('[ツール作成] 木製のピッケルを作成しました');
          return { success: true, toolName: 'wooden_pickaxe' };
        }
      }
      return { success: false, error: 'ピッケルのレシピが見つかりません' };
    } catch (error) {
      console.log(`[ツール作成] ピッケル作成に失敗: ${error.message}`);
      return { success: false, error: `ピッケル作成失敗: ${error.message}` };
    }
  }

  // Count items in inventory
  countItemsInInventory(bot, itemName) {
    const items = bot.inventory.items().filter(item =>
      item && item.name && item.name.includes(itemName)
    );
    return items.reduce((sum, item) => sum + item.count, 0);
  }
}

class PlaceBlockSkill extends Skill {
  constructor() {
    super('place_block', 'Place a block at a specific position');
  }

  async execute(bot, params) {
    const { blockType, position } = params;
    const block = bot.inventory.items().find(item => item.name === blockType);

    if (!block) {
      throw new Error(`Block ${blockType} not found in inventory`);
    }

    try {
      await bot.equip(block, 'hand');
      await bot.placeBlock(bot.blockAt(position), new Vec3(0, 1, 0));
      return { success: true };
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
    const { target } = params;
    const entity = Object.values(bot.entities).find(e => e.name === target);

    if (!entity) {
      throw new Error(`Entity ${target} not found`);
    }

    try {
      await bot.attack(entity);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Advanced Movement Skills
class SmartJumpSkill extends Skill {
  constructor() {
    super('smart_jump', 'Jump over obstacles intelligently');
  }

  async execute(bot, _params) {
    try {
      const blockInFront = bot.blockAt(bot.entity.position.offset(0, 0, -1));
      if (blockInFront && blockInFront.name !== 'air') {
        bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 200));
        bot.setControlState('jump', false);
        return { success: true };
      }
      return { success: false, error: 'No obstacle to jump over' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class EscapeWaterSkill extends Skill {
  constructor() {
    super('escape_water', 'Escape from water');
  }

  async execute(bot, _params) {
    try {
      const blockAtFeet = bot.blockAt(bot.entity.position);
      if (blockAtFeet && blockAtFeet.name === 'water') {
        bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        bot.setControlState('jump', false);
        return { success: true };
      }
      return { success: false, error: 'Not in water' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class NavigateTerrainSkill extends Skill {
  constructor() {
    super('navigate_terrain', 'Navigate complex terrain');
  }

  async execute(bot, params) {
    const { destination } = params;
    try {
      if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        bot.pathfinder.setMovements(movements);
      }
      const goal = new goals.GoalBlock(destination.x, destination.y, destination.z);
      await bot.pathfinder.goto(goal);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Survival Skills
class SimpleGatherWoodSkill extends Skill {
  constructor() {
    super('gather_wood', 'Gather wood from nearby trees');
  }

  async execute(bot, params) {
    const { amount = 1 } = params;
    let collected = 0;

    try {
      for (let i = 0; i < amount; i++) {
        const tree = bot.findBlock({
          matching: (block) => block && block.name.includes('_log'),
          maxDistance: 64
        });

        if (!tree) {
          return { success: false, error: 'No new trees found nearby' };
        }
        if (!bot.pathfinder) {
          return { success: false, error: 'Pathfinder not available' };
        }

        await bot.pathfinder.goto(new goals.GoalNear(tree.position.x, tree.position.y, tree.position.z, 1));
        await bot.dig(tree);
        collected++;
      }
      return { success: true, collected };
    } catch (error) {
      return { success: false, error: error.message, collected };
    }
  }
}

class SimpleFindFoodSkill extends Skill {
  constructor() {
    super('find_food', 'Find and gather food from animals');
  }

  async execute(bot, _params) {
    try {
      // Check current food level
      const currentFood = bot.food;
      console.log(`[食料確保] 現在の食料レベル: ${currentFood}/20`);

      if (currentFood >= 20) {
        console.log('[食料確保] 食料レベルは十分です');
        bot.chat('食料は満タンです！');
        return { success: true, message: '食料は十分です' };
      }

      // Find nearby animals
      const animals = ['cow', 'pig', 'sheep', 'chicken'];
      const target = bot.nearestEntity(entity =>
        animals.includes(entity.name) && bot.entity.position.distanceTo(entity.position) < 32
      );

      if (!target) {
        console.log('[食料確保] 近くに食料源が見つかりません');
        bot.chat('近くに食料が見つかりません...');
        return { success: false, error: '近くに食料源が見つかりません' };
      }

      console.log(`[食料確保] ${target.name}を発見、攻撃します`);
      bot.chat(`${target.name}を発見！食料確保！`);

      // Attack the animal
      await bot.attack(target);

      // Wait for drops
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Collect drops
      const droppedItems = Object.values(bot.entities).filter(e =>
        e.name === 'item' && e.position.distanceTo(target.position) < 4
      );

      for (const item of droppedItems) {
        await bot.pathfinder.goto(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1));
      }

      console.log('[食料確保] 食料を確保しました');
      bot.chat('食料を確保しました！ 🍖');
      return { success: true, message: '食料を確保しました' };
    } catch (error) {
      console.log(`[食料確保] 食料確保に失敗: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// Crafting Skills
class CraftToolsSkill extends Skill {
  constructor() {
    super('craft_tools', 'Crafts specified tools.');
  }

  async execute(bot, params) {
    const { tools } = params;
    const mcData = require('minecraft-data')(bot.version);

    console.log(`[ツールスキル] ${tools.join(', ')}の作成を開始します...`);

    // Ensure we have a crafting table nearby or in inventory
    const workbenchSkill = new CraftWorkbenchSkill();
    const workbenchResult = await workbenchSkill.ensureWorkbench(bot);

    if (!workbenchResult.success) {
      console.log(`[ツールスキル] 作業台の確保に失敗: ${workbenchResult.error}`);
      return { success: false, reason: 'CRAFTING_TABLE_MISSING', details: { error: workbenchResult.error } };
    }

    const craftingTable = workbenchResult.workbench;

    const craftedTools = [];
    for (const toolName of tools) {
      console.log(`[ツールスキル] ${toolName}の作成を試みます`);

      const toolItem = mcData.itemsByName[toolName];
      if (!toolItem) {
        console.log(`[ツールスキル] 不明なツール: ${toolName}`);
        continue;
      }

      // Check if tool already exists in inventory
      if (InventoryUtils.hasItem(bot, toolName)) {
        console.log(`[ツールスキル] ${toolName}は既にインベントリにあります`);
        craftedTools.push(toolName);
        continue;
      }

      const recipe = bot.recipesFor(toolItem.id, null, 1, craftingTable)[0];
      if (!recipe) {
        console.log(`[ツールスキル] ${toolName}のレシピが見つかりません`);
        bot.chat(`${toolName}のレシピが見つかりません`);
        return {
          success: false,
          reason: 'NO_RECIPE',
          details: { tool: toolName, message: 'レシピが見つかりません' }
        };
      }

      // Check for sufficient materials now that we have a valid recipe
      const missingMaterials = this.getMissingMaterialsForRecipe(bot, toolItem.id, craftingTable);
      if (missingMaterials && missingMaterials.length > 0) {
        console.log(`[ツールスキル] ${toolName}の材料が不足しています。不足: ${missingMaterials.map(m => `${m.item} (${m.needed}個)`).join(', ')}`);
        bot.chat(`${toolName}の材料が不足しています`);
        return {
          success: false,
          reason: 'INSUFFICIENT_MATERIALS',
          details: { missing: missingMaterials, tool: toolName }
        };
      }

      try {
        console.log(`[ツールスキル] ${toolName}をクラフト中...`);
        await bot.craft(recipe, 1, craftingTable);
        console.log(`[ツールスキル] ${toolName}をクラフトしました！`);
        bot.chat(`${toolName}をクラフトしました！ 🔨`);
        craftedTools.push(toolName);
      } catch (error) {
        console.log(`[ツールスキル] ${toolName}のクラフトに失敗: ${error.message}`);
        return { success: false, error: `Failed to craft ${toolName}: ${error.message}` };
      }
    }

    if (craftedTools.length === tools.length) {
      console.log('[ツールスキル] 全てのツールを正常にクラフトしました。');
      return { success: true, crafted: craftedTools };
    } else if (craftedTools.length > 0) {
      console.log('[ツールスキル] 一部のツールをクラフトしました。');
      return { success: true, crafted: craftedTools, message: '一部のツールをクラフトしました' };
    } else {
      console.log('[ツールスキル] ツールをクラフトできませんでした。');
      return { success: false, error: 'ツールをクラフトできませんでした' };
    }
  }

  getMissingMaterialsForRecipe(bot, itemId, craftingTable) {
    const mcData = require('minecraft-data')(bot.version);
    const recipes = bot.recipesFor(itemId, null, 1, craftingTable);
    if (recipes.length === 0) return [{ item: 'unknown', needed: 1, reason: 'No recipe' }];

    const recipe = recipes[0];
    const missing = [];

    for (const ingredient of recipe.ingredients) {
      const needed = ingredient.count;
      const available = bot.inventory.count(ingredient.id);
      if (available < needed) {
        const itemName = mcData.items[ingredient.id]?.name || `item_${ingredient.id}`;
        missing.push({ item: itemName, needed: needed - available, have: available });
      }
    }
    return missing;
  }

  async ensureWorkbench(bot) {
    console.log('[ツールスキル] 作業台の確保を開始...');

    // Check if a workbench is already placed nearby
    const workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 8
    });

    if (workbench) {
      console.log(`[ツールスキル] 近くに作業台を発見: ${workbench.position}`);
      return { success: true, workbench };
    }

    // Check if we have a crafting table in inventory
    if (InventoryUtils.hasItem(bot, 'crafting_table', 1, true)) {
      console.log('[ツールスキル] インベントリに作業台があります。設置を試みます...');
      const placeResult = await this.placeCraftingTable(bot);
      if (placeResult.success) {
        return { success: true, workbench: placeResult.workbench };
      } else {
        console.log(`[ツールスキル] 作業台の設置に失敗: ${placeResult.error}`);
        return { success: false, error: `作業台の設置に失敗: ${placeResult.error}` };
      }
    }

    // If not, try to craft one
    console.log('[ツールスキル] 作業台がありません。作成を試みます...');
    const craftWorkbenchSkill = new CraftWorkbenchSkill();
    const craftResult = await craftWorkbenchSkill.execute(bot, {});

    if (craftResult.success) {
      console.log('[ツールスキル] 作業台の作成に成功しました。設置を試みます...');
      const placeResult = await this.placeCraftingTable(bot);
      if (placeResult.success) {
        return { success: true, workbench: placeResult.workbench };
      } else {
        console.log(`[ツールスキル] 作成した作業台の設置に失敗: ${placeResult.error}`);
        return { success: false, error: `作成した作業台の設置に失敗: ${placeResult.error}` };
      }
    } else {
      console.log(`[ツールスキル] 作業台の作成に失敗: ${craftResult.error}`);
      return { success: false, error: `作業台の作成に失敗: ${craftResult.error}` };
    }
  }

  async placeCraftingTable(bot) {
    console.log('[ツールスキル] 作業台の設置場所を探しています...');
    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block below bot

    if (!refBlock) {
      console.log('[ツールスキル] 設置基準ブロックが見つかりません。');
      return { success: false, error: '設置基準ブロックが見つかりません' };
    }

    try {
      const craftingTableItem = bot.inventory.items().find(item => item && item.name === 'crafting_table');
      if (!craftingTableItem) {
        console.log('[ツールスキル] インベントリに作業台がありません。');
        return { success: false, error: 'インベントリに作業台がありません' };
      }

      await bot.equip(craftingTableItem, 'hand');
      await bot.placeBlock(refBlock, new Vec3(0, 1, 0)); // Place on top of the block below

      // Verify placement
      const placedBlock = bot.blockAt(refBlock.position.offset(0, 1, 0));
      if (placedBlock && placedBlock.name === 'crafting_table') {
        console.log('[ツールスキル] 作業台を正常に設置しました！');
        return { success: true, workbench: placedBlock };
      } else {
        console.log('[ツールスキル] 作業台の設置を確認できませんでした。');
        return { success: false, error: '作業台の設置を確認できませんでした' };
      }
    } catch (error) {
      console.log(`[ツールスキル] 作業台の設置中にエラー: ${error.message}`);
      return { success: false, error: `作業台の設置中にエラー: ${error.message}` };
    }
  }
}

class CraftWorkbenchSkill extends Skill {
  constructor() {
    super('craft_workbench', 'Crafts a crafting table.');
  }

  async execute(bot, _params) {
    console.log('[作業台スキル] 作業台の作成を開始します...');

    const mcData = require('minecraft-data')(bot.version);
    const workbenchItem = mcData.itemsByName.crafting_table;
    if (!workbenchItem) {
      console.log('[作業台スキル] クラフトテーブルのアイテムデータが見つかりません');
      return { success: false, error: 'クラフトテーブルのアイテムデータが見つかりません' };
    }

    // Check if we already have a crafting table in inventory
    if (InventoryUtils.hasItem(bot, 'crafting_table', 1, true)) {
      console.log('[作業台スキル] インベントリに作業台が既にあります');
      return { success: true, message: 'インベントリに作業台が既にあります' };
    }

    // Check for planks
    const planksCount = InventoryUtils.getAvailablePlanks(bot);
    console.log(`[作業台スキル] 利用可能な板材: ${planksCount}個`);
    if (planksCount < 4) {
      console.log('[作業台スキル] 板材が不足しています。木材収集を試みます...');
      const gatherWoodSkill = new SimpleGatherWoodSkill();
      const gatherResult = await gatherWoodSkill.execute(bot, { amount: 1 }); // Gather at least 1 wood
      if (!gatherResult.success) {
        return { success: false, reason: 'INSUFFICIENT_MATERIALS', details: { missing: [{ item: 'wood', needed: 1 }] } };
      }
      // After gathering wood, try to craft planks
      await this.craftPlanksFromLogs(bot);
      const updatedPlanksCount = InventoryUtils.getAvailablePlanks(bot);
      if (updatedPlanksCount < 4) {
        console.log('[作業台スキル] 木材を収集しましたが、まだ板材が不足しています');
        return { success: false, reason: 'INSUFFICIENT_MATERIALS', details: { missing: [{ item: 'planks', needed: 4 - updatedPlanksCount }] } };
      }
    }

    // Find recipe for crafting table (inventory crafting, no table needed)
    const recipe = SkillLibrary.getRecipeSafe(bot, workbenchItem.id, 1, null);
    if (!recipe) {
      console.log('[作業台スキル] 作業台のレシピが見つかりません');
      bot.chat('作業台のレシピが見つかりません');
      return {
        success: false,
        reason: 'NO_RECIPE',
        details: { item: 'crafting_table', message: '作業台のレシピが見つかりません' }
      };
    }

    console.log('[作業台スキル] 作業台をクラフト中...');
    try {
      await bot.craft(recipe, 1, null); // Craft in inventory
      console.log('[作業台スキル] 作業台をクラフトしました！');
      bot.chat('作業台をクラフトしました！');
      return { success: true, crafted: 'crafting_table' };
    } catch (error) {
      console.log(`[作業台スキル] 作業台のクラフトに失敗: ${error.message}`);
      return { success: false, error: `作業台のクラフトに失敗: ${error.message}` };
    }
  }

  async craftPlanksFromLogs(bot) {
    const mcData = require('minecraft-data')(bot.version);
    const oakPlanks = mcData.itemsByName.oak_planks;
    if (!oakPlanks) return;

    const logCount = InventoryUtils.getWoodCount(bot);
    if (logCount === 0) return;

    console.log(`[作業台スキル] ${logCount}個の原木から板材を作成中...`);
    const recipe = bot.recipesFor(oakPlanks.id, null, 1, null)[0];
    if (!recipe) {
      console.log('[作業台スキル] 板材のレシピが見つかりません');
      return;
    }

    try {
      await bot.craft(recipe, logCount, null); // Craft all logs into planks
      console.log('[作業台スキル] 原木から板材を作成しました。');
    } catch (error) {
      console.log(`[作業台スキル] 板材作成失敗: ${error.message}`);
    }
  }
}

class CraftFurnaceSkill extends Skill {
  constructor() {
    super('craft_furnace', 'Craft a furnace');
  }

  async execute(bot, _params) {
    try {
      // Check for cobblestone
      const cobblestone = bot.inventory.items().find(item => item.name === 'cobblestone');
      if (!cobblestone || cobblestone.count < 8) {
        return { success: false, error: 'COBBLESTONE_MISSING' };
      }

      // Ensure we have a workbench
      const workbench = bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 8
      });

      if (!workbench) {
        return { success: false, error: 'CRAFTING_TABLE_MISSING' };
      }

      // Get recipe
      const mcData = require('minecraft-data')(bot.version);
      const item = mcData.itemsByName.furnace;
      const recipe = bot.recipesFor(item.id, null, 1, workbench)[0];
      if (!recipe) {
        console.log('[かまどスキル] かまどのレシピが見つかりません');
        bot.chat('かまどのレシピが見つかりません');
        return {
          success: false,
          reason: 'NO_RECIPE',
          details: { item: 'furnace', message: 'かまどのレシピが見つかりません' }
        };
      }

      // Craft the furnace
      await bot.craft(recipe, 1, workbench);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class PlaceBlocksSkill extends Skill {
  constructor() {
    super('place_blocks', 'Place multiple blocks in a pattern');
  }

  async execute(bot, params) {
    const { pattern, material } = params; // pattern is an array of {x, y, z} offsets

    try {
      const startPos = bot.entity.position.floored();
      const blockToPlace = bot.inventory.items().find(item => item.name === material);

      if (!blockToPlace) {
        return { success: false, error: `Material ${material} not found` };
      }

      await bot.equip(blockToPlace, 'hand');

      for (const offset of pattern) {
        const pos = startPos.offset(offset.x, offset.y, offset.z);
        const referenceBlock = bot.blockAt(pos.offset(0, -1, 0));
        if (referenceBlock) {
          await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
          await new Promise(resolve => setTimeout(resolve, 200)); // Wait between placements
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Explore skill with enhanced logic
class ExploreSkill extends Skill {
  constructor() {
    super('explore', 'Explore the area to find resources or points of interest');
  }

  async execute(bot, params) {
    const { objective = 'general', direction = 'random', distance = 32 } = params;
    console.log(`[探索スキル] ${objective}目的で${direction}方向に${distance}ブロック探索開始`);

    try {
      // Determine target position
      const currentPos = bot.entity.position;
      let targetPos;

      if (direction === 'random') {
        const angle = Math.random() * 2 * Math.PI;
        targetPos = currentPos.offset(
          Math.cos(angle) * distance,
          0,
          Math.sin(angle) * distance
        );
      } else {
        // Implement other directions if needed (e.g., 'north', 'south')
        targetPos = currentPos.offset(0, 0, -distance); // Default to north
      }

      console.log(`[探索スキル] (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})を探索中...`);

      // Move to target position
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        console.log('[探索スキル] パスファインディングで目標へ移動中...');
        const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
        await bot.pathfinder.goto(goal);
      } else {
        console.log('[探索スキル] 基本移動で目標へ移動中...');
        await this.basicMove(bot, targetPos);
      }

      // Scan for points of interest after reaching destination
      console.log('[探索スキル] 周辺スキャン中...');
      const scanResult = this.scanForInterestPoints(bot, objective);

      if (scanResult.found.length > 0) {
        console.log(`[探索スキル] ${scanResult.found.length}個の興味深い地点を発見`);
        return { success: true, result: scanResult };
      } else {
        console.log('[探索スキル] 興味深い地点は見つかりませんでした');
        return { success: true, message: '探索完了、興味深い地点なし' };
      }
    } catch (error) {
      console.log('[探索スキル] 移動失敗、近場で探索続行');
      try {
        const scanResult = this.scanForInterestPoints(bot, objective);
        if (scanResult.found.length > 0) {
          return { success: true, result: scanResult, message: '移動失敗したが、近場で発見' };
        }
      } catch (scanError) {
        console.log(`[探索スキル] スキャンエラー: ${scanError.message}`);
        return { success: false, error: `探索スキャンエラー: ${scanError.message}` };
      }
      return { success: false, error: `探索移動エラー: ${error.message}` };
    }
  }

  async basicMove(bot, targetPos) {
    const currentPos = bot.entity.position;
    const distance = currentPos.distanceTo(targetPos);
    const steps = Math.ceil(distance);

    for (let i = 0; i < steps; i++) {
      await bot.lookAt(targetPos);
      bot.setControlState('forward', true);
      await new Promise(resolve => setTimeout(resolve, 200));
      bot.setControlState('forward', false);
    }
  }

  scanForInterestPoints(bot, objective) {
    const interestPoints = {
      ores: [],
      trees: [],
      animals: [],
      structures: [],
      water: [],
      lava: []
    };

    // Scan for ores
    const oreBlocks = bot.findBlocks({
      matching: (block) => block && block.name.includes('_ore'),
      maxDistance: 16,
      count: 10
    });
    interestPoints.ores = oreBlocks.map(pos => ({ type: 'ore', position: pos }));

    // Scan for trees
    const treeBlocks = bot.findBlocks({
      matching: (block) => block && block.name.includes('_log'),
      maxDistance: 32,
      count: 10
    });
    interestPoints.trees = treeBlocks.map(pos => ({ type: 'tree', position: pos }));

    // Scan for animals
    const animalEntities = bot.findPlayers(entity =>
      ['cow', 'pig', 'sheep', 'chicken'].includes(entity.name) && entity.position.distanceTo(bot.entity.position) < 10
    );
    interestPoints.animals = animalEntities.map(e => ({ type: 'animal', name: e.name, position: e.position }));

    const structureBlocks = bot.findBlocks({
      matching: (block) => block && (block.name.includes('planks') || block.name.includes('cobblestone')),
      maxDistance: 64,
      count: 20
    });
    // Simple logic: if we find a cluster of man-made blocks, it might be a structure
    if (structureBlocks.length > 10) {
      interestPoints.structures.push({ type: 'structure_clue', position: structureBlocks[0] });
    }

    // Scan for water and lava
    const waterBlocks = bot.findBlocks({ matching: (b) => b && b.name === 'water', maxDistance: 16, count: 5 });
    interestPoints.water = waterBlocks.map(pos => ({ type: 'water', position: pos }));

    const lavaBlocks = bot.findBlocks({ matching: (b) => b && b.name === 'lava', maxDistance: 16, count: 5 });
    interestPoints.lava = lavaBlocks.map(pos => ({ type: 'lava', position: pos }));

    // Filter based on objective
    let found = [];
    switch (objective) {
    case 'mining':
      found = interestPoints.ores;
      break;
    case 'wood':
      found = interestPoints.trees;
      break;
    case 'food':
      found = interestPoints.animals;
      break;
    case 'shelter':
      found = interestPoints.structures;
      break;
    default: // general
      found = [
        ...interestPoints.ores,
        ...interestPoints.trees,
        ...interestPoints.animals,
        ...interestPoints.structures
      ];
    }

    return {
      found,
      details: interestPoints
    };
  }
}

module.exports = {
  SkillLibrary,
  Skill,
  MoveToSkill,
  FollowSkill,
  MineBlockSkill,
  PlaceBlockSkill,
  AttackEntitySkill,
  SmartJumpSkill,
  EscapeWaterSkill,
  NavigateTerrainSkill,
  SimpleGatherWoodSkill,
  SimpleFindFoodSkill,
  CraftToolsSkill,
  CraftWorkbenchSkill,
  CraftFurnaceSkill,
  PlaceBlocksSkill,
  ExploreSkill
};