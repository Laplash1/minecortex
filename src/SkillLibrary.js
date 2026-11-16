const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const InventoryUtils = require('./InventoryUtils');
const BasicSkills = require('./skills/BasicSkills');
const { Logger } = require('./utils/Logger');
const { moveToPosition, moveToEntity } = require('./utils/MovementUtils');

class SkillLibrary {
  constructor(pathfindingCache = null) {
    this.skills = new Map();
    this.recipeCache = new Map();
    this.aliasConfig = null;
    this.pathfindingCache = pathfindingCache;
    this.logger = Logger.createLogger('SkillLibrary');
  }

  static logger = Logger.createLogger('SkillLibrary-Static');

  /**
   * Load item alias configuration asynchronously
   */
  static async loadAliasConfig() {
    if (!SkillLibrary._aliasConfig) {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const configPath = path.join(__dirname, '..', 'config', 'item-alias.json');
        const configData = await fs.readFile(configPath, 'utf8');
        SkillLibrary._aliasConfig = JSON.parse(configData);
      } catch (error) {
        SkillLibrary.logger.warn(`[レシピ検索] Alias config load failed: ${error.message}`);
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
  static async getRecipeSafe(bot, itemIdentifier, count = 1, table = null) {
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
        SkillLibrary.logger.error(`[レシピ検索] minecraft-data for version ${bot.version} not found`);
        return null;
      }

      // Log version info on first call
      if (!SkillLibrary._versionLogged) {
        SkillLibrary.logger.log(`[RecipeDebug] Bot version: ${bot.version}, mcData version: ${mcData.version?.minecraftVersion || 'unknown'}`);
        SkillLibrary._versionLogged = true;
      }

      // Load alias configuration
      const aliasConfig = await SkillLibrary.loadAliasConfig();

      // Handle both item ID and item name with alias support
      let itemId = itemIdentifier;
      let itemName = 'unknown';

      if (typeof itemIdentifier === 'string') {
        // Check for aliases
        let resolvedName = itemIdentifier;
        if (aliasConfig.common_aliases[itemIdentifier]) {
          resolvedName = aliasConfig.common_aliases[itemIdentifier];
          SkillLibrary.logger.log(`[レシピ検索] Using alias: ${itemIdentifier} -> ${resolvedName}`);
        }

        const item = mcData.itemsByName[resolvedName];
        if (!item) {
          SkillLibrary.logger.warn(`[レシピ検索] Item '${resolvedName}' not found in minecraft-data`);
          return null;
        }
        itemId = item.id;
        itemName = item.name;
      } else {
        itemName = mcData.items[itemId]?.name || 'unknown';
      }

      // Special handling for wooden tools: try to find a recipe with available wood
      if (itemName && itemName.includes('wooden_')) {
        const optimizedRecipe = await SkillLibrary.getOptimizedWoodenToolRecipe(bot, itemName, count, table);
        if (optimizedRecipe) {
          this.logger.log(`[レシピ検索] 木材最適化レシピを使用: ${itemName}`);
          // Cache the optimized recipe
          SkillLibrary._recipeCache.set(cacheKey, {
            recipe: optimizedRecipe,
            timestamp: Date.now()
          });
          return optimizedRecipe;
        }
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
              this.logger.log(`[レシピ検索] フォールバック戦略${i}で${itemName}のレシピを発見`);
            }
            break;
          }
        } catch (error) {
          if (i === 0) {
            this.logger.warn(`[レシピ検索] Primary search failed for ${itemName}: ${error.message}`);
          }
        }
      }

      // minecraft-data 3.90.0+ direct recipe search fallback
      if (!foundRecipe && mcData.recipes) {
        try {
          this.logger.log(`[レシピ検索] minecraft-data直接検索を試行: ${itemName}(id:${itemId})`);

          // minecraft-data 3.90.0の新構造: data.recipes[itemId] が配列
          const directRecipes = mcData.recipes[itemId];
          if (directRecipes && Array.isArray(directRecipes) && directRecipes.length > 0) {
            // 最初のレシピを変換
            const rawRecipe = directRecipes[0];

            // Mineflayer形式に変換 - resultプロパティを確実に設定
            foundRecipe = {
              id: itemId, // レシピIDとしてitemIdを使用
              result: {
                id: itemId,
                count: count || 1
              },
              delta: [],
              inShape: rawRecipe.inShape || null,
              ingredients: rawRecipe.ingredients || null
            };

            // rawRecipe.resultが存在する場合は上書き
            if (rawRecipe.result && typeof rawRecipe.result === 'object' && rawRecipe.result.id) {
              foundRecipe.result = rawRecipe.result;
            }

            // 材料情報を変換
            if (rawRecipe.ingredients) {
              // shapeless recipe
              foundRecipe.delta = rawRecipe.ingredients.map(ingredientId => {
                const ingredientName = mcData.items[ingredientId]?.name || mcData.blocks[ingredientId]?.name || 'unknown';
                this.logger.log(`[レシピ検索] 材料変換: ID ${ingredientId} -> ${ingredientName}`);
                return {
                  id: ingredientId,
                  count: 1
                };
              });
              this.logger.log(`[レシピ検索] Shapeless recipe found for ${itemName}: ingredients ${rawRecipe.ingredients}`);
            } else if (rawRecipe.inShape) {
              // shaped recipe
              const flatIngredients = rawRecipe.inShape.flat().filter(id => id !== null && id !== undefined);
              foundRecipe.delta = flatIngredients.map(ingredientId => {
                const ingredientName = mcData.items[ingredientId]?.name || mcData.blocks[ingredientId]?.name || 'unknown';
                this.logger.log(`[レシピ検索] 材料変換: ID ${ingredientId} -> ${ingredientName}`);
                return {
                  id: ingredientId,
                  count: 1
                };
              });
              this.logger.log(`[レシピ検索] Shaped recipe found for ${itemName}: shape ${JSON.stringify(rawRecipe.inShape)}`);
            }

            this.logger.log(`[レシピ検索] minecraft-data直接検索で${itemName}のレシピを発見`);
            this.logger.log('[レシピ検索] 生成されたレシピ詳細:', {
              id: foundRecipe.id,
              result: foundRecipe.result,
              deltaLength: foundRecipe.delta.length,
              delta: foundRecipe.delta,
              hasInShape: !!foundRecipe.inShape,
              hasIngredients: !!foundRecipe.ingredients
            });
          }
        } catch (directError) {
          this.logger.warn(`[レシピ検索] Direct minecraft-data search failed: ${directError.message}`);
        }
      }

      // Cache the result (success or failure)
      SkillLibrary._recipeCache.set(cacheKey, {
        recipe: foundRecipe,
        timestamp: Date.now()
      });

      if (!foundRecipe) {
        // Enhanced diagnostics for NO_RECIPE cases
        this.logger.warn(`[レシピ検索] NO_RECIPE: ${itemName}(id:${itemId}) count:${count} table:${table ? 'table' : 'inventory'}`);

        // Store failed recipe search for diagnostics
        if (!SkillLibrary._failedRecipes) {
          SkillLibrary._failedRecipes = new Set();
        }
        SkillLibrary._failedRecipes.add(itemName);
      }

      return foundRecipe;
    } catch (error) {
      this.logger.error(`[レシピ検索] エラー: ${error.message}`);
      return null;
    }
  }

  /**
   * Find best available tool material with material priority system (Gemini collaboration)
   * @param {Bot} bot - Mineflayer bot instance
   * @param {*} _inventory - Unused parameter for compatibility
   * @param {string} toolType - Tool type (pickaxe, axe, shovel, sword, hoe)
   * @returns {Object|null} Best material info or null
   */
  static findBestAvailableToolMaterial(bot, _inventory, toolType = 'pickaxe') {
    // 優先順位: 鉄 > 石 > 金 > 木材 (ダイヤモンド除外)
    const materialPriority = [
      {
        name: 'iron_ingot',
        tools: {
          pickaxe: 'iron_pickaxe',
          axe: 'iron_axe',
          shovel: 'iron_shovel',
          sword: 'iron_sword',
          hoe: 'iron_hoe'
        }
      },
      {
        name: 'cobblestone',
        tools: {
          pickaxe: 'stone_pickaxe',
          axe: 'stone_axe',
          shovel: 'stone_shovel',
          sword: 'stone_sword',
          hoe: 'stone_hoe'
        }
      },
      {
        name: 'gold_ingot',
        tools: {
          pickaxe: 'golden_pickaxe',
          axe: 'golden_axe',
          shovel: 'golden_shovel',
          sword: 'golden_sword',
          hoe: 'golden_hoe'
        }
      }
    ];

    // ダイヤモンドツールの除外チェック
    const excludedMaterials = ['diamond', 'netherite'];

    for (const material of materialPriority) {
      // ダイヤモンドやネザライトは除外
      if (excludedMaterials.some(excluded => material.name.includes(excluded))) {
        this.logger.log(`[ツール作成] ${material.name} は除外対象です`);
        continue;
      }

      // ツール作成に必要な材料（通常は3つ、剣は2つ）と棒（2つ）があるか確認
      const materialCount = toolType === 'sword' ? 2 : 3;
      const stickCount = toolType === 'sword' ? 1 : 2;

      const hasMaterial = bot.inventory.items().some(item => item.name === material.name && item.count >= materialCount);
      const hasSticks = bot.inventory.items().some(item => item.name === 'stick' && item.count >= stickCount);

      if (hasMaterial && hasSticks && material.tools[toolType]) {
        this.logger.log(`[ツール作成] 最良の利用可能素材として ${material.name} を発見 (${toolType})`);
        return { name: material.name, tool: material.tools[toolType] };
      }
    }

    // 木材のチェック (特殊ケース)
    const woodenPlanks = bot.inventory.items().find(item => item.name && item.name.includes('_planks') && item.count >= 3);
    const stickCount = toolType === 'sword' ? 1 : 2;
    const hasSticks = bot.inventory.items().some(item => item.name === 'stick' && item.count >= stickCount);

    if (woodenPlanks && hasSticks) {
      const woodenToolName = `wooden_${toolType}`;
      this.logger.log(`[ツール作成] 最良の利用可能素材として ${woodenPlanks.name} を発見 (${toolType})`);
      return { name: woodenPlanks.name, tool: woodenToolName };
    }

    this.logger.log(`[ツール作成] ${toolType}を作成するための適切な素材が見つかりません`);
    return null;
  }

  /**
   * Get optimized tool recipe using best available materials with priority system
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} toolName - Tool name (e.g., 'iron_pickaxe', 'stone_sword')
   * @param {number} count - Number of tools to craft
   * @param {Block|null} table - Crafting table block
   * @returns {Object|null} Optimized recipe or null
   */
  static async getOptimizedToolRecipe(bot, toolName, count = 1, table = null) {
    const mcData = require('minecraft-data')(bot.version);

    if (!mcData) {
      this.logger.error(`[ツール最適化] minecraft-data for version ${bot.version} not found`);
      return null;
    }

    // ダイヤモンドツールの除外チェック
    const excludedMaterials = ['diamond', 'netherite'];
    if (excludedMaterials.some(excluded => toolName.includes(excluded))) {
      this.logger.log(`[ツール最適化] ${toolName} は除外対象です (ダイヤモンド/ネザライト)`);
      return null;
    }

    // ツールタイプを抽出
    const toolTypes = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
    const toolType = toolTypes.find(type => toolName.includes(type));

    if (!toolType) {
      this.logger.log(`[ツール最適化] 不明なツールタイプ: ${toolName}`);
      return null;
    }

    // 最適な材料を検索
    const bestMaterial = SkillLibrary.findBestAvailableToolMaterial(bot, null, toolType);
    if (!bestMaterial) {
      this.logger.log(`[ツール最適化] ${toolType}の最適な材料が見つかりません`);
      return null;
    }

    // 最適な材料で作成可能なツール名を取得
    const optimizedToolName = bestMaterial.tool;
    this.logger.log(`[ツール最適化] ${toolName} -> ${optimizedToolName} (${bestMaterial.name})`);

    // 最適化されたツールのレシピを取得
    const toolItem = mcData.itemsByName[optimizedToolName];
    if (!toolItem) {
      this.logger.warn(`[ツール最適化] Tool ${optimizedToolName} not found in minecraft-data`);
      return null;
    }

    // レシピを取得
    let recipe = null;
    try {
      const recipes = bot.recipesFor(toolItem.id, null, count, table);
      if (recipes.length > 0) {
        recipe = recipes[0];
      }
    } catch (error) {
      this.logger.log(`[ツール最適化] bot.recipesFor failed: ${error.message}`);
    }

    if (!recipe) {
      this.logger.log(`[ツール最適化] ${optimizedToolName}のレシピが見つかりません`);
      return null;
    }

    return recipe;
  }

  /**
   * Get optimized wooden tool recipe using available wood planks
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} toolName - Wooden tool name (e.g., 'wooden_pickaxe')
   * @param {number} count - Number of tools to craft
   * @param {Block|null} table - Crafting table block
   * @returns {Object|null} Optimized recipe or null
   */
  static async getOptimizedWoodenToolRecipe(bot, toolName, count = 1, table = null) {
    const mcData = require('minecraft-data')(bot.version);
    const InventoryUtils = require('./InventoryUtils');

    if (!mcData) {
      this.logger.error(`[木材レシピ最適化] minecraft-data for version ${bot.version} not found`);
      return null;
    }

    // Check if we have any wood planks available
    const { total, breakdown } = InventoryUtils.getAvailableWoodPlanks(bot);
    if (total === 0) {
      this.logger.log(`[木材レシピ最適化] 利用可能な木材がありません: ${toolName}`);
      return null;
    }

    // Find the best available wood type
    const bestWoodType = InventoryUtils.getBestAvailableWoodPlank(bot);
    if (!bestWoodType) {
      this.logger.log(`[木材レシピ最適化] 最適な木材タイプが見つかりません: ${toolName}`);
      return null;
    }

    this.logger.log(`[木材レシピ最適化] 使用する木材: ${bestWoodType} (${breakdown[bestWoodType]}個) for ${toolName}`);

    // Get the standard recipe for the wooden tool
    const toolItem = mcData.itemsByName[toolName];
    if (!toolItem) {
      this.logger.warn(`[木材レシピ最適化] Tool ${toolName} not found in minecraft-data`);
      return null;
    }

    // Try to get the original recipe first
    let originalRecipe = null;
    try {
      const recipes = bot.recipesFor(toolItem.id, null, count, table);
      if (recipes.length > 0) {
        originalRecipe = recipes[0];
      }
    } catch (error) {
      this.logger.log(`[木材レシピ最適化] bot.recipesFor failed: ${error.message}`);
    }

    // If bot.recipesFor failed, try minecraft-data direct search
    if (!originalRecipe && mcData.recipes) {
      const directRecipes = mcData.recipes[toolItem.id];
      if (directRecipes && Array.isArray(directRecipes) && directRecipes.length > 0) {
        const rawRecipe = directRecipes[0];
        originalRecipe = {
          id: toolItem.id,
          result: rawRecipe.result || { id: toolItem.id, count },
          delta: [],
          inShape: rawRecipe.inShape || null,
          ingredients: rawRecipe.ingredients || null
        };

        // Convert materials to delta format
        if (rawRecipe.ingredients) {
          originalRecipe.delta = rawRecipe.ingredients.map(ingredientId => ({
            id: ingredientId,
            count: -1
          }));
        } else if (rawRecipe.inShape) {
          const flatIngredients = rawRecipe.inShape.flat().filter(id => id !== null && id !== undefined);
          originalRecipe.delta = flatIngredients.map(ingredientId => ({
            id: ingredientId,
            count: -1
          }));
        }
      }
    }

    if (!originalRecipe) {
      this.logger.log(`[木材レシピ最適化] No original recipe found for ${toolName}`);
      return null;
    }

    // Create an optimized recipe by replacing any wood plank requirement with the best available wood type
    const optimizedRecipe = JSON.parse(JSON.stringify(originalRecipe)); // Deep copy

    // Try to find the wood item with multiple naming patterns
    let bestWoodItem = null;
    const searchNames = [
      bestWoodType, // Original name (e.g., "jungle_planks")
      bestWoodType.replace('_planks', '_plank'), // Singular form (e.g., "jungle_plank")
      bestWoodType.replace('s', ''), // Remove trailing 's' (e.g., "jungle_plank")
      'planks' // Generic fallback
    ];

    for (const searchName of searchNames) {
      bestWoodItem = mcData.itemsByName[searchName];
      if (bestWoodItem) {
        this.logger.log(`[木材レシピ最適化] 木材アイテム発見: ${bestWoodType} -> ${searchName} (id: ${bestWoodItem.id})`);
        break;
      }
    }

    if (!bestWoodItem) {
      this.logger.warn(`[木材レシピ最適化] Best wood type ${bestWoodType} not found in minecraft-data with any naming pattern`);
      this.logger.warn(`[木材レシピ最適化] 試行した名前: ${searchNames.join(', ')}`);

      // Debug: Show available wood-related items
      if (mcData.itemsByName) {
        const availableWoodItems = Object.keys(mcData.itemsByName).filter(name =>
          name.includes('plank') || name.includes('wood')
        );
        this.logger.warn(`[木材レシピ最適化] 利用可能な木材関連アイテム: ${availableWoodItems.slice(0, 10).join(', ')}`);
      }
      return null;
    }

    // Replace wood plank materials in the recipe
    let replacedCount = 0;
    if (optimizedRecipe.delta) {
      for (const ingredient of optimizedRecipe.delta) {
        if (ingredient.count < 0) {
          const itemName = mcData.items[ingredient.id]?.name || mcData.blocks[ingredient.id]?.name;

          // Check if this is a wood plank item OR id 41 (which often represents generic planks in recipes)
          const isWoodPlank = itemName && InventoryUtils.isWoodPlank(itemName);
          const isGenericPlank = ingredient.id === 41; // gold_block ID often used as generic plank placeholder

          if (isWoodPlank || isGenericPlank) {
            this.logger.log(`[木材レシピ最適化] 材料置換: ${itemName || 'generic_plank'} (ID:${ingredient.id}) -> ${bestWoodType} (ID:${bestWoodItem.id})`);
            ingredient.id = bestWoodItem.id;
            replacedCount++;
          }
        }
      }
    }

    // Also replace in inShape if it exists
    if (optimizedRecipe.inShape) {
      for (let i = 0; i < optimizedRecipe.inShape.length; i++) {
        for (let j = 0; j < optimizedRecipe.inShape[i].length; j++) {
          const itemId = optimizedRecipe.inShape[i][j];
          if (itemId === 41) { // Replace generic plank ID with actual available plank
            this.logger.log(`[木材レシピ最適化] inShape置換: ID:${itemId} -> ${bestWoodType} (ID:${bestWoodItem.id})`);
            optimizedRecipe.inShape[i][j] = bestWoodItem.id;
            replacedCount++;
          }
        }
      }
    }

    if (replacedCount > 0) {
      this.logger.log(`[木材レシピ最適化] ${replacedCount}個の材料を${bestWoodType}に置換しました`);

      // Regenerate ingredients from the corrected inShape to ensure consistency
      if (optimizedRecipe.inShape) {
        const dummyCraftSkill = new CraftToolsSkill();
        optimizedRecipe.ingredients = dummyCraftSkill.generateIngredientsFromInShape(optimizedRecipe.inShape);
        this.logger.log(`[木材レシピ最適化] 更新されたingredients: ${JSON.stringify(optimizedRecipe.ingredients)}`);
      }

      return optimizedRecipe;
    } else {
      this.logger.log(`[木材レシピ最適化] 置換可能な木材材料が見つかりませんでした: ${toolName}`);
      return null;
    }
  }

  loadBasicSkills() {
    // Movement skills with pathfinding cache support
    this.registerSkill('move_to', new MoveToSkill(this.pathfindingCache));
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
    this.registerSkill('place_workbench', new PlaceWorkbenchSkill());
    this.registerSkill('craft_with_workbench', new CraftWithWorkbenchSkill());
    this.registerSkill('craft_furnace', new CraftFurnaceSkill());

    // Building skills
    this.registerSkill('place_blocks', new PlaceBlocksSkill());

    this.logger.log(`${this.skills.size}個のスキルを読み込みました`);
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
    this.logger = Logger.createLogger(`Skill-${name}`);
  }

  async execute(_bot, _params = {}) {
    throw new Error('execute method must be implemented');
  }
}

