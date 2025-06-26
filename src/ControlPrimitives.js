const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock, GoalLookAtBlock } = goals;
const { Vec3 } = require('vec3');
const InventoryUtils = require('./InventoryUtils');

class ControlPrimitives {
  constructor(bot) {
    this.bot = bot;
    this.mcData = require('minecraft-data')(bot.version);
    this.mineBlockFailCount = 0;
    this.craftItemFailCount = 0;
    this.maxFailCount = 10;
    this.environmentObserver = null; // Will be set from MinecraftAI

    // Initialize pathfinder
    this.initializePathfinder();
  }

  initializePathfinder() {
    try {
      if (this.bot.loadPlugin && !this.bot.pathfinder) {
        this.bot.loadPlugin(pathfinder);
        const movements = new Movements(this.bot, this.mcData);

        // Enhanced movement capabilities for complex terrain navigation
        movements.canDig = false; // Disable digging for safer navigation
        movements.allow1by1towers = false; // Disable tower building
        movements.allowFreeMotion = true; // Allow free motion
        movements.allowParkour = true; // Enable parkour movements
        movements.allowSprinting = true; // Enable sprinting
        movements.canOpenDoors = true; // Allow opening doors
        movements.allowEntityDetection = true; // Detect entities as obstacles

        // Liquid handling - treat as passable but with caution
        movements.liquids = new Set();
        movements.infiniteLiquidDropdownDistance = false; // Safer liquid handling

        // Enhanced jumping settings for obstacle navigation
        movements.maxJumpDistance = 4; // Increased jump distance
        movements.maxDropDistance = 4; // Allow controlled drops
        movements.maxClimbDistance = 2; // Allow climbing

        // Block breaking restrictions for safety
        movements.blocksCantBreak = new Set([
          this.mcData.blocksByName.bedrock?.id,
          this.mcData.blocksByName.barrier?.id,
          this.mcData.blocksByName.lava?.id,
          this.mcData.blocksByName.flowing_lava?.id
        ].filter(Boolean));

        // Scaffolding blocks (items that can be placed for building paths)
        movements.scafoldingBlocks = [
          this.mcData.itemsByName.dirt?.id,
          this.mcData.itemsByName.cobblestone?.id,
          this.mcData.itemsByName.stone?.id
        ].filter(Boolean);

        // Safety settings
        movements.dontMineUnderFallingBlock = true;
        movements.dontCreateFlow = true; // Don't create water/lava flows
        movements.allowWaterBucket = false;
        movements.allowLavaBucket = false;
        movements.placeCost = 2; // Cost for placing blocks
        movements.breakCost = 1; // Cost for breaking blocks

        this.bot.pathfinder.setMovements(movements);
        console.log('[ControlPrimitives] Enhanced pathfinder initialized with parkour and jumping');
      }
    } catch (error) {
      console.log('[ControlPrimitives] Pathfinder initialization skipped (mock bot or already loaded)');
    }
  }

