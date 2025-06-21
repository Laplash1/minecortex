// AI学習機能の検証とテスト
const { VoyagerAI } = require('../src/VoyagerAI');
const { TrainingScenarios } = require('../training/training_scenarios');
const fs = require('fs');

class AITrainingVerification {
  constructor() {
    this.testResults = [];
    this.mockBot = this.createMockBot();
    this.voyagerAI = new VoyagerAI(this.mockBot);
  }

  createMockBot() {
    return {
      entity: {
        position: { x: 0, y: 64, z: 0 }
      },
      health: 20,
      food: 20,
      inventory: {
        findInventoryItem: (itemId) => {
          // モックインベントリ実装
          const mockItems = {
            'oak_planks': { count: 10 },
            'stick': { count: 5 },
            'cobblestone': { count: 15 }
          };
          return mockItems[itemId] || null;
        }
      },
      findBlock: (options) => {
        // モックブロック検索
        return {
          position: { x: 5, y: 64, z: 5 },
          type: options.matching
        };
      },
      dig: async (block) => {
        // モック採掘
        return Promise.resolve();
      },
      craft: async (recipe, count) => {
        // モッククラフト
        return Promise.resolve();
      },
      pathfinder: {
        setGoal: (goal) => {
          // モック移動
          return Promise.resolve();
        }
      }
    };
  }

  async runAllVerifications() {
    console.log('🤖 MinecraftAI学習機能の検証を開始...\n');

    const verifications = [
      () => this.verifyBasicSkillGeneration(),
      () => this.verifyLearningFromExperience(),
      () => this.verifyCurriculumGeneration(),
      () => this.verifyScenarioExecution(),
      () => this.verifyDataFlow(),
      () => this.verifyTrainingDataProcessing()
    ];

    for (const verification of verifications) {
      try {
        await verification();
      } catch (error) {
        this.addTestResult(verification.name, false, error.message);
      }
    }

    this.generateVerificationReport();
  }

  async verifyBasicSkillGeneration() {
    console.log('📝 1. 基本スキル生成の検証...');
    
    const testTask = {
      type: 'gather_wood',
      params: { amount: 5, wood_type: 'oak' }
    };

    const testContext = {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      food: 18,
      timeOfDay: 'day',
      weather: 'clear',
      nearbyEntities: ['oak_log'],
      inventoryItems: []
    };

    try {
      const skill = await this.voyagerAI.generateSkill(testTask, testContext);
      
      if (skill && typeof skill.execute === 'function') {
        console.log('   ✅ スキル生成成功');
        this.addTestResult('スキル生成', true, 'GPT使用可能またはフォールバック成功');
        
        // スキル実行のテスト
        const result = await skill.execute(this.mockBot, testTask.params);
        if (result && typeof result.success === 'boolean') {
          console.log('   ✅ スキル実行成功');
          this.addTestResult('スキル実行', true, `実行結果: ${JSON.stringify(result)}`);
        } else {
          throw new Error('スキル実行結果が無効');
        }
      } else {
        throw new Error('生成されたスキルが無効');
      }
    } catch (error) {
      console.log('   ❌ スキル生成失敗:', error.message);
      this.addTestResult('スキル生成', false, error.message);
    }
  }

  async verifyLearningFromExperience() {
    console.log('📚 2. 経験からの学習の検証...');

    const testTask = {
      type: 'craft_tools',
      params: { tools: ['wooden_pickaxe'] }
    };

    const testResult = {
      success: true,
      crafted: ['wooden_pickaxe'],
      executionTime: 30000
    };

    const testContext = {
      position: { x: 10, y: 64, z: 10 },
      health: 20,
      food: 15,
      timeOfDay: 'day',
      weather: 'clear'
    };

    try {
      const initialHistoryLength = this.voyagerAI.learningHistory.length;
      
      await this.voyagerAI.learnFromExperience(testTask, testResult, testContext);
      
      const newHistoryLength = this.voyagerAI.learningHistory.length;
      
      if (newHistoryLength > initialHistoryLength) {
        console.log('   ✅ 学習履歴への記録成功');
        
        const latestExperience = this.voyagerAI.learningHistory[newHistoryLength - 1];
        if (latestExperience && latestExperience.task.type === testTask.type) {
          console.log('   ✅ 学習データの整合性確認');
          this.addTestResult('経験学習', true, '学習履歴に正しく記録された');
        } else {
          throw new Error('学習データの整合性エラー');
        }
      } else {
        throw new Error('学習履歴が更新されていない');
      }
    } catch (error) {
      console.log('   ❌ 学習失敗:', error.message);
      this.addTestResult('経験学習', false, error.message);
    }
  }

