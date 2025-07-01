const OpenAI = require('openai');

/**
 * 自然言語理解(NLU)プロセッサ
 * OpenAI Function Callingを使用してMinecraftボットコマンドの自然言語解析を行う
 */
class NLUProcessor {
  constructor() {
    // OpenAI APIキーの設定確認
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[NLU] OpenAI API key not found. NLU features will be disabled.');
      this.client = null;
      return;
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // デバッグモード設定
    this.debugMode = process.env.DEBUG_MODE === 'true';
  }

  /**
   * 自然言語テキストを解析してIntent/Entityを抽出
   * @param {string} text - 解析対象の自然言語テキスト
   * @param {object} context - ボットの現在状態（位置、インベントリ等）
   * @returns {Promise<{intent: string, entities: object}|null>}
   */
  async parse(text, context = {}) {
    if (!this.client) {
      console.warn('[NLU] OpenAI client not initialized. Skipping NLU processing.');
      return null;
    }

    try {
      const systemPrompt = this._buildSystemPrompt(context);
      const tools = this._getSkillDefinitions();

      if (this.debugMode) {
        console.log('[NLU Debug] Input text:', text);
        console.log('[NLU Debug] Context:', context);
      }

      const response = await this.client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        tools,
        tool_choice: 'auto',
        temperature: 0.1, // 一貫性のある解析のため低めに設定
        max_tokens: 500
      });

      return this._processResponse(response);
    } catch (error) {
      console.error('[NLU Error] Failed to parse natural language:', error.message);
      return null;
    }
  }

  /**
   * システムプロンプトを構築
   * @param {object} context - ボットの現在状態
   * @returns {string}
   */
  _buildSystemPrompt(context) {
    const { position, health, food, inventory } = context;

    let contextInfo = '';
    if (position) {
      contextInfo += `現在位置: x=${Math.round(position.x)}, y=${Math.round(position.y)}, z=${Math.round(position.z)}\n`;
    }
    if (health !== undefined) {
      contextInfo += `体力: ${health}/20\n`;
    }
    if (food !== undefined) {
      contextInfo += `食料: ${food}/20\n`;
    }
    if (inventory) {
      contextInfo += `インベントリ: ${inventory}\n`;
    }

    return `あなたはMinecraftボットのコマンド解析システムです。
プレイヤーからの日本語の指示を理解し、適切なMinecraftアクションに変換してください。

現在のボット状態:
${contextInfo}

指示を解析して、以下のような行動に変換してください：
- 移動や探索の指示 → navigation関連の関数を呼び出し
- 採掘や収集の指示 → resource_gathering関連の関数を呼び出し
- クラフト・製作の指示 → crafting関連の関数を呼び出し
- インベントリ操作の指示 → inventory関連の関数を呼び出し
- ステータス確認の指示 → information関連の関数を呼び出し

日本語の自然な表現から適切なパラメータを抽出し、Minecraftの世界で実行可能な具体的なアクションとして解釈してください。`;
  }

  /**
   * SkillLibraryに対応するOpenAI Function Callingのツール定義
   * @returns {Array}
   */
  _getSkillDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'goto',
          description: '指定された座標に移動する',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X座標' },
              y: { type: 'number', description: 'Y座標' },
              z: { type: 'number', description: 'Z座標' }
            },
            required: ['x', 'y', 'z']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'explore',
          description: '探索を行う（洞窟、地下、特定の場所など）',
          parameters: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: '探索対象（cave, underground, surface, nearby）',
                enum: ['cave', 'underground', 'surface', 'nearby']
              },
              radius: { type: 'number', description: '探索範囲（ブロック数）', default: 50 }
            },
            required: ['target']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'mine_block',
          description: 'ブロックを採掘する',
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: '採掘するブロック名（例: stone, coal_ore, iron_ore, diamond_ore）'
              },
              count: { type: 'number', description: '採掘する数量', default: 1 }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'gather_wood',
          description: '木材を収集する',
          parameters: {
            type: 'object',
            properties: {
              wood_type: {
                type: 'string',
                description: '木材の種類（oak, birch, spruce, jungle）',
                default: 'oak'
              },
              count: { type: 'number', description: '収集する数量', default: 10 }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'craft_item',
          description: 'アイテムをクラフトする',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string', description: 'クラフトするアイテム名' },
              count: { type: 'number', description: 'クラフトする数量', default: 1 }
            },
            required: ['item']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'follow',
          description: 'プレイヤーを追跡する',
          parameters: {
            type: 'object',
            properties: {
              player: { type: 'string', description: '追跡するプレイヤー名' }
            },
            required: ['player']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'check_inventory',
          description: 'インベントリの状態を確認する',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_status',
          description: 'ボットの現在状態（体力、食料、位置）を確認する',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'stop_task',
          description: '現在実行中のタスクを停止する',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }
    ];
  }

  /**
   * OpenAI APIのレスポンスを処理
   * @param {object} response - OpenAI APIレスポンス
   * @returns {{intent: string, entities: object}|null}
   */
  _processResponse(response) {
    try {
      const message = response.choices[0]?.message;

      if (!message?.tool_calls || message.tool_calls.length === 0) {
        if (this.debugMode) {
          console.log('[NLU Debug] No tool calls found in response');
        }
        return null;
      }

      const toolCall = message.tool_calls[0];
      const intent = toolCall.function.name;
      let entities = {};

      try {
        entities = JSON.parse(toolCall.function.arguments);
      } catch (parseError) {
        console.error('[NLU Error] Failed to parse function arguments:', parseError);
        return null;
      }

      if (this.debugMode) {
        console.log('[NLU Debug] Parsed intent:', intent);
        console.log('[NLU Debug] Parsed entities:', entities);
      }

      return { intent, entities };
    } catch (error) {
      console.error('[NLU Error] Failed to process OpenAI response:', error);
      return null;
    }
  }
}

module.exports = { NLUProcessor };

// 使用例（コメント）:
// const { NLUProcessor } = require('./NLUProcessor');
// const nluProcessor = new NLUProcessor();
//
// // 基本的な使用
// const result = await nluProcessor.parse('近くの洞窟を探検して');
// // 結果: { intent: 'explore', entities: { target: 'cave', radius: 50 } }
//
// const result2 = await nluProcessor.parse('10個の石を掘って');
// // 結果: { intent: 'mine_block', entities: { name: 'stone', count: 10 } }
//
// // コンテキスト付きの使用
// const context = {
//   position: { x: 100, y: 64, z: 200 },
//   health: 18,
//   food: 15,
//   inventory: 'oak_log x32, stone x16, coal x8'
// };
// const result3 = await nluProcessor.parse('体力回復して', context);
