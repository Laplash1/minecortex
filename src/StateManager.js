const { Logger } = require('./utils/Logger');

class StateManager {
  constructor(bot) {
    this.bot = bot;
    this.logger = Logger.createLogger('StateManager');
    this.state = {
      // Core bot state
      position: { x: 0, y: 0, z: 0 },
      health: 20,
      food: 20,
      experience: 0,

      // Inventory state
      inventory: new Map(),
      inventorySlots: 36,
      equippedItems: {
        hand: null,
        head: null,
        torso: null,
        legs: null,
        feet: null
      },

      // Environmental state
      timeOfDay: 'unknown',
      weather: 'clear',
      dimension: 'overworld',
      nearbyEntities: new Map(),
      nearbyBlocks: new Map(),

      // Task and goal state
      currentTask: null,
      taskQueue: [],
      completedTasks: [],
      activeGoals: [],

      // Learning and skill state
      knownSkills: new Set(),
      learningHistory: [],
      skillPerformance: new Map(),

      // Multi-player state
      nearbyPlayers: new Map(),
      resourceClaims: new Set(),
      cooperationScore: 100,

      // AI behavior state
      currentStrategy: 'exploration',
      riskTolerance: 'medium',
      energyLevel: 100,
      lastActivity: Date.now()
    };

    this.subscribers = new Map(); // Component subscriptions to state changes
    this.stateHistory = []; // For state rollback if needed
    this.maxHistorySize = 100;
    this.lastSync = Date.now();
    this.syncInterval = 1000; // 1 second

    // Setup real-time inventory updates for immediate cache invalidation
    this.setupInventoryEventListeners();
  }

  // Setup inventory event listeners for real-time cache invalidation
  setupInventoryEventListeners() {
    if (!this.bot) return;

    // Listen for inventory updates to ensure real-time synchronization
    this.bot.on('inventoryUpdate', (slot, oldItem, newItem) => {
      try {
        this.logger.log(`インベントリ更新検出: slot=${slot}, old=${oldItem?.name}, new=${newItem?.name}`);

        // Force immediate inventory sync to avoid cache issues
        const inventoryUpdates = this.syncInventory();
        if (Object.keys(inventoryUpdates).length > 0) {
          this.updateState(inventoryUpdates, 'inventory-event');
        }
      } catch (error) {
        this.logger.error(`inventoryUpdate event error: ${error.message}`);
      }
    });

    // Listen for held item changes
    this.bot.on('heldItemChanged', (heldItem) => {
      try {
        this.logger.log(`手持ちアイテム変更: ${heldItem?.name || 'null'}`);
        this.updateState({
          equippedItems: { ...this.state.equippedItems, hand: heldItem }
        }, 'held-item-event');
      } catch (error) {
        this.logger.error(`heldItemChanged event error: ${error.message}`);
      }
    });

    // Listen for window open/close (crafting table access)
    this.bot.on('windowOpen', (window) => {
      try {
        this.logger.log(`ウィンドウ開始: ${window.type}`);
        // Force inventory sync when opening crafting interfaces
        if (window.type === 'minecraft:crafting' || window.type === 'generic_3x3') {
          setTimeout(() => {
            const inventoryUpdates = this.syncInventory();
            if (Object.keys(inventoryUpdates).length > 0) {
              this.updateState(inventoryUpdates, 'window-open-event');
            }
          }, 100); // Small delay to ensure window is fully loaded
        }
      } catch (error) {
        this.logger.error(`windowOpen event error: ${error.message}`);
      }
    });

    this.logger.log('リアルタイムインベントリ監視を開始しました');
  }

  // Subscribe to state changes
  subscribe(componentName, callback, stateKeys = []) {
    if (!this.subscribers.has(componentName)) {
      this.subscribers.set(componentName, []);
    }

    this.subscribers.get(componentName).push({
      callback,
      stateKeys: stateKeys.length > 0 ? stateKeys : null // null means all keys
    });
  }

  // Unsubscribe from state changes
  unsubscribe(componentName) {
    this.subscribers.delete(componentName);
  }

  // Update state and notify subscribers
  updateState(updates, source = 'unknown') {
    const previousState = this.cloneState();
    const changedKeys = new Set();

    // Apply updates
    for (const [key, value] of Object.entries(updates)) {
      if (Object.prototype.hasOwnProperty.call(this.state, key)) {
        this.state[key] = value;
        changedKeys.add(key);
      }
    }

    // Record in history
    this.stateHistory.push({
      timestamp: Date.now(),
      source,
      changes: updates,
      previousState
    });

    // Limit history size
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }

    // Notify subscribers
    this.notifySubscribers(changedKeys, updates);

