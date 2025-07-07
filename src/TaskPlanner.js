const InventoryUtils = require('./InventoryUtils');
const { PathfindingCache } = require('./PathfindingCache');
const { ValidationUtils } = require('./utils/ValidationUtils');
const { Logger } = require('./utils/Logger');

class TaskPlanner {
  constructor(bot, pathfindingCache = null) {
    this.bot = bot;
    this.pathfindingCache = pathfindingCache || new PathfindingCache();
    this.activeTasks = new Map();
    this.taskHistory = [];
    this.logger = Logger.createLogger('TaskPlanner');

    if (!pathfindingCache) {
      this.logger.log('独自PathfindingCacheを初期化');
    }
  }

  async planTask(goal) {
    try {
      ValidationUtils.validateGoal(goal, 'TaskPlanner');
    } catch (error) {
      this.logger.error(error.message);
      return null;
    }

    switch (goal.type) {
    case 'explore':
      return this.planExploration(goal);

    case 'gather_wood':
      return this.planWoodGathering(goal);

    case 'craft_tools':
    case 'craft_basic_tools':
      return this.planToolCrafting(goal);

    case 'craft_workbench':
      return this.planWorkbenchCrafting(goal);

    case 'place_workbench':
      return this.planWorkbenchPlacement(goal);

    case 'craft_with_workbench':
      return this.planAdvancedCrafting(goal);

    case 'craft_stone_tools':
      return this.planStoneToolCrafting(goal);

    case 'move_to':
      return this.planMovement(goal);

    case 'follow':
      return this.planFollowing(goal);

    case 'find_food':
      return this.planFoodGathering(goal);

    case 'find_stone':
      return this.planStoneGathering(goal);

    case 'build_shelter':
      return this.planShelterBuilding(goal);

    case 'mine_safely':
      return this.planSafeMining(goal);

      // Handle AI-generated goal types
    case 'task':
    case 'skill_improvement':
    case 'goal_progression':
    case 'failure_analysis':
    case 'new_capability_exploration':
    case 'integration_task':
      return this.planGenericTask(goal);

    default:
      if (goal.type && typeof goal.type === 'string') {
        this.logger.log(`不明な目標タイプ: ${goal.type}, 汎用タスクを作成`);
        return this.planGenericTask(goal);
      } else {
        this.logger.error('無効な目標タイプで汎用タスクを作成できません');
        return null;
      }
    }
  }

  planExploration(goal) {
    const { radius = 100, duration = 60000 } = goal;

    return {
      type: 'explore',
      params: { radius },
      priority: goal.priority || 5,
      timeout: Date.now() + duration,
      prerequisites: []
    };
  }

  planWoodGathering(goal) {
    const { amount = 20 } = goal;

    // Check if we have an axe
    let hasAxe = false;
    if (this.bot && this.bot.inventory) {
      hasAxe = this.bot.inventory.items().some(item =>
        item && item.name && item.name.includes('axe')
      );
    }

    const task = {
      type: 'gather_wood',
      params: { amount },
      priority: goal.priority || 3,
      timeout: Date.now() + 300000, // 5 minutes
      prerequisites: []
    };

    if (!hasAxe) {
      // Need to craft axe first
      task.prerequisites.push({
        type: 'craft_tools',
        params: { tools: ['wooden_axe'] }
      });
    }

    return task;
  }

  planToolCrafting(goal) {
    const { tools = ['wooden_pickaxe', 'wooden_axe', 'wooden_sword'] } = goal;
    this.logger.log(`ツールクラフトタスクを計画中: ${tools.join(', ')}`);

    const needsWood = this.checkWoodRequirements(tools);
    this.logger.log(`ツールクラフトの前提条件: 木材必要量=${needsWood}`);

    const task = {
      type: 'craft_tools',
      params: { tools },
      priority: goal.priority || 4,
      timeout: Date.now() + 600000, // 10 minutes
      prerequisites: []
    };

    if (needsWood > 0) {
      task.prerequisites.push({
        type: 'gather_wood',
        params: { amount: needsWood }
      });
    }

    return task;
  }

  planMovement(goal) {
    const { target } = goal;

    return {
      type: 'move_to',
      params: target,
      priority: goal.priority || 1,
      timeout: Date.now() + 120000, // 2 minutes
      prerequisites: [],
      useCache: true // パスキャッシュを使用
    };
  }

