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

// 直接実行時のテスト
if (require.main === module) {
  console.log('[RecipeDiagnostics] Analyzing minecraft-data structure for Minecraft 1.21...');
  
  try {
    const data = mcData('1.21');
    if (!data) {
      console.error('❌ minecraft-data for 1.21 not available');
      process.exit(1);
    }
    
    console.log(`✓ minecraft-data version: ${data.version?.minecraftVersion || 'unknown'}`);
    console.log(`✓ Package version: ${data.version?.version || 'unknown'}`);
    
    // Analyze recipe structure
    RecipeDiagnostics.diagnoseRecipeStructure(data);
    
    // Test critical items structure
    const criticalItems = ['crafting_table', 'oak_planks', 'wooden_pickaxe'];
    console.log('\n[RecipeDiagnostics] --- Item Analysis ---');
    
    for (const itemName of criticalItems) {
      const item = data.itemsByName[itemName];
      if (item) {
        console.log(`✓ ${itemName}: found (id: ${item.id})`);
      } else {
        console.log(`❌ ${itemName}: not found`);
      }
    }
    
    // Check if recipe search works directly
    console.log('\n[RecipeDiagnostics] --- Direct Recipe Search Test ---');
    if (data.recipes) {
      console.log(`Recipe keys sample: ${Object.keys(data.recipes).slice(0, 10)}`);
      
      // Investigate raw recipe structure
      const recipeKeys = Object.keys(data.recipes);
      console.log(`\nInvestigating raw recipe data:`);
      
      for (let i = 0; i < Math.min(5, recipeKeys.length); i++) {
        const key = recipeKeys[i];
        const recipe = data.recipes[key];
        console.log(`Recipe ${key}:`, JSON.stringify(recipe, null, 2));
      }
      
      // Check if there's a different recipe structure
      console.log('\nChecking alternative recipe access:');
      
      // Try crafting recipes specifically
      if (data.recipes && typeof data.recipes === 'object') {
        console.log(`data.recipes type: ${typeof data.recipes}`);
        console.log(`data.recipes constructor: ${data.recipes.constructor.name}`);
        
        // Check for alternative structures
        if (data.recipesFor) {
          console.log('✓ data.recipesFor function exists');
        } else {
          console.log('❌ data.recipesFor function not found');
        }
        
        // Check for recipe arrays or alternative storage
        const possibleRecipeProps = ['craftingRecipes', 'shapedRecipes', 'shapelessRecipes', 'recipeData'];
        for (const prop of possibleRecipeProps) {
          if (data[prop]) {
            console.log(`✓ Found alternative recipe property: ${prop}`);
            console.log(`  Type: ${typeof data[prop]}, Length: ${Array.isArray(data[prop]) ? data[prop].length : 'N/A'}`);
          }
        }
      }
      
      // Try to find recipes for oak_planks using different approaches
      const oakPlanksItem = data.itemsByName.oak_planks;
      if (oakPlanksItem) {
        console.log(`\nSearching for oak_planks (id: ${oakPlanksItem.id}) recipes:`);
        
        let found = 0;
        for (const [recipeId, recipe] of Object.entries(data.recipes)) {
          // More flexible result checking
          if (recipe && typeof recipe === 'object') {
            const hasResult = recipe.result || recipe.output || recipe.item;
            if (hasResult) {
              const resultId = hasResult.id || hasResult;
              if (resultId === oakPlanksItem.id) {
                console.log(`✓ Recipe for oak_planks found: ${recipeId}`);
                console.log(`  Recipe structure:`, JSON.stringify(recipe, null, 2));
                found++;
              }
            }
          }
        }
        if (found === 0) {
          console.log(`❌ No recipes found for oak_planks in comprehensive search`);
          
          // Check if recipe ID matches item ID directly
          console.log(`\nChecking recipe ID matching item ID for oak_planks (${oakPlanksItem.id}):`);
          const directRecipe = data.recipes[oakPlanksItem.id];
          if (directRecipe) {
            console.log(`✓ Found recipe data for oak_planks at ID ${oakPlanksItem.id}:`);
            console.log(JSON.stringify(directRecipe, null, 2));
          } else {
            console.log(`❌ No recipe found at ID ${oakPlanksItem.id}`);
          }
          
          // Check a few more specific IDs around oak_planks
          const testIds = [35, 36, 37, 38];
          console.log('\nChecking specific recipe IDs:');
          for (const testId of testIds) {
            if (data.recipes[testId]) {
              console.log(`Recipe ${testId}:`, JSON.stringify(data.recipes[testId], null, 2));
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error(`[RecipeDiagnostics] Analysis failed: ${error.message}`);
    process.exit(1);
  }
}