  async verifyCurriculumGeneration() {
    console.log('🎯 3. カリキュラム生成の検証...');

    try {
      const mockSkills = new Map([
        ['gather_wood', {}],
        ['craft_tools', {}],
        ['explore_area', {}]
      ]);

      const mockGoals = [
        { type: 'build_shelter', priority: 5 },
        { type: 'find_food', priority: 3 }
      ];

      const curriculum = await this.voyagerAI.generateCurriculum(mockSkills, mockGoals);
      
      if (Array.isArray(curriculum) && curriculum.length > 0) {
        console.log('   ✅ カリキュラム生成成功');
        console.log(`   📋 生成されたタスク数: ${curriculum.length}`);
        
        // カリキュラムの構造検証
        const validTask = curriculum.every(task => 
          task.type && task.description && typeof task.difficulty === 'number'
        );
        
        if (validTask) {
          console.log('   ✅ カリキュラム構造の妥当性確認');
          this.addTestResult('カリキュラム生成', true, `${curriculum.length}個のタスクを生成`);
        } else {
          throw new Error('カリキュラムの構造が無効');
        }
      } else {
        throw new Error('カリキュラムが生成されていない');
      }
    } catch (error) {
      console.log('   ❌ カリキュラム生成失敗:', error.message);
      this.addTestResult('カリキュラム生成', false, error.message);
    }
  }

  async verifyScenarioExecution() {
    console.log('🎮 4. 学習シナリオの実行検証...');

    try {
      const basicScenario = TrainingScenarios.getBasicSurvivalScenario();
      
      if (basicScenario && basicScenario.tasks && basicScenario.tasks.length > 0) {
        console.log('   ✅ シナリオ構造の妥当性確認');
        console.log(`   📊 シナリオ名: ${basicScenario.name}`);
        console.log(`   📝 タスク数: ${basicScenario.tasks.length}`);
        
        // 最初のタスクを実行テスト
        const firstTask = basicScenario.tasks[0];
        const skill = await this.voyagerAI.generateSkill(firstTask, basicScenario.initialState);
        
        if (skill) {
          console.log('   ✅ シナリオタスクのスキル生成成功');
          this.addTestResult('シナリオ実行', true, 'シナリオの構造とタスク実行可能');
        } else {
          throw new Error('シナリオタスクのスキル生成失敗');
        }
      } else {
        throw new Error('シナリオの構造が無効');
      }
    } catch (error) {
      console.log('   ❌ シナリオ実行失敗:', error.message);
      this.addTestResult('シナリオ実行', false, error.message);
    }
  }

  async verifyDataFlow() {
    console.log('🔄 5. データフローの検証...');

    try {
      // 学習統計の取得
      const stats = this.voyagerAI.getLearningStats();
      
      if (stats && typeof stats.totalExperiences === 'number' && 
          typeof stats.successRate === 'number') {
        console.log('   ✅ 学習統計の取得成功');
        console.log(`   📈 総経験数: ${stats.totalExperiences}`);
        console.log(`   📊 成功率: ${(stats.successRate * 100).toFixed(1)}%`);
        
        // 特定タスクの成功率
        const taskSuccessRate = this.voyagerAI.getSuccessRate('gather_wood');
        if (typeof taskSuccessRate === 'number') {
          console.log('   ✅ タスク別成功率の計算成功');
          this.addTestResult('データフロー', true, '統計データの取得と計算が正常');
        } else {
          throw new Error('タスク別成功率の計算失敗');
        }
      } else {
        throw new Error('学習統計の構造が無効');
      }
    } catch (error) {
      console.log('   ❌ データフロー検証失敗:', error.message);
      this.addTestResult('データフロー', false, error.message);
    }
  }

