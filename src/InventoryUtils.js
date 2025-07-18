/**
 * InventoryUtils - Common inventory calculation utilities
 *
 * This module provides shared utility functions for inventory calculations
 * to reduce code duplication and improve consistency across the codebase.
 */

const { Logger } = require('./utils/Logger');

class InventoryUtils {
  /**
   * Wood compatibility table for recipe crafting
   * Maps specific plank types to their compatible log types
   */
  static WOOD_COMPATIBILITY = {
    oak_planks: ['oak_log'],
    birch_planks: ['birch_log'],
    cherry_planks: ['cherry_log'],
    spruce_planks: ['spruce_log'],
    jungle_planks: ['jungle_log'],
    acacia_planks: ['acacia_log'],
    dark_oak_planks: ['dark_oak_log'],
    mangrove_planks: ['mangrove_log'],
    bamboo_planks: ['bamboo_block'],
    planks: [
      'oak_log', 'birch_log', 'cherry_log', 'spruce_log',
      'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'
    ]
  };

  /**
   * Get compatible log types for a specific plank type
   * @param {string} plankType - The plank type to check
   * @returns {Array<string>} Array of compatible log types
   */
  static getCompatibleLogs(plankType) {
    return this.WOOD_COMPATIBILITY[plankType] || [];
  }

  /**
   * Check if a log type can be converted to a specific plank type
   * @param {string} logType - The log type to check
   * @param {string} plankType - The target plank type
   * @returns {boolean} True if conversion is possible
   */
  static canConvertLogToPlank(logType, plankType) {
    const compatibleLogs = this.getCompatibleLogs(plankType);
    return compatibleLogs.includes(logType);
  }

  /**
   * Find best available log for a specific plank type
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} plankType - The required plank type
   * @returns {Object|null} Best matching log item or null
   */
  static findBestLogForPlank(bot, plankType) {
    const compatibleLogs = this.getCompatibleLogs(plankType);
    const availableLogs = this.getAllItems(bot).filter(item =>
      item.name && item.name.includes('_log') && compatibleLogs.includes(item.name)
    );

    if (availableLogs.length === 0) {
      return null;
    }

    return availableLogs.reduce((best, current) =>
      current.count > best.count ? current : best
    );
  }

  /**
   * Safe count method that handles both Mineflayer v3 standard API and callback extensions
   * @param {Bot} bot - Mineflayer bot instance
   * @param {Function} predicate - Filter function for items
   * @returns {number} Item count
   */
  static _safeCount(bot, predicate) {
    if (!bot || !bot.inventory) {
      const logger = Logger.createLogger('InventoryUtils');
      logger.warn('Bot or inventory is null/undefined');
      return 0;
    }
    try {
      // Try using bot.inventory.items() method for safer access
      const items = bot.inventory.items();
      if (Array.isArray(items)) {
        return items.filter(item => {
          if (!item || !item.name) return false;
          return predicate(item);
        }).reduce((total, item) => total + item.count, 0);
      }

      // Fallback: try callback-style count if available
      if (typeof bot.inventory.count === 'function') {
        try {
          return bot.inventory.count(predicate);
        } catch (callbackError) {
          console.warn('[InventoryUtils] Callback-style count failed, using items() method');
        }
      }

      return 0;
    } catch (error) {
      console.error('[InventoryUtils] _safeCount error:', error.message);
      return 0;
    }
  }

  /**
   * Get total wood count (logs) from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total wood/log count
   */
  static getWoodCount(bot) {
    if (!bot || !bot.inventory) return 0;

    // Enhanced log detection for all log types
    const logPattern = item => {
      if (!item || !item.name) return false;
      return item.name.includes('_log') || item.name === 'log';
    };

    const count = this._safeCount(bot, logPattern);

    // Debug: Log all wood items found
    const allItems = bot.inventory.items();
    const woodItems = allItems.filter(logPattern);
    console.log(`[InventoryUtils] 木材検出: 総数=${count}`);
    woodItems.forEach(item => {
      console.log(`[InventoryUtils] - ${item.name}: ${item.count}個`);
    });

    return count;
  }

