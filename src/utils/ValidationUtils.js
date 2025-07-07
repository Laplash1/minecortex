class ValidationUtils {
  static validateBot(bot, context = '') {
    if (!bot) {
      throw new Error(`${context ? `[${context}] ` : ''}Bot instance is null or undefined`);
    }
    return true;
  }

  static validateBotInventory(bot, context = '') {
    this.validateBot(bot, context);
    if (!bot.inventory) {
      throw new Error(`${context ? `[${context}] ` : ''}Bot inventory is null or undefined`);
    }
    return true;
  }

  static validateGoal(goal, context = '') {
    if (!goal || typeof goal !== 'object') {
      throw new Error(`${context ? `[${context}] ` : ''}Invalid goal object`);
    }

    if (!goal.type || typeof goal.type !== 'string') {
      throw new Error(`${context ? `[${context}] ` : ''}Invalid goal type: ${goal.type}`);
    }

    return true;
  }

  static validateTask(task, context = '') {
    if (!task || typeof task !== 'object') {
      throw new Error(`${context ? `[${context}] ` : ''}Invalid task object`);
    }

    if (!task.type || typeof task.type !== 'string') {
      throw new Error(`${context ? `[${context}] ` : ''}Invalid task type: ${task.type}`);
    }

    return true;
  }

  static safeGetProperty(obj, property, defaultValue = null, context = '') {
    try {
      if (!obj || typeof obj !== 'object') {
        return defaultValue;
      }
      return obj[property] !== undefined ? obj[property] : defaultValue;
    } catch (error) {
      if (context) {
        console.warn(`[${context}] Error accessing property ${property}:`, error.message);
      }
      return defaultValue;
    }
  }
}

module.exports = { ValidationUtils };
