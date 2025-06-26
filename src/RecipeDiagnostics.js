/**
 * Recipe Diagnostics Tool
 * Provides comprehensive minecraft-data and recipe analysis
 */

const mcData = require('minecraft-data');

class RecipeDiagnostics {
  static async diagnoseRecipeIssues(bot) {
    console.log('\n[RecipeDiagnostics] ===== RECIPE DIAGNOSTIC REPORT =====');
    
    try {
      const version = bot.version;
      console.log(`[RecipeDiagnostics] Bot version: ${version}`);
      
      const data = mcData(version);
      if (!data) {
        console.error(`[RecipeDiagnostics] ❌ minecraft-data not available for version ${version}`);
        return false;
      }
      
      console.log(`[RecipeDiagnostics] minecraft-data version: ${data.version?.minecraftVersion || 'unknown'}`);
      
      // Test critical items
      const criticalItems = ['crafting_table', 'oak_planks', 'wooden_pickaxe'];
      
      for (const itemName of criticalItems) {
        await this.diagnoseItem(bot, data, itemName);
      }
      
      // Additional diagnostics
      this.diagnoseRecipeStructure(data);
      
      return true;
      
    } catch (error) {
      console.error(`[RecipeDiagnostics] Critical error: ${error.message}`);
      return false;
    }
  }

  static async diagnoseItem(bot, data, itemName) {
    console.log(`\n[RecipeDiagnostics] --- Diagnosing ${itemName} ---`);
    
    try {
      // Step 1: Check if item exists in minecraft-data
      const item = data.itemsByName[itemName];
      if (!item) {
        console.log(`❌ Item '${itemName}' not found in minecraft-data`);
        return;
      }
      console.log(`✓ Item found: id=${item.id}, name=${item.name}`);
      
      // Step 2: Check bot.recipesFor API
      try {
        const recipes = bot.recipesFor(item.id, null, 1, null);
        console.log(`✓ bot.recipesFor(${item.id}) returned ${recipes.length} recipes`);
        
        if (recipes.length > 0) {
          const recipe = recipes[0];
          console.log(`  Recipe details:`, {
            ingredients: recipe.ingredients?.length || 'unknown',
            requiresTable: recipe.requiresTable || false
          });
        }
      } catch (error) {
        console.log(`❌ bot.recipesFor(${item.id}) failed: ${error.message}`);
      }
      
      // Step 3: Direct minecraft-data recipe search
      let directRecipeCount = 0;
      if (data.recipes) {
        for (const recipe of Object.values(data.recipes)) {
          if (recipe && recipe.result) {
            const resultId = typeof recipe.result === 'object' ? recipe.result.id : recipe.result;
            if (resultId === item.id) {
              directRecipeCount++;
            }
          }
        }
      }
      console.log(`  Direct minecraft-data search: ${directRecipeCount} recipes found`);
      
    } catch (error) {
      console.log(`❌ Diagnosis failed for ${itemName}: ${error.message}`);
    }
  }

  static diagnoseRecipeStructure(data) {
    console.log('\n[RecipeDiagnostics] --- Recipe Structure Analysis ---');
    
    if (!data.recipes) {
      console.log('❌ No recipes object found in minecraft-data');
      return;
    }
    
    const totalRecipes = Object.keys(data.recipes).length;
    console.log(`Total recipes available: ${totalRecipes}`);
    
    // Sample recipe structure
    const sampleRecipes = Object.entries(data.recipes).slice(0, 5);
    console.log('Sample recipe structures:');
    
    for (const [recipeId, recipe] of sampleRecipes) {
      console.log(`  Recipe ${recipeId}:`, {
        hasResult: !!recipe.result,
        resultType: typeof recipe.result,
        hasInShape: !!recipe.inShape,
        hasIngredients: !!recipe.ingredients,
        keys: Object.keys(recipe)
      });
    }
  }

  static async testRecipeCompatibility(bot) {
    console.log('\n[RecipeDiagnostics] ===== RECIPE COMPATIBILITY TEST =====');
    
    try {
      // Test if mineflayer's recipe system is working at all
      const data = mcData(bot.version);
      const allItems = Object.values(data.itemsByName).slice(0, 10);
      
      let workingRecipes = 0;
      let totalTested = 0;
      
      for (const item of allItems) {
        try {
          const recipes = bot.recipesFor(item.id, null, 1, null);
          totalTested++;
          if (recipes.length > 0) {
            workingRecipes++;
            console.log(`✓ ${item.name}: ${recipes.length} recipes`);
          }
        } catch (error) {
          // Silent failure for this test
        }
      }
      
      console.log(`Recipe compatibility: ${workingRecipes}/${totalTested} items have recipes`);
      
      if (workingRecipes === 0) {
        console.log('⚠️  WARNING: No recipes found for any tested items - possible version mismatch');
      }
      
    } catch (error) {
      console.error(`[RecipeDiagnostics] Compatibility test failed: ${error.message}`);
    }
  }

  static createEnhancedRecipeHelper(bot) {
    return {
      searchRecipe: (itemName) => {
        try {
          const data = mcData(bot.version);
          const item = data.itemsByName[itemName];
          
          if (!item) {
            return { success: false, reason: 'ITEM_NOT_FOUND', itemName };
          }
          
          // Try multiple approaches
          const approaches = [
            () => bot.recipesFor(item.id, null, 1, null),
            () => bot.recipesFor(item.id, null, 1),
            () => bot.recipesFor(item.id)
          ];
          
          for (const approach of approaches) {
            try {
              const recipes = approach();
              if (recipes && recipes.length > 0) {
                return { 
                  success: true, 
                  recipe: recipes[0], 
                  count: recipes.length,
                  itemId: item.id 
                };
              }
            } catch (error) {
              // Try next approach
            }
          }
          
          return { 
            success: false, 
            reason: 'NO_RECIPE', 
            itemName, 
            itemId: item.id 
          };
          
        } catch (error) {
          return { 
            success: false, 
            reason: 'SEARCH_ERROR', 
            error: error.message 
          };
        }
      }
    };
  }
}

module.exports = RecipeDiagnostics;