  async mineBlock(name, count = 1) {
    if (typeof name !== 'string') {
      throw new Error('name for mineBlock must be a string');
    }
    if (typeof count !== 'number') {
      throw new Error('count for mineBlock must be a number');
    }

    const blockByName = this.mcData.blocksByName[name];
    if (!blockByName) {
      throw new Error(`No block named ${name}`);
    }

    console.log(`[ControlPrimitives] Looking for ${count} ${name} blocks...`);

    // Find blocks
    const blocks = this.bot.findBlocks({
      matching: [blockByName.id],
      maxDistance: 32,
      count: Math.max(count * 2, 10) // Find more than needed
    });

    if (blocks.length === 0) {
      this.bot.chat(`No ${name} nearby, please explore first`);
      this.mineBlockFailCount++;
      if (this.mineBlockFailCount > this.maxFailCount) {
        throw new Error(
          'mineBlock failed too many times, make sure you explore before calling mineBlock'
        );
      }
      return false;
    }

    // Check if we have the right tool
    const tool = this.getOptimalTool(blockByName);
    if (tool) {
      await this.bot.equip(tool, 'hand');
      console.log(`[ControlPrimitives] Equipped ${tool.name} for mining ${name}`);
    } else {
      console.log(`[ControlPrimitives] Warning: Mining ${name} without proper tool`);
    }

    let mined = 0;
    for (let i = 0; i < blocks.length && mined < count; i++) {
      try {
        const block = this.bot.blockAt(blocks[i]);
        if (block && block.name === name) {
          // Move closer to block if needed
          const distance = this.bot.entity.position.distanceTo(block.position);
          if (distance > 4.5) {
            await this.bot.pathfinder.goto(new GoalBlock(block.position.x, block.position.y, block.position.z));
          }

          console.log(`[ControlPrimitives] Mining ${name} ${mined + 1}/${count} at ${block.position}`);
          await this.bot.dig(block);
          mined++;

          // Small delay to prevent spam
          await this.sleep(100);
        }
      } catch (error) {
        console.log(`[ControlPrimitives] Failed to mine block: ${error.message}`);
        continue;
      }
    }

    console.log(`[ControlPrimitives] Successfully mined ${mined}/${count} ${name} blocks`);
    this.mineBlockFailCount = 0; // Reset fail count on success
    return mined > 0;
  }

