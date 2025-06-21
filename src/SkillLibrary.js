const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

class SkillLibrary {
  constructor() {
    this.skills = new Map();
  }

  loadBasicSkills() {
    // Movement skills
    this.registerSkill('move_to', new MoveToSkill());
    this.registerSkill('follow', new FollowSkill());
    this.registerSkill('explore', new ExploreSkill());
    
    // Interaction skills
    this.registerSkill('mine_block', new MineBlockSkill());
    this.registerSkill('place_block', new PlaceBlockSkill());
    this.registerSkill('attack_entity', new AttackEntitySkill());
    
    // Survival skills
    this.registerSkill('gather_wood', new SimpleGatherWoodSkill());
    this.registerSkill('find_food', new SimpleFindFoodSkill());
    
    // Crafting skills
    this.registerSkill('craft_tools', new CraftToolsSkill());
    this.registerSkill('craft_workbench', new CraftWorkbenchSkill());
    this.registerSkill('craft_furnace', new CraftFurnaceSkill());
    
    // Building skills
    this.registerSkill('build_shelter', new BuildShelterSkill());
    this.registerSkill('place_blocks', new PlaceBlocksSkill());
    
    console.log(`${this.skills.size}個のスキルを読み込みました`);
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

  async execute(bot, params = {}) {
    throw new Error('execute method must be implemented');
  }
}

// Movement Skills
class MoveToSkill extends Skill {
  constructor() {
    super('move_to', 'Move to a specific position');
  }

  async execute(bot, params) {
    try {
      const { target } = params;
      const { x, y, z } = target || params;
      
      console.log(`[移動スキル] (${x}, ${y}, ${z})に移動中...`);
      
      // Ensure pathfinder and movement settings are ready with proper error handling
      if (!bot.pathfinder) {
        try {
          bot.loadPlugin(pathfinder);
          // Wait for plugin to fully initialize
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (loadError) {
          console.log(`[移動スキル] Pathfinder読み込み失敗: ${loadError.message}`);
          return { success: false, error: `Pathfinder初期化エラー: ${loadError.message}` };
        }
      }
      
      // Verify pathfinder is properly initialized
      if (!bot.pathfinder || typeof bot.pathfinder !== 'object') {
        console.log('[移動スキル] Pathfinderが正しく初期化されていません');
        return { success: false, error: 'Pathfinder初期化が不完全です' };
      }
      
      if (!bot.pathfinder.movements) {
        try {
          const mcData = require('minecraft-data')(bot.version);
          const movements = new Movements(bot, mcData);
          movements.scafoldingBlocks = []; // Prevent scaffolding issues
          movements.dontMineUnderFallingBlock = true; // Safety
          movements.allow1by1towers = false; // Prevent building towers
          bot.pathfinder.setMovements(movements);
        } catch (movementError) {
          console.log(`[移動スキル] Movement設定エラー: ${movementError.message}`);
          return { success: false, error: `Movement設定失敗: ${movementError.message}` };
        }
      }

      // Prefer the high-level `goto` helper when available to avoid
      // manual event wiring issues that caused “bot.pathfinder.on is not a function”
      if (typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
        try {
          await bot.pathfinder.goto(goal, { timeout: 10000 }); // 10 second timeout
          return { success: true, message: '目的地に到着しました' };
        } catch (gotoErr) {
          console.log(`[移動スキル] 移動失敗: ${gotoErr.message}`);
          return { success: false, error: gotoErr.message };
        }
      }
      
      // Manual pathfinding with safety checks and error handling
      if (!bot.pathfinder.setGoal || !bot.pathfinder.on) {
        return { success: false, error: 'Pathfinder APIが利用できません' };
      }
      
      const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      bot.pathfinder.setGoal(goal);
      
      return new Promise((resolve) => {
        let resolved = false;
        
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            bot.pathfinder.stop();
            resolve({ success: false, error: 'パスファインディングタイムアウト (8秒)' });
          }
        }, 8000); // Reduced timeout to 8 seconds
        
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
            console.log(`[移動スキル] イベントリスナー削除エラー: ${cleanupError.message}`);
          }
        };
        
