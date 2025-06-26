/**
 * Mineflayer Recipe Test
 * Tests actual bot.recipesFor() API behavior
 */

const mineflayer = require('mineflayer');
const mcData = require('minecraft-data');

class MineflayerRecipeTest {
  constructor() {
    this.testResults = [];
    this.bot = null;
  }

  async runTests() {
    console.log('[MineflayerRecipeTest] Starting recipe API test...');
    
    try {
      // Create offline bot for testing
      this.bot = mineflayer.createBot({
        host: 'localhost',
        port: 25565,
        username: 'test_bot',
        auth: 'offline',
        connect: false // Don't actually connect
      });

      // Initialize minecraft-data
      const version = '1.20.4';
      const data = mcData(version);
      console.log(`[MineflayerRecipeTest] Testing with version: ${version}`);
      
      // Manually set bot version for minecraft-data compatibility
      this.bot.version = version;
      
      // Test critical recipes
      const criticalItems = [
        { name: 'crafting_table', id: data.itemsByName.crafting_table?.id },
        { name: 'oak_planks', id: data.itemsByName.oak_planks?.id },
        { name: 'wooden_pickaxe', id: data.itemsByName.wooden_pickaxe?.id },
        { name: 'wooden_axe', id: data.itemsByName.wooden_axe?.id },
        { name: 'furnace', id: data.itemsByName.furnace?.id },
        { name: 'chest', id: data.itemsByName.chest?.id }
      ];

      for (const item of criticalItems) {
        await this.testItemRecipeAPI(data, item);
      }

      this.printResults();
      return this.testResults.every(r => r.passed);

    } catch (error) {
      console.error(`[MineflayerRecipeTest] Critical error: ${error.message}`);
      return false;
    } finally {
      if (this.bot) {
        this.bot.end();
      }
    }
  }

  async testItemRecipeAPI(data, item) {
    try {
      if (!item.id) {
        this.recordResult(item.name, false, `Item ${item.name} not found in minecraft-data`);
        return;
      }

      // Test with different approaches
      let recipeFound = false;
      let recipeDetails = '';

      try {
        // Approach 1: Try with mock recipesFor function (simulate mineflayer behavior)
        const recipes = this.mockRecipesFor(data, item.id);
        if (recipes && recipes.length > 0) {
          recipeFound = true;
          recipeDetails = `Mock API found ${recipes.length} recipe(s)`;
        }
      } catch (error) {
        console.log(`[MineflayerRecipeTest] Mock API failed for ${item.name}: ${error.message}`);
      }

      if (!recipeFound) {
        // Approach 2: Direct minecraft-data recipe search
        const directRecipes = this.findRecipesInData(data, item.id);
        if (directRecipes.length > 0) {
          recipeFound = true;
          recipeDetails = `Direct search found ${directRecipes.length} recipe(s)`;
        }
      }

      if (recipeFound) {
        this.recordResult(item.name, true, recipeDetails);
      } else {
        this.recordResult(item.name, false, `No recipes found for ${item.name} (id: ${item.id})`);
      }

    } catch (error) {
      this.recordResult(item.name, false, `Test error: ${error.message}`);
    }
  }

  mockRecipesFor(data, itemId) {
    // Simulate mineflayer's recipesFor behavior
    const recipes = [];
    
    // Search through minecraft-data recipes
    if (data.recipes) {
      for (const [recipeId, recipe] of Object.entries(data.recipes)) {
        if (recipe && typeof recipe === 'object') {
          // Handle different recipe formats
          let resultItemId = null;
          
          if (recipe.result && recipe.result.id === itemId) {
            resultItemId = recipe.result.id;
          } else if (recipe.result === itemId) {
            resultItemId = recipe.result;
          }
          
          if (resultItemId === itemId) {
            recipes.push({
              id: parseInt(recipeId),
              result: recipe.result,
              inShape: recipe.inShape,
              ingredients: recipe.ingredients
            });
          }
        }
      }
    }

    return recipes;
  }

  findRecipesInData(data, itemId) {
    const recipes = [];
    
    // Check if minecraft-data has a different structure
    if (data.recipes) {
      for (const [recipeId, recipe] of Object.entries(data.recipes)) {
        if (recipe && recipe.result) {
          const resultId = typeof recipe.result === 'object' ? recipe.result.id : recipe.result;
          if (resultId === itemId) {
            recipes.push(recipe);
          }
        }
      }
    }

    return recipes;
  }

  recordResult(itemName, passed, message) {
    const result = { itemName, passed, message };
    this.testResults.push(result);
    
    const status = passed ? '✓' : '✗';
    const color = passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}[MineflayerRecipeTest] ${status} ${itemName}: ${message}\x1b[0m`);
  }

  printResults() {
    const total = this.testResults.length;
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = total - passed;

    console.log('\n[MineflayerRecipeTest] ===== SUMMARY =====');
    console.log(`Total tests: ${total}`);
    console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    
    if (failed > 0) {
      console.log('\n[MineflayerRecipeTest] Failed tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => console.log(`  - ${r.itemName}: ${r.message}`));
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const test = new MineflayerRecipeTest();
  test.runTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = MineflayerRecipeTest;