class TaskPlanner {
  constructor(bot) {
    this.bot = bot;
    this.activeTasks = new Map();
    this.taskHistory = [];
  }

  async planTask(goal) {
    // Enhanced goal validation to prevent "No valid type given" errors
    if (!goal || typeof goal !== 'object') {
      console.log('タスクプランナー: 無効な目標オブジェクト');
      return null;
    }
    
    if (!goal.type || typeof goal.type !== 'string') {
      console.log(`タスクプランナー: 無効な目標タイプ: ${goal.type}`);
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
      
      case 'move_to':
        return this.planMovement(goal);
      
      case 'follow':
        return this.planFollowing(goal);
      
      case 'find_food':
        return this.planFoodGathering(goal);
      
      case 'find_stone':
        return this.planStoneGathering(goal);
      
      case 'craft_stone_tools':
        return this.planStoneToolCrafting(goal);
      
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
        // Enhanced handling for unknown goal types
        if (goal.type && typeof goal.type === 'string') {
          console.log(`不明な目標タイプ: ${goal.type}, 汎用タスクを作成`);
          return this.planGenericTask(goal);
        } else {
          console.log('タスクプランナー: 無効な目標タイプで汎用タスクを作成できません');
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
    const hasAxe = this.bot.inventory.findInventoryItem(item => 
      item.name.includes('axe')
    );
    
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
    
    // Check materials needed
    const needsWood = this.checkWoodRequirements(tools);
    
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
      prerequisites: []
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
    const hasWeapon = this.bot.inventory.findInventoryItem(item => 
      item.name.includes('sword') || item.name.includes('axe')
    );
    
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

  planStoneToolCrafting(goal) {
    const { tools = ['stone_pickaxe', 'stone_axe', 'stone_sword'] } = goal;
    
    return {
      type: 'craft_tools',
      params: { tools },
      priority: goal.priority || 4,
      timeout: Date.now() + 600000, // 10 minutes
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
    
    // Default exploration with context-aware parameters
    const radius = this.calculateExplorationRadius(goal);
    const timeout = this.calculateTaskTimeout(goal);
    
    return {
      type: 'explore',
      params: { radius },
      priority: goal.priority || 5,
      timeout: Date.now() + timeout,
      prerequisites: [],
      context: {
        originalType: taskType,
        fallbackReason: 'No specific planner found'
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
      prerequisites: this.hasPickaxe() ? [] : [{
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
      prerequisites: this.hasWeapon() ? [] : [{
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
      'wood': ['wood', 'log', 'tree'],
      'stone': ['stone', 'rock', 'cobble'],
      'iron': ['iron', 'metal'],
      'pickaxe': ['pickaxe', 'pick'],
      'axe': ['axe', 'hatchet'],
      'sword': ['sword', 'weapon'],
      'food': ['food', 'meat', 'bread']
    };
    
    for (const [item, keywords] of Object.entries(itemKeywords)) {
      if (keywords.some(keyword => description.toLowerCase().includes(keyword))) {
        items.push(item);
      }
    }
    
    return items;
  }

  hasPickaxe() {
    const pickaxes = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'];
    return pickaxes.some(pickaxe => this.bot.inventory.findInventoryItem(pickaxe));
  }

  hasWeapon() {
    const weapons = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword'];
    return weapons.some(weapon => this.bot.inventory.findInventoryItem(weapon));
  }

  checkWoodRequirements(tools) {
    let woodNeeded = 0;
    
    for (const tool of tools) {
      if (tool.includes('wooden_')) {
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
    
    // Check current inventory
    const currentPlanks = this.bot.inventory.count('oak_planks') + 
                         this.bot.inventory.count('planks');
    const currentSticks = this.bot.inventory.count('stick');
    
    // Convert logs to planks (1 log = 4 planks)
    const currentLogs = this.bot.inventory.count('oak_log') + 
                       this.bot.inventory.count('log');
    const availablePlanks = currentPlanks + (currentLogs * 4);
    
    return Math.max(0, woodNeeded - availablePlanks);
  }

  isTaskComplete(task) {
    if (!task) return true;
    
    // Check timeout
    if (task.timeout && Date.now() > task.timeout) {
      console.log(`タスク ${task.type} がタイムアウトしました`);
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
    const { amount } = task.params;
    const currentWood = this.bot.inventory.count('oak_log') + 
                       this.bot.inventory.count('log') +
                       (this.bot.inventory.count('oak_planks') + 
                        this.bot.inventory.count('planks')) / 4;
    
    return currentWood >= amount;
  }

  checkToolCraftingComplete(task) {
    const { tools } = task.params;
    
    return tools.every(tool => {
      return this.bot.inventory.findInventoryItem(tool) !== null;
    });
  }

  checkFoodGatheringComplete(task) {
    const { minHunger } = task.params;
    return this.bot.food >= minHunger;
  }

  checkMovementComplete(task) {
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
}

module.exports = { TaskPlanner };