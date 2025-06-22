/**
 * InventoryUtils - Common inventory calculation utilities
 * 
 * This module provides shared utility functions for inventory calculations
 * to reduce code duplication and improve consistency across the codebase.
 */

class InventoryUtils {
  /**
   * Get total wood count (logs) from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total wood/log count
   */
  static getWoodCount(bot) {
    if (!bot || !bot.inventory) return 0;
    return bot.inventory.count('oak_log') + bot.inventory.count('log');
  }

  /**
   * Get total stone count from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total stone count (stone + cobblestone)
   */
  static getStoneCount(bot) {
    if (!bot || !bot.inventory) return 0;
    return bot.inventory.count('stone') + bot.inventory.count('cobblestone');
  }

  /**
   * Get total planks count from bot inventory
   * @param {Bot} bot - Mineflayer bot instance
   * @returns {number} Total planks count
   */
  static getPlanksCount(bot) {
    if (!bot || !bot.inventory) return 0;
    return bot.inventory.count('oak_planks') + bot.inventory.count('planks');
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
    return bot.inventory.findInventoryItem(item => 
      item.name && item.name.includes(toolType)
    ) !== null;
  }

  /**
   * Check if bot has a specific item (exact name match)
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} itemName - Exact item name
   * @param {number} minCount - Minimum count required (default: 1)
   * @returns {boolean} True if item is found with sufficient count
   */
  static hasItem(bot, itemName, minCount = 1) {
    if (!bot || !bot.inventory) return false;
    const item = bot.inventory.findInventoryItem(item => item.name === itemName);
    return item && item.count >= minCount;
  }

  /**
   * Get item count for a specific item
   * @param {Bot} bot - Mineflayer bot instance
   * @param {string} itemName - Exact item name
   * @returns {number} Item count (0 if not found)
   */
  static getItemCount(bot, itemName) {
    if (!bot || !bot.inventory) return 0;
    const item = bot.inventory.findInventoryItem(item => item.name === itemName);
    return item ? item.count : 0;
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
        hasCraftingTable: false
      };
    }

    return {
      wood: this.getWoodCount(bot),
      stone: this.getStoneCount(bot),
      planks: this.getPlanksCount(bot),
      availablePlanks: this.getAvailablePlanks(bot),
      hasPickaxe: this.hasTool(bot, 'pickaxe'),
      hasAxe: this.hasTool(bot, 'axe'),
      hasSword: this.hasTool(bot, 'sword'),
      hasCraftingTable: this.hasItem(bot, 'crafting_table')
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
}

module.exports = { InventoryUtils };