  planFollowing(goal) {
    const { target } = goal;

    return {
      type: 'follow',
      params: { target },
      priority: goal.priority || 2,
      timeout: Date.now() + 600000, // 10 minutes
      prerequisites: []
    };
  }

  planFoodGathering(goal) {
    const { minHunger = 15 } = goal;

    const task = {
      type: 'find_food',
      params: { minHunger },
      priority: goal.priority || 2,
      timeout: Date.now() + 300000, // 5 minutes
      prerequisites: []
    };

    // Check if we have weapons for hunting
    let hasWeapon = false;
    if (this.bot && this.bot.inventory) {
      hasWeapon = this.bot.inventory.items().some(item =>
        item && item.name && (item.name.includes('sword') || item.name.includes('axe'))
      );
    }

    if (!hasWeapon) {
      task.prerequisites.push({
        type: 'craft_tools',
        params: { tools: ['wooden_sword'] }
      });
    }

    return task;
  }

  planStoneGathering(goal) {
    const { amount = 10 } = goal;

    return {
      type: 'mine_block',
      params: { blockType: 'stone', amount },
      priority: goal.priority || 3,
      timeout: Date.now() + 300000, // 5 minutes
      prerequisites: []
    };
  }


  planShelterBuilding(goal) {
    return {
      type: 'explore', // Fallback to exploration
      params: { radius: 50 },
      priority: goal.priority || 3,
      timeout: Date.now() + 300000,
      prerequisites: []
    };
  }

  planSafeMining(goal) {
    return {
      type: 'mine_block',
      params: { blockType: 'coal_ore', amount: 5 },
      priority: goal.priority || 3,
      timeout: Date.now() + 600000,
      prerequisites: []
    };
  }

  planGenericTask(goal) {
    // Enhanced generic task planning based on goal type and context
    const taskType = goal.type;
    const description = goal.description || '';

    // Analyze task type and description for better planning
    if (taskType.includes('craft') || description.includes('craft')) {
      return this.planCraftingTask(goal);
    }

    if (taskType.includes('mine') || description.includes('mine') || description.includes('dig')) {
      return this.planMiningTask(goal);
    }

    if (taskType.includes('build') || description.includes('build') || description.includes('construct')) {
      return this.planBuildingTask(goal);
    }

    if (taskType.includes('collect') || description.includes('collect') || description.includes('gather')) {
      return this.planCollectionTask(goal);
    }

    if (taskType.includes('combat') || description.includes('fight') || description.includes('attack')) {
      return this.planCombatTask(goal);
    }

    // Default to resource gathering instead of exploration
    // Prioritize resource collection over aimless exploration
    const timeout = this.calculateTaskTimeout(goal);

    if (!this.bot || !this.bot.inventory) {
      this.logger.warn('planGenericTask: botまたはinventoryが未定義です。探索タスクにフォールバックします。');
      const radius = this.calculateExplorationRadius(goal) * 0.5;
      return {
        type: 'explore',
        params: { radius },
        priority: goal.priority || 6,
        timeout: Date.now() + 180000, // 3 minutes
        prerequisites: [],
        context: {
          originalType: taskType,
          fallbackReason: 'Bot inventory not available'
        }
      };
    }

    const woodCount = InventoryUtils.getWoodCount(this.bot);
    const stoneCount = InventoryUtils.getStoneCount(this.bot);

    // Prefer resource gathering over exploration
    if (woodCount < 15) {
      return {
        type: 'gather_wood',
        params: { amount: 10 },
        priority: goal.priority || 3,
        timeout: Date.now() + timeout,
        prerequisites: [],
        context: {
          originalType: taskType,
          fallbackReason: 'Need wood for progression'
        }
      };
    }

    if (stoneCount < 8) {
      return {
        type: 'mine_block',
        params: { blockType: 'stone', amount: 5 },
        priority: goal.priority || 3,
        timeout: Date.now() + timeout,
        prerequisites: [],
        context: {
          originalType: taskType,
          fallbackReason: 'Need stone for progression'
        }
      };
    }

    // Only explore as last resort with reduced radius
    const radius = this.calculateExplorationRadius(goal) * 0.5; // Reduce exploration radius

    return {
      type: 'explore',
      params: { radius },
      priority: goal.priority || 6, // Lower priority for exploration
      timeout: Date.now() + timeout,
      prerequisites: [],
      context: {
        originalType: taskType,
        fallbackReason: 'All resources satisfied, minimal exploration'
      }
    };
  }

