/**
 * MineCortex Performance Test Script
 * 5体ボット環境でのパフォーマンス問題再現・診断
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class PerformanceTestRunner {
  constructor() {
    this.testResults = [];
    this.testDuration = 60000; // 1分間のテスト
    this.outputDir = path.join(__dirname, '..', 'performance-reports');
  }

  async runAllTests() {
    console.log('🔍 MineCortex パフォーマンステスト開始...');

    // 出力ディレクトリ作成
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const tests = [
      { name: '単体ボット', botCount: 1, command: 'npm start' },
      { name: '3体ボット', botCount: 3, command: 'MULTIPLE_PLAYERS_COUNT=3 npm run multi-players' },
      { name: '5体ボット（問題再現）', botCount: 5, command: 'npm run squad' }
    ];

    for (const test of tests) {
      console.log(`\n📊 ${test.name}テスト実行中...`);
      await this.runSingleTest(test);
    }

    // 結果レポート生成
    this.generateReport();
  }

  async runSingleTest(testConfig) {
    const startTime = Date.now();
    const logFile = path.join(this.outputDir, `${testConfig.name.replace(/[^\w]/g, '_')}_${startTime}.log`);

    console.log(`  コマンド: ${testConfig.command}`);
    console.log(`  テスト時間: ${this.testDuration / 1000}秒`);
    console.log(`  ログファイル: ${logFile}`);

    return new Promise((resolve) => {
      // プロセス起動
      const child = spawn('bash', ['-c', testConfig.command], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PERFORMANCE_MONITORING: 'true',
          PERF_LOG_INTERVAL: '5000',
          EVENT_LOOP_THRESHOLD: '30'
        }
      });

      let output = '';
      const performanceData = [];

      // 出力収集
      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;

        // パフォーマンス情報抽出
        const perfLines = chunk.split('\n').filter(line =>
          line.includes('[PerformanceMonitor]') ||
          line.includes('イベントループ遅延') ||
          line.includes('メモリ使用量')
        );

        perfLines.forEach(line => {
          performanceData.push({
            timestamp: Date.now(),
            line: line.trim(),
            testConfig: testConfig.name
          });
        });

        console.log(chunk);
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        output += `STDERR: ${chunk}`;
        console.error(chunk);
      });

      // テスト時間経過後にプロセス終了
      setTimeout(() => {
        console.log(`  ⏰ ${testConfig.name}テスト時間満了、プロセス終了中...`);

        child.kill('SIGTERM');

        // 結果保存
        fs.writeFileSync(logFile, output);

        const result = {
          testName: testConfig.name,
          botCount: testConfig.botCount,
          duration: this.testDuration,
          startTime,
          endTime: Date.now(),
          logFile,
          performanceData,
          summary: this.analyzePerformanceData(performanceData)
        };

        this.testResults.push(result);

        console.log(`  ✅ ${testConfig.name}テスト完了`);
        console.log(`     パフォーマンスデータ: ${performanceData.length}件`);

        // 少し待ってから次のテストへ
        setTimeout(resolve, 2000);
      }, this.testDuration);

      child.on('error', (error) => {
        console.error(`  ❌ ${testConfig.name}テストエラー:`, error.message);
        resolve();
      });
    });
  }

  analyzePerformanceData(performanceData) {
    const lagData = [];
    const memoryData = [];

    performanceData.forEach(entry => {
      // イベントループ遅延抽出
      const lagMatch = entry.line.match(/平均\s+([\d.]+)ms/);
      if (lagMatch) {
        lagData.push(parseFloat(lagMatch[1]));
      }

      // メモリ使用量抽出
      const memMatch = entry.line.match(/RSS\s+([\d.]+)MB/);
      if (memMatch) {
        memoryData.push(parseFloat(memMatch[1]));
      }
    });

    return {
      eventLoopLag: {
        samples: lagData.length,
        avg: lagData.length > 0 ? lagData.reduce((a, b) => a + b, 0) / lagData.length : 0,
        max: lagData.length > 0 ? Math.max(...lagData) : 0,
        min: lagData.length > 0 ? Math.min(...lagData) : 0
      },
      memoryUsage: {
        samples: memoryData.length,
        avg: memoryData.length > 0 ? memoryData.reduce((a, b) => a + b, 0) / memoryData.length : 0,
        max: memoryData.length > 0 ? Math.max(...memoryData) : 0,
        min: memoryData.length > 0 ? Math.min(...memoryData) : 0
      }
    };
  }

  generateReport() {
    const reportTime = new Date().toISOString();
    const reportFile = path.join(this.outputDir, `performance_report_${Date.now()}.json`);

    const report = {
      timestamp: reportTime,
      testDuration: this.testDuration,
      results: this.testResults,
      analysis: this.generateAnalysis()
    };

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    console.log('\n📈 パフォーマンステスト結果レポート');
    console.log('='.repeat(50));

    this.testResults.forEach(result => {
      console.log(`\n${result.testName} (${result.botCount}体)`);
      console.log(`  イベントループ遅延: 平均 ${result.summary.eventLoopLag.avg.toFixed(2)}ms (最大 ${result.summary.eventLoopLag.max.toFixed(2)}ms)`);
      console.log(`  メモリ使用量: 平均 ${result.summary.memoryUsage.avg.toFixed(1)}MB (最大 ${result.summary.memoryUsage.max.toFixed(1)}MB)`);
      console.log(`  データサンプル: ${result.summary.eventLoopLag.samples}件`);
    });

    console.log(`\n📄 詳細レポート: ${reportFile}`);
    console.log('\n🔍 分析結果:');
    console.log(this.generateAnalysis());
  }

  generateAnalysis() {
    if (this.testResults.length < 2) return '分析にはより多くのテスト結果が必要です';

    const analysis = {
      lagIncrease: '',
      memoryIncrease: '',
      scalabilityIssues: [],
      recommendations: []
    };

    // ボット数による影響分析
    const singleBot = this.testResults.find(r => r.botCount === 1);
    const fiveBot = this.testResults.find(r => r.botCount === 5);

    if (singleBot && fiveBot) {
      const lagRatio = fiveBot.summary.eventLoopLag.avg / (singleBot.summary.eventLoopLag.avg || 1);
      const memRatio = fiveBot.summary.memoryUsage.avg / (singleBot.summary.memoryUsage.avg || 1);

      analysis.lagIncrease = `5体ボット時のイベントループ遅延は単体の${lagRatio.toFixed(1)}倍`;
      analysis.memoryIncrease = `5体ボット時のメモリ使用量は単体の${memRatio.toFixed(1)}倍`;

      if (lagRatio > 5) {
        analysis.scalabilityIssues.push('イベントループの深刻なボトルネック');
        analysis.recommendations.push('Worker Threadsまたはマルチプロセス化を検討');
      }

      if (memRatio > 5) {
        analysis.scalabilityIssues.push('メモリ使用量の急激な増加');
        analysis.recommendations.push('メモリリーク調査とオブジェクト共有化を検討');
      }

      if (fiveBot.summary.eventLoopLag.avg > 50) {
        analysis.scalabilityIssues.push('許容できないイベントループ遅延');
        analysis.recommendations.push('CPU集約的処理の最適化が必要');
      }
    }

    return analysis;
  }
}

// スクリプト実行
if (require.main === module) {
  const runner = new PerformanceTestRunner();
  runner.runAllTests().catch(console.error);
}

module.exports = PerformanceTestRunner;