  async verifyTrainingDataProcessing() {
    console.log('💾 6. 訓練データ処理の検証...');

    try {
      // サンプルデータの読み込み
      const path = require('path');
      const sampleDataPath = path.join(__dirname, '../training/sample_training_data.json');
      if (fs.existsSync(sampleDataPath)) {
        const sampleData = JSON.parse(fs.readFileSync(sampleDataPath, 'utf8'));
        
        if (Array.isArray(sampleData) && sampleData.length > 0) {
          console.log('   ✅ サンプルデータの読み込み成功');
          console.log(`   📋 サンプル数: ${sampleData.length}`);
          
          // データ構造の検証
          const validData = sampleData.every(sample => 
            sample.task && sample.context && sample.result && sample.timestamp
          );
          
          if (validData) {
            console.log('   ✅ データ構造の妥当性確認');
            
            // データを学習履歴に追加テスト
            for (const sample of sampleData.slice(0, 3)) { // 最初の3つをテスト
              await this.voyagerAI.learnFromExperience(
                sample.task, 
                sample.result, 
                sample.context
              );
            }
            
            console.log('   ✅ 訓練データの処理成功');
            this.addTestResult('訓練データ処理', true, '訓練データの読み込みと処理が正常');
          } else {
            throw new Error('訓練データの構造が無効');
          }
        } else {
          throw new Error('訓練データが空または無効');
        }
      } else {
        throw new Error('サンプル訓練データファイルが存在しない');
      }
    } catch (error) {
      console.log('   ❌ 訓練データ処理失敗:', error.message);
      this.addTestResult('訓練データ処理', false, error.message);
    }
  }

  addTestResult(testName, success, details) {
    this.testResults.push({
      test: testName,
      success: success,
      details: details,
      timestamp: new Date().toISOString()
    });
  }

  generateVerificationReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 AI学習機能検証レポート');
    console.log('='.repeat(60));

    const successCount = this.testResults.filter(result => result.success).length;
    const totalCount = this.testResults.length;
    const successRate = ((successCount / totalCount) * 100).toFixed(1);

    console.log(`\n総合結果: ${successCount}/${totalCount} テスト成功 (${successRate}%)\n`);

    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${result.test}`);
      console.log(`   詳細: ${result.details}\n`);
    });

    // レポートをファイルに保存
    const path = require('path');
    const reportPath = path.join(__dirname, '../training/ai_verification_report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      summary: {
        totalTests: totalCount,
        successfulTests: successCount,
        successRate: parseFloat(successRate),
        timestamp: new Date().toISOString()
      },
      results: this.testResults
    }, null, 2));

    console.log(`📄 詳細レポートを保存: ${reportPath}`);
    
    // 結果に基づく推奨事項
    this.generateRecommendations(successRate);
  }

  generateRecommendations(successRate) {
    console.log('\n🔧 推奨事項:');
    
    if (successRate >= 90) {
      console.log('✅ AI学習システムは正常に動作しています');
      console.log('✅ 本格的な学習を開始できます');
    } else if (successRate >= 70) {
      console.log('⚠️  一部の機能に問題があります');
      console.log('⚠️  OpenAI APIキーの設定を確認してください');
    } else {
      console.log('❌ 重要な問題があります');
      console.log('❌ 環境設定とOpenAI接続を確認してください');
      console.log('❌ package.jsonの依存関係を確認してください');
    }

    const failedTests = this.testResults.filter(result => !result.success);
    if (failedTests.length > 0) {
      console.log('\n❌ 失敗したテスト:');
      failedTests.forEach(test => {
        console.log(`   - ${test.test}: ${test.details}`);
      });
    }
  }
}

// モジュールエクスポートと直接実行
module.exports = { AITrainingVerification };

// スクリプトが直接実行された場合
if (require.main === module) {
  const verification = new AITrainingVerification();
  verification.runAllVerifications().catch(console.error);
}