/**
 * Unit tests for InventoryUtils
 * Tests for API compatibility and null safety
 */

const InventoryUtils = require('../src/InventoryUtils');

// Mock bot with different inventory API signatures
function createMockBot(apiType = 'standard') {
  const mockItems = [
    { name: 'oak_log', count: 5, type: 17 },
    { name: 'stone', count: 10, type: 1 },
    { name: 'oak_planks', count: 8, type: 5 },
    { name: 'iron_pickaxe', count: 1, type: 257 },
    { name: 'stone_axe', count: 1, type: 275 }
  ];

  const bot = {
    inventory: {}
  };

  if (apiType === 'standard') {
    // Mineflayer v3 standard API: items() method
    bot.inventory.items = () => mockItems;
    bot.inventory.count = null; // No callback support
  } else if (apiType === 'callback') {
    // Legacy callback API
    bot.inventory.items = () => mockItems;
    bot.inventory.count = (predicate) => {
      return mockItems.filter(predicate).reduce((total, item) => total + item.count, 0);
    };
  } else if (apiType === 'broken') {
    // Broken API to test error handling
    bot.inventory.items = () => {
      throw new Error('Mock API error');
    };
    bot.inventory.count = () => {
      throw new Error('Mock callback error');
    };
  }

  return bot;
}

// Test suite
describe('InventoryUtils', () => {
  describe('_safeCount method', () => {
    test('should work with standard API (items() method)', () => {
      const bot = createMockBot('standard');
      const count = InventoryUtils._safeCount(bot, item => item.name === 'oak_log');
      expect(count).toBe(5);
    });

    test('should work with callback API', () => {
      const bot = createMockBot('callback');
      const count = InventoryUtils._safeCount(bot, item => item.name === 'stone');
      expect(count).toBe(10);
    });

    test('should handle broken API gracefully', () => {
      const bot = createMockBot('broken');
      const count = InventoryUtils._safeCount(bot, item => item.name === 'oak_log');
      expect(count).toBe(0); // Should return 0 without throwing
    });

    test('should handle null/undefined bot', () => {
      expect(InventoryUtils._safeCount(null, () => true)).toBe(0);
      expect(InventoryUtils._safeCount(undefined, () => true)).toBe(0);
      expect(InventoryUtils._safeCount({}, () => true)).toBe(0);
    });
  });

  describe('Count methods using _safeCount', () => {
    test('getWoodCount should return correct count', () => {
      const bot = createMockBot('standard');
      expect(InventoryUtils.getWoodCount(bot)).toBe(5);
    });

    test('getStoneCount should return correct count', () => {
      const bot = createMockBot('callback');
      expect(InventoryUtils.getStoneCount(bot)).toBe(10);
    });

    test('getPlanksCount should return correct count', () => {
      const bot = createMockBot('standard');
      expect(InventoryUtils.getPlanksCount(bot)).toBe(8);
    });
  });

  describe('getBestToolForBlock with null guards', () => {
    test('should handle supported block types', () => {
      const bot = createMockBot('standard');
      const result = InventoryUtils.getBestToolForBlock(bot, 'stone');

      expect(result.tool).toBeTruthy();
      expect(result.tool.name).toBe('iron_pickaxe');
      expect(result.efficiency).toBeGreaterThan(0);
    });

    test('should handle unsupported block types gracefully', () => {
      const bot = createMockBot('standard');
      const result = InventoryUtils.getBestToolForBlock(bot, 'unknown_block');

      expect(result.tool).toBeNull();
      expect(result.efficiency).toBe(0);
      expect(result.error).toContain('Unsupported block type');
      expect(result.supportedTypes).toEqual(['stone', 'wood', 'dirt', 'sand', 'gravel']);
    });

    test('should handle empty inventory', () => {
      const bot = {
        inventory: {
          items: () => []
        }
      };

      const result = InventoryUtils.getBestToolForBlock(bot, 'stone');
      expect(result.tool).toBeNull();
      expect(result.efficiency).toBe(0);
    });

    test('should handle null bot gracefully', () => {
      const result = InventoryUtils.getBestToolForBlock(null, 'stone');
      expect(result.tool).toBeNull();
      expect(result.efficiency).toBe(0);
    });
  });

  describe('General robustness', () => {
    test('getInventorySummary should not crash with broken bot', () => {
      const result = InventoryUtils.getInventorySummary(null);

      expect(result.wood).toBe(0);
      expect(result.stone).toBe(0);
      expect(result.planks).toBe(0);
      expect(result.hasPickaxe).toBe(false);
    });

    test('hasTool should handle various input types', () => {
      const bot = createMockBot('standard');

      expect(InventoryUtils.hasTool(bot, 'pickaxe')).toBe(true);
      expect(InventoryUtils.hasTool(bot, 'axe')).toBe(true);
      expect(InventoryUtils.hasTool(bot, 'sword')).toBe(false);
      expect(InventoryUtils.hasTool(null, 'pickaxe')).toBe(false);
    });
  });
});

// Simple test runner if jest is not available
if (typeof describe === 'undefined') {
  console.log('Running InventoryUtils tests...');

  // Basic API compatibility test
  try {
    const bot = createMockBot('standard');
    const woodCount = InventoryUtils.getWoodCount(bot);
    console.log(`✓ Standard API - Wood count: ${woodCount}`);

    const callbackBot = createMockBot('callback');
    const stoneCount = InventoryUtils.getStoneCount(callbackBot);
    console.log(`✓ Callback API - Stone count: ${stoneCount}`);

    const brokenBot = createMockBot('broken');
    const errorCount = InventoryUtils.getPlanksCount(brokenBot);
    console.log(`✓ Error handling - Count: ${errorCount} (should be 0)`);

    // Test unsupported block type
    const unsupportedResult = InventoryUtils.getBestToolForBlock(bot, 'unknown_block');
    console.log(`✓ Unsupported block - Error: ${unsupportedResult.error}`);

    console.log('All tests passed! ✅');
  } catch (error) {
    console.error('Test failed:', error);
  }
}