  /**
   * Get total stone count from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total stone count (stone + cobblestone)
   */
  static getStoneCount(bot) {
    if (!bot || !bot.inventory) return 0;
    return this._safeCount(bot, item => item.name === 'stone' || item.name === 'cobblestone');
  }

  /**
   * Get total planks count from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total planks count
   */
  static getPlanksCount(bot) {
    if (!bot || !bot.inventory) return 0;
    return this._safeCount(bot, item =>
      item.name === 'oak_planks' || item.name === 'planks' ||
      item.name === 'birch_planks' || item.name === 'cherry_planks' ||
      item.name === 'spruce_planks' || item.name === 'jungle_planks' ||
      item.name === 'acacia_planks' || item.name === 'dark_oak_planks' ||
      item.name === 'mangrove_planks' || item.name === 'bamboo_planks'
    );
  }

  /**
   * Calculate total available planks (existing planks + convertible logs)
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total available planks (1 log = 4 planks)
   */
  static getAvailablePlanks(bot) {
    if (!bot || !bot.inventory) return 0;
    const currentPlanks = this.getPlanksCount(bot);
    const logs = this.getWoodCount(bot);
    return currentPlanks + (logs * 4); // 1 log = 4 planks
  }

  /**
   * Calculate planks obtainable from logs
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Planks obtainable from current logs
   */
  static getPlanksFromLogs(bot) {
    if (!bot || !bot.inventory) return 0;
    return this.getWoodCount(bot) * 4; // 1 log = 4 planks
  }

  /**
   * Check if bot has a specific tool type (using partial name matching)
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} toolType - Tool type to search for (e.g., 'pickaxe', 'axe', 'sword')
   * @returns {boolean} True if tool is found
   */
  static hasTool(bot, toolType) {
    if (!bot || !bot.inventory) return false;
    try {
      // Use bot.inventory.items() for safer access
      const items = bot.inventory.items();
      return items.some(item =>
        item && item.name && typeof item.name === 'string' && item.name.includes(toolType)
      );
    } catch (error) {
      console.error(`[InventoryUtils] hasTool error for toolType "${toolType}":`, error.message);
      return false;
    }
  }

  /**
   * Check if bot has a specific item (exact name match or flexible matching)
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} itemName - Item name (exact or partial match)
   * @param {number} minCount - Minimum count required (default: 1)
   * @param {boolean} flexible - Enable flexible matching (default: false)
   * @returns {boolean} True if item is found with sufficient count
   */
  static hasItem(bot, itemName, minCount = 1, flexible = false) {
    if (!bot || !bot.inventory) return false;
    try {
      // Use bot.inventory.items() for safer access
      const items = bot.inventory.items();

      let matchingItem = null;

      if (flexible) {
        // Flexible matching for common variations
        matchingItem = items.find(item => {
          if (!item || !item.name || typeof item.name !== 'string') return false;

          const itemNameLower = item.name.toLowerCase();
          const targetNameLower = itemName.toLowerCase();

          // Exact match first
          if (itemNameLower === targetNameLower) return true;

          // Special cases for crafting table
          if (targetNameLower === 'crafting_table') {
            return itemNameLower === 'crafting_table' ||
                   itemNameLower === 'workbench' ||
                   itemNameLower.includes('crafting');
          }

          // Special cases for planks
          if (targetNameLower.includes('planks')) {
            return itemNameLower.includes('planks');
          }

          // Special cases for logs
          if (targetNameLower.includes('log')) {
            return itemNameLower.includes('log');
          }

          // General partial matching
          return itemNameLower.includes(targetNameLower) ||
                 targetNameLower.includes(itemNameLower);
        });
      } else {
        // Exact match only
        matchingItem = items.find(item =>
          item && item.name && typeof item.name === 'string' && item.name === itemName
        );
      }

      return matchingItem && matchingItem.count >= minCount;
    } catch (error) {
      console.error(`[InventoryUtils] hasItem error for itemName "${itemName}":`, error.message);
      return false;
    }
  }

