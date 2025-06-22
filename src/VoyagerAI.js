const OpenAI = require('openai');
const { Vec3 } = require('vec3');

class VoyagerAI {
  constructor(bot) {
    this.bot = bot;
    this.openai = null;
    this.skillCache = new Map();
    this.learningHistory = [];
    this.maxHistorySize = 100;
    
    // Initialize OpenAI if API key is provided
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
  }

  async generateSkill(task, context) {
    if (!this.openai) {
      console.log('OpenAI not configured, using basic skill generation');
      return this.generateBasicSkill(task, context);
    }

    try {
      const prompt = this.buildSkillPrompt(task, context);
      
      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_SKILL_MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.3
      });

      const skillCode = response.choices[0].message.content;
      return this.parseGeneratedSkill(skillCode);
      
    } catch (error) {
      console.log(`Error generating skill: ${error.message}`);
      return this.generateBasicSkill(task, context);
    }
  }

  buildSkillPrompt(task, context) {
    return `
Task: ${task.type}
Parameters: ${JSON.stringify(task.params, null, 2)}

Current Context:
- Position: ${JSON.stringify(context.position)}
- Health: ${context.health}/20
- Food: ${context.food}/20
- Time: ${context.timeOfDay}
- Weather: ${context.weather}
- Nearby entities: ${context.nearbyEntities}
- Inventory items: ${context.inventoryItems}

Generate a JavaScript function that accomplishes this task using the mineflayer bot API.
The function should be async and take (bot, params) as parameters.
Include error handling and return meaningful results.

Example structure:
\`\`\`javascript
async function executeTask(bot, params) {
  // Implementation here
  try {
    // Task logic
    return { success: true, result: "Task completed" };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
\`\`\`
`;
  }

  getSystemPrompt() {
    return `You are an AI assistant that generates Minecraft bot skills using the mineflayer library.

Key principles:
1. Always include proper error handling
2. Use bot.pathfinder for movement when available
3. Check inventory before crafting/placing items
4. Be aware of the bot's surroundings
5. Return structured results with success/failure status

Available bot methods include:
- bot.dig(block) - dig a block
- bot.placeBlock(referenceBlock, faceVector) - place a block
- bot.attack(entity) - attack an entity
- bot.craft(recipe, count, craftingTable) - craft items
- bot.findBlock(options) - find nearby blocks
- bot.pathfinder.setGoal(goal) - set movement goal
- bot.inventory.findInventoryItem(itemId) - find items in inventory

Always prioritize safety and efficiency in your implementations.`;
  }

  parseGeneratedSkill(skillCode) {
    try {
      // Extract the function from code blocks
      const codeMatch = skillCode.match(/```javascript\n([\s\S]*?)\n```/);
      const code = codeMatch ? codeMatch[1] : skillCode;
      
      // Create and return the skill function
      const skillFunction = new Function('bot', 'params', `
        ${code}
        return executeTask(bot, params);
      `);
      
      return {
        execute: skillFunction,
        code: code,
        generated: true
      };
      
    } catch (error) {
      console.log(`Error parsing generated skill: ${error.message}`);
      return null;
    }
  }

  generateBasicSkill(task, context) {
    // Fallback skill generation without AI
    switch (task.type) {
      case 'explore_area':
        return this.createExploreSkill();
      case 'collect_resource':
        return this.createCollectSkill();
      case 'build_structure':
        return this.createBuildSkill();
      default:
        return this.createGenericSkill();
    }
  }

  createExploreSkill() {
    return {
      execute: async (bot, params) => {
        try {
          const { radius = 50 } = params;
          const pos = bot.entity.position;
          
          // Generate random exploration target
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.random() * radius;
          
          const targetX = Math.floor(pos.x + Math.cos(angle) * distance);
          const targetZ = Math.floor(pos.z + Math.sin(angle) * distance);
          
          // Move to target
          if (bot.pathfinder) {
            const { goals } = require('mineflayer-pathfinder');
            bot.pathfinder.setGoal(new goals.GoalBlock(targetX, pos.y, targetZ));
          }
          
          return { success: true, result: `Exploring towards (${targetX}, ${targetZ})` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      code: 'Basic exploration skill',
      generated: false
    };
  }

  createCollectSkill() {
    return {
      execute: async (bot, params) => {
        try {
          const { itemType, amount = 1 } = params;
          
          const block = bot.findBlock({
            matching: itemType,
            maxDistance: 32
          });
          
          if (!block) {
            return { success: false, error: `No ${itemType} found nearby` };
          }
          
          await bot.dig(block);
          return { success: true, result: `Collected ${itemType}` };
          
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      code: 'Basic collection skill',
      generated: false
    };
  }

  createBuildSkill() {
    return {
      execute: async (bot, params) => {
        try {
          const { blockType, position } = params;
          
          const item = bot.inventory.findInventoryItem(blockType);
          if (!item) {
            return { success: false, error: `No ${blockType} in inventory` };
          }
          
          const referenceBlock = bot.blockAt(position);
          await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
          
          return { success: true, result: `Placed ${blockType}` };
          
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      code: 'Basic building skill',
      generated: false
    };
  }

  createGenericSkill() {
    return {
      execute: async (bot, params) => {
        return { success: false, error: 'Generic skill not implemented' };
      },
      code: 'Generic fallback skill',
      generated: false
    };
  }

  async learnFromExperience(task, result, context) {
    // Enhanced guard against null/undefined task objects
    if (!task || typeof task !== 'object') {
      console.log('Error in learning analysis: Cannot read properties of null (reading \'type\')');
      return; // Skip learning if task is null or not an object
    }
    
    // Guard against missing task type
    if (!task.type || typeof task.type !== 'string') {
      console.log('Error in learning analysis: Cannot read properties of null (reading \'type\')');
      return; // Skip learning if task type is invalid
    }
    
    // Enhanced result validation
    if (!result || typeof result !== 'object') {
      result = { success: false, error: '結果オブジェクトが不正です' };
    }
    
    // Ensure result has a success property
    if (typeof result.success === 'undefined') {
      result.success = false;
    }
    
    // Create experience object with additional safety
    const experience = {
      timestamp: Date.now(),
      task: {
        type: task.type,
        params: task.params || {},
        startTime: task.startTime || Date.now()
      },
      result: {
        success: result.success,
        error: result.error || null,
        message: result.message || null
      },
      context: context || {},
      success: result.success
    };
    
    this.learningHistory.push(experience);
    
    // Limit history size
    if (this.learningHistory.length > this.maxHistorySize) {
      this.learningHistory.shift();
    }
    
    // Analyze patterns and improve
    if (this.openai) {
      await this.analyzeAndImprove();
    }
  }

  async analyzeAndImprove() {
    try {
      // Get recent failures and filter out any with null tasks
      const recentFailures = this.learningHistory
        .filter(exp => !exp.success && exp.task && exp.task.type)
        .slice(-10);
      
      if (recentFailures.length === 0) return;
      
      const analysisPrompt = `
Analyze these recent task failures and suggest improvements:

${recentFailures.map(failure => `
Task: ${failure.task.type || 'unknown'}
Error: ${failure.result.error || 'unknown error'}
Context: ${JSON.stringify(failure.context, null, 2)}
`).join('\n---\n')}

Provide specific suggestions for improving task execution and avoiding these errors.
`;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an AI that learns from failures to improve Minecraft bot performance.'
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        max_tokens: 800,
        temperature: 0.2
      });

      const suggestions = response.choices[0].message.content;
      console.log('AI Learning Suggestions:', suggestions);
      
      // Store suggestions for future reference
      this.storeLearnings(suggestions);
      
    } catch (error) {
      console.log(`Error in learning analysis: ${error.message}`);
    }
  }

  storeLearnings(suggestions) {
    // Store learning suggestions for future skill generation
    if (!this.learnings) {
      this.learnings = [];
    }
    
    this.learnings.push({
      timestamp: Date.now(),
      suggestions: suggestions
    });
    
    // Keep only recent learnings
    if (this.learnings.length > 20) {
      this.learnings.shift();
    }
  }

  getRelevantLearnings(taskType) {
    if (!this.learnings) return '';
    
    // Return recent learnings that might be relevant
    return this.learnings
      .slice(-5)
      .map(learning => learning.suggestions)
      .join('\n\n');
  }

  async generateCurriculum(currentSkills, goals) {
    if (!this.openai) {
      return this.generateBasicCurriculum(currentSkills, goals);
    }

    try {
      const prompt = `
Current bot skills: ${Array.from(currentSkills.keys()).join(', ')}
Current goals: ${goals.map(g => g.type).join(', ')}

Recent learning history (last 10 experiences):
${this.learningHistory.slice(-10).map(exp => 
  `${exp.task.type}: ${exp.success ? 'SUCCESS' : 'FAILED - ' + exp.result.error}`
).join('\n')}

Generate a learning curriculum with 5 progressive tasks that will help the bot:
1. Build upon existing skills
2. Work towards the stated goals
3. Learn from recent failures
4. Explore new capabilities

Format as JSON array of task objects with type, description, and difficulty (1-10).
`;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_CURRICULUM_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Generate a learning curriculum for a Minecraft bot based on its current state.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      });

      const curriculumText = response.choices[0].message.content;
      return this.parseCurriculum(curriculumText);
      
    } catch (error) {
      console.log(`Error generating curriculum: ${error.message}`);
      return this.generateBasicCurriculum(currentSkills, goals);
    }
  }

  parseCurriculum(curriculumText) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = curriculumText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fallback parsing
      return this.generateBasicCurriculum(new Map(), []);
      
    } catch (error) {
      console.log(`Error parsing curriculum: ${error.message}`);
      return this.generateBasicCurriculum(new Map(), []);
    }
  }

  generateBasicCurriculum(currentSkills, goals) {
    return [
      { type: 'explore_area', description: 'Explore nearby area', difficulty: 2 },
      { type: 'gather_wood', description: 'Collect wood resources', difficulty: 3 },
      { type: 'craft_tools', description: 'Craft basic tools', difficulty: 4 },
      { type: 'build_shelter', description: 'Build a simple shelter', difficulty: 6 },
      { type: 'find_minerals', description: 'Locate and mine minerals', difficulty: 8 }
    ];
  }

  getSuccessRate(taskType) {
    const taskExperiences = this.learningHistory.filter(exp => exp.task.type === taskType);
    if (taskExperiences.length === 0) return 0;
    
    const successes = taskExperiences.filter(exp => exp.success);
    return successes.length / taskExperiences.length;
  }

  getLearningStats() {
    const stats = {
      totalExperiences: this.learningHistory.length,
      successRate: 0,
      taskTypes: new Set(),
      recentPerformance: []
    };
    
    try {
      if (this.learningHistory.length > 0) {
        // Filter out invalid experiences to prevent crashes
        const validExperiences = this.learningHistory.filter(exp => 
          exp && 
          exp.task && 
          exp.task.type && 
          typeof exp.task.type === 'string' &&
          typeof exp.success === 'boolean'
        );
        
        if (validExperiences.length > 0) {
          const successes = validExperiences.filter(exp => exp.success);
          stats.successRate = successes.length / validExperiences.length;
          
          // Safely add task types with validation
          validExperiences.forEach(exp => {
            if (exp.task && exp.task.type) {
              stats.taskTypes.add(exp.task.type);
            }
          });
          
          // Get recent performance (last 10 valid tasks) with safety checks
          stats.recentPerformance = validExperiences
            .slice(-10)
            .map(exp => ({
              task: exp.task?.type || 'unknown',
              success: exp.success || false,
              timestamp: exp.timestamp || Date.now()
            }))
            .filter(item => item.task !== 'unknown'); // Remove unknown tasks
        }
        
        // Update total experiences to reflect valid ones
        stats.totalExperiences = validExperiences.length;
      }
    } catch (error) {
      console.log(`Error in getLearningStats: ${error.message}`);
      // Return safe default stats if anything fails
      return {
        totalExperiences: 0,
        successRate: 0,
        taskTypes: new Set(),
        recentPerformance: []
      };
    }
    
    return stats;
  }
}

module.exports = { VoyagerAI };