        try {
          if (bot.pathfinder && typeof bot.pathfinder.on === 'function') {
            bot.pathfinder.on('goal_reached', onGoalReached);
            bot.pathfinder.on('path_update', onPathUpdate);
          } else {
            resolved = true;
            cleanup();
            resolve({ success: false, error: 'Pathfinderイベントハンドラーが利用できません' });
          }
        } catch (eventError) {
          resolved = true;
          cleanup();
          resolve({ success: false, error: `イベントハンドラー設定エラー: ${eventError.message}` });
        }
      });
      
    } catch (error) {
      console.log(`[移動スキル] エラー: ${error.message}`);
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

class ExploreSkill extends Skill {
  constructor() {
    super('explore', 'Explore the surrounding area');
  }

  async execute(bot, params) {
    const { radius = 50 } = params;
    const pos = bot.entity.position;
    
    // Generate random exploration target
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius;
    
    const targetX = Math.floor(pos.x + Math.cos(angle) * distance);
    const targetZ = Math.floor(pos.z + Math.sin(angle) * distance);
    const targetY = pos.y;
    
    console.log(`[探索スキル] (${targetX}, ${targetY}, ${targetZ})を探索中...`);
    
    const moveSkill = new MoveToSkill();
    const result = await moveSkill.execute(bot, { x: targetX, y: targetY, z: targetZ });
    
    if (result.success) {
      bot.chat(`新しいエリアを探索しました！ 🗺️`);
    }
    
    return result;
  }
}

// Interaction Skills
class MineBlockSkill extends Skill {
  constructor() {
    super('mine_block', 'Mine a specific block');
  }

  async execute(bot, params) {
    const { blockType, position } = params;
    let block;
    
    if (position) {
      block = bot.blockAt(position);
    } else {
      block = bot.findBlock({
        matching: blockType,
        maxDistance: 32
      });
    }
    
    if (!block) {
      return { success: false, error: `ブロック ${blockType} が見つかりません` };
    }
    
    try {
      await bot.dig(block);
      return { success: true, message: `${block.name}を採掘しました` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class PlaceBlockSkill extends Skill {
  constructor() {
    super('place_block', 'Place a block at a position');
  }

  async execute(bot, params) {
    const { blockType, position } = params;
    const item = bot.inventory.findInventoryItem(blockType);
    
    if (!item) {
      return { success: false, error: `インベントリに${blockType}がありません` };
    }
    
    try {
      const referenceBlock = bot.blockAt(position);
      await bot.placeBlock(referenceBlock, new bot.Vec3(0, 1, 0));
      return { success: true, message: `${blockType}を設置しました` };
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
    const { entityType, maxDistance = 16 } = params;
    
    const entity = bot.nearestEntity(e => 
      e.name === entityType && 
      e.position.distanceTo(bot.entity.position) <= maxDistance
    );
    
    if (!entity) {
      return { success: false, error: `近くに${entityType}が見つかりません` };
    }
    
    try {
      await bot.attack(entity);
      return { success: true, message: `${entityType}を攻撃しました` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Survival Skills
class SimpleGatherWoodSkill extends Skill {
  constructor() {
    super('gather_wood', 'Simple wood gathering');
  }

  async execute(bot, params) {
    const { amount = 5 } = params;
    
    console.log(`[木材収集] 近くの木を探しています...`);
    
    // Find wood blocks nearby
    const woodBlock = bot.findBlock({
      matching: (block) => {
        return block.name && (
          block.name.includes('_log') ||
          block.name === 'log'
        );
      },
      maxDistance: 32
    });

    if (woodBlock) {
      console.log(`[木材収集] ${woodBlock.position}で${woodBlock.name}を発見しました`);
      try {
        await bot.dig(woodBlock);
        bot.chat(`${woodBlock.name}を採取しました！ 🌳`);
        return { success: true, gathered: 1 };
      } catch (error) {
        console.log(`[木材収集] 採掘に失敗: ${error.message}`);
        return { success: false, error: error.message };
      }
    } else {
      console.log(`[木材収集] 近くに木が見つかりません`);
      return { success: false, error: '木が見つかりません' };
    }
  }
}

class SimpleFindFoodSkill extends Skill {
  constructor() {
    super('find_food', 'Simple food finding');
  }

  async execute(bot, params) {
    console.log(`[食料確保] 現在の食料レベル: ${bot.food}/20`);
    
    if (bot.food >= 15) {
      console.log(`[食料確保] 食料レベルは十分です`);
      return { success: true, message: '食料レベルは十分です' };
    }
    
    // Look for animals to hunt
    const animals = ['cow', 'pig', 'chicken', 'sheep'];
    
    for (const animalType of animals) {
      const animal = bot.nearestEntity(e => 
        e.name === animalType && 
        e.position.distanceTo(bot.entity.position) <= 16
      );
      
      if (animal) {
        console.log(`[食料確保] ${animalType}を発見、攻撃中...`);
        try {
          await bot.attack(animal);
          bot.chat(`${animalType}を狩りました！ 🍖`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return { success: true, hunted: animalType };
        } catch (error) {
          console.log(`[食料確保] 攻撃に失敗: ${error.message}`);
        }
      }
    }
    
    console.log(`[食料確保] 近くに動物が見つかりません`);
    return { success: false, error: '動物が見つかりません' };
  }
}

// Crafting Skills
class CraftToolsSkill extends Skill {
  constructor() {
    super('craft_tools', 'Craft basic tools');
  }

  async execute(bot, params) {
    const { tools = ['wooden_pickaxe', 'wooden_axe'], context } = params;
    console.log(`[クラフトスキル] ${tools.join(', ')}を作成します`);

    let crafted = 0;
    const results = [];

    for (const tool of tools) {
      try {
        const result = await this.craftSingleTool(bot, tool);
        if (result.success) {
          crafted++;
          results.push(tool);
          console.log(`[クラフトスキル] ${tool}の作成に成功`);
        } else {
          console.log(`[クラフトスキル] ${tool}の作成に失敗: ${result.error}`);
        }
      } catch (error) {
        console.log(`[クラフトスキル] ${tool}作成中にエラー: ${error.message}`);
      }
    }

    if (crafted > 0) {
      bot.chat(`${results.join(', ')}を作成しました！ 🔨`);
      return { success: true, crafted: results };
    } else {
      return { success: false, error: '何もクラフトできませんでした' };
    }
  }

  async craftSingleTool(bot, toolName) {
    // Check if we have a crafting table
    const craftingTable = bot.findBlock({
      matching: (block) => block.name === 'crafting_table',
      maxDistance: 32
    });

    try {
      // Find the recipe
      const mcData = require('minecraft-data')(bot.version);
      const itemByName = mcData.itemsByName[toolName];
      
      if (!itemByName) {
        return { success: false, error: `Unknown tool: ${toolName}` };
      }

      const recipe = bot.recipesFor(itemByName.id, null, 1, craftingTable)[0];
      if (!recipe) {
        return { success: false, error: `No recipe for ${toolName}` };
      }

      // Move to crafting table if needed
      if (craftingTable) {
        const distance = bot.entity.position.distanceTo(craftingTable.position);
        if (distance > 4) {
          if (bot.pathfinder) {
            const { goals } = require('mineflayer-pathfinder');
            await bot.pathfinder.setGoal(new goals.GoalBlock(
              craftingTable.position.x, 
              craftingTable.position.y, 
              craftingTable.position.z
            ));
          }
        }
      }

      // Craft the item
      await bot.craft(recipe, 1, craftingTable);
      return { success: true };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class CraftWorkbenchSkill extends Skill {
  constructor() {
    super('craft_workbench', 'Craft a workbench');
  }

  async execute(bot, params) {
    console.log(`[作業台スキル] 作業台を作成します`);

    try {
      // Check if we have wood planks
      const planks = bot.inventory.findInventoryItem('oak_planks') || 
                    bot.inventory.findInventoryItem('planks');
      
      if (!planks || planks.count < 4) {
        // Try to make planks from logs first
        const logs = bot.inventory.findInventoryItem('oak_log') || 
                    bot.inventory.findInventoryItem('log');
        
        if (logs && logs.count > 0) {
          await this.craftPlanks(bot, logs);
        } else {
          return { success: false, error: '木材が不足しています' };
        }
      }

      // Craft the workbench
      const mcData = require('minecraft-data')(bot.version);
      const workbenchItem = mcData.itemsByName.crafting_table;
      const recipe = bot.recipesFor(workbenchItem.id, null, 1, null)[0];

      if (!recipe) {
        return { success: false, error: '作業台のレシピが見つかりません' };
      }

      await bot.craft(recipe, 1, null);
      bot.chat('作業台を作成しました！ 🔧');
      return { success: true, crafted: 'crafting_table' };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async craftPlanks(bot, logs) {
    try {
      const mcData = require('minecraft-data')(bot.version);
      const planksItem = mcData.itemsByName.oak_planks || mcData.itemsByName.planks;
      const recipe = bot.recipesFor(planksItem.id, null, 1, null)[0];

      if (recipe) {
        const planksToCraft = Math.min(logs.count, 4);
        await bot.craft(recipe, planksToCraft, null);
        console.log(`[作業台スキル] ${planksToCraft * 4}個の板を作成`);
      }
    } catch (error) {
      console.log(`[作業台スキル] 板の作成に失敗: ${error.message}`);
    }
  }
}

class CraftFurnaceSkill extends Skill {
  constructor() {
    super('craft_furnace', 'Craft a furnace');
  }

  async execute(bot, params) {
    console.log(`[かまどスキル] かまどを作成します`);

    try {
      // Check if we have cobblestone
      const cobblestone = bot.inventory.findInventoryItem('cobblestone');
      
      if (!cobblestone || cobblestone.count < 8) {
        return { success: false, error: 'かまど作成には8個の石が必要です' };
      }

      // Find crafting table
      const craftingTable = bot.findBlock({
        matching: (block) => block.name === 'crafting_table',
        maxDistance: 32
      });

      if (!craftingTable) {
        return { success: false, error: 'かまど作成には作業台が必要です' };
      }

      // Move to crafting table
      const distance = bot.entity.position.distanceTo(craftingTable.position);
      if (distance > 4 && bot.pathfinder) {
        const { goals } = require('mineflayer-pathfinder');
        await bot.pathfinder.setGoal(new goals.GoalBlock(
          craftingTable.position.x, 
          craftingTable.position.y, 
          craftingTable.position.z
        ));
      }

      // Craft the furnace
      const mcData = require('minecraft-data')(bot.version);
      const furnaceItem = mcData.itemsByName.furnace;
      const recipe = bot.recipesFor(furnaceItem.id, null, 1, craftingTable)[0];

      if (!recipe) {
        return { success: false, error: 'かまどのレシピが見つかりません' };
      }

      await bot.craft(recipe, 1, craftingTable);
      bot.chat('かまどを作成しました！ 🔥');
      return { success: true, crafted: 'furnace' };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Building Skills
class BuildShelterSkill extends Skill {
  constructor() {
    super('build_shelter', 'Build a simple shelter');
  }

  async execute(bot, params) {
    const { size = 'small', materials = ['wood'] } = params;
    console.log(`[建築スキル] ${size}サイズの避難所を建設します`);

    try {
      // Check materials
      const planks = bot.inventory.findInventoryItem('oak_planks') || 
                    bot.inventory.findInventoryItem('planks');
      
      if (!planks || planks.count < 20) {
        return { success: false, error: '建築材料が不足しています（20個の板が必要）' };
      }

      const pos = bot.entity.position;
      const shelterPos = {
        x: Math.floor(pos.x) + 3,
        y: Math.floor(pos.y),
        z: Math.floor(pos.z) + 3
      };

      // Build simple 3x3 shelter
      const success = await this.buildSimpleShelter(bot, shelterPos, planks);
      
      if (success) {
        bot.chat('避難所を建設しました！ 🏠');
        return { success: true, built: 'shelter', location: shelterPos };
      } else {
        return { success: false, error: '建設に失敗しました' };
      }

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async buildSimpleShelter(bot, pos, planks) {
    try {
      await bot.equip(planks, 'hand');
      
      // Build walls (simple 3x3x3 structure)
      const wallPositions = [
        // Front wall
        { x: pos.x, y: pos.y + 1, z: pos.z },
        { x: pos.x + 1, y: pos.y + 1, z: pos.z },
        { x: pos.x + 2, y: pos.y + 1, z: pos.z },
        // Back wall
        { x: pos.x, y: pos.y + 1, z: pos.z + 2 },
        { x: pos.x + 1, y: pos.y + 1, z: pos.z + 2 },
        { x: pos.x + 2, y: pos.y + 1, z: pos.z + 2 },
        // Side walls
        { x: pos.x, y: pos.y + 1, z: pos.z + 1 },
        { x: pos.x + 2, y: pos.y + 1, z: pos.z + 1 },
        // Roof
        { x: pos.x, y: pos.y + 2, z: pos.z },
        { x: pos.x + 1, y: pos.y + 2, z: pos.z },
        { x: pos.x + 2, y: pos.y + 2, z: pos.z },
        { x: pos.x, y: pos.y + 2, z: pos.z + 1 },
        { x: pos.x + 1, y: pos.y + 2, z: pos.z + 1 },
        { x: pos.x + 2, y: pos.y + 2, z: pos.z + 1 },
        { x: pos.x, y: pos.y + 2, z: pos.z + 2 },
        { x: pos.x + 1, y: pos.y + 2, z: pos.z + 2 },
        { x: pos.x + 2, y: pos.y + 2, z: pos.z + 2 }
      ];

      let placed = 0;
      for (const wallPos of wallPositions) {
        try {
          const referenceBlock = bot.blockAt({ x: wallPos.x, y: wallPos.y - 1, z: wallPos.z });
          if (referenceBlock) {
            await bot.placeBlock(referenceBlock, new bot.Vec3(0, 1, 0));
            placed++;
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          }
        } catch (placeError) {
          // Continue placing other blocks even if one fails
          console.log(`[建築スキル] ブロック配置失敗: ${placeError.message}`);
        }
      }

      return placed > 5; // Consider success if at least some blocks were placed

    } catch (error) {
      console.log(`[建築スキル] 建設エラー: ${error.message}`);
      return false;
    }
  }
}

class PlaceBlocksSkill extends Skill {
  constructor() {
    super('place_blocks', 'Place blocks in specified pattern');
  }

  async execute(bot, params) {
    const { blockType, positions, pattern = 'line' } = params;
    console.log(`[配置スキル] ${blockType}を${pattern}パターンで配置します`);

    try {
      const item = bot.inventory.findInventoryItem(blockType);
      if (!item) {
        return { success: false, error: `${blockType}がインベントリにありません` };
      }

      await bot.equip(item, 'hand');
      
      let placed = 0;
      const targetPositions = positions || this.generatePattern(bot.entity.position, pattern);

      for (const pos of targetPositions) {
        try {
          const referenceBlock = bot.blockAt({ x: pos.x, y: pos.y - 1, z: pos.z });
          if (referenceBlock && referenceBlock.name !== 'air') {
            await bot.placeBlock(referenceBlock, new bot.Vec3(0, 1, 0));
            placed++;
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (placeError) {
          console.log(`[配置スキル] 配置失敗: ${placeError.message}`);
        }
      }

      if (placed > 0) {
        bot.chat(`${placed}個のブロックを配置しました！ 🧱`);
        return { success: true, placed: placed };
      } else {
        return { success: false, error: 'ブロックを配置できませんでした' };
      }

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  generatePattern(centerPos, pattern) {
    const positions = [];
    const baseX = Math.floor(centerPos.x);
    const baseY = Math.floor(centerPos.y);
    const baseZ = Math.floor(centerPos.z);

    switch (pattern) {
      case 'line':
        for (let i = 1; i <= 5; i++) {
          positions.push({ x: baseX + i, y: baseY, z: baseZ });
        }
        break;
      case 'square':
        for (let x = 0; x < 3; x++) {
          for (let z = 0; z < 3; z++) {
            positions.push({ x: baseX + x, y: baseY, z: baseZ + z });
          }
        }
        break;
      case 'wall':
        for (let i = 0; i < 5; i++) {
          positions.push({ x: baseX + i, y: baseY + 1, z: baseZ + 1 });
          positions.push({ x: baseX + i, y: baseY + 2, z: baseZ + 1 });
        }
        break;
      default:
        positions.push({ x: baseX + 1, y: baseY, z: baseZ + 1 });
    }

    return positions;
  }
}

module.exports = { SkillLibrary };
