/**
 * NLUProcessor基本機能テスト
 * サーバー接続なしでNLU機能をテストする
 */

const { NLUProcessor } = require('../src/NLUProcessor');

// モックでOpenAI APIをテストする場合のサンプル
async function testNLUProcessor() {
  console.log('=== NLUProcessor基本テスト開始 ===');

  // 1. インスタンス化テスト
  const nluProcessor = new NLUProcessor();
  console.log('✅ NLUProcessor インスタンス化成功');

  // 2. OpenAI APIキーの設定確認
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY未設定 - APIテストをスキップ');
    return;
  }

  // 3. コンテキスト作成テスト
  const testContext = {
    position: { x: 100, y: 64, z: 200 },
    health: 18,
    food: 15,
    inventory: 'oak_log x32, stone x16, coal x8'
  };

  // 4. 基本的な自然言語解析テスト
  const testCases = [
    {
      input: '近くの洞窟を探検して',
      expectedIntent: 'explore',
      description: '探索コマンドテスト'
    },
    {
      input: '10個の石を掘って',
      expectedIntent: 'mine_block',
      description: '採掘コマンドテスト'
    },
    {
      input: '座標100,70,200に移動して',
      expectedIntent: 'goto',
      description: '移動コマンドテスト'
    },
    {
      input: 'インベントリを確認して',
      expectedIntent: 'check_inventory',
      description: 'インベントリ確認テスト'
    }
  ];

  for (const testCase of testCases) {
    try {
      console.log(`\n--- ${testCase.description} ---`);
      console.log(`入力: "${testCase.input}"`);

      const result = await nluProcessor.parse(testCase.input, testContext);

      if (result) {
        console.log('✅ 解析成功');
        console.log(`Intent: ${result.intent}`);
        console.log('Entities:', result.entities);

        if (result.intent === testCase.expectedIntent) {
          console.log(`✅ 期待されるIntent "${testCase.expectedIntent}" と一致`);
        } else {
          console.log(`❌ Intent不一致 - 期待: ${testCase.expectedIntent}, 実際: ${result.intent}`);
        }
      } else {
        console.log('❌ 解析失敗 - null結果');
      }
    } catch (error) {
      console.log(`❌ テストエラー: ${error.message}`);
    }

    // APIレート制限を考慮した待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n=== NLUProcessorテスト完了 ===');
}

// MinecraftAI統合テスト（モック使用）
async function testMinecraftAIIntegration() {
  console.log('\n=== MinecraftAI統合テスト開始 ===');

  const { MinecraftAI } = require('../src/MinecraftAI');

  // Botのモック作成（EventEmitter機能付き）
  const EventEmitter = require('events');
  class MockBot extends EventEmitter {
    constructor() {
      super();
      this.entity = { position: { x: 100, y: 64, z: 200 } };
      this.health = 20;
      this.food = 18;
      this.username = 'TestBot';
      this.inventory = {
        items: () => [
          { name: 'oak_log', count: 32 },
          { name: 'stone', count: 16 }
        ]
      };
      this._client = { socket: { on: () => {} } };
    }

    chat(message) {
      console.log(`[Bot]: ${message}`);
    }
  }

  const mockBot = new MockBot();

  const ai = new MinecraftAI(mockBot);

  // getContextメソッドテスト
  console.log('\n--- getContext() テスト ---');
  const context = ai.getContext();
  console.log('Context:', context);
  console.log('✅ getContext() 実行成功');

  // mapNluToTaskメソッドテスト
  console.log('\n--- mapNluToTask() テスト ---');
  const nluResults = [
    { intent: 'goto', entities: { x: 100, y: 70, z: 200 } },
    { intent: 'explore', entities: { target: 'cave', radius: 50 } },
    { intent: 'mine_block', entities: { name: 'stone', count: 10 } }
  ];

  nluResults.forEach((nluResult, index) => {
    const task = ai.mapNluToTask(nluResult);
    console.log(`テスト ${index + 1}:`);
    console.log(`  入力: ${JSON.stringify(nluResult)}`);
    console.log(`  出力: ${JSON.stringify(task)}`);
    console.log(`  ${task ? '✅' : '❌'} マッピング${task ? '成功' : '失敗'}`);
  });

  console.log('\n=== MinecraftAI統合テスト完了 ===');
}

// メイン実行
async function runTests() {
  try {
    await testNLUProcessor();
    await testMinecraftAIIntegration();
    console.log('\n🎉 全テスト完了');
  } catch (error) {
    console.error('❌ テスト実行エラー:', error);
  }
}

// スクリプトとして実行された場合のみテストを実行
if (require.main === module) {
  runTests();
}

module.exports = { testNLUProcessor, testMinecraftAIIntegration };