// Movement Skills
class MoveToSkill extends Skill {
  constructor(pathfindingCache = null) {
    super('move_to', 'Move to a specific position');
    this.pathfindingCache = pathfindingCache;
  }

  async execute(bot, params, context) {
    return BasicSkills.moveTo(bot, params, context);
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
    super('mine_block', 'Mine a supported block and verify pickup');
  }

  async execute(bot, params, context) {
    return BasicSkills.mineBlocks(bot, params, context);
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
      // Use MovementUtils for consistent movement handling
      const moveResult = await moveToPosition(bot, destination, 0);
      if (moveResult.success) {
        return { success: true };
      } else {
        return { success: false, error: moveResult.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Survival Skills
class SimpleGatherWoodSkill extends Skill {
  constructor() {
    super('gather_wood', 'Gather logs and verify pickup');
  }

  async execute(bot, params, context) {
    return BasicSkills.gatherWood(bot, params, context);
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
      this.logger.log(`[食料確保] 現在の食料レベル: ${currentFood}/20`);

      if (currentFood >= 20) {
        this.logger.log('[食料確保] 食料レベルは十分です');
        bot.chat('食料は満タンです！');
        return { success: true, message: '食料は十分です' };
      }

      // Find nearby animals
      const animals = ['cow', 'pig', 'sheep', 'chicken'];
      const target = bot.nearestEntity(entity =>
        animals.includes(entity.name) && bot.entity.position.distanceTo(entity.position) < 32
      );

      if (!target) {
        this.logger.log('[食料確保] 近くに食料源が見つかりません');
        bot.chat('近くに食料が見つかりません...');
        return { success: false, error: '近くに食料源が見つかりません' };
      }

      this.logger.log(`[食料確保] ${target.name}を発見、攻撃します`);
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
        const moveResult = await moveToEntity(bot, item, 1);
        if (!moveResult.success) {
          this.logger.log(`[食料確保] アイテムへの移動に失敗: ${moveResult.error}`);
        }
      }

      this.logger.log('[食料確保] 食料を確保しました');
      bot.chat('食料を確保しました！ 🍖');
      return { success: true, message: '食料を確保しました' };
    } catch (error) {
      this.logger.log(`[食料確保] 食料確保に失敗: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// Crafting Skills
class CraftToolsSkill extends Skill {
  constructor() {
    super('craft_tools', 'Crafts specified tools.');
  }

  async execute(bot, params, context) {
    return BasicSkills.craftTools(bot, params, context);
  }

  async verifyMaterialsBeforeCraft(bot, recipe) {
    const mcData = require('minecraft-data')(bot.version);

    if (!recipe || !recipe.delta) {
      return { success: false, error: 'Recipe or delta is null' };
    }

    // Get current inventory
    const inventory = bot.inventory.items();
    const inventoryMap = new Map();

    for (const item of inventory) {
      if (item && item.type !== null && item.type !== undefined) {
        inventoryMap.set(item.type, (inventoryMap.get(item.type) || 0) + item.count);
      }
    }


    // Check each required material
    const missing = [];
    for (const ingredient of recipe.delta) {
      if (ingredient.count < 0) {
        const needed = Math.abs(ingredient.count);
        const available = inventoryMap.get(ingredient.id) || 0;

        const itemData = mcData.items[ingredient.id];
        const itemName = itemData ? itemData.name : `ID:${ingredient.id}`;


        if (available < needed) {
          missing.push({
            item: itemName,
            needed,
            available,
            shortage: needed - available
          });
        }
      }
    }

    if (missing.length > 0) {
      return {
        success: false,
        error: `Missing materials: ${missing.map(m => `${m.item} (need ${m.shortage} more)`).join(', ')}`,
        missing
      };
    }

    return { success: true };
  }

  /**
   * Generate ingredients array from inShape for mineflayer compatibility
   * @param {Array} inShape - 3x3 crafting grid shape
   * @returns {Array} ingredients array for mineflayer bot.craft()
   */
  generateIngredientsFromInShape(inShape) {
    if (!inShape || !Array.isArray(inShape)) {
      return [];
    }

    const ingredients = [];
    const uniqueItems = new Set();

    // Flatten inShape and collect unique non-null items
    for (const row of inShape) {
      if (Array.isArray(row)) {
        for (const item of row) {
          if (item !== null && item !== undefined && typeof item === 'number' && item !== 0 && item !== -1) {
            uniqueItems.add(item);
          }
        }
      }
    }

    // Convert to ingredients format expected by mineflayer
    for (const itemId of uniqueItems) {
      ingredients.push({
        id: itemId,
        count: 1 // mineflayer will calculate actual count from inShape
      });
    }

    return ingredients;
  }

  /**
   * Fix delta field to match inShape for recipe consistency
   * @param {Array} delta - Original delta array
   * @param {Array} inShape - 3x3 crafting grid shape
   * @returns {Array} corrected delta array
   */
  fixDeltaFromInShape(delta, inShape) {
    if (!delta || !inShape || !Array.isArray(delta) || !Array.isArray(inShape)) {
      return delta;
    }

    this.logger.log('[レシピ修正] 元のinShape:', JSON.stringify(inShape));

    // Count items in inShape
    const itemCounts = new Map();
    for (const row of inShape) {
      if (Array.isArray(row)) {
        for (const item of row) {
          // Exclude null, undefined, Air (ID: 0), and empty slots (ID: -1)
          if (item !== null && item !== undefined && typeof item === 'number' && item !== 0 && item !== -1) {
            itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
          }
        }
      }
    }

    // Create corrected delta based on inShape
    const correctedDelta = [];
    for (const [itemId, count] of itemCounts) {
      correctedDelta.push({
        id: itemId,
        count: -count // Negative because it's consumption
      });
    }

    return correctedDelta;
  }

  /**
   * Sanitize inShape array by replacing null / undefined cells with 0.
   * Mineflayer 4.x では bot.craft 内部で inShape[row][col].id を参照するため
   * null が残っていると「Cannot read properties of null (reading 'id')」が発生する。
   * 0 は Air を意味し、mineflayer 側でスキップされる。
   * @param {Array} inShape 3x3 shaped recipe grid
   * @returns {Array} sanitized copy
   */
  sanitizeInShape(inShape) {
    if (!Array.isArray(inShape)) return inShape;
    return inShape.map(row =>
      Array.isArray(row)
        ? row.map(cell => {
          // Handle null, undefined, and empty slots
          if (cell == null || cell === undefined) return -1;

          // -1 is a valid empty slot indicator in mineflayer
          if (cell === -1) return -1;

          // Handle objects that should be item IDs
          if (typeof cell === 'object' && cell !== null) {
          // If it's an object with an id property, use the id
            if (cell.id !== undefined && typeof cell.id === 'number') {
              return cell.id;
            }
            // Otherwise, this is invalid - return 0 (empty slot)
            this.logger.log(`[sanitizeInShape] 無効なオブジェクトをスキップ: ${JSON.stringify(cell)}`);
            return 0;
          }

          // Handle string item IDs - convert to number if possible
          if (typeof cell === 'string') {
            const numId = parseInt(cell, 10);
            if (!isNaN(numId)) {
              return numId;
            }
            // Invalid string - return 0
            this.logger.log(`[sanitizeInShape] 無効な文字列ID: ${cell}`);
            return 0;
          }

          // Handle number item IDs
          if (typeof cell === 'number') {
            return cell;
          }

          // Unknown type - return 0
          this.logger.log(`[sanitizeInShape] 未知のタイプ: ${typeof cell}, 値: ${cell}`);
          return 0;
        })
        : row
    );
  }

  async getMissingMaterialsForActualRecipe(bot, recipe) {
    const mcData = require('minecraft-data')(bot.version);
    const InventoryUtils = require('./InventoryUtils');

    if (!recipe || !recipe.delta) {
      return [{ item: 'unknown', needed: 1, reason: 'Invalid recipe' }];
    }

    const missing = [];

    // Use the actual recipe delta for accurate material checking
    for (const ingredient of recipe.delta) {
      if (ingredient.count < 0) {
        // Negative count means required material
        const needed = Math.abs(ingredient.count);
        const itemName = mcData.items[ingredient.id]?.name || mcData.blocks[ingredient.id]?.name || `item_${ingredient.id}`;

        // Check if we can substitute this material (especially for wood planks and sticks)
        const substitutionInfo = InventoryUtils.canSubstituteMaterial(bot, itemName, needed);

        if (!substitutionInfo.canSubstitute) {
          missing.push({
            item: itemName,
            needed: needed - substitutionInfo.availableCount,
            have: substitutionInfo.availableCount,
            substitutionType: substitutionInfo.substitutionType,
            possibleSubstitutes: substitutionInfo.substitutes
          });
        } else if (substitutionInfo.substitutionType === 'wood_plank') {
          // Log successful wood plank substitution
          this.logger.log(`[材料チェック] 木材代替可能: ${itemName} (必要:${needed}) -> 利用可能合計:${substitutionInfo.availableCount}`);
          this.logger.log(`[材料チェック] 利用可能木材: ${JSON.stringify(substitutionInfo.substitutes)}`);
        } else if (substitutionInfo.substitutionType === 'stick_from_planks') {
          // Need to craft sticks from planks - add to missing for processing
          const currentSticks = substitutionInfo.substitutes.stick || 0;
          const sticksNeeded = needed - currentSticks;
          if (sticksNeeded > 0) {
            this.logger.log(`[材料チェック] スティック不足: ${itemName} (必要:${needed}, 現在:${currentSticks}) -> ${sticksNeeded}個を板材から作成が必要`);
            missing.push({
              item: itemName,
              needed: sticksNeeded,
              have: currentSticks,
              substitutionType: substitutionInfo.substitutionType,
              possibleSubstitutes: substitutionInfo.substitutes
            });
          } else {
            this.logger.log(`[材料チェック] スティック十分: ${itemName} (必要:${needed}) -> 利用可能:${currentSticks}`);
          }
        } else if (substitutionInfo.substitutionType === 'exact_match') {
          // Log successful exact match
          this.logger.log(`[材料チェック] 材料十分: ${itemName} (必要:${needed}) -> 利用可能:${substitutionInfo.availableCount}`);
        }
      }
    }
    return missing;
  }

  async getMissingMaterialsForRecipe(bot, itemId, craftingTable) {
    const mcData = require('minecraft-data')(bot.version);
    const InventoryUtils = require('./InventoryUtils');

    const itemName = mcData.items[itemId]?.name || 'unknown';

    // Special handling for wooden tools: use optimized recipe
    let recipe = null;
    if (itemName && itemName.includes('wooden_')) {
      recipe = await SkillLibrary.getOptimizedWoodenToolRecipe(bot, itemName, 1, craftingTable);
      if (recipe) {
        this.logger.log(`[材料チェック] 木材最適化レシピを使用: ${itemName}`);
      }
    }

    if (!recipe) {
      try {
        const recipes = bot.recipesFor(itemId, null, 1, craftingTable);
        if (recipes.length > 0) {
          recipe = recipes[0];
        }
      } catch (error) {
        this.logger.log(`[材料チェック] bot.recipesFor failed: ${error.message}`);
      }
    }

    // If bot.recipesFor failed, use minecraft-data direct search
    if (!recipe) {
      const directRecipes = mcData.recipes[itemId];
      if (directRecipes && Array.isArray(directRecipes) && directRecipes.length > 0) {
        const rawRecipe = directRecipes[0];
        recipe = {
          id: itemId,
          result: rawRecipe.result || { id: itemId, count: 1 },
          delta: [],
          inShape: rawRecipe.inShape || null,
          ingredients: rawRecipe.ingredients || null
        };

        // Convert materials to delta format with proper counting
        if (rawRecipe.ingredients) {
          const ingredientCounts = new Map();
          rawRecipe.ingredients.forEach(ingredientId => {
            ingredientCounts.set(ingredientId, (ingredientCounts.get(ingredientId) || 0) + 1);
          });
          recipe.delta = Array.from(ingredientCounts.entries()).map(([id, count]) => ({
            id,
            count: -count // Negative count means required material
          }));
        } else if (rawRecipe.inShape) {
          const ingredientCounts = new Map();
          rawRecipe.inShape.flat().forEach(id => {
            if (id !== null && id !== undefined && id !== 0) {
              ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
            }
          });
          recipe.delta = Array.from(ingredientCounts.entries()).map(([id, count]) => ({
            id,
            count: -count // Negative count means required material
          }));
        }
      }
    }

    if (!recipe) {
      return [{ item: 'unknown', needed: 1, reason: 'No recipe found' }];
    }

    const missing = [];

    // Use recipe.delta instead of recipe.ingredients for better compatibility
    const ingredients = recipe.delta || recipe.ingredients || [];
    for (const ingredient of ingredients) {
      if (ingredient.count < 0) {
        // Negative count means required material
        const needed = Math.abs(ingredient.count);
        const itemName = mcData.items[ingredient.id]?.name || mcData.blocks[ingredient.id]?.name || `item_${ingredient.id}`;

        // Check if we can substitute this material (especially for wood planks and sticks)
        const substitutionInfo = InventoryUtils.canSubstituteMaterial(bot, itemName, needed);

        if (!substitutionInfo.canSubstitute) {
          missing.push({
            item: itemName,
            needed: needed - substitutionInfo.availableCount,
            have: substitutionInfo.availableCount,
            substitutionType: substitutionInfo.substitutionType,
            possibleSubstitutes: substitutionInfo.substitutes
          });
        } else if (substitutionInfo.substitutionType === 'wood_plank') {
          // Log successful wood plank substitution
          this.logger.log(`[材料チェック] 木材代替可能: ${itemName} (必要:${needed}) -> 利用可能合計:${substitutionInfo.availableCount}`);
          this.logger.log(`[材料チェック] 利用可能木材: ${JSON.stringify(substitutionInfo.substitutes)}`);
        } else if (substitutionInfo.substitutionType === 'stick_from_planks') {
          // Log successful stick substitution using planks
          this.logger.log(`[材料チェック] スティック代替可能: ${itemName} (必要:${needed}) -> 現在のスティック:${substitutionInfo.substitutes.stick}, 板材から作成可能`);
          this.logger.log(`[材料チェック] 板材利用可能: ${substitutionInfo.substitutes.planks_available}個, 必要: ${substitutionInfo.substitutes.planks_needed}個`);
        } else if (substitutionInfo.substitutionType === 'exact_match') {
          // Log successful exact match
          this.logger.log(`[材料チェック] 材料十分: ${itemName} (必要:${needed}) -> 利用可能:${substitutionInfo.availableCount}`);
        }
      }
    }
    return missing;
  }

  async ensureWorkbench(bot) {
    this.logger.log('[ツールスキル] 作業台の確保を開始...');

    // Check if a workbench is already placed nearby
    const workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 8
    });

    if (workbench) {
      this.logger.log(`[ツールスキル] 近くに作業台を発見: ${workbench.position}`);
      return { success: true, workbench };
    }

    // Check if we have a crafting table in inventory
    if (InventoryUtils.hasItem(bot, 'crafting_table', 1, true)) {
      this.logger.log('[ツールスキル] インベントリに作業台があります。設置を試みます...');
      const placeResult = await this.placeCraftingTable(bot);
      if (placeResult.success) {
        return { success: true, workbench: placeResult.workbench };
      } else {
        this.logger.log(`[ツールスキル] 作業台の設置に失敗: ${placeResult.error}`);
        return { success: false, error: `作業台の設置に失敗: ${placeResult.error}` };
      }
    }

    // If not, try to craft one
    this.logger.log('[ツールスキル] 作業台がありません。作成を試みます...');
    const craftWorkbenchSkill = new CraftWorkbenchSkill();
    const craftResult = await craftWorkbenchSkill.execute(bot, {});

    if (craftResult.success) {
      this.logger.log('[ツールスキル] 作業台の作成に成功しました。設置を試みます...');
      const placeResult = await this.placeCraftingTable(bot);
      if (placeResult.success) {
        return { success: true, workbench: placeResult.workbench };
      } else {
        this.logger.log(`[ツールスキル] 作成した作業台の設置に失敗: ${placeResult.error}`);
        return { success: false, error: `作成した作業台の設置に失敗: ${placeResult.error}` };
      }
    } else {
      this.logger.log(`[ツールスキル] 作業台の作成に失敗: ${craftResult.error}`);
      return { success: false, error: `作業台の作成に失敗: ${craftResult.error}` };
    }
  }

  async placeCraftingTable(bot) {
    this.logger.log('[ツールスキル] 作業台の設置場所を探しています...');

    // Blocks that should be avoided as reference blocks (jungle biome problematic blocks)
    const avoidableBlocks = [
      'vine', 'jungle_log', 'oak_log', 'spruce_log', 'birch_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log', 'jungle_leaves', 'oak_leaves', 'spruce_leaves', 'birch_leaves',
      'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves',
      'flowering_azalea_leaves', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
      'seagrass', 'tall_seagrass', 'kelp', 'bamboo', 'sugar_cane', 'cactus', 'cocoa'
    ];

    // Generate more placement positions with extended search range
    const placementPositions = [];

    // Close positions (radius 1-2)
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        if (x === 0 && z === 0) continue; // Skip bot's position
        placementPositions.push(new Vec3(x, -1, z)); // Below bot level
        placementPositions.push(new Vec3(x, 0, z)); // Same level as bot
      }
    }

    // Extended positions (radius 3-4) for difficult situations
    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) {
        if (Math.abs(x) < 3 && Math.abs(z) < 3) continue; // Skip already covered positions
        placementPositions.push(new Vec3(x, -1, z)); // Below bot level
        placementPositions.push(new Vec3(x, 0, z)); // Same level as bot
      }
    }

    this.logger.log(`[ツールスキル] 設置候補位置を生成: ${placementPositions.length}個`);

    // Try to find suitable placement location
    for (const offset of placementPositions) {
      const refBlock = bot.blockAt(bot.entity.position.offset(offset.x, offset.y, offset.z));

      // Skip invalid reference blocks
      if (!refBlock || refBlock.name === 'air' || refBlock.name === 'water' || refBlock.name === 'lava') {
        continue;
      }

      // Skip problematic blocks (vine, logs, leaves, etc.)
      if (avoidableBlocks.includes(refBlock.name)) {
        continue;
      }

      // Check if reference block is solid and can support placement
      if (!refBlock.boundingBox || refBlock.boundingBox === 'empty') {
        continue;
      }

      // Check if target position is free and accessible
      const targetPos = refBlock.position.offset(0, 1, 0);
      const targetBlock = bot.blockAt(targetPos);
      if (targetBlock && targetBlock.name !== 'air') {
        continue;
      }

      // Additional check for space above (2 blocks high clearance)
      const aboveTarget = bot.blockAt(targetPos.offset(0, 1, 0));
      if (aboveTarget && aboveTarget.name !== 'air') {
        continue;
      }

      // Check if bot can reach the placement position
      const distanceToTarget = bot.entity.position.distanceTo(targetPos);
      if (distanceToTarget > 6) {
        continue;
      }

      this.logger.log(`[ツールスキル] 設置候補位置を検証: ${targetPos.toString()}, 距離: ${distanceToTarget.toFixed(2)}`);
      this.logger.log(`[ツールスキル] 参照ブロック: ${refBlock.name} at ${refBlock.position.toString()}`);

      try {
        const craftingTableItem = bot.inventory.items().find(item => item && item.name === 'crafting_table');
        if (!craftingTableItem) {
          this.logger.log('[ツールスキル] インベントリに作業台がありません。');
          return { success: false, error: 'インベントリに作業台がありません' };
        }

        await bot.equip(craftingTableItem, 'hand');

        // Retry mechanism for blockUpdate timeout with proper event waiting
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            this.logger.log(`[ツールスキル] 作業台設置試行 ${attempt}/3 at ${targetPos}`);

            // Create blockUpdate promise BEFORE placing block
            let blockUpdateResolve, blockUpdateReject;
            const blockUpdatePromise = new Promise((resolve, reject) => {
              blockUpdateResolve = resolve;
              blockUpdateReject = reject;
            });

            const timeout = setTimeout(() => {
              bot.removeListener('blockUpdate', onBlockUpdate);
              blockUpdateReject(new Error('blockUpdate timeout'));
            }, 8000);

            const onBlockUpdate = (_oldBlock, newBlock) => {
              if (newBlock && newBlock.position.equals(targetPos) && newBlock.name === 'crafting_table') {
                clearTimeout(timeout);
                bot.removeListener('blockUpdate', onBlockUpdate);
                blockUpdateResolve(newBlock);
              }
            };

            // Set up listener BEFORE placing block
            bot.on('blockUpdate', onBlockUpdate);

            try {
              // Place the block
              await bot.placeBlock(refBlock, new Vec3(0, 1, 0));

              // Wait for either blockUpdate event or timeout
              const updatedBlock = await blockUpdatePromise;
              this.logger.log('[ツールスキル] 作業台を正常に設置しました！');
              return { success: true, workbench: updatedBlock };
            } catch (eventError) {
              // Clean up listener on error
              clearTimeout(timeout);
              bot.removeListener('blockUpdate', onBlockUpdate);

              this.logger.log(`[ツールスキル] blockUpdate待機エラー: ${eventError.message}`);

              // Fallback: Direct verification after short delay
              await new Promise(resolve => setTimeout(resolve, 1000));
              const placedBlock = bot.blockAt(targetPos);
              if (placedBlock && placedBlock.name === 'crafting_table') {
                this.logger.log('[ツールスキル] 作業台設置を直接確認で検証成功！');
                return { success: true, workbench: placedBlock };
              }
            }
          } catch (error) {
            this.logger.log(`[ツールスキル] 設置試行 ${attempt} 失敗: ${error.message}`);

            // Wait before retry
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
          }
        }

        // If all retries failed, try next position
        this.logger.log(`[ツールスキル] 位置 ${targetPos.toString()} での設置に失敗、次の位置を試行...`);
      } catch (error) {
        this.logger.log(`[ツールスキル] 設置準備エラー at ${targetPos ? targetPos.toString() : 'unknown'}: ${error.message}`);
        this.logger.log(`[ツールスキル] エラースタック: ${error.stack}`);
        continue;
      }
    }

    // If standard placement failed, try terrain modification approach
    this.logger.log('[ツールスキル] 通常の設置位置が見つかりませんでした。地形を整備して設置場所を作成します...');
    const terrainResult = await this.createCraftingTableSpot(bot);
    if (terrainResult.success) {
      return terrainResult;
    }

    // Enhanced error reporting
    const botPos = bot.entity.position;
    const inventoryItems = bot.inventory.items().map(item => item.name).join(', ');

    this.logger.log('[ツールスキル] 作業台設置失敗の詳細情報:');
    this.logger.log(`[ツールスキル] - ボット位置: ${botPos.toString()}`);
    this.logger.log(`[ツールスキル] - 試行した位置数: ${placementPositions.length}`);
    this.logger.log('[ツールスキル] - インベントリ:', inventoryItems);
    this.logger.log('[ツールスキル] - 周辺ブロック情報:');

    // Show first 10 positions for debugging
    for (let i = 0; i < Math.min(10, placementPositions.length); i++) {
      const offset = placementPositions[i];
      const refBlock = bot.blockAt(botPos.offset(offset.x, offset.y, offset.z));
      const targetPos = refBlock ? refBlock.position.offset(0, 1, 0) : null;
      const targetBlock = targetPos ? bot.blockAt(targetPos) : null;

      const refName = refBlock ? refBlock.name : 'null';
      const targetName = targetBlock ? targetBlock.name : 'null';
      this.logger.log(`[ツールスキル]   位置${i + 1}: 参照=${refName}, ターゲット=${targetName}`);
    }

    return {
      success: false,
      error: '全ての設置位置で作業台の設置に失敗しました',
      details: {
        botPosition: botPos.toString(),
        attemptedPositions: placementPositions.length,
        inventoryItems
      }
    };
  }

  // New method to create a crafting table spot by modifying terrain
  async createCraftingTableSpot(bot) {
    this.logger.log('[ツールスキル] 地形を整備して作業台設置場所を作成します...');

    const botPos = bot.entity.position;
    // First try to find existing solid ground
    const candidatePositions = [];

    // Add positions in expanding circles
    for (let radius = 1; radius <= 4; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          if (Math.abs(x) === radius || Math.abs(z) === radius) {
            candidatePositions.push(new Vec3(x, 0, z));
          }
        }
      }
    }

    // Sort by distance from bot
    candidatePositions.sort((a, b) => {
      const distA = Math.sqrt(a.x * a.x + a.z * a.z);
      const distB = Math.sqrt(b.x * b.x + b.z * b.z);
      return distA - distB;
    });

    for (const offset of candidatePositions) {
      const targetPos = botPos.offset(offset.x, offset.y, offset.z);
      const groundPos = targetPos.offset(0, -1, 0);

      this.logger.log(`[ツールスキル] 地形整備候補位置: ${targetPos.toString()}`);

      try {
        // Check if position is reachable
        const distance = botPos.distanceTo(targetPos);
        if (distance > 6) {
          continue;
        }

        // Check what's at the target position
        const targetBlock = bot.blockAt(targetPos);
        const groundBlock = bot.blockAt(groundPos);
        const aboveBlock = bot.blockAt(targetPos.offset(0, 1, 0));

        this.logger.log(`[ツールスキル] 地形状況: 地面=${groundBlock?.name || 'null'}, 設置位置=${targetBlock?.name || 'null'}, 上方=${aboveBlock?.name || 'null'}`);

        // If ground block exists and is solid, try to place directly
        if (groundBlock && groundBlock.name !== 'air' && groundBlock.name !== 'water') {
          if (targetBlock && targetBlock.name === 'air') {
            try {
              const craftingTableItem = bot.inventory.items().find(item => item && item.name === 'crafting_table');
              if (craftingTableItem) {
                await bot.equip(craftingTableItem, 'hand');
                await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));

                // Verify placement
                await new Promise(resolve => setTimeout(resolve, 1000));
                const placedBlock = bot.blockAt(targetPos);
                if (placedBlock && placedBlock.name === 'crafting_table') {
                  this.logger.log('[ツールスキル] 作業台設置に成功しました！');
                  return { success: true, workbench: placedBlock };
                }
              }
            } catch (placeError) {
              this.logger.log(`[ツールスキル] 直接設置失敗: ${placeError.message}`);
            }
          }
        }

        // If target position is blocked, try to clear it
        if (targetBlock && targetBlock.name !== 'air') {
          this.logger.log(`[ツールスキル] 設置位置をクリア: ${targetBlock.name}`);
          try {
            await bot.dig(targetBlock);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for dig to complete
          } catch (digError) {
            this.logger.log(`[ツールスキル] ブロック除去失敗: ${digError.message}`);
            continue;
          }
        }

        // If above position is blocked, try to clear it
        if (aboveBlock && aboveBlock.name !== 'air') {
          this.logger.log(`[ツールスキル] 上方スペースをクリア: ${aboveBlock.name}`);
          try {
            await bot.dig(aboveBlock);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for dig to complete
          } catch (digError) {
            this.logger.log(`[ツールスキル] 上方ブロック除去失敗: ${digError.message}`);
            continue;
          }
        }

        // If no ground block, try to create one with available blocks
        if (!groundBlock || groundBlock.name === 'air') {
          this.logger.log('[ツールスキル] 地面ブロックがありません。利用可能なブロックで地面を作成します...');

          // Find any solid block we can use for ground
          const availableBlocks = bot.inventory.items().filter(item =>
            item && item.name && ['dirt', 'cobblestone', 'stone', 'oak_planks'].includes(item.name)
          );

          if (availableBlocks.length > 0) {
            const blockToPlace = availableBlocks[0];
            try {
              await bot.equip(blockToPlace, 'hand');

              // Find a solid reference block nearby to place against
              const searchRadius = 3;
              let refBlock = null;

              for (let x = -searchRadius; x <= searchRadius; x++) {
                for (let y = -searchRadius; y <= searchRadius; y++) {
                  for (let z = -searchRadius; z <= searchRadius; z++) {
                    const checkPos = groundPos.offset(x, y, z);
                    const checkBlock = bot.blockAt(checkPos);
                    if (checkBlock && checkBlock.name !== 'air' && checkBlock.name !== 'water') {
                      refBlock = checkBlock;
                      break;
                    }
                  }
                  if (refBlock) break;
                }
                if (refBlock) break;
              }

              if (refBlock) {
                // Calculate face vector from reference block to ground position
                const faceVector = groundPos.minus(refBlock.position);
                await bot.placeBlock(refBlock, faceVector);
                this.logger.log(`[ツールスキル] ${blockToPlace.name}で地面を作成しました`);
                await new Promise(resolve => setTimeout(resolve, 800));
              } else {
                this.logger.log('[ツールスキル] 地面作成用の参照ブロックが見つかりません');
                continue;
              }
            } catch (placeError) {
              this.logger.log(`[ツールスキル] 地面作成失敗: ${placeError.message}`);
              continue;
            }
          } else {
            this.logger.log('[ツールスキル] 地面作成用のブロックがありません');
            continue;
          }
        }

        // Now try to place the crafting table
        const finalGroundBlock = bot.blockAt(groundPos);
        if (finalGroundBlock && finalGroundBlock.name !== 'air') {
          try {
            const craftingTableItem = bot.inventory.items().find(item => item && item.name === 'crafting_table');
            if (!craftingTableItem) {
              return { success: false, error: 'インベントリに作業台がありません' };
            }

            await bot.equip(craftingTableItem, 'hand');
            await bot.placeBlock(finalGroundBlock, new Vec3(0, 1, 0));

            // Verify placement
            await new Promise(resolve => setTimeout(resolve, 1000));
            const placedBlock = bot.blockAt(targetPos);
            if (placedBlock && placedBlock.name === 'crafting_table') {
              this.logger.log('[ツールスキル] 地形整備後の作業台設置に成功しました！');
              return { success: true, workbench: placedBlock };
            }
          } catch (placeError) {
            this.logger.log(`[ツールスキル] 地形整備後の設置失敗: ${placeError.message}`);
            continue;
          }
        }
      } catch (error) {
        this.logger.log(`[ツールスキル] 地形整備エラー: ${error.message}`);
        continue;
      }
    }

    return { success: false, error: '地形整備による設置場所作成に失敗しました' };
  }

  // Simple wood gathering method for CraftToolsSkill
  async simpleWoodGathering(bot) {
    this.logger.log('[材料収集] 木材の自動収集を開始...');

    try {
      // Find a nearby tree
      const tree = bot.findBlock({
        matching: (block) => block && block.name.includes('_log'),
        maxDistance: 64
      });

      if (!tree) {
        this.logger.log('[材料収集] 近くに木が見つかりません');
        return { success: false, error: '木が見つかりません' };
      }

      this.logger.log(`[材料収集] 木材を発見: ${tree.position}`);

      // Basic movement to the tree
      try {
        await bot.lookAt(tree.position);
        const distance = bot.entity.position.distanceTo(tree.position);

        if (distance > 4) {
          bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, Math.min(distance * 500, 3000)));
          bot.setControlState('forward', false);
        }

        // Mine the tree
        await bot.dig(tree);
        this.logger.log(`[材料収集] ${tree.name}を収集しました`);

        // Wait for inventory update to sync
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify collection with detailed logging
        const postCollectionInventory = bot.inventory.items();
        this.logger.log(`[材料収集] 収集後インベントリ検査: ${postCollectionInventory.length}個のアイテム`);
        postCollectionInventory.forEach(item => {
          this.logger.log(`[材料収集] - ${item.name}: ${item.count}個`);
        });

        return { success: true };
      } catch (error) {
        this.logger.log(`[材料収集] 木材収集に失敗: ${error.message}`);
        return { success: false, error: `木材収集失敗: ${error.message}` };
      }
    } catch (error) {
      this.logger.log(`[材料収集] 木材収集中にエラー: ${error.message}`);
      return { success: false, error: `収集エラー: ${error.message}` };
    }
  }

  // Improved inventory detection methods
  countPlankItems(bot) {
    // Use InventoryUtils for consistent detection
    const totalPlanks = InventoryUtils.getPlanksCount(bot);
    this.logger.log(`[インベントリ検出] 板材総数: ${totalPlanks}`);

    // Debug: Show all plank items found
    const plankItems = InventoryUtils.findItemsByPattern(bot, '_planks');
    plankItems.forEach(item => {
      this.logger.log(`[インベントリ検出] 発見した板材: ${item.name} x${item.count}`);
    });

    return totalPlanks;
  }

  countLogItems(bot) {
    // Use InventoryUtils for consistent detection
    const totalLogs = InventoryUtils.getWoodCount(bot);
    this.logger.log(`[インベントリ検出] 原木総数: ${totalLogs}`);

    // Debug: Show all log items found
    const logItems = InventoryUtils.findItemsByPattern(bot, '_log');
    logItems.forEach(item => {
      this.logger.log(`[インベントリ検出] 発見した原木: ${item.name} x${item.count}`);
    });

    return totalLogs;
  }

  countItemsInInventoryByName(bot, itemName) {
    // Use InventoryUtils for consistent detection
    return InventoryUtils.getItemCount(bot, itemName);
  }

  // On-demand log to plank conversion
  async convertLogsToPlanksDemand(bot, logsToCraft) {
    this.logger.log(`[オンデマンド変換] ${logsToCraft}個の原木を板材に変換します`);

    try {
      const mcData = require('minecraft-data')(bot.version);

      // Find the first log type in inventory
      const logItem = bot.inventory.items().find(item =>
        item && item.name && item.name.includes('_log')
      );

      if (!logItem) {
        return { success: false, error: 'インベントリに原木がありません' };
      }

      // Get corresponding plank name
      const plankName = logItem.name.replace('_log', '_planks');
      const plankItem = mcData.itemsByName[plankName];

      if (!plankItem) {
        return { success: false, error: `対応する板材(${plankName})が見つかりません` };
      }

      // Get recipe for planks
      const plankRecipe = await SkillLibrary.getRecipeSafe(bot, plankItem.id, 1, null);
      if (!plankRecipe) {
        return { success: false, error: `${plankName}のレシピが見つかりません` };
      }

      // Convert logs to planks (one log = 4 planks)
      const totalConversions = Math.min(logsToCraft, logItem.count);

      for (let i = 0; i < totalConversions; i++) {
        try {
          await bot.craft(plankRecipe, 1, null);
          this.logger.log(`[オンデマンド変換] ${logItem.name} → ${plankName} (${i + 1}/${totalConversions})`);
        } catch (craftError) {
          this.logger.log(`[オンデマンド変換] クラフトエラー: ${craftError.message}`);
          if (i === 0) {
            return { success: false, error: `クラフト失敗: ${craftError.message}` };
          }
          break;
        }
      }

      const convertedPlanks = this.countPlankItems(bot);
      this.logger.log(`[オンデマンド変換] 変換完了: ${convertedPlanks}個の板材を確保`);
      return { success: true, planksConverted: convertedPlanks };
    } catch (error) {
      this.logger.log(`[オンデマンド変換] エラー: ${error.message}`);
      return { success: false, error: `変換エラー: ${error.message}` };
    }
  }

  async convertLogsToPlanksDynamic(bot, planksNeeded) {
    this.logger.log(`[動的変換] ${planksNeeded}個の板材が必要、原木から変換します`);

    try {
      const mcData = require('minecraft-data')(bot.version);

      // Find the first log type in inventory
      const logItem = bot.inventory.items().find(item =>
        item && item.name && item.name.includes('_log')
      );

      if (!logItem) {
        return { success: false, error: 'インベントリに原木がありません' };
      }

      // Get corresponding plank name
      const plankName = logItem.name.replace('_log', '_planks');
      const plankItem = mcData.itemsByName[plankName];

      if (!plankItem) {
        return { success: false, error: `対応する板材(${plankName})が見つかりません` };
      }

      // Get recipe for planks
      const plankRecipe = await SkillLibrary.getRecipeSafe(bot, plankItem.id, 1, null);
      if (!plankRecipe) {
        return { success: false, error: `${plankName}のレシピが見つかりません` };
      }

      // Calculate how many logs we need (1 log = 4 planks)
      const logsNeeded = Math.ceil(planksNeeded / 4);
      const totalConversions = Math.min(logsNeeded, logItem.count);

      let totalPlanksConverted = 0;
      for (let i = 0; i < totalConversions; i++) {
        try {
          await bot.craft(plankRecipe, 1, null);
          totalPlanksConverted += 4; // Each log produces 4 planks
          this.logger.log(`[動的変換] ${logItem.name} → ${plankName} (${i + 1}/${totalConversions})`);

          // Check if we have enough planks now
          if (totalPlanksConverted >= planksNeeded) {
            break;
          }
        } catch (craftError) {
          this.logger.log(`[動的変換] クラフトエラー: ${craftError.message}`);
          if (i === 0) {
            return { success: false, error: `クラフト失敗: ${craftError.message}` };
          }
          break;
        }
      }

      this.logger.log(`[動的変換] 変換完了: ${totalPlanksConverted}個の板材を作成`);
      return { success: true, converted: totalPlanksConverted };
    } catch (error) {
      this.logger.log(`[動的変換] エラー: ${error.message}`);
      return { success: false, error: `変換エラー: ${error.message}` };
    }
  }

  async createStickFromPlanks(bot, sticksNeeded) {
    this.logger.log(`[スティック作成] ${sticksNeeded}本のスティックが必要、板材から作成します`);

    try {
      const mcData = require('minecraft-data')(bot.version);

      // Find planks in inventory
      const plankItems = bot.inventory.items().filter(item =>
        item && item.name && item.name.includes('_planks')
      );

      if (plankItems.length === 0) {
        return { success: false, error: 'インベントリに板材がありません' };
      }

      const stickItem = mcData.itemsByName.stick;
      if (!stickItem) {
        return { success: false, error: 'スティックアイテムが見つかりません' };
      }

      const stickRecipe = await SkillLibrary.getRecipeSafe(bot, stickItem.id, 1, null);
      if (!stickRecipe) {
        return { success: false, error: 'スティックのレシピが見つかりません' };
      }

      // Calculate how many crafting operations we need (1 craft = 4 sticks, needs 2 planks)
      const craftsNeeded = Math.ceil(sticksNeeded / 4);
      const planksNeeded = craftsNeeded * 2;

      // Check if we have enough planks
      const totalPlanks = plankItems.reduce((sum, item) => sum + item.count, 0);
      if (totalPlanks < planksNeeded) {
        return { success: false, error: `板材不足: 必要${planksNeeded}個, 所持${totalPlanks}個` };
      }

      let totalSticksCreated = 0;
      for (let i = 0; i < craftsNeeded; i++) {
        try {
          await bot.craft(stickRecipe, 1, null);
          totalSticksCreated += 4; // Each craft produces 4 sticks
          this.logger.log(`[スティック作成] 板材 → スティック (${i + 1}/${craftsNeeded})`);

          // Check if we have enough sticks now
          if (totalSticksCreated >= sticksNeeded) {
            break;
          }
        } catch (craftError) {
          this.logger.log(`[スティック作成] クラフトエラー: ${craftError.message}`);
          if (i === 0) {
            return { success: false, error: `クラフト失敗: ${craftError.message}` };
          }
          break;
        }
      }

      this.logger.log(`[スティック作成] 作成完了: ${totalSticksCreated}本のスティックを作成`);
      return { success: true, created: totalSticksCreated };
    } catch (error) {
      this.logger.log(`[スティック作成] エラー: ${error.message}`);
      return { success: false, error: `作成エラー: ${error.message}` };
    }
  }
}

class CraftWorkbenchSkill extends Skill {
  constructor() {
    super('craft_workbench', 'Craft a workbench from collected logs');
  }

  async execute(bot, params, context) {
    return BasicSkills.craftWorkbench(bot, params, context);
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
        this.logger.log('[かまどスキル] かまどのレシピが見つかりません');
        bot.chat('かまどのレシピが見つかりません');
        return {
          success: false,
          reason: 'NO_RECIPE',
          details: { item: 'furnace', message: 'かまどのレシピが見つかりません' }
        };
      }

      // Craft the furnace
      if (workbench && !bot.currentWindow) {
        await bot.activateBlock(workbench);
      }
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
    this.logger.log(`[探索スキル] ${objective}目的で${direction}方向に${distance}ブロック探索開始`);

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

      this.logger.log(`[探索スキル] (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})を探索中...`);

      // Move to target position using MovementUtils
      const moveResult = await moveToPosition(bot, targetPos, 2);
      if (!moveResult.success) {
        this.logger.log(`[探索スキル] 探索位置への移動に失敗: ${moveResult.error}`);
        return { success: false, error: moveResult.error };
      }

      // Scan for points of interest after reaching destination
      this.logger.log('[探索スキル] 周辺スキャン中...');
      const scanResult = this.scanForInterestPoints(bot, objective);

      if (scanResult.found.length > 0) {
        this.logger.log(`[探索スキル] ${scanResult.found.length}個の興味深い地点を発見`);
        return { success: true, result: scanResult };
      } else {
        this.logger.log('[探索スキル] 興味深い地点は見つかりませんでした');
        return { success: true, message: '探索完了、興味深い地点なし' };
      }
    } catch (error) {
      this.logger.log('[探索スキル] 移動失敗、近場で探索続行');
      try {
        const scanResult = this.scanForInterestPoints(bot, objective);
        if (scanResult.found.length > 0) {
          return { success: true, result: scanResult, message: '移動失敗したが、近場で発見' };
        }
      } catch (scanError) {
        this.logger.log(`[探索スキル] スキャンエラー: ${scanError.message}`);
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

// 作業台設置スキル
class PlaceWorkbenchSkill extends Skill {
  constructor() {
    super('place_workbench', 'Place an existing workbench');
  }

  async execute(bot, params, context) {
    return BasicSkills.placeWorkbench(bot, params, context);
  }
}

class CraftWithWorkbenchSkill extends Skill {
  constructor() {
    super('craft_with_workbench', 'Craft an item at an existing workbench');
  }

  async execute(bot, params, context) {
    return BasicSkills.craftWithWorkbench(bot, params, context);
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
  ExploreSkill,
  PlaceWorkbenchSkill,
  CraftWithWorkbenchSkill
};