  planCraftingTask(goal) {
    const itemHints = this.extractItemHints(goal.description || '');

    return {
      type: 'craft_tools',
      params: {
        tools: itemHints.length > 0 ? itemHints : ['wooden_pickaxe', 'wooden_axe'],
        context: goal.description
      },
      priority: goal.priority || 4,
      timeout: Date.now() + 600000, // 10 minutes
      prerequisites: [{
        type: 'gather_wood',
        params: { amount: 10 }
      }]
    };
  }

  planMiningTask(goal) {
    return {
      type: 'mine_block',
      params: {
        blockType: 'stone',
        amount: goal.amount || 5,
        context: goal.description
      },
      priority: goal.priority || 3,
      timeout: Date.now() + 300000, // 5 minutes
      prerequisites: this.hasPickaxe()
        ? []
        : [{
          type: 'craft_tools',
          params: { tools: ['wooden_pickaxe'] }
        }]
    };
  }

  planBuildingTask(goal) {
    return {
      type: 'build_shelter',
      params: {
        size: goal.size || 'small',
        materials: goal.materials || ['wood', 'stone'],
        context: goal.description
      },
      priority: goal.priority || 4,
      timeout: Date.now() + 900000, // 15 minutes
      prerequisites: [{
        type: 'gather_wood',
        params: { amount: 20 }
      }]
    };
  }

  planCollectionTask(goal) {
    const targetItems = this.extractItemHints(goal.description || '');

    return {
      type: targetItems.includes('wood') ? 'gather_wood' : 'explore',
      params: {
        amount: goal.amount || 10,
        target: targetItems[0] || 'wood',
        context: goal.description
      },
      priority: goal.priority || 3,
      timeout: Date.now() + 300000, // 5 minutes
      prerequisites: []
    };
  }

  planCombatTask(goal) {
    return {
      type: 'find_food', // Use hunting as combat practice
      params: {
        huntingMode: true,
        context: goal.description
      },
      priority: goal.priority || 2,
      timeout: Date.now() + 240000, // 4 minutes
      prerequisites: this.hasWeapon()
        ? []
        : [{
          type: 'craft_tools',
          params: { tools: ['wooden_sword'] }
        }]
    };
  }

  calculateExplorationRadius(goal) {
    const baseRadius = 30;

    // Adjust based on goal description
    if (goal.description && goal.description.includes('far')) return baseRadius * 2;
    if (goal.description && goal.description.includes('near')) return baseRadius / 2;
    if (goal.difficulty && goal.difficulty > 5) return baseRadius * 1.5;

    return baseRadius;
  }

  calculateTaskTimeout(goal) {
    const baseTimeout = 180000; // 3 minutes

    // Adjust based on difficulty
    if (goal.difficulty) {
      return baseTimeout * (1 + goal.difficulty / 10);
    }

    return baseTimeout;
  }

  extractItemHints(description) {
    const items = [];
    const itemKeywords = {
      wood: ['wood', 'log', 'tree'],
      stone: ['stone', 'rock', 'cobble'],
      iron: ['iron', 'metal'],
      pickaxe: ['pickaxe', 'pick'],
      axe: ['axe', 'hatchet'],
      sword: ['sword', 'weapon'],
      food: ['food', 'meat', 'bread']
    };

    for (const [item, keywords] of Object.entries(itemKeywords)) {
      if (keywords.some(keyword => description.toLowerCase().includes(keyword))) {
        items.push(item);
      }
    }

    return items;
  }

  hasPickaxe() {
    try {
      ValidationUtils.validateBotInventory(this.bot, 'TaskPlanner.hasPickaxe');
      return InventoryUtils.hasTool(this.bot, 'pickaxe');
    } catch (error) {
      this.logger.warn(error.message);
      return false;
    }
  }

  hasWeapon() {
    try {
      ValidationUtils.validateBotInventory(this.bot, 'TaskPlanner.hasWeapon');
      return InventoryUtils.hasTool(this.bot, 'sword');
    } catch (error) {
      this.logger.warn(error.message);
      return false;
    }
  }

  checkWoodRequirements(tools) {
    try {
      ValidationUtils.validateBotInventory(this.bot, 'TaskPlanner.checkWoodRequirements');
    } catch (error) {
      this.logger.warn(error.message);
      return 10;
    }

    const woodNeeded = InventoryUtils.calculateWoodRequirements(tools);
    const availablePlanks = InventoryUtils.getAvailablePlanks(this.bot);

    return Math.max(0, woodNeeded - availablePlanks);
  }