  /**
   * Get item count for a specific item
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} itemName - Exact item name
   * @returns {number} Item count (0 if not found)
   */
  static getItemCount(bot, itemName) {
    if (!bot || !bot.inventory) return 0;
    try {
      // Use bot.inventory.items() for safer access
      const items = bot.inventory.items();
      const item = items.find(item =>
        item && item.name && typeof item.name === 'string' && item.name === itemName
      );
      return item ? item.count : 0;
    } catch (error) {
      console.error(`[InventoryUtils] getItemCount error for itemName "${itemName}":`, error.message);
      return 0;
    }
  }

  /**
   * Get comprehensive inventory summary
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {Object} Inventory summary with key resource counts
   */
  static getInventorySummary(bot) {
    if (!bot || !bot.inventory) {
      return {
        wood: 0,
        stone: 0,
        planks: 0,
        availablePlanks: 0,
        hasPickaxe: false,
        hasAxe: false,
        hasSword: false,
        hasCraftingTable: false,
        canCraftWorkbench: false,
        canCraftBasicTools: false
      };
    }

    const wood = this.getWoodCount(bot);
    const stone = this.getStoneCount(bot);
    const planks = this.getPlanksCount(bot);
    const availablePlanks = this.getAvailablePlanks(bot);
    const hasCraftingTable = this.hasItem(bot, 'crafting_table', 1, true); // Enable flexible matching

    // Get detailed inventory information for debugging
    const allItems = bot.inventory.items();
    const inventoryDetails = allItems.map(item => ({
      name: item.name,
      count: item.count,
      type: item.type
    }));

    return {
      wood,
      stone,
      planks,
      availablePlanks,
      hasPickaxe: this.hasTool(bot, 'pickaxe'),
      hasAxe: this.hasTool(bot, 'axe'),
      hasSword: this.hasTool(bot, 'sword'),
      hasCraftingTable,
      // 作業台作成可能判定: 板材4個が利用可能で作業台未所持
      canCraftWorkbench: availablePlanks >= 4 && !hasCraftingTable,
      // 基本ツール作成可能判定: 板材8個が利用可能（作業台4個+ツール4個）
      canCraftBasicTools: availablePlanks >= 8,
      totalItems: allItems.length,
      inventoryDetails
    };
  }

  /**
   * Calculate wood requirements for tools
   * @param {Array<string>} tools - Array of tool names
   * @returns {number} Wood planks needed
   */
  static calculateWoodRequirements(tools) {
    if (!Array.isArray(tools)) return 0;

    let woodNeeded = 0;

    for (const tool of tools) {
      if (typeof tool === 'string' && tool.includes('wooden_')) {
        switch (tool) {
        case 'wooden_pickaxe':
        case 'wooden_axe':
        case 'wooden_hoe':
          woodNeeded += 3; // 3 planks + 2 sticks
          break;
        case 'wooden_sword':
          woodNeeded += 2; // 2 planks + 1 stick
          break;
        case 'wooden_shovel':
          woodNeeded += 1; // 1 plank + 2 sticks
          break;
        }
        woodNeeded += 1; // Additional for sticks
      }
    }

    return woodNeeded;
  }

  /**
   * Check if inventory has enough space for new items
   * @param {Bot} bot - Mineflayer bot instance
   * @param {number} itemCount - Number of items to check space for
   * @returns {Object} Space information
   */
  static checkInventorySpace(bot, itemCount = 1) {
    try {
      if (!bot || !bot.inventory) {
        return { hasSpace: false, error: 'Invalid bot or inventory' };
      }

      const inventory = bot.inventory;
      const totalSlots = 36; // Standard inventory size
      const usedSlots = inventory.items().length;
      const freeSlots = totalSlots - usedSlots;

      return {
        hasSpace: freeSlots >= itemCount,
        freeSlots,
        usedSlots,
        totalSlots,
        slotsNeeded: itemCount
      };
    } catch (error) {
      return {
        hasSpace: false,
        error: error.message,
        freeSlots: 0
      };
    }
  }