    this.lastSync = Date.now();
  }

  // Get current state (read-only copy)
  getState(keys = null) {
    if (keys === null) {
      return this.cloneState();
    }

    if (Array.isArray(keys)) {
      const partialState = {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(this.state, key)) {
          partialState[key] = this.cloneValue(this.state[key]);
        }
      }
      return partialState;
    }

    if (Object.prototype.hasOwnProperty.call(this.state, keys)) {
      return this.cloneValue(this.state[keys]);
    }

    return null;
  }

  // Synchronize with bot state
  syncWithBot() {
    if (!this.bot || Date.now() - this.lastSync < this.syncInterval) {
      return;
    }

    const botUpdates = {};

    // Sync basic bot properties
    if (this.bot.entity && this.bot.entity.position) {
      const pos = this.bot.entity.position;
      if (!this.positionsEqual(this.state.position, pos)) {
        botUpdates.position = { x: pos.x, y: pos.y, z: pos.z };
      }
    }

    if (this.bot.entity && this.bot.entity.health !== this.state.health) {
      botUpdates.health = this.bot.entity.health;
    }

    if (this.bot.entity && this.bot.entity.food !== this.state.food) {
      botUpdates.food = this.bot.entity.food;
    }

    if (this.bot.experience !== this.state.experience) {
      botUpdates.experience = this.bot.experience;
    }

    // Sync time and weather
    if (this.bot.time) {
      const timeOfDay = this.calculateTimeOfDay(this.bot.time.timeOfDay);
      if (timeOfDay !== this.state.timeOfDay) {
        botUpdates.timeOfDay = timeOfDay;
      }
    }

    const weather = this.getWeatherState();
    if (weather !== this.state.weather) {
      botUpdates.weather = weather;
    }

    // Sync inventory
    const inventoryUpdates = this.syncInventory();
    if (Object.keys(inventoryUpdates).length > 0) {
      Object.assign(botUpdates, inventoryUpdates);
    }

    // Apply updates if any
    if (Object.keys(botUpdates).length > 0) {
      this.updateState(botUpdates, 'bot_sync');
    }
  }

  // Sync inventory state
  syncInventory() {
    const updates = {};
    const newInventory = new Map();

    if (this.bot.inventory && this.bot.inventory.items) {
      try {
        for (const item of this.bot.inventory.items()) {
          if (item) {
            newInventory.set(item.name, {
              name: item.name,
              count: item.count,
              slot: item.slot,
              metadata: item.metadata || 0
            });
          }
        }
      } catch (error) {
        // Handle inventory access errors gracefully
        console.log(`[StateManager] Inventory sync error: ${error.message}`);
        return updates;
      }
    }

    // Check if inventory has changed
    if (!this.mapsEqual(this.state.inventory, newInventory)) {
      updates.inventory = newInventory;
    }

    return updates;
  }

  // Calculate time of day from bot time
  calculateTimeOfDay(time) {
    if (time < 1000 || time > 23000) return 'night';
    if (time < 6000) return 'morning';
    if (time < 12000) return 'day';
    if (time < 18000) return 'afternoon';
    return 'evening';
  }

  // Get weather state
  getWeatherState() {
    if (this.bot.isRaining) return 'rain';
    if (this.bot.thunderState > 0) return 'thunder';
    return 'clear';
  }

  // Notify subscribers of state changes
  notifySubscribers(changedKeys, updates) {
    for (const [componentName, subscriptions] of this.subscribers.entries()) {
      for (const subscription of subscriptions) {
        try {
          const { callback, stateKeys } = subscription;

          // Check if this subscription is interested in the changed keys
          if (stateKeys === null || stateKeys.some(key => changedKeys.has(key))) {
            callback(updates, changedKeys, this.state);
          }
        } catch (error) {
          console.log(`[StateManager] Error notifying ${componentName}: ${error.message}`);
        }
      }
    }
  }

  // Task management
  setCurrentTask(task) {
    this.updateState({ currentTask: task }, 'task_manager');
  }

  addTaskToQueue(task) {
    const newQueue = [...this.state.taskQueue, task];
    this.updateState({ taskQueue: newQueue }, 'task_manager');
  }

  removeTaskFromQueue(index) {
    const newQueue = [...this.state.taskQueue];
    newQueue.splice(index, 1);
    this.updateState({ taskQueue: newQueue }, 'task_manager');
  }

  completeCurrentTask(result) {
    const completedTask = {
      task: this.state.currentTask,
      result,
      completedAt: Date.now()
    };

    const newCompleted = [...this.state.completedTasks, completedTask];

    // Limit completed tasks history
    if (newCompleted.length > 50) {
      newCompleted.shift();
    }

    this.updateState({
      currentTask: null,
      completedTasks: newCompleted
    }, 'task_completion');
  }

  // Goal management
  addGoal(goal) {
    const newGoals = [...this.state.activeGoals, goal];
    this.updateState({ activeGoals: newGoals }, 'goal_manager');
  }

  removeGoal(goalIndex) {
    const newGoals = [...this.state.activeGoals];
    newGoals.splice(goalIndex, 1);
    this.updateState({ activeGoals: newGoals }, 'goal_manager');
  }

  // Learning state management
  addSkill(skillName, skillData = null) {
    const newSkills = new Set(this.state.knownSkills);
    newSkills.add(skillName);

    const updates = { knownSkills: newSkills };

    if (skillData) {
      const newPerformance = new Map(this.state.skillPerformance);
      newPerformance.set(skillName, {
        uses: 0,
        successes: 0,
        failures: 0,
        averageTime: 0,
        lastUsed: null,
        skillData
      });
      updates.skillPerformance = newPerformance;
    }

    this.updateState(updates, 'skill_manager');
  }

  updateSkillPerformance(skillName, success, executionTime) {
    const newPerformance = new Map(this.state.skillPerformance);
    const current = newPerformance.get(skillName) || {
      uses: 0,
      successes: 0,
      failures: 0,
      averageTime: 0,
      lastUsed: null
    };

    current.uses += 1;
    if (success) {
      current.successes += 1;
    } else {
      current.failures += 1;
    }

    // Update average execution time
    if (executionTime > 0) {
      current.averageTime = ((current.averageTime * (current.uses - 1)) + executionTime) / current.uses;
    }

    current.lastUsed = Date.now();
    newPerformance.set(skillName, current);

    this.updateState({ skillPerformance: newPerformance }, 'skill_performance');
  }

  // Multi-player state management
  updateCooperationScore(change) {
    const newScore = Math.max(0, Math.min(100, this.state.cooperationScore + change));
    this.updateState({ cooperationScore: newScore }, 'cooperation');
  }

  addResourceClaim(resourceKey) {
    const newClaims = new Set(this.state.resourceClaims);
    newClaims.add(resourceKey);
    this.updateState({ resourceClaims: newClaims }, 'resource_manager');
  }

  removeResourceClaim(resourceKey) {
    const newClaims = new Set(this.state.resourceClaims);
    newClaims.delete(resourceKey);
    this.updateState({ resourceClaims: newClaims }, 'resource_manager');
  }

  // State validation and recovery
  validateState() {
    const issues = [];

    // Validate basic constraints
    if (this.state.health < 0 || this.state.health > 20) {
      issues.push('Invalid health value');
    }

    if (this.state.food < 0 || this.state.food > 20) {
      issues.push('Invalid food value');
    }

    if (this.state.cooperationScore < 0 || this.state.cooperationScore > 100) {
      issues.push('Invalid cooperation score');
    }

    // Validate task state consistency
    if (this.state.currentTask && this.state.taskQueue.length === 0) {
      // This might be normal, but worth noting
      issues.push('Current task exists but task queue is empty');
    }

    return issues;
  }

  // State rollback (emergency recovery)
  rollbackToLastValid() {
    if (this.stateHistory.length === 0) {
      console.log('[StateManager] No state history available for rollback');
      return false;
    }

    const lastEntry = this.stateHistory[this.stateHistory.length - 1];
    this.state = this.cloneState(lastEntry.previousState);

    console.log('[StateManager] State rolled back to previous valid state');
    return true;
  }

  // Utility methods
  cloneState(stateObj = null) {
    const source = stateObj || this.state;
    const clone = {};

    for (const [key, value] of Object.entries(source)) {
      clone[key] = this.cloneValue(value);
    }

    return clone;
  }

  cloneValue(value) {
    if (value instanceof Map) {
      return new Map(value);
    } else if (value instanceof Set) {
      return new Set(value);
    } else if (Array.isArray(value)) {
      return [...value];
    } else if (typeof value === 'object' && value !== null) {
      return { ...value };
    } else {
      return value;
    }
  }

  positionsEqual(pos1, pos2) {
    if (!pos1 || !pos2) return false;
    const threshold = 0.1;
    return Math.abs(pos1.x - pos2.x) < threshold &&
           Math.abs(pos1.y - pos2.y) < threshold &&
           Math.abs(pos1.z - pos2.z) < threshold;
  }

  mapsEqual(map1, map2) {
    if (map1.size !== map2.size) return false;

    for (const [key, value] of map1.entries()) {
      if (!map2.has(key)) return false;

      const otherValue = map2.get(key);
      if (typeof value === 'object' && typeof otherValue === 'object') {
        if (JSON.stringify(value) !== JSON.stringify(otherValue)) return false;
      } else if (value !== otherValue) {
        return false;
      }
    }

    return true;
  }

  // Export state for debugging/analysis
  exportState() {
    return {
      currentState: this.cloneState(),
      history: this.stateHistory.slice(-10), // Last 10 entries
      subscribers: Array.from(this.subscribers.keys()),
      lastSync: this.lastSync,
      validationIssues: this.validateState()
    };
  }

  // Get performance statistics
  getPerformanceStats() {
    const stats = {
      totalSkills: this.state.knownSkills.size,
      totalTasksCompleted: this.state.completedTasks.length,
      overallSuccessRate: 0,
      averageTaskTime: 0,
      cooperationScore: this.state.cooperationScore,
      activeClaims: this.state.resourceClaims.size
    };

    if (this.state.skillPerformance.size > 0) {
      let totalUses = 0;
      let totalSuccesses = 0;
      let totalTime = 0;

      for (const performance of this.state.skillPerformance.values()) {
        totalUses += performance.uses;
        totalSuccesses += performance.successes;
        totalTime += performance.averageTime * performance.uses;
      }

      if (totalUses > 0) {
        stats.overallSuccessRate = (totalSuccesses / totalUses) * 100;
        stats.averageTaskTime = totalTime / totalUses;
      }
    }

    return stats;
  }
}

module.exports = { StateManager };