  isTaskComplete(task) {
    if (!task) return true;

    if (task.timeout && Date.now() > task.timeout) {
      this.logger.log(`タスク ${task.type} がタイムアウトしました`);
      return true;
    }

    // Task-specific completion checks
    switch (task.type) {
    case 'gather_wood':
      return this.checkWoodGatheringComplete(task);

    case 'craft_tools':
      return this.checkToolCraftingComplete(task);

    case 'find_food':
      return this.checkFoodGatheringComplete(task);

    case 'move_to':
      return this.checkMovementComplete(task);

    default:
      // For other tasks, assume they manage their own completion
      return false;
    }
  }

  checkWoodGatheringComplete(task) {
    try {
      ValidationUtils.validateBotInventory(this.bot, 'TaskPlanner.checkWoodGatheringComplete');
    } catch (error) {
      this.logger.warn(error.message);
      return false;
    }

    const { amount } = task.params;
    const currentWood = InventoryUtils.getWoodCount(this.bot) +
                       (InventoryUtils.getPlanksCount(this.bot) / 4);

    return currentWood >= amount;
  }

  checkToolCraftingComplete(task) {
    try {
      ValidationUtils.validateBotInventory(this.bot, 'TaskPlanner.checkToolCraftingComplete');
    } catch (error) {
      this.logger.warn(error.message);
      return false;
    }

    const { tools } = task.params;

    return tools.every(tool => {
      return this.bot.inventory.items().some(item => item && item.name === tool);
    });
  }

  checkFoodGatheringComplete(task) {
    try {
      ValidationUtils.validateBot(this.bot, 'TaskPlanner.checkFoodGatheringComplete');
    } catch (error) {
      this.logger.warn(error.message);
      return false;
    }

    const { minHunger } = task.params;
    return this.bot.food >= minHunger;
  }

  checkMovementComplete(task) {
    if (!this.bot || !this.bot.entity || !this.bot.entity.position) {
      console.warn('[タスクプランナー] checkMovementComplete: botまたはpositionが未定義です');
      return false; // Can't determine completion status
    }

    const { x, y, z } = task.params;
    const pos = this.bot.entity.position;
    const distance = Math.sqrt(
      Math.pow(pos.x - x, 2) +
      Math.pow(pos.y - y, 2) +
      Math.pow(pos.z - z, 2)
    );

    return distance < 2; // Within 2 blocks
  }

  addTaskToHistory(task, result) {
    this.taskHistory.push({
      task,
      result,
      timestamp: Date.now()
    });

    // Keep only last 100 tasks
    if (this.taskHistory.length > 100) {
      this.taskHistory.shift();
    }
  }

  getTaskHistory() {
    return this.taskHistory;
  }

  planWorkbenchCrafting(goal) {
    console.log('[タスクプランナー] 作業台クラフトタスクを計画中...');

    // Validate bot instance before proceeding
    if (!this.bot) {
      console.error('[タスクプランナー] エラー: botインスタンスが未定義です');
      return null;
    }

    if (!this.bot.inventory) {
      console.error('[タスクプランナー] エラー: bot.inventoryが未定義です');
      return null;
    }

    // Check if we already have a crafting table
    const hasCraftingTable = InventoryUtils.hasItem(this.bot, 'crafting_table');

    if (hasCraftingTable) {
      console.log('[タスクプランナー] 作業台を既に所持しています。タスクをスキップします。');
      return null; // Skip if already have one
    }

    const needsWood = !this.hasEnoughWoodForWorkbench();
    console.log(`[タスクプランナー] 作業台クラフトの前提条件: 木材収集が必要=${needsWood}`);

    return {
      type: 'craft_workbench',
      params: { item: 'crafting_table' },
      priority: goal.priority || 3,
      timeout: Date.now() + 180000, // 3 minutes
      prerequisites: needsWood
        ? [{
          type: 'gather_wood',
          params: { amount: 5 }
        }]
        : []
    };
  }

  hasEnoughWoodForWorkbench() {
    if (!this.bot || !this.bot.inventory) {
      console.warn('[タスクプランナー] hasEnoughWoodForWorkbench: botまたはinventoryが未定義です');
      return false;
    }
    return InventoryUtils.getAvailablePlanks(this.bot) >= 4; // Need 4 planks for crafting table
  }