  /**
   * Get best tool for a specific block type
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} blockType - Block type to mine
   * @returns {Object} Best tool information
   */
  static getBestToolForBlock(bot, blockType) {
    try {
      if (!bot || !bot.inventory) {
        return { tool: null, efficiency: 0 };
      }

      const tools = bot.inventory.items().filter(item =>
        item && item.name && (
          item.name.includes('pickaxe') ||
          item.name.includes('axe') ||
          item.name.includes('shovel') ||
          item.name.includes('sword')
        )
      );

      if (tools.length === 0) {
        return { tool: null, efficiency: 0 };
      }

      // Define tool efficiency for different block types
      const toolEfficiency = {
        stone: { pickaxe: 10, axe: 1, shovel: 1, sword: 1 },
        wood: { axe: 10, pickaxe: 1, shovel: 1, sword: 2 },
        dirt: { shovel: 10, pickaxe: 1, axe: 1, sword: 1 },
        sand: { shovel: 10, pickaxe: 1, axe: 1, sword: 1 },
        gravel: { shovel: 10, pickaxe: 1, axe: 1, sword: 1 }
      };

      // Early check for unsupported block types
      if (!toolEfficiency[blockType]) {
        return {
          tool: null,
          efficiency: 0,
          error: `Unsupported block type: ${blockType}`,
          supportedTypes: Object.keys(toolEfficiency)
        };
      }

      let bestTool = null;
      let bestEfficiency = 0;

      for (const tool of tools) {
        const toolType = Object.keys(toolEfficiency[blockType]).find(type =>
          tool.name.includes(type)
        );

        if (toolType) {
          const efficiency = toolEfficiency[blockType][toolType] || 1;

          // Consider tool material (diamond > iron > stone > wooden)
          const materialMultiplier = this.getToolMaterialMultiplier(tool.name);
          const totalEfficiency = efficiency * materialMultiplier;

          if (totalEfficiency > bestEfficiency) {
            bestEfficiency = totalEfficiency;
            bestTool = tool;
          }
        }
      }

      return { tool: bestTool, efficiency: bestEfficiency };
    } catch (error) {
      return { tool: null, efficiency: 0, error: error.message };
    }
  }

  /**
   * Get tool material multiplier for efficiency calculation
   * @param {string} toolName - Tool name
   * @returns {number} Material multiplier
   */
  static getToolMaterialMultiplier(toolName) {
    if (toolName.includes('diamond')) return 4;
    if (toolName.includes('iron')) return 3;
    if (toolName.includes('stone')) return 2;
    if (toolName.includes('wooden')) return 1;
    return 1;
  }

  /**
   * Organize inventory by priority and type
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {Object} Organized inventory information
   */
  static organizeInventory(bot) {
    try {
      if (!bot || !bot.inventory) {
        return { organized: false, error: 'Invalid bot or inventory' };
      }

      const items = bot.inventory.items();
      const organized = {
        tools: [],
        resources: [],
        food: [],
        building: [],
        misc: []
      };

      for (const item of items) {
        if (!item || !item.name) continue;

        const itemName = item.name.toLowerCase();

        // Categorize items
        if (itemName.includes('pickaxe') || itemName.includes('axe') ||
            itemName.includes('sword') || itemName.includes('shovel') ||
            itemName.includes('hoe')) {
          organized.tools.push(item);
        } else if (itemName.includes('log') || itemName.includes('stone') ||
                   itemName.includes('coal') || itemName.includes('iron') ||
                   itemName.includes('ore') || itemName.includes('planks')) {
          organized.resources.push(item);
        } else if (itemName.includes('bread') || itemName.includes('meat') ||
                   itemName.includes('apple') || itemName.includes('food')) {
          organized.food.push(item);
        } else if (itemName.includes('block') || itemName.includes('brick') ||
                   itemName.includes('stone') || itemName.includes('wood')) {
          organized.building.push(item);
        } else {
          organized.misc.push(item);
        }
      }

      return {
        organized: true,
        categories: organized,
        totalItems: items.length
      };
    } catch (error) {
      return {
        organized: false,
        error: error.message
      };
    }
  }

