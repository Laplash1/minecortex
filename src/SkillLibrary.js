const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const InventoryUtils = require('./InventoryUtils');
const { Logger } = require('./utils/Logger');
const { ensureProximity, moveToBlock, moveToPosition, moveToEntity } = require('./utils/MovementUtils');

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
        this.logger.log(`[移動スキル] 既に目的地に近いため移動をスキップ (距離: ${distance.toFixed(1)})`);
        return { success: true, message: '既に目的地付近にいます' };
      }

      this.logger.log(`[移動スキル] (${x}, ${y}, ${z})に移動中... (距離: ${distance.toFixed(1)})`);

      // Ensure pathfinder and movement settings are ready with proper error handling
      if (!bot.pathfinder) {
        try {
          bot.loadPlugin(pathfinder);
          // Wait for plugin to fully initialize
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (loadError) {
          this.logger.log(`[移動スキル] Pathfinder読み込み失敗: ${loadError.message}`);
          return { success: false, error: `Pathfinder初期化エラー: ${loadError.message}` };
        }
      }

      // Verify pathfinder is properly initialized
      if (!bot.pathfinder || typeof bot.pathfinder !== 'object') {
        this.logger.log('[移動スキル] Pathfinderが正しく初期化されていません');
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
          this.logger.log(`[移動スキル] Movement設定エラー: ${movementError.message}`);
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
            this.logger.log('[移動スキル] 水中でpathfinding困難、基本移動にフォールバック');
            return await this.executeBasicMovement(bot, x, y, z);
          }

          // Use appropriate goal type based on distance and height difference
          const currentPos = bot.entity.position;
          const heightDiff = Math.abs(y - currentPos.y);

          const pathStartTime = Date.now();
          // Use MovementUtils for consistent movement handling
          const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
          const range = (heightDiff > 2) ? 0 : 1;
          const moveResult = await moveToPosition(bot, targetPos, range, { timeoutMs: 12000 });

          if (!moveResult.success) {
            throw new Error(`MovementUtils移動に失敗: ${moveResult.error}`);
          }

          // パス計算結果をキャッシュに保存
          if (this.pathfindingCache && params.useCache !== false) {
            const pathResult = {
              path: [], // TODO: 実際のパスを取得
              status: 'success',
              time: Date.now() - pathStartTime
            };
            this.pathfindingCache.storePath(currentPos, { x, y, z }, pathResult, bot.username);
          }

          return { success: true, message: '目的地に到着しました' };
        } catch (gotoErr) {
          this.logger.log(`[移動スキル] goto失敗: ${gotoErr.message}`);

          // Enhanced error handling with specific fallback strategies
          if (gotoErr.message.includes('timeout') ||
              gotoErr.message.includes('path') ||
              gotoErr.message.includes('goal') ||
              gotoErr.message.includes('changed')) {
            this.logger.log('[移動スキル] パスファインディング問題を検出、基本移動にフォールバック');
            return await this.executeBasicMovement(bot, x, y, z);
          }

          // For other errors, try basic movement as well
          this.logger.log('[移動スキル] 未知のエラー、基本移動を試行');
          return await this.executeBasicMovement(bot, x, y, z);
        }
      }

      // Manual pathfinding with enhanced safety checks and error handling
      if (!bot.pathfinder.setGoal || !bot.pathfinder.on) {
        this.logger.log('[移動スキル] Pathfinder APIが利用できません、基本移動を試行');
        return await this.executeBasicMovement(bot, x, y, z);
      }

      // Clear any existing goals and setup new one
      try {
        bot.pathfinder.stop();
        await new Promise(resolve => setTimeout(resolve, 50)); // Brief pause

        const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
        bot.pathfinder.setGoal(goal);
      } catch (setupError) {
        this.logger.log(`[移動スキル] 目標設定エラー、基本移動を試行: ${setupError.message}`);
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
            this.logger.log(`[移動スキル] イベントリスナー削除エラー: ${cleanupError.message}`);
          }
        };

        try {
          if (bot.pathfinder && typeof bot.pathfinder.on === 'function' && typeof bot.pathfinder.setGoal === 'function') {
            bot.pathfinder.on('goal_reached', onGoalReached);
            bot.pathfinder.on('path_update', onPathUpdate);

            // Actually set the goal to start pathfinding
            this.logger.log(`[移動スキル] パスファインディング目標設定: (${x}, ${y}, ${z})`);
            const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
            bot.pathfinder.setGoal(goal);
          } else {
            resolved = true;
            cleanup();
            resolve({ success: false, error: 'PathfinderイベントハンドラーまたはsetGoalが利用できません' });
          }
        } catch (eventError) {
          this.logger.log(`[移動スキル] パスファインディング設定エラー: ${eventError.message}`);
          resolved = true;
          cleanup();
          resolve({ success: false, error: `パスファインディング設定エラー: ${eventError.message}` });
        }
      });
    } catch (error) {
      this.logger.log(`[移動スキル] エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Enhanced movement with obstacle detection, stuck detection, and water escape
  async executeBasicMovement(bot, x, y, z) {
    try {
      this.logger.log(`[移動スキル] 強化基本移動: (${x}, ${y}, ${z})`);

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
            this.logger.log('[移動スキル] 水中で移動困難、脱出を試行');
            continue;
          }

          // Look at target and move
          await bot.lookAt(new Vec3(targetX, currentPos.y, targetZ));

          // Check for obstacles ahead
          const obstacleCheck = await this.checkObstacleAhead(bot, targetX, targetZ);
          if (obstacleCheck.hasObstacle) {
            this.logger.log(`[移動スキル] 障害物検出: ${obstacleCheck.reason}`);

            // Try jumping over obstacle
            if (obstacleCheck.canJump) {
              this.logger.log('[移動スキル] ジャンプで障害物を回避');
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
            this.logger.log(`[移動スキル] スタック検出 ${stuckCount}/3`);

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
          this.logger.log(`[移動スキル] 移動ステップエラー: ${moveError.message}`);
          continue;
        }
      }

      return { success: false, error: '強化基本移動でも目的地に到達できませんでした' };
    } catch (error) {
      this.logger.log(`[移動スキル] 強化基本移動エラー: ${error.message}`);
      return { success: false, error: `強化基本移動失敗: ${error.message}` };
    }
  }

  // Handle out-of-sight blocks: approach and clear obstacles
  async handleOutOfSightBlock(bot, targetBlock, _lineOfSightResult) {
    try {
      this.logger.log(`[視界外対応] ${targetBlock.name}が視界外です。接近と障害物除去を試みます`);

      // Step 1: Move closer to target (within 2 blocks)
      const approachResult = await this.approachTarget(bot, targetBlock.position);
      if (!approachResult.success) {
        this.logger.log(`[視界外対応] 接近に失敗: ${approachResult.error}`);
        return { success: false, error: '接近失敗' };
      }

      // Step 2: Re-check line of sight after approaching
      const newLineOfSight = this.checkLineOfSight(bot, bot.entity.position, targetBlock.position);
      if (newLineOfSight.clear) {
        this.logger.log('[視界外対応] 接近後に視界が確保されました');
        return { success: true, approach: true };
      }

      // Step 3: Clear obstacles if still blocked
      if (newLineOfSight.obstacleBlocks && newLineOfSight.obstacleBlocks.length > 0) {
        this.logger.log(`[視界外対応] ${newLineOfSight.obstacleBlocks.length}個の障害物を除去します`);

        for (const obstacle of newLineOfSight.obstacleBlocks.slice(0, 3)) { // Limit to 3 blocks
          const obstacleDistance = bot.entity.position.distanceTo(obstacle.position);

          if (obstacleDistance <= 3.0) {
            this.logger.log(`[視界外対応] 障害物 ${obstacle.name} を除去中...`);

            try {
              // Equip appropriate tool for obstacle
              await this.equipAppropriateToolForBlock(bot, obstacle.name);
              await bot.dig(obstacle);

              // Wait for obstacle removal
              await new Promise(resolve => setTimeout(resolve, 500));
              this.logger.log(`[視界外対応] 障害物 ${obstacle.name} を除去しました`);
            } catch (digError) {
              this.logger.log(`[視界外対応] 障害物除去失敗: ${digError.message}`);
              continue; // Try next obstacle
            }
          }
        }

        // Final check after obstacle removal
        const finalLineOfSight = this.checkLineOfSight(bot, bot.entity.position, targetBlock.position);
        if (finalLineOfSight.clear) {
          this.logger.log('[視界外対応] 障害物除去後に視界が確保されました');
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
      this.logger.log(`[接近] 目標位置 ${targetPosition} に接近中...`);

      // Use MovementUtils for consistent movement handling
      const moveResult = await moveToPosition(bot, targetPosition, 2.0);
      if (moveResult.success) {
        return { success: true };
      } else {
        this.logger.log('[接近] 目標位置に到達できませんでした');
        return { success: false, error: moveResult.error };
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
      this.logger.log(`[移動スキル] ${fluidType}中検出、強化脱出システム開始`);

      // Priority 1: Find nearby land blocks
      const landResult = await this.findNearestLand(bot, pos);
      if (landResult.found) {
        this.logger.log(`[移動スキル] 陸地を発見: ${landResult.direction}方向`);
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

      this.logger.log('[移動スキル] 全ての脱出方法が失敗');
      return { success: false, inWater: true, error: `${fluidType}中脱出に失敗` };
    } catch (error) {
      this.logger.log(`[移動スキル] 水中脱出エラー: ${error.message}`);
      return { success: false, inWater: true, error: error.message };
    }
  }

  async findNearestLand(bot, currentPos) {
    try {
      this.logger.log('[移動スキル] 周辺の陸地検索中...');

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
            this.logger.log(`[移動スキル] 陸地発見: ${dir.name}方向 ${distance}ブロック先`);
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
      this.logger.log(`[移動スキル] 陸地検索エラー: ${error.message}`);
      return { found: false };
    }
  }

  async escapeToLand(bot, landInfo) {
    try {
      this.logger.log(`[移動スキル] ${landInfo.direction}の陸地へ脱出中...`);

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
          this.logger.log(`[移動スキル] ${landInfo.direction}陸地への脱出成功`);
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
      this.logger.log(`[移動スキル] 陸地脱出エラー: ${error.message}`);
      return { success: false };
    }
  }

  async performEnhancedEscape(bot, pos, _fluidType) {
    try {
      this.logger.log('[移動スキル] 強化方向脱出を実行中...');

      // Try 12 directions (more granular than before)
      for (let i = 0; i < 12; i++) {
        const escapeAngle = (i * Math.PI * 2) / 12;
        const escapeX = Math.cos(escapeAngle);
        const escapeZ = Math.sin(escapeAngle);

        this.logger.log(`[移動スキル] 方向 ${i + 1}/12 での脱出試行`);

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
          this.logger.log(`[移動スキル] 方向脱出成功 (方向 ${i + 1})`);
          return { success: true };
        }

        // Brief pause between attempts
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      bot.setControlState('jump', false);
      return { success: false };
    } catch (error) {
      bot.setControlState('jump', false);
      this.logger.log(`[移動スキル] 強化脱出エラー: ${error.message}`);
      return { success: false };
    }
  }

  async performVerticalEscape(bot, pos, _fluidType) {
    try {
      this.logger.log('[移動スキル] 垂直脱出を実行中...');

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
          this.logger.log(`[移動スキル] 垂直脱出成功 (${i + 1}回試行)`);
          return { success: true };
        }

        // Check if we're making progress upward
        if (newPos.y > pos.y + 2) {
          this.logger.log(`[移動スキル] 上昇中... Y: ${pos.y.toFixed(1)} → ${newPos.y.toFixed(1)}`);
          pos = newPos; // Update position reference
        }
      }

      bot.setControlState('jump', false);
      return { success: false };
    } catch (error) {
      bot.setControlState('jump', false);
      this.logger.log(`[移動スキル] 垂直脱出エラー: ${error.message}`);
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
      this.logger.log(`[移動スキル] 障害物検出エラー: ${error.message}`);
      return { hasObstacle: false };
    }
  }

  // Unstuck maneuvers when bot gets stuck
  async performUnstuckManeuvers(bot) {
    try {
      this.logger.log('[移動スキル] スタック解除マニューバを実行');

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
          this.logger.log('[移動スキル] スタック解除成功');
          return { success: true };
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      this.logger.log('[移動スキル] スタック解除失敗');
      return { success: false };
    } catch (error) {
      this.logger.log(`[移動スキル] スタック解除エラー: ${error.message}`);
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
    this.logger.log(`[マイニング] ${blockType}を${amount}個採取開始`);

    let successfulMines = 0;
    const targetAmount = amount;
    let consecutiveFailures = 0;
    const blacklist = new Set(); // 失敗ブロックのブラックリスト

    // Check initial inventory to track collected items
    const initialItems = this.countItemsInInventory(bot, blockType);
    this.logger.log(`[マイニング] 開始時の${blockType}所持数: ${initialItems}個`);

    // Mining loop until we have enough items
    while (successfulMines < targetAmount) {
      let block;

      this.logger.log(`[マイニング] 進捗: ${successfulMines}/${targetAmount}個採取済み`);

      if (position && successfulMines === 0) {
        // Only use position for first block
        block = bot.blockAt(position);
        if (!block || block.name !== blockType) {
          this.logger.log(`[マイニング] 指定位置に${blockType}がありません: ${block ? block.name : 'null'}`);
          return { success: false, reason: 'TARGET_NOT_FOUND', details: { type: blockType, position } };
        }
      } else {
        // Stage 1: Find block nearby with progressive search using blacklist
        block = this.findBlockWithProgressiveSearch(bot, blockType, blacklist);
      }

      if (!block) {
        this.logger.log(`[マイニング] ${blockType}が見つかりません。`);
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
        this.logger.log(`[マイニング] ${block.name}は採掘可能範囲外: ${reachabilityCheck.reason}`);

        // 視線が遮られている場合、障害物除去を試行
        if (reachabilityCheck.reason.includes('視線が遮られています')) {
          this.logger.log('[マイニング] 視線を遮る障害物の除去を試みます...');
          const clearResult = await this.handleOutOfSightBlock(bot, block, reachabilityCheck);
          if (clearResult.success) {
            this.logger.log('[マイニング] 障害物除去成功、再試行します。');
            continue; // 同じブロックで再試行
          } else {
            this.logger.log('[マイニング] 障害物除去失敗、このブロックは諦めます。');
            if (block && block.position) {
              blacklist.add(block.position.toString());
            }
            continue;
          }
        }

        // Try to move closer to the block
        const moveResult = await this.moveToMiningPosition(bot, block);
        if (!moveResult.success) {
          this.logger.log(`[マイニング] 移動失敗、次のブロックを探します: ${moveResult.error}`);
          if (block && block.position) {
            blacklist.add(block.position.toString()); // 移動失敗でもブラックリストへ
          }
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
          this.logger.log(`[マイニング] 移動後も採掘不可、次のブロックを探します: ${recheckResult.reason}`);
          if (block && block.position) {
            blacklist.add(block.position.toString()); // 再チェック失敗でもブラックリストへ
          }
          continue; // Try next block instead of failing completely
        }
      }

      // Additional strict line of sight check before mining
      const finalLineOfSight = this.checkLineOfSight(bot, bot.entity.position, block.position);
      if (!finalLineOfSight.clear) {
        this.logger.log(`[マイニング] 採掘直前の視線チェック失敗: ${finalLineOfSight.obstacle}`);
        if (block && block.position) {
          blacklist.add(block.position.toString()); // 最終チェック失敗でもブラックリストへ
        }
        continue;
      }

      // Check inventory space before mining
      const inventoryCheck = this.checkInventorySpace(bot);
      if (!inventoryCheck.hasSpace) {
        this.logger.log('[マイニング] インベントリが満杯です。整理を試みます...');
        const cleanupResult = await this.cleanupInventory(bot);
        if (!cleanupResult.success) {
          this.logger.log('[マイニング] インベントリ整理失敗、次のブロックを探します');
          continue; // Try to continue rather than fail completely
        }
      }

      try {
        // Final distance check before mining - prevent mining from 3+ blocks away
        if (!block || !block.position) {
          this.logger.log('[マイニング] ブロックまたはポジションが無効です');
          continue;
        }
        const finalDistance = bot.entity.position.distanceTo(block.position);
        if (finalDistance >= 3.0) {
          this.logger.log(`[マイニング] 採掘距離が遠すぎます: ${finalDistance.toFixed(2)}ブロック (制限: 3.0ブロック未満)`);
          if (block && block.position) {
            blacklist.add(block.position.toString());
          }
          continue; // Try next block instead of failing completely
        }

        // Check if block requires a tool and equip appropriate tool
        const toolCheck = await this.equipAppropriateToolForBlock(bot, block);
        if (!toolCheck.success) {
          this.logger.log(`[マイニング] ツール装備失敗: ${toolCheck.error}`);
          return { success: false, reason: toolCheck.reason || 'NO_TOOL', details: toolCheck.details };
        }

        const toolInfo = toolCheck.toolUsed ? ` - ツール: ${toolCheck.toolUsed}` : '';
        this.logger.log(`[マイニング] ${block.position}で${block.name}を採掘中... (距離: ${finalDistance.toFixed(2)}ブロック)${toolInfo}`);

        // Store position for item collection
        const miningPosition = block.position.clone();

        // Check tool durability before mining if tool is used
        if (toolCheck.toolUsed) {
          const toolDurabilityCheck = this.checkToolDurability(bot);
          if (!toolDurabilityCheck.usable) {
            this.logger.log(`[マイニング] ツール耐久度不足: ${toolDurabilityCheck.warning}`);
            // Try to craft or find a replacement tool before critical failure
            const replacementResult = await this.handleLowDurabilityTool(bot, toolCheck.toolUsed);
            if (!replacementResult.success) {
              this.logger.log(`[マイニング] ツール交換失敗、次のブロックを探します: ${toolDurabilityCheck.warning}`);
              continue; // Try to continue with next block
            }
          }
        }

        await bot.dig(block);
        this.logger.log(`[マイニング] ${block.name}を採掘完了`);

        // Wait for items to drop and settle
        await new Promise(resolve => setTimeout(resolve, 500));

        // Collect dropped items
        const collectionResult = await this.collectDroppedItems(bot, miningPosition);
        if (collectionResult.itemsCollected > 0) {
          this.logger.log(`[マイニング] ${collectionResult.itemsCollected}個のアイテムを回収しました`);
          bot.chat(`${block.name}を採掘して${collectionResult.itemsCollected}個のアイテムを回収！ ⛏️`);
        } else {
          bot.chat(`${block.name}を採掘しました！ ⛏️`);
        }

        successfulMines++;
        consecutiveFailures = 0; // 成功したらリセット
        this.logger.log(`[マイニング] 採掘成功! 進捗: ${successfulMines}/${targetAmount}個`);

        // Check if we have enough items in inventory (more accurate than just counting mines)
        const currentItems = this.countItemsInInventory(bot, blockType);
        const itemsGained = currentItems - initialItems;

        if (itemsGained >= targetAmount) {
          this.logger.log(`[マイニング] 目標達成! ${blockType}を${itemsGained}個取得しました`);
          break;
        }

        // Short wait before next mining attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        this.logger.log(`[マイニング] 採掘に失敗: ${error.message}`);
        if (block && block.position) {
          blacklist.add(block.position.toString()); // 採掘失敗でもブラックリストへ
        }
        // Don't return here, continue to next iteration or exit loop
        continue;
      }
    } // End of while loop

    // Final result calculation
    const finalItems = this.countItemsInInventory(bot, blockType);
    const totalItemsGained = finalItems - initialItems;

    if (totalItemsGained >= targetAmount) {
      this.logger.log(`[マイニング] タスク完了! ${blockType}を${totalItemsGained}個取得 (目標: ${targetAmount}個)`);
      bot.chat(`${blockType}採取完了! ${totalItemsGained}個取得しました！ ⛏️`);
      return {
        success: true,
        message: `${blockType}を${totalItemsGained}個採取しました`,
        itemsCollected: totalItemsGained,
        targetReached: true
      };
    } else {
      this.logger.log(`[マイニング] 部分的成功: ${blockType}を${totalItemsGained}個取得 (目標: ${targetAmount}個)`);
      return {
        success: totalItemsGained > 0,
        message: `${blockType}を${totalItemsGained}個採取しました (目標未達成)`,
        itemsCollected: totalItemsGained,
        targetReached: false
      };
    }
  }

  async digDownForStone(bot, blockType) {
    this.logger.log(`[マイニング] ${blockType}を求めて地下探索開始...`);

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
            this.logger.log(`[マイニング] 地下で${blockBelow.name}を発見！`);
            await bot.dig(blockBelow);
            bot.chat(`地下で${blockBelow.name}を採掘しました！ ⛏️`);
            return { success: true, message: `地下で${blockBelow.name}を採掘しました` };
          } catch (error) {
            this.logger.log(`[マイニング] 地下採掘失敗: ${error.message}`);
            continue;
          }
        }

        // Dig the block to go deeper
        try {
          await bot.dig(blockBelow);
        } catch (error) {
          this.logger.log(`[マイニング] 掘削失敗: ${error.message}`);
          break;
        }

        // Move down if possible
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for movement
      } else {
        // Hit air or water, stop digging
        break;
      }
    }

    this.logger.log(`[マイニング] 地下探索でも${blockType}が見つかりませんでした`);
    return { success: false, error: `地下探索でも${blockType}が見つかりません` };
  }

  findBlockWithProgressiveSearch(bot, blockType, blacklist = new Set()) {
    this.logger.log(`[マイニング] ${blockType}の段階的探索を開始...`);

    // Start with close-range search and expand for better coverage
    const searchRadii = [16, 32, 64, 128]; // Extended search range

    for (const radius of searchRadii) {
      this.logger.log(`[マイニング] ${radius}ブロック範囲で${blockType}を探索中...`);

      const block = bot.findBlock({
        matching: (candidate) => {
          if (!candidate || !candidate.name || !candidate.position) return false;

          // ブラックリストに含まれていれば除外
          try {
            if (blacklist.has(candidate.position.toString())) {
              return false;
            }
          } catch (positionError) {
            // position.toString()でエラーが発生した場合は除外
            this.logger.log(`[マイニング] ポジション参照エラー: ${positionError.message}`);
            return false;
          }

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
        this.logger.log(`[マイニング] ${radius}ブロック範囲で発見: ${block.name} at ${block.position}`);
        return block;
      }
    }

    // Enhanced fallback search for specific block types
    this.logger.log('[マイニング] 標準探索失敗、特殊検索開始...');

    if (typeof blockType === 'string') {
      const fallbackBlock = this.findSimilarBlocks(bot, blockType, blacklist);
      if (fallbackBlock) {
        this.logger.log(`[マイニング] 代替ブロック発見: ${fallbackBlock.name}`);
        return fallbackBlock;
      }
    }

    this.logger.log(`[マイニング] 全ての探索方法で${blockType}が見つかりませんでした`);
    return null;
  }

  findSimilarBlocks(bot, blockType, blacklist = new Set()) {
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

    this.logger.log(`[マイニング] ${blockType}の代替ブロックを検索中: ${targetGroup.join(', ')}`);

    // Search for any block in the same group
    for (const radius of [32, 64, 96]) {
      const block = bot.findBlock({
        matching: (candidate) => {
          if (!candidate || !candidate.name || !candidate.position) return false;

          // ブラックリストに含まれていれば除外
          try {
            if (blacklist.has(candidate.position.toString())) {
              return false;
            }
          } catch (positionError) {
            // position.toString()でエラーが発生した場合は除外
            this.logger.log(`[マイニング] ポジション参照エラー: ${positionError.message}`);
            return false;
          }

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
          this.logger.log(`[マイニング] ${radius}ブロック範囲で代替発見: ${block.name} (距離: ${distance.toFixed(2)})`);
          return block;
        } else {
          this.logger.log(`[マイニング] 代替ブロック発見したが距離が遠すぎます: ${distance.toFixed(2)}ブロック (制限: 3.0ブロック未満)`);
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
      this.logger.log(`[マイニング] 視界内ブロック検索エラー: ${error.message}`);
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

  // Move bot to optimal mining position
  async moveToMiningPosition(bot, block) {
    try {
      const blockPos = block.position;

      this.logger.log(`[マイニング] 採掘位置への移動開始: ${blockPos}`);

      // Move to within 2.5 blocks of the block for reliable mining
      this.logger.log(`[マイニング] 採掘可能距離内(2.5ブロック)への移動を実行: ${blockPos}`);

      // Use MovementUtils for consistent movement handling
      const moveResult = await moveToPosition(bot, blockPos, 2.5);
      if (moveResult.success) {
        return { success: true };
      } else {
        this.logger.log(`[マイニング] 採掘位置への移動に失敗: ${moveResult.error}`);
        return { success: false, error: moveResult.error };
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
      this.logger.log(`[マイニング] インベントリチェックエラー: ${error.message}`);
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
      this.logger.log('[マイニング] インベントリ整理開始');

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
            this.logger.log(`[マイニング] ${item.name}を${dropCount}個破棄しました`);

            // Check if we have enough space now
            const spaceCheck = this.checkInventorySpace(bot);
            if (spaceCheck.freeSlots >= 3) {
              break;
            }
          } catch (error) {
            this.logger.log(`[マイニング] アイテム破棄エラー: ${error.message}`);
          }
        }
      }

      if (itemsDropped > 0) {
        this.logger.log(`[マイニング] インベントリ整理完了: ${itemsDropped}個のアイテムを破棄`);
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
      this.logger.log('[マイニング] ドロップアイテム回収開始');

      let itemsCollected = 0;
      const maxCollectionTime = 15000; // Increased to 15 seconds for thorough collection
      const startTime = Date.now();
      let lastItemCount = -1;
      let consecutiveNoItemChecks = 0;

      // Store initial inventory count for accurate tracking
      const initialInventoryCount = bot.inventory.items().length;
      this.logger.log(`[マイニング] 回収前インベントリアイテム数: ${initialInventoryCount}`);

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
        this.logger.log(`[マイニング] 発見したアイテム: ${droppedItems.length}個 (座標: ${coords})`);

        if (droppedItems.length === 0) {
          consecutiveNoItemChecks++;
          // If no items found multiple times, likely no more items to collect
          if (consecutiveNoItemChecks >= 3 && Date.now() - startTime > 3000) {
            this.logger.log('[マイニング] アイテムが見つからないため回収終了');
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
          if (!a.position || !b.position) return 0;
          const distA = bot.entity.position.distanceTo(a.position);
          const distB = bot.entity.position.distanceTo(b.position);
          return distA - distB;
        });

        // Move to each dropped item and collect it
        for (const itemEntity of droppedItems) {
          try {
            if (!itemEntity || !itemEntity.position) {
              this.logger.log('[マイニング] アイテムエンティティまたはポジションが無効です');
              continue;
            }
            const distance = bot.entity.position.distanceTo(itemEntity.position);
            this.logger.log(`[マイニング] アイテムまでの距離: ${distance.toFixed(2)}ブロック`);

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
                    this.logger.log(`[マイニング] アイテムに接近完了: ${newDistance.toFixed(2)}ブロック`);
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
              this.logger.log(`[マイニング] アイテム回収成功: ${itemsCollected}個目`);
            } else {
              this.logger.log(`[マイニング] アイテム回収失敗: アイテムID ${itemEntity.id} がまだ存在`);
              // Try additional pickup attempts for stubborn items
              await bot.lookAt(itemEntity.position);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (error) {
            this.logger.log(`[マイニング] アイテム回収エラー: ${error.message}`);
          }
        }

        // Wait between collection cycles for stability
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      // Final inventory check
      const finalInventoryCount = bot.inventory.items().length;
      const actualItemsGained = finalInventoryCount - initialInventoryCount;

      this.logger.log(`[マイニング] 回収後インベントリアイテム数: ${finalInventoryCount}`);
      this.logger.log(`[マイニング] 実際に増加したアイテム数: ${actualItemsGained}`);
      this.logger.log(`[マイニング] アイテム回収完了: 検出${itemsCollected}個, 実際${actualItemsGained}個`);

      return {
        success: true,
        itemsCollected: Math.max(itemsCollected, actualItemsGained)
      };
    } catch (error) {
      this.logger.log(`[マイニング] アイテム回収処理エラー: ${error.message}`);
      return {
        success: false,
        itemsCollected: 0,
        error: error.message
      };
    }
  }

  // Tool management for mining different block types
  async equipAppropriateToolForBlock(bot, block) {
    this.logger.log(`[ツール管理] ${block.name}の採掘に適したツールを装備します`);
    const blockName = block.name;

    // Tool hierarchy with mining levels and durability (Gemini collaboration)
    const toolHierarchy = {
      wooden: { level: 1, durability: 59 },
      golden: { level: 1, durability: 32 }, // 金は速いが木と同じレベル
      stone: { level: 2, durability: 131 },
      iron: { level: 3, durability: 250 },
      diamond: { level: 4, durability: 1561 }, // 存在は定義するが、作成ロジックからは除外
      netherite: { level: 5, durability: 2031 }
    };

    // Block mining requirements with required tool levels
    const blockMiningRequirements = {
      coal_ore: { requiredLevel: 1 },
      copper_ore: { requiredLevel: 2 },
      iron_ore: { requiredLevel: 2 },
      lapis_ore: { requiredLevel: 2 },
      gold_ore: { requiredLevel: 3 },
      redstone_ore: { requiredLevel: 3 },
      diamond_ore: { requiredLevel: 3 },
      emerald_ore: { requiredLevel: 3 },
      obsidian: { requiredLevel: 4 },
      ancient_debris: { requiredLevel: 4 },
      // Deepslate variants
      deepslate_coal_ore: { requiredLevel: 1 },
      deepslate_copper_ore: { requiredLevel: 2 },
      deepslate_iron_ore: { requiredLevel: 2 },
      deepslate_lapis_ore: { requiredLevel: 2 },
      deepslate_gold_ore: { requiredLevel: 3 },
      deepslate_redstone_ore: { requiredLevel: 3 },
      deepslate_diamond_ore: { requiredLevel: 3 },
      deepslate_emerald_ore: { requiredLevel: 3 },
      // Stone variants
      stone: { requiredLevel: 1 },
      cobblestone: { requiredLevel: 1 },
      deepslate: { requiredLevel: 1 },
      // Nether ores
      nether_quartz_ore: { requiredLevel: 1 },
      nether_gold_ore: { requiredLevel: 1 },
      // Default for hand-minable blocks
      default: { requiredLevel: 0 }
    };

    // Get block mining requirement
    const requirement = blockMiningRequirements[blockName] ||
                       (blockName.includes('ore') ? blockMiningRequirements.iron_ore : blockMiningRequirements.default);
    const requiredLevel = requirement.requiredLevel;

    this.logger.log(`[ツール管理] ${blockName}の採掘に必要なレベル: ${requiredLevel}`);

    // If hand-minable
    if (requiredLevel === 0) {
      this.logger.log(`[ツール管理] ${blockName}は素手で採掘可能`);
      return { success: true, toolUsed: 'hand' };
    }

    // Find best tool in inventory
    const inventory = bot.inventory.items();
    const pickaxes = inventory.filter(item => item.name && item.name.includes('_pickaxe'));

    let bestTool = null;
    let bestLevel = -1;

    for (const tool of pickaxes) {
      const toolType = tool.name.split('_')[0];
      const toolInfo = toolHierarchy[toolType];

      if (toolInfo && toolInfo.level >= requiredLevel) {
        // より高いレベルのツールを優先
        if (toolInfo.level > bestLevel) {
          bestLevel = toolInfo.level;
          bestTool = tool;
        }
      }
    }

    // Equip best available tool
    if (bestTool) {
      try {
        await bot.equip(bestTool, 'hand');
        this.logger.log(`[ツール管理] ${bestTool.name}を装備しました (レベル${bestLevel})`);
        return { success: true, toolUsed: bestTool.name };
      } catch (err) {
        this.logger.error(`[ツール管理] ${bestTool.name}の装備に失敗: ${err.message}`);
        return { success: false, error: 'ツールの装備に失敗しました' };
      }
    }

    // No appropriate tool found - try to craft one
    this.logger.log(`[ツール管理] ${blockName}の採掘に適したツールがありません。作成を試みます...`);
    bot.chat(`${blockName}を掘るための適切な道具がないので、作ってみます。`);

    const craftResult = await this.craftBestAvailablePickaxe(bot);
    if (craftResult.success && craftResult.toolName) {
      const newTool = bot.inventory.items().find(item => item.name === craftResult.toolName);
      if (newTool) {
        try {
          await bot.equip(newTool, 'hand');
          this.logger.log(`[ツール管理] 新しく作成した ${craftResult.toolName}を装備しました`);
          return { success: true, toolUsed: craftResult.toolName };
        } catch (err) {
          return { success: false, error: '作成したツールの装備に失敗しました' };
        }
      }
    }

    this.logger.error(`[ツール管理] ${blockName}に必要なツールの作成に失敗しました`);
    bot.chat('適切な道具の作成に失敗しました。');
    return { success: false, error: '適切なツールがなく、作成もできませんでした', reason: 'NO_TOOL' };
  }


  // Craft best available pickaxe (Gemini collaboration)
  async craftBestAvailablePickaxe(bot) {
    this.logger.log('[ツール作成] 利用可能な最良のピッケルの作成を開始...');

    // Check if we have sticks, if not try to create them
    const hasSticks = bot.inventory.items().some(item => item.name === 'stick' && item.count >= 2);
    if (!hasSticks) {
      this.logger.log('[ツール作成] 棒が不足しているため、作成を試みます');
      const craftSticksSkill = this.getSkill('craft_tools');
      if (craftSticksSkill) {
        const stickResult = await craftSticksSkill.execute(bot, { toolName: 'stick', amount: 4 });
        if (!stickResult.success) {
          return { success: false, error: 'ツールの柄となる棒の作成に失敗しました' };
        }
      }
    }

    const bestMaterial = SkillLibrary.findBestAvailableToolMaterial(bot, null, 'pickaxe');
    if (!bestMaterial) {
      return { success: false, error: 'ツール作成に必要な素材（鉱石や石、木材）がありません' };
    }

    const { tool: toolToCraft } = bestMaterial;
    const craftSkill = this.getSkill('craft_tools');
    if (!craftSkill) {
      return { success: false, error: 'CraftToolsSkillが見つかりません' };
    }

    this.logger.log(`[ツール作成] ${toolToCraft} の作成を試みます...`);
    const craftResult = await craftSkill.execute(bot, {
      toolName: toolToCraft,
      amount: 1
    });

    if (craftResult.success) {
      this.logger.log(`[ツール作成] ${toolToCraft} の作成に成功しました`);
      return { success: true, toolName: toolToCraft };
    } else {
      this.logger.error(`[ツール作成] ${toolToCraft} の作成に失敗しました: ${craftResult.error}`);
      return { success: false, error: `${toolToCraft}の作成に失敗: ${craftResult.error}` };
    }
  }

  // Legacy tool requirements (for backward compatibility)
  getLegacyToolRequirements() {
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

    return toolRequirements;
  }

  // Tool management method for mining operations
  async manageTool(bot, blockName) {
    const toolRequirements = this.getLegacyToolRequirements();
    const requiredTools = toolRequirements[blockName];

    // If no specific tool is required, no tool needed (like dirt, grass, etc.)
    if (!requiredTools) {
      this.logger.log(`[ツール管理] ${blockName}は素手で採掘可能`);
      return { success: true, toolUsed: null };
    }

    // Check current equipped item
    const currentItem = bot.heldItem;
    if (currentItem && requiredTools.includes(currentItem.name)) {
      this.logger.log(`[ツール管理] 適切なツールが既に装備されています: ${currentItem.name}`);
      return { success: true, toolUsed: currentItem.name };
    }

    // Find the best available tool from inventory
    const availableTools = bot.inventory.items().filter(item =>
      item && item.name && requiredTools.includes(item.name)
    );

    if (availableTools.length === 0) {
      this.logger.log(`[ツール管理] ${blockName}に必要なツールがありません: ${requiredTools.join(', ')}`);

      // Try to craft basic tools if we have materials
      const craftResult = await this.tryToCraftBasicPickaxe(bot);
      if (craftResult.success) {
        this.logger.log(`[ツール管理] 基本ツールを作成しました: ${craftResult.toolName}`);
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
      this.logger.log(`[ツール管理] ${bestTool.name}を装備しました (${blockName}採掘用)`);
      return { success: true, toolUsed: bestTool.name };
    } catch (error) {
      this.logger.log(`[ツール管理] ツール装備に失敗: ${error.message}`);
      return { success: false, error: `ツール装備失敗: ${error.message}` };
    }
  }

  // Try to craft a basic pickaxe if materials are available
  async tryToCraftBasicPickaxe(bot) {
    this.logger.log('[ツール作成] 基本ピッケルの作成を試みます...');

    // Step 1: Ensure we have or can get a workbench
    const workbenchResult = await this.ensureWorkbench(bot);
    if (!workbenchResult.success) {
      this.logger.log(`[ツール作成] 作業台の確保に失敗: ${workbenchResult.error}`);

      // Try to gather materials automatically
      if (workbenchResult.error.includes('材料不足')) {
        this.logger.log('[ツール作成] 材料不足のため自動収集を試みます...');
        const gatherResult = await this.simpleWoodGathering(bot);

        if (gatherResult.success) {
          this.logger.log('[ツール作成] 材料収集成功、作業台確保を再試行...');
          const retryWorkbenchResult = await this.ensureWorkbench(bot);
          if (retryWorkbenchResult.success) {
            this.logger.log('[ツール作成] 材料収集後の作業台確保成功');
          } else {
            return { success: false, error: `材料収集後も作業台確保失敗: ${retryWorkbenchResult.error}` };
          }
        } else {
          return { success: false, error: `材料収集失敗: ${gatherResult.error}` };
        }
      } else {
        return { success: false, error: `作業台不足: ${workbenchResult.error}` };
      }
    }

    const inventory = bot.inventory.items();

    // Check for sticks first
    const sticks = inventory.filter(item => item && item.name === 'stick');
    const totalSticks = sticks.reduce((sum, item) => sum + item.count, 0);

    if (totalSticks < 2) {
      this.logger.log(`[ツール作成] スティック不足: 必要2本, 現在${totalSticks}本`);

      // Try to craft sticks from planks
      const planks = inventory.filter(item =>
        item && item.name && item.name.includes('_planks')
      );
      const totalPlanks = planks.reduce((sum, item) => sum + item.count, 0);

      if (totalPlanks >= 2) {
        this.logger.log('[ツール作成] 板材からスティックを作成します...');
        try {
          const mcData = require('minecraft-data')(bot.version);
          const stickItem = mcData.itemsByName.stick;
          if (stickItem) {
            const stickRecipes = bot.recipesFor(stickItem.id, null, 1, null);
            if (stickRecipes.length > 0) {
              await bot.craft(stickRecipes[0], 1, null);
              this.logger.log('[ツール作成] スティックを作成しました');
            }
          }
        } catch (error) {
          this.logger.log(`[ツール作成] スティック作成に失敗: ${error.message}`);
        }
      } else {
        // No planks available, try to get wood
        this.logger.log('[ツール作成] 板材不足、木材の収集を試みます...');
        const woodResult = await this.gatherWoodForCrafting(bot);
        if (woodResult.success) {
          this.logger.log('[ツール作成] 木材収集成功、板材を作成します...');
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
                  this.logger.log('[ツール作成] 木材から板材経由でスティックを作成しました');
                }
              }
            } catch (error) {
              this.logger.log(`[ツール作成] 板材からスティック作成失敗: ${error.message}`);
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
      this.logger.log(`[ツール耐久度] 耐久度情報取得エラー: ${error.message}`);
      return { usable: true, durability: null };
    }

    if (maxDurability === 0) {
      return { usable: true, durability: null }; // Tool doesn't have durability
    }

    const remainingDurability = maxDurability - damage;
    const durabilityPercentage = (remainingDurability / maxDurability) * 100;

    const durabilityInfo = `${remainingDurability}/${maxDurability} (${durabilityPercentage.toFixed(1)}%)`;
    this.logger.log(`[ツール耐久度] ${currentTool.name}: ${durabilityInfo}`);

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
    this.logger.log(`[ツール管理] ${currentToolName}の交換または修理を試みます`);

    // First, try to find a replacement tool of the same type
    const replacementTool = bot.inventory.items().find(item =>
      item && item.name === currentToolName && item !== bot.heldItem
    );

    if (replacementTool) {
      this.logger.log(`[ツール管理] 代替ツールを発見: ${replacementTool.name}`);
      try {
        await bot.equip(replacementTool, 'hand');
        this.logger.log(`[ツール管理] ${replacementTool.name}に交換しました`);
        return { success: true, action: 'replaced' };
      } catch (error) {
        this.logger.log(`[ツール管理] ツール交換失敗: ${error.message}`);
      }
    }

    // If no replacement found, try to craft a new one
    this.logger.log('[ツール管理] 代替ツールが見つかりません。新しいツールの作成を試みます');
    const craftResult = await this.tryToCraftBasicPickaxe(bot);

    if (craftResult.success) {
      this.logger.log(`[ツール管理] 新しいツールを作成しました: ${craftResult.toolName}`);
      const newTool = bot.inventory.items().find(item => item.name === craftResult.toolName);
      if (newTool) {
        try {
          await bot.equip(newTool, 'hand');
          this.logger.log(`[ツール管理] 新しいツール ${newTool.name} を装備しました`);
          return { success: true, action: 'crafted' };
        } catch (error) {
          this.logger.log(`[ツール管理] 新ツール装備失敗: ${error.message}`);
        }
      }
    }

    return { success: false, error: 'ツール交換・作成に失敗しました' };
  }

  // Ensure a workbench is available for crafting
  async ensureWorkbench(bot) {
    this.logger.log('[作業台管理] 作業台の確保を開始...');

    // Check if a workbench is already placed nearby
    const workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 8
    });

    if (workbench) {
      this.logger.log(`[作業台管理] 近くに作業台を発見: ${workbench.position}`);
      return { success: true, workbench };
    }

    this.logger.log('[作業台検索] 周辺に作業台が見つかりませんでした');

    // Check if we have a workbench in inventory
    const inventoryWorkbench = bot.inventory.items().find(item =>
      item && item.name === 'crafting_table'
    );

    if (inventoryWorkbench) {
      this.logger.log('[作業台管理] インベントリに作業台があります。設置を試みます...');
      try {
        // Find a suitable place to put the workbench
        const placePosition = bot.entity.position.offset(1, 0, 0);
        await bot.equip(inventoryWorkbench, 'hand');
        await bot.placeBlock(bot.blockAt(placePosition), new Vec3(0, 1, 0));
        this.logger.log(`[作業台管理] 作業台を設置しました: ${placePosition}`);
        return { success: true, workbench: bot.blockAt(placePosition) };
      } catch (error) {
        this.logger.log(`[作業台管理] 作業台の設置に失敗: ${error.message}`);
        return { success: false, error: `作業台設置失敗: ${error.message}` };
      }
    }

    // If no workbench, try to craft one
    this.logger.log('[作業台管理] 作業台の作成を試みます...');
    const craftResult = await this.craftWorkbench(bot);
    if (craftResult.success) {
      this.logger.log('[作業台管理] 作業台の作成に成功しました');
      // Now try to place it
      const newWorkbench = bot.inventory.items().find(item =>
        item && item.name === 'crafting_table'
      );
      if (newWorkbench) {
        try {
          const placePosition = bot.entity.position.offset(1, 0, 0);
          await bot.equip(newWorkbench, 'hand');
          await bot.placeBlock(bot.blockAt(placePosition), new Vec3(0, 1, 0));
          this.logger.log(`[作業台管理] 新しい作業台を設置しました: ${placePosition}`);
          return { success: true, workbench: bot.blockAt(placePosition) };
        } catch (error) {
          this.logger.log(`[作業台管理] 新しい作業台の設置に失敗: ${error.message}`);
          return { success: false, error: `新作業台設置失敗: ${error.message}` };
        }
      }
    }

    return { success: false, error: '作業台の確保に失敗しました' };
  }

  // Craft a workbench if materials are available
  async craftWorkbench(bot) {
    this.logger.log('[作業台作成] 作業台のクラフトを開始...');

    // Check for planks
    const planks = bot.inventory.items().filter(item =>
      item && item.name && item.name.includes('_planks')
    );
    const totalPlanks = planks.reduce((sum, item) => sum + item.count, 0);

    if (totalPlanks < 4) {
      this.logger.log(`[作業台作成] 板材不足: 必要4枚, 現在${totalPlanks}枚`);
      // Try to get wood to make planks
      const woodResult = await this.gatherWoodForCrafting(bot);
      if (woodResult.success) {
        this.logger.log('[作業台作成] 木材収集成功、板材を作成します...');
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
          this.logger.log('[作業台作成] 作業台を作成しました');
          return { success: true };
        }
      }
      return { success: false, error: '作業台のレシピが見つかりません' };
    } catch (error) {
      this.logger.log(`[作業台作成] 作業台作成に失敗: ${error.message}`);
      return { success: false, error: `作業台作成失敗: ${error.message}` };
    }
  }

  // Gather wood for crafting purposes
  async gatherWoodForCrafting(bot) {
    this.logger.log('[木材収集] クラフト用木材の収集を開始...');

    // Find a nearby tree
    const tree = bot.findBlock({
      matching: (block) => block && block.name.includes('_log'),
      maxDistance: 64
    });

    if (!tree) {
      this.logger.log('[木材収集] 近くに木が見つかりません。探索を試みます...');
      // Try to explore to find trees
      const exploreResult = await this.exploreForTrees(bot);
      if (!exploreResult.success) {
        return { success: false, error: '木が見つかりません（探索後）' };
      }

      // Search again after exploration
      const treeAfterExplore = bot.findBlock({
        matching: (block) => block && block.name.includes('_log'),
        maxDistance: 64
      });

      if (!treeAfterExplore) {
        return { success: false, error: '探索後も木が見つかりません' };
      }
    }

    // Mine the tree
    try {
      await bot.dig(tree);
      this.logger.log(`[木材収集] ${tree.name}を収集しました`);
      return { success: true };
    } catch (error) {
      this.logger.log(`[木材収集] 木材収集に失敗: ${error.message}`);
      return { success: false, error: `木材収集失敗: ${error.message}` };
    }
  }

  // Explore to find trees
  async exploreForTrees(bot) {
    this.logger.log('[探索] 木材探索を開始...');

    const originalPosition = bot.entity.position.clone();
    const searchDirections = [
      { x: 0, z: 16 }, // North
      { x: 16, z: 0 }, // East
      { x: 0, z: -16 }, // South
      { x: -16, z: 0 } // West
    ];

    for (const direction of searchDirections) {
      const targetPos = originalPosition.offset(direction.x, 0, direction.z);
      this.logger.log(`[探索] ${direction.x}, ${direction.z}方向を探索中...`);

      try {
        // Basic movement toward the direction
        await bot.lookAt(targetPos);

        // Move forward for exploration
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 3000));
        bot.setControlState('forward', false);

        // Search for trees in new area
        const tree = bot.findBlock({
          matching: (block) => block && block.name.includes('_log'),
          maxDistance: 32
        });

        if (tree) {
          this.logger.log(`[探索] 木材を発見: ${tree.position}`);
          return { success: true, tree };
        }
      } catch (error) {
        this.logger.log(`[探索] 探索エラー: ${error.message}`);
        continue;
      }
    }

    // Return to original position
    try {
      await bot.lookAt(originalPosition);
      bot.setControlState('forward', true);
      await new Promise(resolve => setTimeout(resolve, 2000));
      bot.setControlState('forward', false);
    } catch (error) {
      this.logger.log(`[探索] 復帰エラー: ${error.message}`);
    }

    return { success: false, error: '探索でも木材が見つかりませんでした' };
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
          this.logger.log(`[板材作成] ${logs[0].count}個の丸太から板材を作成しました`);
        }
      }
    } catch (error) {
      this.logger.log(`[板材作成] 板材作成に失敗: ${error.message}`);
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
          if (workbench && !bot.currentWindow) {
            await bot.activateBlock(workbench);
          }
          await bot.craft(pickaxeRecipes[0], 1, workbench);
          this.logger.log('[ツール作成] 木製のピッケルを作成しました');
          return { success: true, toolName: 'wooden_pickaxe' };
        }
      }
      return { success: false, error: 'ピッケルのレシピが見つかりません' };
    } catch (error) {
      this.logger.log(`[ツール作成] ピッケル作成に失敗: ${error.message}`);
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
          this.logger.log('[木材収集] パスファインダーが利用不可。基本移動を使用します');
          // 基本移動で対応
          const distance = bot.entity.position.distanceTo(tree.position);
          if (distance > 4) {
            try {
              await bot.lookAt(tree.position);
              await bot.setControlState('forward', true);
              await new Promise(resolve => setTimeout(resolve, Math.min(distance * 500, 3000)));
              await bot.setControlState('forward', false);
            } catch (moveError) {
              this.logger.log(`[木材収集] 基本移動エラー: ${moveError.message}`);
              return { success: false, error: `移動に失敗: ${moveError.message}` };
            }
          }
        } else {
          const moveResult = await moveToBlock(bot, tree, 1);
          if (!moveResult.success) {
            this.logger.log(`[木材収集] 木への移動に失敗: ${moveResult.error}`);
            return { success: false, error: `木への移動に失敗: ${moveResult.error}` };
          }
        }
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

  async execute(bot, params) {
    const { tools } = params;
    const mcData = require('minecraft-data')(bot.version);

    this.logger.log(`[ツールスキル] ${tools.join(', ')}の作成を開始します...`);

    // インベントリの事前チェック
    const inventoryItems = InventoryUtils.getAllItems(bot);
    this.logger.log(`[ツールスキル] インベントリアイテム数: ${inventoryItems.length}`);

    if (inventoryItems.length === 0) {
      this.logger.log('[ツールスキル] インベントリが空です。ツール作成を中止します。');
      return { success: false, error: 'インベントリが空です。まず基本的な素材を集めてください。' };
    }

    // インベントリアイテムの詳細表示
    const itemCounts = {};
    inventoryItems.forEach(item => {
      if (item && item.name) {
        itemCounts[item.name] = (itemCounts[item.name] || 0) + item.count;
      }
    });
    this.logger.log('[ツールスキル] インベントリ内容:', JSON.stringify(itemCounts, null, 2));

    // Ensure we have a crafting table nearby or in inventory
    const workbenchResult = await this.ensureWorkbench(bot);

    if (!workbenchResult.success) {
      this.logger.log(`[ツールスキル] 作業台の確保に失敗: ${workbenchResult.error}`);

      // Try to gather materials automatically
      if (workbenchResult.error.includes('材料不足')) {
        this.logger.log('[ツールスキル] 材料不足のため自動収集を試みます...');
        // Use a simple wood gathering approach
        const gatherResult = await this.simpleWoodGathering(bot);

        if (gatherResult.success) {
          this.logger.log('[ツールスキル] 材料収集成功、作業台確保を再試行...');
          const retryWorkbenchResult = await this.ensureWorkbench(bot);
          if (retryWorkbenchResult.success) {
            this.logger.log('[ツールスキル] 材料収集後の作業台確保成功');
          } else {
            return { success: false, error: `材料収集後も作業台確保失敗: ${retryWorkbenchResult.error}` };
          }
        } else {
          return { success: false, error: `材料収集失敗: ${gatherResult.error}` };
        }
      } else {
        return { success: false, reason: 'CRAFTING_TABLE_MISSING', details: { error: workbenchResult.error } };
      }
    }

    const craftingTable = workbenchResult.workbench;
    // 距離チェック: 作業台に接近
    const proximityCheck = await ensureProximity(bot, craftingTable, 3);
    if (!proximityCheck.success) {
      this.logger.log('[ツールスキル] 作業台まで接近できません');
      return { success: false, reason: 'UNREACHABLE_WORKBENCH', error: '作業台に接近できません' };
    }

    const craftedTools = [];
    for (const toolName of tools) {
      this.logger.log(`[ツールスキル] ${toolName}の作成を試みます`);

      // ダイヤモンドツールの除外チェック
      const excludedMaterials = ['diamond', 'netherite'];
      if (excludedMaterials.some(excluded => toolName.includes(excluded))) {
        this.logger.log(`[ツールスキル] ${toolName} は除外対象です (ダイヤモンド/ネザライト)`);
        bot.chat(`${toolName}は作成対象外です（ダイヤモンド/ネザライト除外）`);
        continue;
      }

      const toolItem = mcData.itemsByName[toolName];
      if (!toolItem) {
        this.logger.log(`[ツールスキル] 不明なツール: ${toolName}`);
        this.logger.log(`[ツールスキル] 利用可能なツールアイテム: ${Object.keys(mcData.itemsByName).filter(name => name.includes('pickaxe')).join(', ')}`);
        continue;
      }

      // Check if tool already exists in inventory
      if (InventoryUtils.hasItem(bot, toolName)) {
        this.logger.log(`[ツールスキル] ${toolName}は既にインベントリにあります`);
        craftedTools.push(toolName);
        continue;
      }

      // ツール作成前のインベントリ状態再チェック
      const currentItems = InventoryUtils.getAllItems(bot);
      if (currentItems.length === 0) {
        this.logger.log(`[ツールスキル] ${toolName}作成時にインベントリが空です`);
        return { success: false, error: `${toolName}作成時にインベントリが空です` };
      }

      // 素材優先度システムを使用して最適化されたレシピを取得
      let recipe = await SkillLibrary.getOptimizedToolRecipe(bot, toolName, 1, craftingTable);
      let actualToolName = toolName;

      if (recipe) {
        // 最適化されたレシピから実際のツール名を取得
        if (recipe.result && recipe.result.id) {
          const optimizedToolItem = mcData.items[recipe.result.id];
          if (optimizedToolItem) {
            actualToolName = optimizedToolItem.name;
            this.logger.log(`[ツールスキル] 素材優先度システムにより ${toolName} -> ${actualToolName} に最適化`);
          }
        } else {
          this.logger.warn(`[ツールスキル] 最適化レシピの result.id が無効です: ${JSON.stringify(recipe.result)}`);
        }
      } else {
        // フォールバック: 通常のレシピ取得
        recipe = await SkillLibrary.getRecipeSafe(bot, toolName, 1, craftingTable);
        if (!recipe) {
          this.logger.log(`[ツールスキル] ${toolName}のレシピが見つかりません`);

          // Try alternative recipes or wait for materials
          const alternativeRecipe = await SkillLibrary.getRecipeSafe(bot, toolItem.id, 1, craftingTable);
          if (!alternativeRecipe) {
            this.logger.log(`[ツールスキル] ${toolName}の代替レシピも見つかりません`);
            bot.chat(`${toolName}のレシピが見つかりません`);
            return {
              success: false,
              reason: 'NO_RECIPE',
              details: { tool: toolName, message: 'レシピが見つかりません' }
            };
          } else {
            this.logger.log(`[ツールスキル] ${toolName}の代替レシピを使用します`);
            recipe = alternativeRecipe;
          }
        }

        if (toolName.includes('wooden_') && !recipe) {
          this.logger.log(`[ツールスキル] 木材ツール用の最適化レシピを再取得: ${toolName}`);
          recipe = await SkillLibrary.getOptimizedWoodenToolRecipe(bot, toolName, 1, craftingTable);
          if (recipe) {
            this.logger.log(`[ツールスキル] 木材最適化レシピを取得成功: ${toolName}`);
          }
        }
      }

      // Check for sufficient materials using the actual recipe we'll use
      const missingMaterials = await this.getMissingMaterialsForActualRecipe(bot, recipe);
      if (missingMaterials && missingMaterials.length > 0) {
        this.logger.log(`[ツールスキル] ${actualToolName}の材料が不足しています。不足: ${missingMaterials.map(m => `${m.item} (${m.needed}個)`).join(', ')}`);

        // Try to auto-convert materials if possible
        let materialConverted = false;
        for (const missing of missingMaterials) {
          // Check if this is a planks material and we have logs
          if (missing.item.includes('_planks') || missing.item.includes('planks')) {
            this.logger.log(`[ツールスキル] 板材不足検出: ${missing.item} ${missing.needed}個`);
            const logs = InventoryUtils.getAllItems(bot).filter(item => item.name && item.name.includes('_log'));
            if (logs.length > 0) {
              this.logger.log(`[ツールスキル] 木材が利用可能: ${logs.length}種類`);
              const convertResult = await this.convertLogsToPlanksDynamic(bot, missing.needed);
              if (convertResult.success) {
                this.logger.log(`[ツールスキル] 板材変換成功: ${convertResult.converted}個`);
                materialConverted = true;
                break;
              } else {
                this.logger.log(`[ツールスキル] 板材変換失敗: ${convertResult.error}`);
              }
            }
          } else if (missing.item === 'stick') {
            // Check if this is a stick material and we have planks
            this.logger.log(`[ツールスキル] スティック不足検出: ${missing.needed}個`);

            // 不足分のスティックを作成
            const sticksNeeded = missing.needed;

            this.logger.log(`[ツールスキル] 追加で${sticksNeeded}個のスティックが必要。板材から作成します。`);
            const stickResult = await this.createStickFromPlanks(bot, sticksNeeded);
            if (stickResult.success) {
              this.logger.log(`[ツールスキル] スティック作成成功: ${stickResult.created}個`);
              materialConverted = true;
              break;
            } else {
              this.logger.log(`[ツールスキル] スティック作成失敗: ${stickResult.error}`);
            }
          }
        }

        if (!materialConverted) {
          bot.chat(`${toolName}の材料が不足しています`);
          return {
            success: false,
            reason: 'INSUFFICIENT_MATERIALS',
            details: { missing: missingMaterials, tool: toolName }
          };
        }

        // Re-check materials after conversion
        const updatedMissingMaterials = await this.getMissingMaterialsForActualRecipe(bot, recipe);
        if (updatedMissingMaterials && updatedMissingMaterials.length > 0) {
          this.logger.log(`[ツールスキル] 材料変換後も不足: ${updatedMissingMaterials.map(m => `${m.item} (${m.needed}個)`).join(', ')}`);
          bot.chat(`${actualToolName}の材料が不足しています`);
          return {
            success: false,
            reason: 'INSUFFICIENT_MATERIALS',
            details: { missing: updatedMissingMaterials, tool: actualToolName }
          };
        } else {
          this.logger.log('[ツールスキル] 材料変換後、材料が十分になりました');
        }
      }

      // Debug: Log recipe state before crafting
      this.logger.log(`[ツールスキル] ${toolName}クラフト前のレシピ状態:`, {
        hasRecipe: !!recipe,
        recipeId: recipe?.id,
        recipeResult: recipe?.result,
        recipeDelta: recipe?.delta?.length || 0
      });

      try {
        this.logger.log(`[ツールスキル] ${toolName}をクラフト中...`);

        if (!recipe) {
          this.logger.log(`[ツールスキル] ${toolName}のレシピがnullです - クラフトをスキップ`);
          return { success: false, error: `Recipe is null for ${toolName}` };
        }

        if (!recipe.id && !recipe.result) {
          this.logger.log(`[ツールスキル] ${toolName}のレシピが不正な形式です`);
          this.logger.log('[ツールスキル] レシピ詳細:', JSON.stringify(recipe, null, 2));
          return { success: false, error: `Invalid recipe format for ${toolName}` };
        }

        // 追加の安全性チェック
        if (recipe.result && recipe.result.id === undefined) {
          this.logger.log(`[ツールスキル] ${toolName}のレシピ結果IDが未定義です`);
          this.logger.log('[ツールスキル] レシピ結果:', JSON.stringify(recipe.result, null, 2));
          return { success: false, error: `Recipe result ID is undefined for ${toolName}` };
        }

        // Sanitize inShape so that bot.craft() never receives null cells
        if (recipe.inShape) {
          recipe.inShape = this.sanitizeInShape(recipe.inShape);
          // inShapeの内容を検証
          let hasInvalidItems = false;
          for (const row of recipe.inShape) {
            if (Array.isArray(row)) {
              for (const item of row) {
                if (item !== 0 && item !== null && item !== undefined) {
                  // Handle object types that shouldn't be here
                  if (typeof item === 'object') {
                    this.logger.log(`[ツールスキル] 無効なアイテムID (オブジェクト): ${JSON.stringify(item)}`);
                    hasInvalidItems = true;
                    continue;
                  }

                  // Handle string types that shouldn't be here
                  if (typeof item === 'string') {
                    this.logger.log(`[ツールスキル] 無効なアイテムID (文字列): ${item}`);
                    hasInvalidItems = true;
                    continue;
                  }

                  // Handle number types - check if they exist in mcData
                  if (typeof item === 'number') {
                    // -1 is a valid ID in mineflayer representing empty slots
                    if (item === -1) {
                      // -1 is valid - represents empty slot in mineflayer
                      continue;
                    }

                    const itemData = mcData.items[item];
                    if (!itemData) {
                      this.logger.log(`[ツールスキル] 無効なアイテムID (数値): ${item}`);
                      hasInvalidItems = true;
                    }
                  } else {
                    this.logger.log(`[ツールスキル] 無効なアイテムID (不明な型): ${typeof item}, 値: ${item}`);
                    hasInvalidItems = true;
                  }
                }
              }
            }
          }
          if (hasInvalidItems) {
            this.logger.log('[ツールスキル] inShapeに無効なアイテムIDが含まれています');
            this.logger.log('[ツールスキル] 現在のinShape:', JSON.stringify(recipe.inShape, null, 2));
            return { success: false, error: `Invalid item IDs in recipe for ${toolName}` };
          }
        }

        // Fix missing ingredients field by generating from inShape
        if (!recipe.ingredients && recipe.inShape) {
          this.logger.log(`[ツールスキル] ${toolName}のingredientsがnullのため、inShapeから生成します`);
          recipe.ingredients = this.generateIngredientsFromInShape(recipe.inShape);
          this.logger.log('[ツールスキル] 生成されたingredients:', recipe.ingredients);
        }

        // Fix delta/inShape ID inconsistency that causes crafting errors
        if (recipe.delta && recipe.inShape) {
          // delta/inShape不整合を静かに修正
          recipe.delta = this.fixDeltaFromInShape(recipe.delta, recipe.inShape);
        }

        // CRITICAL FIX: Ensure recipe.id is set for bot.craft() compatibility
        if (!recipe.id && recipe.result && recipe.result.id) {
          recipe.id = recipe.result.id;
          this.logger.log(`[ツールスキル] recipe.id missing - setting to result.id: ${recipe.id}`);
        }

        // Use official bot.recipesFor() for reliable crafting
        try {
          const targetItemId = recipe.result.id;
          const officialRecipes = bot.recipesFor(targetItemId, null, 1, craftingTable);

          if (officialRecipes.length > 0) {
            const officialRecipe = officialRecipes[0];
            this.logger.log(`[ツールスキル] ${actualToolName}のクラフトを実行中...`);
            await bot.craft(officialRecipe, 1, craftingTable);
            this.logger.log(`[ツールスキル] ${actualToolName}をクラフトしました！`);
            bot.chat(`${actualToolName}をクラフトしました！ 🔨`);
            craftedTools.push(actualToolName);
            continue;
          }
        } catch (officialRecipeError) {
          this.logger.log(`[ツールスキル] 公式レシピでのクラフトに失敗: ${officialRecipeError.message}`);
          this.logger.log('[ツールスキル] 手動レシピでクラフトを続行...');
        }

        // Fallback to manual recipe crafting
        this.logger.log(`[ツールスキル] ${toolName}の手動レシピでクラフトを試行中...`);

        // より安全な bot.craft() 呼び出しを実装
        try {
          // 最終的なレシピ安全性チェック
          if (!recipe || !recipe.result || !recipe.result.id) {
            throw new Error('Recipe result is invalid');
          }

          if (!mcData || !mcData.items || !mcData.items[recipe.result.id]) {
            throw new Error('Recipe result item not found in minecraft-data');
          }

          // 作業台の状態確認
          if (craftingTable && !bot.blockAt(craftingTable.position)) {
            throw new Error('Crafting table is no longer available');
          }

          // currentWindowがNULLの場合、まず作業台を開いてからwindowOpenイベントを待機
          if (!bot.currentWindow) {
            this.logger.log('[ツールスキル] currentWindowがNULL - 作業台を開いてwindowOpenイベントを待機中...');

            try {
              await bot.activateBlock(craftingTable);
              this.logger.log('[ツールスキル] 作業台を開きました');
            } catch (activateError) {
              throw new Error(`作業台の開放に失敗: ${activateError.message}`);
            }

            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                bot.removeListener('windowOpen', onWindowOpen);
                reject(new Error('windowOpen event timeout after 10 seconds'));
              }, 10000);

              const onWindowOpen = (window) => {
                if (window.type === 'minecraft:crafting' || window.type === 'generic_3x3') {
                  clearTimeout(timeout);
                  bot.removeListener('windowOpen', onWindowOpen);
                  this.logger.log(`[ツールスキル] windowOpen確認: ${window.type}`);
                  // 少し待ってからresolve to ensure window is fully initialized
                  setTimeout(resolve, 100);
                }
              };

              bot.on('windowOpen', onWindowOpen);
            });
          }

          // currentWindowの最終確認と追加待機
          let windowCheckAttempts = 0;
          const maxWindowCheckAttempts = 10;

          while (!bot.currentWindow && windowCheckAttempts < maxWindowCheckAttempts) {
            this.logger.log(`[ツールスキル] currentWindow待機中... (${windowCheckAttempts + 1}/${maxWindowCheckAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 200));
            windowCheckAttempts++;
          }

          if (!bot.currentWindow) {
            throw new Error('currentWindow is still null after extended waiting');
          }

          this.logger.log(`[ツールスキル] currentWindow確認: ${bot.currentWindow.type}`);

          // クラフト直前の最終材料確認
          const finalMaterialCheck = await this.verifyMaterialsBeforeCraft(bot, recipe);
          if (!finalMaterialCheck.success) {
            throw new Error(`Final material check failed: ${finalMaterialCheck.error}`);
          }

          // bot.craft() 呼び出しをPromiseでラップして適切なエラー処理
          const craftPromise = bot.craft(recipe, 1, craftingTable);
          const result = await Promise.race([
            craftPromise,
            new Promise((_resolve, reject) =>
              setTimeout(() => reject(new Error('Craft timeout after 15 seconds')), 15000)
            )
          ]);

          this.logger.log(`[ツールスキル] ${toolName}のクラフト結果:`, result);
        } catch (craftError) {
          this.logger.log(`[ツールスキル] 手動レシピでのクラフトに失敗: ${craftError.message}`);
          throw craftError;
        }
        this.logger.log(`[ツールスキル] ${actualToolName}をクラフトしました！`);
        bot.chat(`${actualToolName}をクラフトしました！ 🔨`);
        craftedTools.push(actualToolName);
      } catch (error) {
        this.logger.log(`[ツールスキル] ${actualToolName}のクラフトに失敗: ${error.message}`);
        this.logger.log('[ツールスキル] レシピ詳細:', recipe ? JSON.stringify(recipe, null, 2) : 'null');
        return { success: false, error: `Failed to craft ${actualToolName}: ${error.message}` };
      }
    }

    if (craftedTools.length === tools.length) {
      this.logger.log('[ツールスキル] 全てのツールを正常にクラフトしました。');
      return { success: true, crafted: craftedTools };
    } else if (craftedTools.length > 0) {
      this.logger.log('[ツールスキル] 一部のツールをクラフトしました。');
      return { success: true, crafted: craftedTools, message: '一部のツールをクラフトしました' };
    } else {
      this.logger.log('[ツールスキル] ツールをクラフトできませんでした。');
      return { success: false, error: 'ツールをクラフトできませんでした' };
    }
  }

  /**
   * Verify materials are available before crafting
   * @param {Object} bot - Mineflayer bot instance
   * @param {Object} recipe - Recipe object to verify
   * @returns {Object} verification result
   */
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
    super('craft_workbench', 'Crafts a crafting table from planks, with automatic log-to-plank conversion');
  }

  // Improved inventory detection methods for CraftWorkbenchSkill
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

  // On-demand log to plank conversion for CraftWorkbenchSkill
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

  async execute(bot, _params) {
    try {
      this.logger.log('[作業台スキル] 作業台の作成を開始します...');

      const mcData = require('minecraft-data')(bot.version);
      const requiredPlanks = 4;

      // Phase 1: Check if we already have a workbench
      if (InventoryUtils.hasItem(bot, 'crafting_table', 1, true)) {
        this.logger.log('[作業台スキル] インベントリに作業台が既にあります');
        return { success: true, message: 'インベントリに作業台が既にあります' };
      }

      // Phase 2: Material assessment (improved inventory detection)
      this.logger.log('[作業台スキル] 材料評価フェーズ...');
      InventoryUtils.logInventoryDetails(bot, 'CraftWorkbench-Start');

      const currentPlanks = this.countPlankItems(bot);
      const currentLogs = this.countLogItems(bot);
      const totalAvailablePlanks = currentPlanks + (currentLogs * 4);

      this.logger.log(`[作業台スキル] 材料状況: 板材=${currentPlanks}, 原木=${currentLogs}, 総利用可能板材=${totalAvailablePlanks}`);

      if (totalAvailablePlanks < requiredPlanks) {
        const message = `材料不足: 必要な板材=${requiredPlanks}, 利用可能=${totalAvailablePlanks}`;
        this.logger.log(`[作業台スキル] ${message}`);
        return { success: false, reason: 'INSUFFICIENT_MATERIALS', error: message };
      }

      // Phase 3: On-demand plank conversion (only when needed)
      if (currentPlanks < requiredPlanks) {
        const planksNeeded = requiredPlanks - currentPlanks;
        const logsToCraft = Math.ceil(planksNeeded / 4);

        this.logger.log(`[作業台スキル] オンデマンド板材変換: ${planksNeeded}個の板材が必要、${logsToCraft}個の原木を変換します`);

        const plankCraftResult = await this.convertLogsToPlanksDemand(bot, logsToCraft);
        if (!plankCraftResult.success) {
          return { success: false, error: `板材の作成に失敗: ${plankCraftResult.error}` };
        }

        // Verify we now have enough planks
        const updatedPlanks = this.countPlankItems(bot);
        this.logger.log(`[作業台スキル] オンデマンド変換完了: ${updatedPlanks}個の板材を確保`);

        if (updatedPlanks < requiredPlanks) {
          const message = `板材作成後も材料不足: 必要=${requiredPlanks}, 現在=${updatedPlanks}`;
          this.logger.log(`[作業台スキル] ${message}`);
          return { success: false, error: message };
        }
      }

      // Phase 4: Workbench crafting
      this.logger.log('[作業台スキル] 作業台作成フェーズ...');
      const workbenchRecipe = await SkillLibrary.getRecipeSafe(bot, 'crafting_table', 1, null);
      if (!workbenchRecipe) {
        const message = '作業台のレシピが見つかりません';
        this.logger.log(`[作業台スキル] ${message}`);
        return { success: false, reason: 'NO_RECIPE', error: message };
      }

      this.logger.log('[作業台スキル] レシピ詳細:', {
        id: workbenchRecipe.id,
        deltaLength: workbenchRecipe.delta?.length,
        delta: workbenchRecipe.delta
      });

      // Final material verification before crafting (only check negative counts = input materials)
      for (const ingredient of workbenchRecipe.delta) {
        if (ingredient.count < 0) { // Only check input materials (negative counts)
          const requiredCount = Math.abs(ingredient.count);
          const ingredientName = mcData.items[ingredient.id]?.name || `id_${ingredient.id}`;
          const available = this.countItemsInInventoryByName(bot, ingredientName);
          if (available < requiredCount) {
            const message = `最終確認で材料不足: ${ingredientName} (必要=${requiredCount}, 所持=${available})`;
            this.logger.log(`[作業台スキル] ${message}`);
            InventoryUtils.logInventoryDetails(bot, 'CraftWorkbench-MaterialError');
            return { success: false, error: message };
          }
          this.logger.log(`[作業台スキル] 材料確認OK: ${ingredientName} (必要=${requiredCount}, 所持=${available})`);
        }
      }

      // Execute crafting
      try {
        await bot.craft(workbenchRecipe, 1, null);
        this.logger.log('[作業台スキル] 作業台のクラフトに成功しました！');
        bot.chat('作業台をクラフトしました！');
        InventoryUtils.logInventoryDetails(bot, 'CraftWorkbench-Success');

        // 自動設置を試行（オプション機能）
        if (_params.autoPlace !== false) {
          this.logger.log('[作業台スキル] 自動設置を試行します...');
          const placeResult = await this.tryAutoPlace(bot);
          if (placeResult.success) {
            return {
              success: true,
              crafted: 'crafting_table',
              placed: true,
              workbenchPosition: placeResult.workbenchPosition,
              message: '作業台のクラフトと設置に成功'
            };
          } else {
            this.logger.log(`[作業台スキル] 自動設置失敗: ${placeResult.error}`);
          }
        }

        return { success: true, crafted: 'crafting_table', message: '作業台のクラフトに成功' };
      } catch (error) {
        const message = `作業台クラフト実行エラー: ${error.message}`;
        this.logger.log(`[作業台スキル] ${message}`);
        InventoryUtils.logInventoryDetails(bot, 'CraftWorkbench-CraftError');
        return { success: false, error: message };
      }
    } catch (error) {
      const message = `予期せぬエラー: ${error.message}`;
      this.logger.log(`[作業台スキル] ${message}`);
      return { success: false, error: message };
    }
  }

  // Helper method to craft planks from logs
  async craftPlanksFromLogs(bot, logCount = 1) {
    try {
      this.logger.log(`[作業台スキル] 原木から板材への変換を開始: ${logCount}個の原木を使用`);

      const plankRecipe = await SkillLibrary.getRecipeSafe(bot, 'oak_planks', 1, null);
      if (!plankRecipe) {
        return { success: false, error: '板材のレシピが見つかりません' };
      }

      // Verify we have enough logs
      const availableLogs = this.countItemsInInventory(bot, 'log');
      if (availableLogs < logCount) {
        return { success: false, error: `原木不足: 必要=${logCount}, 所持=${availableLogs}` };
      }

      await bot.craft(plankRecipe, logCount, null);
      const planksCreated = logCount * 4;
      this.logger.log(`[作業台スキル] 板材作成成功: ${planksCreated}個の板材を作成`);
      return { success: true, planksCreated };
    } catch (error) {
      this.logger.log(`[作業台スキル] 板材作成エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Count items in inventory with flexible name matching
  countItemsInInventory(bot, itemType) {
    let count = 0;
    const items = bot.inventory.items();

    for (const item of items) {
      if (!item || !item.name) continue;

      const itemName = item.name.toLowerCase();
      const targetType = itemType.toLowerCase();

      if (itemName === targetType) {
        count += item.count;
      } else if (targetType === 'planks' && itemName.includes('_planks')) {
        count += item.count;
      } else if (targetType === 'log' && itemName.includes('_log')) {
        count += item.count;
      } else if (targetType === 'oak_planks' && itemName === 'oak_planks') {
        count += item.count;
      }
    }

    return count;
  }

  // 自動設置を試行するヘルパーメソッド
  async tryAutoPlace(bot) {
    try {
      // PlaceWorkbenchSkillの簡略版ロジック
      const workbenchItem = bot.inventory.items().find(item =>
        item && item.name === 'crafting_table'
      );

      if (!workbenchItem) {
        return { success: false, error: 'インベントリに作業台がありません' };
      }

      // 近くに既に作業台があるかチェック
      const existingWorkbench = bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 8
      });

      if (existingWorkbench) {
        return {
          success: true,
          message: '近くに既に作業台があります',
          workbenchPosition: existingWorkbench.position
        };
      }

      // 簡単な設置場所を探す（足元）
      const botPos = bot.entity.position;
      const groundBlock = bot.blockAt(botPos.floored().plus(new Vec3(0, -1, 0)));

      if (groundBlock && groundBlock.name !== 'air') {
        const aboveGround = botPos.floored();
        const aboveGroundBlock = bot.blockAt(aboveGround);

        if (aboveGroundBlock && aboveGroundBlock.name === 'air') {
          await bot.equip(workbenchItem, 'hand');
          await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
          const placedPosition = groundBlock.position.plus(new Vec3(0, 1, 0));

          this.logger.log(`[作業台スキル] 自動設置成功: ${placedPosition}`);
          bot.chat('作業台を設置しました！');

          return {
            success: true,
            workbenchPosition: placedPosition,
            message: '作業台の自動設置に成功'
          };
        }
      }

      return { success: false, error: '適切な設置場所が見つかりません' };
    } catch (error) {
      return { success: false, error: `自動設置エラー: ${error.message}` };
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
    super('place_workbench', '作業台を近くの適切な場所に設置します');
  }

  async execute(bot, _params) {
    try {
      this.logger.log('[作業台設置] 作業台の設置を開始します...');

      // 1. インベントリから作業台を探す
      const workbenchItem = bot.inventory.items().find(item =>
        item && item.name === 'crafting_table'
      );

      if (!workbenchItem) {
        return {
          success: false,
          reason: 'NO_WORKBENCH',
          error: 'インベントリに作業台がありません'
        };
      }

      // 2. 近くに既に作業台があるかチェック
      const existingWorkbench = bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 8
      });

      if (existingWorkbench) {
        this.logger.log('[作業台設置] 近くに既に作業台があります');
        return {
          success: true,
          message: '近くに既に作業台があります',
          workbenchPosition: existingWorkbench.position
        };
      }

      // 3. 設置場所を探す
      const placementResult = await this.findPlacementLocation(bot);
      if (!placementResult.success) {
        return placementResult;
      }

      const { referenceBlock, face } = placementResult;

      // 4. 作業台を手に持つ
      await bot.equip(workbenchItem, 'hand');
      this.logger.log('[作業台設置] 作業台を手に持ちました');

      // 5. 設置実行
      await bot.placeBlock(referenceBlock, face);
      const placedPosition = referenceBlock.position.plus(face);

      this.logger.log(`[作業台設置] 作業台を ${placedPosition} に設置しました`);
      bot.chat('作業台を設置しました！');

      return {
        success: true,
        result: '作業台の設置に成功しました',
        workbenchPosition: placedPosition
      };
    } catch (error) {
      const errorMessage = `作業台の設置に失敗: ${error.message}`;
      this.logger.error(`[作業台設置] ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async findPlacementLocation(bot) {
    try {
      const botPos = bot.entity.position;

      // 設置可能な場所を探す（ボットの周りを確認）
      const directions = [
        new Vec3(1, 0, 0), // 東
        new Vec3(-1, 0, 0), // 西
        new Vec3(0, 0, 1), // 南
        new Vec3(0, 0, -1), // 北
        new Vec3(1, 0, 1), // 南東
        new Vec3(-1, 0, 1), // 南西
        new Vec3(1, 0, -1), // 北東
        new Vec3(-1, 0, -1) // 北西
      ];

      for (const direction of directions) {
        const checkPos = botPos.floored().plus(direction);
        const referenceBlock = bot.blockAt(checkPos);

        if (!referenceBlock || referenceBlock.name === 'air') continue;

        // 上に空間があるかチェック
        const abovePos = checkPos.plus(new Vec3(0, 1, 0));
        const aboveBlock = bot.blockAt(abovePos);

        if (aboveBlock && aboveBlock.name === 'air') {
          this.logger.log(`[作業台設置] 設置場所発見: ${checkPos} の上`);
          return {
            success: true,
            referenceBlock,
            face: new Vec3(0, 1, 0)
          };
        }
      }

      // 足元に設置を試行
      const groundBlock = bot.blockAt(botPos.floored().plus(new Vec3(0, -1, 0)));
      if (groundBlock && groundBlock.name !== 'air') {
        const aboveGround = botPos.floored();
        const aboveGroundBlock = bot.blockAt(aboveGround);

        if (aboveGroundBlock && aboveGroundBlock.name === 'air') {
          this.logger.log('[作業台設置] 足元に設置');
          return {
            success: true,
            referenceBlock: groundBlock,
            face: new Vec3(0, 1, 0)
          };
        }
      }

      return {
        success: false,
        error: '作業台を設置できる適切な場所が見つかりません'
      };
    } catch (error) {
      return {
        success: false,
        error: `設置場所の検索中にエラー: ${error.message}`
      };
    }
  }
}

// 作業台を使ったクラフトスキル
class CraftWithWorkbenchSkill extends Skill {
  constructor() {
    super('craft_with_workbench', '作業台を使ってアイテムをクラフトします');
  }

  async execute(bot, params) {
    const { itemName, count = 1 } = params;

    if (!itemName) {
      return {
        success: false,
        error: 'クラフトするアイテム名が指定されていません'
      };
    }

    try {
      this.logger.log(`[作業台クラフト] ${itemName} を ${count} 個クラフトを開始...`);

      // 1. 近くの作業台を探す
      const workbenchBlock = bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 10
      });

      if (!workbenchBlock) {
        return {
          success: false,
          reason: 'NO_WORKBENCH_NEARBY',
          error: '近くに作業台が見つかりません'
        };
      }

      this.logger.log(`[作業台クラフト] 作業台発見: ${workbenchBlock.position}`);

      // 2. アイテムのレシピを取得（作業台必須のレシピ）
      const recipe = await SkillLibrary.getRecipeSafe(bot, itemName, count, workbenchBlock);

      if (!recipe) {
        return {
          success: false,
          reason: 'NO_RECIPE',
          error: `${itemName} の作業台レシピが見つかりません`
        };
      }

      this.logger.log(`[作業台クラフト] レシピ取得成功: ${itemName}`);

      // 3. 材料チェック
      const materialCheck = await this.checkMaterials(bot, recipe);
      if (!materialCheck.success) {
        return materialCheck;
      }

      // 4. 作業台に近づく
      const proximityCheck = await ensureProximity(bot, workbenchBlock, 3);
      if (!proximityCheck.success) {
        return { success: false, reason: 'UNREACHABLE_WORKBENCH', error: '作業台に接近できません' };
      }

      // 5. クラフト実行
      if (workbenchBlock && !bot.currentWindow) {
        await bot.activateBlock(workbenchBlock);
      }
      await bot.craft(recipe, count, workbenchBlock);

      this.logger.log(`[作業台クラフト] ${itemName} を ${count} 個クラフトしました`);
      bot.chat(`${itemName} を ${count} 個クラフトしました！`);

      return {
        success: true,
        result: `${itemName} を ${count} 個クラフトしました`,
        crafted: { item: itemName, count }
      };
    } catch (error) {
      const errorMessage = `${itemName} のクラフトに失敗: ${error.message}`;
      this.logger.error(`[作業台クラフト] ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async checkMaterials(bot, recipe) {
    try {
      const mcData = require('minecraft-data')(bot.version);
      const InventoryUtils = require('./InventoryUtils');

      for (const ingredient of recipe.delta) {
        if (ingredient.count < 0) { // 入力材料（負の数）
          const requiredCount = Math.abs(ingredient.count);
          const item = mcData.items[ingredient.id];
          const itemName = item ? item.name : `id_${ingredient.id}`;

          // Check if we can substitute this material (especially for wood planks)
          const substitutionInfo = InventoryUtils.canSubstituteMaterial(bot, itemName, requiredCount);

          if (!substitutionInfo.canSubstitute) {
            return {
              success: false,
              reason: 'INSUFFICIENT_MATERIALS',
              error: `材料不足: ${itemName} (必要=${requiredCount}, 所持=${substitutionInfo.availableCount})`
            };
          } else if (substitutionInfo.substitutionType === 'wood_plank') {
            // Log successful wood plank substitution
            this.logger.log(`[作業台クラフト] 木材代替OK: ${itemName} (必要=${requiredCount}) -> 利用可能合計:${substitutionInfo.availableCount}`);
            this.logger.log(`[作業台クラフト] 利用可能木材: ${JSON.stringify(substitutionInfo.substitutes)}`);
          }

          this.logger.log(`[作業台クラフト] 材料確認OK: ${itemName} (必要=${requiredCount}, 所持=${substitutionInfo.availableCount})`);
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `材料チェック中にエラー: ${error.message}`
      };
    }
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
