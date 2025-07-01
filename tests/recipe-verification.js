/**
 * Recipe Verification Test
 * Tests minecraft-data recipe availability for critical items
 */

const mcData = require('minecraft-data');

class RecipeVerificationTest {
  constructor() {
    this.testResults = [];
  }

  async runTests(version = '1.21') {
    console.log(`[RecipeTest] Starting recipe verification for Minecraft ${version}`);

    try {
      const data = mcData(version);
      if (!data) {
        throw new Error(`minecraft-data for version ${version} not available`);
      }

      console.log(`[RecipeTest] mcData version: ${data.version.minecraftVersion}`);

      // Debug: Check recipe structure
      console.log('[RecipeTest] Total recipes available:', Object.keys(data.recipes || {}).length);

      // Sample a few recipes to understand structure
      const sampleRecipeIds = Object.keys(data.recipes || {}).slice(0, 3);
      for (const recipeId of sampleRecipeIds) {
        const recipe = data.recipes[recipeId];
        console.log(`[RecipeTest] Sample recipe ${recipeId}:`, {
          result: recipe.result,
          inShape: recipe.inShape ? 'has inShape' : 'no inShape',
          ingredients: recipe.ingredients ? recipe.ingredients.length : 'no ingredients'
        });
      }

      // Test critical items
      const criticalItems = [
        'crafting_table',
        'oak_planks',
        'wooden_pickaxe',
        'wooden_axe',
        'furnace',
        'chest'
      ];

      for (const itemName of criticalItems) {
        await this.testItemRecipe(data, itemName);
      }

      this.printResults();
      return this.testResults.every(r => r.passed);
    } catch (error) {
      console.error(`[RecipeTest] Critical error: ${error.message}`);
      return false;
    }
  }

  async testItemRecipe(data, itemName) {
    try {
      const item = data.itemsByName[itemName];
      if (!item) {
        this.recordResult(itemName, false, `Item ${itemName} not found in minecraft-data`);
        return;
      }

      // minecraft-data 3.90.0+ 新構造対応テスト
      let recipeFound = false;
      let recipeDetails = '';

      // 直接検索: data.recipes[itemId] が配列になっている
      if (data.recipes && data.recipes[item.id]) {
        const directRecipes = data.recipes[item.id];
        if (Array.isArray(directRecipes) && directRecipes.length > 0) {
          recipeFound = true;
          const recipe = directRecipes[0];
          const ingredientCount = recipe.ingredients
            ? recipe.ingredients.length
            : recipe.inShape ? recipe.inShape.flat().filter(x => x !== null && x !== undefined).length : 0;
          recipeDetails = `Direct lookup: ${directRecipes.length} recipe(s), ingredients: ${ingredientCount}`;

          console.log(`[RecipeTest] ✓ Found recipe for ${itemName} via direct lookup:`, {
            recipeCount: directRecipes.length,
            hasIngredients: !!recipe.ingredients,
            hasInShape: !!recipe.inShape,
            result: recipe.result
          });
        }
      }

      // バックアップ検索: 全レシピをスキャン
      if (!recipeFound && data.recipes && Object.keys(data.recipes).length > 0) {
        for (const [recipeId, recipeArray] of Object.entries(data.recipes)) {
          if (Array.isArray(recipeArray)) {
            for (const recipe of recipeArray) {
              if (recipe.result && recipe.result.id === item.id) {
                recipeFound = true;
                const ingredientCount = recipe.ingredients
                  ? recipe.ingredients.length
                  : recipe.inShape ? recipe.inShape.flat().filter(x => x !== null && x !== undefined).length : 0;
                recipeDetails = `Full scan: Recipe ID ${recipeId}, ingredients: ${ingredientCount}`;
                break;
              }
            }
            if (recipeFound) break;
          }
        }
      }

      if (recipeFound) {
        this.recordResult(itemName, true, recipeDetails);
      } else {
        // Additional debug information
        console.log(`[RecipeTest] Debug ${itemName}: item.id=${item.id}, recipe keys sample:`,
          Object.keys(data.recipes || {}).slice(0, 5));
        this.recordResult(itemName, false, `No recipes found for ${itemName} (id: ${item.id})`);
      }
    } catch (error) {
      this.recordResult(itemName, false, `Test error: ${error.message}`);
    }
  }

  recordResult(itemName, passed, message) {
    const result = { itemName, passed, message };
    this.testResults.push(result);

    const status = passed ? '✓' : '✗';
    const color = passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}[RecipeTest] ${status} ${itemName}: ${message}\x1b[0m`);
  }

  printResults() {
    const total = this.testResults.length;
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = total - passed;

    console.log('\n[RecipeTest] ===== SUMMARY =====');
    console.log(`Total tests: ${total}`);
    console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);

    if (failed > 0) {
      console.log('\n[RecipeTest] Failed tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => console.log(`  - ${r.itemName}: ${r.message}`));
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const test = new RecipeVerificationTest();
  test.runTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = RecipeVerificationTest;