  /**
   * Get all items from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {Array} Array of inventory items
   */
  static getAllItems(bot) {
    try {
      if (!bot || !bot.inventory) {
        console.warn('[InventoryUtils] Bot or inventory is null/undefined');
        return [];
      }

      const items = bot.inventory.items();
      if (Array.isArray(items)) {
        return items.filter(item => item && item.name);
      }

      return [];
    } catch (error) {
      console.error('[InventoryUtils] getAllItems error:', error.message);
      return [];
    }
  }

  /**
   * Check if an item is a wood plank type
   * @param {string} itemName - Item name to check
   * @returns {boolean} True if item is a wood plank
   */
  static isWoodPlank(itemName) {
    if (!itemName || typeof itemName !== 'string') return false;
    return itemName.includes('_planks') || itemName === 'planks';
  }

  /**
   * Get available wood planks (any type) that can be used for crafting
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {Object} Object with total count and breakdown by type
   */
  static getAvailableWoodPlanks(bot) {
    if (!bot || !bot.inventory) return { total: 0, breakdown: {} };

    const items = bot.inventory.items();
    const woodPlanks = items.filter(item => this.isWoodPlank(item.name));

    const breakdown = {};
    let total = 0;

    woodPlanks.forEach(item => {
      breakdown[item.name] = item.count;
      total += item.count;
    });

    return { total, breakdown };
  }

  /**
   * Check if we have enough wood planks (any type) for a recipe
   * @param {Bot} bot - Mineflayer bot instance
   * @param {number} requiredCount - Required plank count
   * @returns {boolean} True if we have enough planks
   */
  static hasEnoughWoodPlanks(bot, requiredCount) {
    const { total } = this.getAvailableWoodPlanks(bot);
    return total >= requiredCount;
  }

  /**
   * Get the best available wood plank type for crafting
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {string|null} Best available plank type or null if none available
   */
  static getBestAvailableWoodPlank(bot) {
    const { breakdown } = this.getAvailableWoodPlanks(bot);
    const plankTypes = Object.keys(breakdown);

    if (plankTypes.length === 0) return null;

    // Return the type with the most quantity
    return plankTypes.reduce((best, current) =>
      breakdown[current] > breakdown[best] ? current : best
    );
  }

  /**
   * Check if a material can be substituted with available materials
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} requiredMaterial - Required material name
   * @param {number} requiredCount - Required count
   * @returns {Object} Substitution information
   */
  static canSubstituteMaterial(bot, requiredMaterial, requiredCount) {
    // Check for wood plank substitution
    if (this.isWoodPlank(requiredMaterial)) {
      const { total, breakdown } = this.getAvailableWoodPlanks(bot);
      const available = total >= requiredCount;

      return {
        canSubstitute: available,
        substitutionType: 'wood_plank',
        availableCount: total,
        requiredCount,
        substitutes: breakdown,
        bestSubstitute: available ? this.getBestAvailableWoodPlank(bot) : null
      };
    }

    // Check for stick substitution - sticks can be crafted from planks
    if (requiredMaterial === 'stick') {
      const stickCount = this.getItemCount(bot, 'stick');

      // Check if we have enough sticks directly
      if (stickCount >= requiredCount) {
        return {
          canSubstitute: true,
          substitutionType: 'exact_match',
          availableCount: stickCount,
          requiredCount,
          substitutes: { stick: stickCount },
          bestSubstitute: 'stick'
        };
      }

      // Check if we have enough planks to craft sticks
      const { total: totalPlanks } = this.getAvailableWoodPlanks(bot);
      // 2 planks -> 4 sticks, so we need (requiredCount - stickCount) additional sticks
      const additionalSticksNeeded = requiredCount - stickCount;
      const planksNeededForSticks = Math.ceil(additionalSticksNeeded / 4) * 2;

      if (totalPlanks >= planksNeededForSticks) {
        return {
          canSubstitute: true,
          substitutionType: 'stick_from_planks',
          availableCount: stickCount + Math.floor(totalPlanks / 2) * 4,
          requiredCount,
          substitutes: {
            stick: stickCount,
            planks_available: totalPlanks,
            planks_needed: planksNeededForSticks
          },
          bestSubstitute: 'stick'
        };
      }

      return {
        canSubstitute: false,
        substitutionType: 'stick_insufficient',
        availableCount: stickCount,
        requiredCount,
        substitutes: {
          stick: stickCount,
          planks_available: totalPlanks,
          planks_needed: planksNeededForSticks
        },
        bestSubstitute: null
      };
    }

    // For non-wood materials, check exact match
    const exactCount = this.getItemCount(bot, requiredMaterial);
    return {
      canSubstitute: exactCount >= requiredCount,
      substitutionType: 'exact_match',
      availableCount: exactCount,
      requiredCount,
      substitutes: { [requiredMaterial]: exactCount },
      bestSubstitute: exactCount >= requiredCount ? requiredMaterial : null
    };
  }