  planWorkbenchPlacement(goal) {
    console.log('[タスクプランナー] 作業台設置タスクを計画中...');

    // インベントリに作業台があるかチェック
    const hasWorkbench = InventoryUtils.hasItem(this.bot, 'crafting_table');

    if (!hasWorkbench) {
      console.log('[タスクプランナー] 作業台が必要です');
      return {
        type: 'place_workbench',
        params: {},
        priority: goal.priority || 4,
        timeout: Date.now() + 120000, // 2 minutes
        prerequisites: [{
          type: 'craft_workbench',
          params: {}
        }]
      };
    }

    return {
      type: 'place_workbench',
      params: {},
      priority: goal.priority || 4,
      timeout: Date.now() + 120000, // 2 minutes
      prerequisites: []
    };
  }

  planAdvancedCrafting(goal) {
    const { itemName, count = 1 } = goal;
    console.log(`[タスクプランナー] 高度クラフトタスクを計画中: ${itemName}`);

    // 近くに作業台があるかチェック（実際の実行時に確認されるが、計画段階でも考慮）
    const task = {
      type: 'craft_with_workbench',
      params: { itemName, count },
      priority: goal.priority || 4,
      timeout: Date.now() + 600000, // 10 minutes
      prerequisites: []
    };

    // 材料の前提条件を追加
    if (itemName && itemName.includes('stone')) {
      // 石ツールの場合、石材と棒が必要
      const stoneCount = InventoryUtils.getStoneCount(this.bot);
      const sticksCount = this.countSticksInInventory();

      if (stoneCount < 3) {
        task.prerequisites.push({
          type: 'mine_block',
          params: { blockType: 'stone', amount: 5 }
        });
      }

      if (sticksCount < 2) {
        task.prerequisites.push({
          type: 'craft_tools',
          params: { tools: ['stick'] }
        });
      }
    }

    return task;
  }

  planStoneToolCrafting(goal) {
    const { tools = ['stone_pickaxe', 'stone_axe', 'stone_sword'] } = goal;
    console.log(`[タスクプランナー] 石ツールクラフトタスクを計画中: ${tools.join(', ')}`);

    // 作業台の存在チェック
    const needsWorkbench = !this.hasNearbyWorkbench();
    const needsWorkbenchItem = !InventoryUtils.hasItem(this.bot, 'crafting_table');

    const task = {
      type: 'craft_stone_tools',
      params: { tools },
      priority: goal.priority || 4,
      timeout: Date.now() + 900000, // 15 minutes
      prerequisites: []
    };

    // 作業台関連の前提条件
    if (needsWorkbench) {
      if (needsWorkbenchItem) {
        task.prerequisites.push({
          type: 'craft_workbench',
          params: { autoPlace: true }
        });
      } else {
        task.prerequisites.push({
          type: 'place_workbench',
          params: {}
        });
      }
    }

    // 材料の前提条件
    const stoneCount = InventoryUtils.getStoneCount(this.bot);
    if (stoneCount < tools.length * 3) {
      task.prerequisites.push({
        type: 'mine_block',
        params: { blockType: 'stone', amount: tools.length * 3 }
      });
    }

    const sticksNeeded = this.calculateSticksNeeded(tools);
    const sticksAvailable = this.countSticksInInventory();
    if (sticksAvailable < sticksNeeded) {
      task.prerequisites.push({
        type: 'gather_wood',
        params: { amount: Math.ceil((sticksNeeded - sticksAvailable) / 4) }
      });
    }

    return task;
  }

  hasNearbyWorkbench() {
    if (!this.bot) return false;
    try {
      const workbench = this.bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 10
      });
      return !!workbench;
    } catch (error) {
      return false;
    }
  }

  countSticksInInventory() {
    if (!this.bot || !this.bot.inventory) return 0;
    const InventoryUtils = require('./InventoryUtils');
    return InventoryUtils._safeCount(this.bot, item => item.name === 'stick');
  }

  calculateSticksNeeded(tools) {
    let sticksNeeded = 0;
    for (const tool of tools) {
      if (tool.includes('pickaxe') || tool.includes('axe')) {
        sticksNeeded += 2; // ピッケルと斧は棒2本
      } else if (tool.includes('sword')) {
        sticksNeeded += 1; // 剣は棒1本
      }
    }
    return sticksNeeded;
  }
}

module.exports = { TaskPlanner };