  getOptimalTool(blockData) {
    const toolPriorities = {
      // Pickaxe blocks
      stone: ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      cobblestone: ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      coal_ore: ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      iron_ore: ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe'],

      // Axe blocks
      oak_log: ['diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      birch_log: ['diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      spruce_log: ['diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
      jungle_log: ['diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],

      // Shovel blocks
      dirt: ['diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'],
      sand: ['diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'],
      gravel: ['diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel']
    };

    const tools = toolPriorities[blockData.name] || [];

    for (const toolName of tools) {
      const tool = this.bot.inventory.items().find(item => item && item.name === toolName);
      if (tool) {
        return tool;
      }
    }

    return null;
  }

  async craftItem(name, count = 1) {
    if (typeof name !== 'string') {
      throw new Error('name for craftItem must be a string');
    }
    if (typeof count !== 'number') {
      throw new Error('count for craftItem must be a number');
    }

    const itemByName = this.mcData.itemsByName[name];
    if (!itemByName) {
      throw new Error(`No item named ${name}`);
    }

    console.log(`[ControlPrimitives] Attempting to craft ${count} ${name}`);

    // Find crafting table
    const craftingTable = this.bot.findBlock({
      matching: this.mcData.blocksByName.crafting_table.id,
      maxDistance: 32
    });

    if (!craftingTable) {
      console.log('[ControlPrimitives] No crafting table found, crafting in inventory');
    } else {
      // Move to crafting table
      await this.bot.pathfinder.goto(
        new GoalLookAtBlock(craftingTable.position, this.bot.world)
      );
      console.log(`[ControlPrimitives] Moved to crafting table at ${craftingTable.position}`);
    }

    // Get recipe
    const recipe = this.bot.recipesFor(itemByName.id, null, 1, craftingTable)[0];
    if (!recipe) {
      const missingItems = this.getMissingMaterials(name, craftingTable);
      this.bot.chat(`Cannot craft ${name}. Missing: ${missingItems.join(', ')}`);
      this.craftItemFailCount++;
      if (this.craftItemFailCount > this.maxFailCount) {
        throw new Error(
          'craftItem failed too many times, check chat log to see what happened'
        );
      }
      return false;
    }

    try {
      console.log(`[ControlPrimitives] Crafting ${name} x${count}`);
      await this.bot.craft(recipe, count, craftingTable);
      this.bot.chat(`Successfully crafted ${name} x${count}`);
      this.craftItemFailCount = 0; // Reset fail count on success
      return true;
    } catch (error) {
      this.bot.chat(`Failed to craft ${name}: ${error.message}`);
      console.log(`[ControlPrimitives] Craft error: ${error.message}`);
      return false;
    }
  }

  getMissingMaterials(itemName, craftingTable) {
    const itemByName = this.mcData.itemsByName[itemName];
    if (!itemByName) return [];

    const recipes = this.bot.recipesFor(itemByName.id, null, 1, craftingTable);
    if (recipes.length === 0) return [`No recipe for ${itemName}`];

    const recipe = recipes[0];
    const missing = [];

    for (const ingredient of recipe.ingredients) {
      const needed = ingredient.count;
      // Ensure ingredient.id is valid for count() method
      if (typeof ingredient.id !== 'number' && typeof ingredient.id !== 'string') {
        console.log(`[ControlPrimitives] Invalid ingredient ID type: ${typeof ingredient.id}, value: ${ingredient.id}`);
        continue;
      }

      try {
        const available = this.bot.inventory.count(ingredient.id);
        if (available < needed) {
          const itemName = this.mcData.items[ingredient.id]?.name || `item_${ingredient.id}`;
          missing.push(`${itemName} (need ${needed}, have ${available})`);
        }
      } catch (error) {
        console.log(`[ControlPrimitives] Error counting ingredient ${ingredient.id}: ${error.message}`);
        const itemName = this.mcData.items[ingredient.id]?.name || `item_${ingredient.id}`;
        missing.push(`${itemName} (count error: ${error.message})`);
      }
    }

    return missing;
  }

  async placeItem(name, position) {
    const item = this.bot.inventory.items().find(item => item && item.name === name);
    if (!item) {
      throw new Error(`No ${name} in inventory`);
    }

    console.log(`[ControlPrimitives] Placing ${name} at ${position}`);

    try {
      await this.bot.equip(item, 'hand');

      // Find reference block (ground)
      const referenceBlock = this.bot.blockAt(position.offset(0, -1, 0));
      if (!referenceBlock) {
        throw new Error(`No reference block found at ${position.offset(0, -1, 0)}`);
      }

      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
      console.log(`[ControlPrimitives] Successfully placed ${name}`);
      return true;
    } catch (error) {
      console.log(`[ControlPrimitives] Failed to place ${name}: ${error.message}`);
      return false;
    }
  }

  async exploreUntil(direction, maxTime, condition) {
    console.log('[ControlPrimitives] Starting exploration...');

    const startTime = Date.now();
    const maxTimeMs = maxTime * 1000;

    while (Date.now() - startTime < maxTimeMs) {
      // Check condition
      const result = condition();
      if (result) {
        console.log('[ControlPrimitives] Exploration successful!');
        return result;
      }

      // Move in exploration direction
      const pos = this.bot.entity.position;
      const targetPos = pos.offset(
        direction.x * 10,
        0,
        direction.z * 10
      );

      try {
        await this.bot.pathfinder.goto(new GoalBlock(targetPos.x, targetPos.y, targetPos.z));
        await this.sleep(500); // Optimized wait - reduced from 1000ms to 500ms for faster exploration
      } catch (error) {
        // If can't reach target, try random direction
        const angle = Math.random() * Math.PI * 2;
        const randomTarget = pos.offset(
          Math.cos(angle) * 15,
          0,
          Math.sin(angle) * 15
        );

        try {
          await this.bot.pathfinder.goto(new GoalBlock(randomTarget.x, randomTarget.y, randomTarget.z));
        } catch (e) {
          console.log('[ControlPrimitives] Movement failed, continuing exploration...');
        }
      }
    }

    console.log(`[ControlPrimitives] Exploration timed out after ${maxTime} seconds`);
    return null;
  }

  async moveToPosition(x, y, z) {
    console.log(`[ControlPrimitives] Moving to position (${x}, ${y}, ${z})`);

    try {
      await this.bot.pathfinder.goto(new GoalBlock(x, y, z));
      console.log('[ControlPrimitives] Successfully reached target position');
      return true;
    } catch (error) {
      console.log(`[ControlPrimitives] Failed to reach position: ${error.message}`);
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility method to check inventory (delegated to InventoryUtils)
  hasItem(itemName, count = 1) {
    return InventoryUtils.hasItem(this.bot, itemName, count);
  }

  // Utility method to get item count (delegated to InventoryUtils)
  getItemCount(itemName) {
    return InventoryUtils.getItemCount(this.bot, itemName);
  }
}

module.exports = { ControlPrimitives };