  /**
   * Get item priority for inventory management
   * @param {string} itemName - Item name
   * @returns {number} Priority (higher = more important)
   */
  static getItemPriority(itemName) {
    if (!itemName) return 0;

    const name = itemName.toLowerCase();

    // Essential tools
    if (name.includes('diamond')) return 100;
    if (name.includes('iron') && (name.includes('pickaxe') || name.includes('axe'))) return 90;
    if (name.includes('pickaxe') || name.includes('axe')) return 80;
    if (name.includes('sword')) return 70;
    if (name.includes('shovel') || name.includes('hoe')) return 60;

    // Important resources
    if (name.includes('diamond')) return 95;
    if (name.includes('iron') || name.includes('gold')) return 85;
    if (name.includes('coal')) return 75;
    if (name.includes('log') || name.includes('wood')) return 65;
    if (name.includes('stone')) return 55;

    // Food
    if (name.includes('bread') || name.includes('meat')) return 50;
    if (name.includes('apple') || name.includes('food')) return 45;

    // Building materials
    if (name.includes('crafting_table') || name.includes('furnace')) return 40;
    if (name.includes('planks')) return 35;

    // Low priority items
    if (name.includes('dirt') || name.includes('gravel') || name.includes('sand')) return 10;
    if (name.includes('cobblestone') && name.includes('cobblestone')) return 20;

    return 25; // Default priority
  }

  /**
   * Suggest items to drop based on priority and quantity
   * @param {Bot} bot - Mineflayer bot instance
   * @param {number} slotsNeeded - Number of slots needed
   * @returns {Array} Items to drop
   */
  static suggestItemsToDrop(bot, slotsNeeded = 1) {
    try {
      if (!bot || !bot.inventory) {
        return [];
      }

      const items = bot.inventory.items();
      const suggestions = [];

      // Sort items by priority (lowest first)
      const sortedItems = items.sort((a, b) => {
        const priorityA = this.getItemPriority(a.name);
        const priorityB = this.getItemPriority(b.name);
        return priorityA - priorityB;
      });

      let slotsToFree = slotsNeeded;

      for (const item of sortedItems) {
        if (slotsToFree <= 0) break;

        const priority = this.getItemPriority(item.name);

        // Only suggest dropping low priority items
        if (priority < 30) {
          const dropCount = Math.min(item.count, Math.max(1, item.count - 8));
          suggestions.push({
            item,
            dropCount,
            priority,
            reason: priority < 15 ? 'Very low priority' : 'Low priority'
          });
          slotsToFree--;
        }
      }

      return suggestions;
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if bot has sufficient resources for tool upgrade
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} currentTool - Current tool name
   * @returns {Object} Upgrade information
   */
  static checkToolUpgradeAvailability(bot, currentTool) {
    try {
      if (!bot || !bot.inventory || !currentTool) {
        return { canUpgrade: false, error: 'Invalid parameters' };
      }

      const toolType = currentTool.includes('pickaxe')
        ? 'pickaxe'
        : currentTool.includes('axe')
          ? 'axe'
          : currentTool.includes('sword')
            ? 'sword'
            : currentTool.includes('shovel') ? 'shovel' : null;

      if (!toolType) {
        return { canUpgrade: false, error: 'Unknown tool type' };
      }

      const upgrades = [];

      // Check for stone upgrade
      if (currentTool.includes('wooden') && this.getStoneCount(bot) >= 3) {
        upgrades.push({
          from: currentTool,
          to: `stone_${toolType}`,
          materials: { stone: 3, sticks: 2 },
          available: true
        });
      }

      // Check for iron upgrade
      if ((currentTool.includes('wooden') || currentTool.includes('stone')) &&
          this.getItemCount(bot, 'iron_ingot') >= 3) {
        upgrades.push({
          from: currentTool,
          to: `iron_${toolType}`,
          materials: { iron_ingot: 3, sticks: 2 },
          available: true
        });
      }

      // Check for diamond upgrade
      if (this.getItemCount(bot, 'diamond') >= 3) {
        upgrades.push({
          from: currentTool,
          to: `diamond_${toolType}`,
          materials: { diamond: 3, sticks: 2 },
          available: true
        });
      }

      return {
        canUpgrade: upgrades.length > 0,
        upgrades,
        bestUpgrade: upgrades.length > 0 ? upgrades[upgrades.length - 1] : null
      };
    } catch (error) {
      return { canUpgrade: false, error: error.message };
    }
  }

  /**
   * Print detailed inventory information for debugging
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} context - Context description for logging
   */
  static logInventoryDetails(bot, context = '') {
    if (!bot || !bot.inventory) {
      console.log(`[InventoryUtils${context ? ' - ' + context : ''}] Bot or inventory not available`);
      return;
    }

    const summary = this.getInventorySummary(bot);
    console.log(`[InventoryUtils${context ? ' - ' + context : ''}] インベントリ詳細:`);
    console.log(`  総アイテム数: ${summary.totalItems}`);
    console.log(`  木材: ${summary.wood}個, 石材: ${summary.stone}個`);
    console.log(`  板材: ${summary.planks}個, 利用可能板材: ${summary.availablePlanks}個`);
    console.log(`  作業台所持: ${summary.hasCraftingTable ? 'あり' : 'なし'}`);
    const pickaxeStatus = summary.hasPickaxe ? 'あり' : 'なし';
    const axeStatus = summary.hasAxe ? 'あり' : 'なし';
    const swordStatus = summary.hasSword ? 'あり' : 'なし';
    console.log(`  ツール: つるはし${pickaxeStatus}, 斧${axeStatus}, 剣${swordStatus}`);

    if (summary.inventoryDetails.length > 0) {
      console.log('  詳細アイテムリスト:');
      summary.inventoryDetails.forEach(item => {
        console.log(`    - ${item.name}: ${item.count}個 (ID: ${item.type})`);
      });
    } else {
      console.log('  インベントリは空です');
    }
  }

  /**
   * Find all items matching a pattern (flexible search)
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} pattern - Search pattern
   * @returns {Array} Array of matching items
   */
  static findItemsByPattern(bot, pattern) {
    if (!bot || !bot.inventory) return [];

    try {
      const items = bot.inventory.items();
      const patternLower = pattern.toLowerCase();

      return items.filter(item => {
        if (!item || !item.name || typeof item.name !== 'string') return false;
        return item.name.toLowerCase().includes(patternLower);
      });
    } catch (error) {
      console.error(`[InventoryUtils] findItemsByPattern error for pattern "${pattern}":`, error.message);
      return [];
    }
  }
}

module.exports = InventoryUtils;
