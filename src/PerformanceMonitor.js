/**
 * PerformanceMonitor - イベントループ遅延とシステムパフォーマンス監視
 * MineCortex マルチボット環境のパフォーマンス問題診断用
 */

const { performance, PerformanceObserver } = require('perf_hooks');

class PerformanceMonitor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.logInterval = options.logInterval || 5000; // 5秒間隔
    this.eventLoopThreshold = options.eventLoopThreshold || 50; // 50ms以上で警告
    
    // メトリクス収集
    this.metrics = {
      eventLoopLag: [],
      cpuUsage: [],
      memoryUsage: [],
      gcEvents: [],
      performanceTiming: new Map()
    };
    
    // 監視状態
    this.isMonitoring = false;
    this.intervalId = null;
    this.lastCpuUsage = process.cpuUsage();
    this.performanceObserver = null;
    
    if (this.enabled) {
      this.startMonitoring();
    }
  }
  
  /**
   * パフォーマンス監視開始
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    
    console.log('[PerformanceMonitor] 監視開始...');
    this.isMonitoring = true;
    
    // 定期的なメトリクス収集
    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, this.logInterval);
    
    // ガベージコレクション監視
    this.setupGCMonitoring();
    
    // Performance API監視
    this.setupPerformanceObserver();
  }
  
  /**
   * パフォーマンス監視停止
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    console.log('[PerformanceMonitor] 監視停止...');
    this.isMonitoring = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }
  }
  
  /**
   * イベントループ遅延測定
   */
  measureEventLoopLag() {
    return new Promise((resolve) => {
      const start = performance.now();
      setImmediate(() => {
        const lag = performance.now() - start;
        resolve(lag);
      });
    });
  }
  
  /**
   * メトリクス収集
   */
  async collectMetrics() {
    try {
      // イベントループ遅延測定
      const eventLoopLag = await this.measureEventLoopLag();
      this.metrics.eventLoopLag.push({
        timestamp: Date.now(),
        lag: eventLoopLag
      });
      
      // CPU使用率
      const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
      const cpuPercent = (currentCpuUsage.user + currentCpuUsage.system) / 1000 / this.logInterval * 100;
      this.metrics.cpuUsage.push({
        timestamp: Date.now(),
        percent: cpuPercent,
        user: currentCpuUsage.user,
        system: currentCpuUsage.system
      });
      this.lastCpuUsage = process.cpuUsage();
      
      // メモリ使用量
      const memoryUsage = process.memoryUsage();
      this.metrics.memoryUsage.push({
        timestamp: Date.now(),
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers
      });
      
      // パフォーマンス警告
      if (eventLoopLag > this.eventLoopThreshold) {
        console.warn(`[PerformanceMonitor] ⚠️  高いイベントループ遅延検出: ${eventLoopLag.toFixed(2)}ms`);
      }
      
      // 定期レポート
      this.logPerformanceReport();
      
    } catch (error) {
      console.error('[PerformanceMonitor] メトリクス収集エラー:', error.message);
    }
  }
  
  /**
   * ガベージコレクション監視
   */
  setupGCMonitoring() {
    if (typeof global.gc === 'function') {
      // GC監視は--expose-gcフラグが必要
      const obs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'gc') {
            this.metrics.gcEvents.push({
              timestamp: Date.now(),
              kind: entry.kind,
              duration: entry.duration
            });
            
            if (entry.duration > 100) { // 100ms以上のGC
              console.warn(`[PerformanceMonitor] ⚠️  長時間GC検出: ${entry.duration.toFixed(2)}ms (kind: ${entry.kind})`);
            }
          }
        });
      });
      
      obs.observe({ entryTypes: ['gc'] });
    }
  }
  
  /**
   * Performance API監視
   */
  setupPerformanceObserver() {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.entryType === 'measure') {
          const timing = this.metrics.performanceTiming.get(entry.name) || [];
          timing.push({
            timestamp: Date.now(),
            duration: entry.duration
          });
          this.metrics.performanceTiming.set(entry.name, timing);
        }
      });
    });
    
    this.performanceObserver.observe({ entryTypes: ['measure'] });
  }
  
  /**
   * 処理時間測定開始
   */
  startMeasure(name) {
    performance.mark(`${name}-start`);
  }
  
  /**
   * 処理時間測定終了
   */
  endMeasure(name) {
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
  }
  
  /**
   * パフォーマンスレポート出力
   */
  logPerformanceReport() {
    const recentMetrics = this.getRecentMetrics(60000); // 直近1分
    
    if (recentMetrics.eventLoopLag.length === 0) return;
    
    // イベントループ遅延統計
    const lagValues = recentMetrics.eventLoopLag.map(m => m.lag);
    const avgLag = lagValues.reduce((a, b) => a + b, 0) / lagValues.length;
    const maxLag = Math.max(...lagValues);
    
    // メモリ使用量統計
    const memValues = recentMetrics.memoryUsage;
    const latestMem = memValues[memValues.length - 1];
    
    console.log(`[PerformanceMonitor] 📊 直近1分統計:`);
    console.log(`  イベントループ遅延: 平均 ${avgLag.toFixed(2)}ms, 最大 ${maxLag.toFixed(2)}ms`);
    console.log(`  メモリ使用量: RSS ${(latestMem.rss / 1024 / 1024).toFixed(1)}MB, Heap ${(latestMem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    
    // 警告表示
    if (avgLag > this.eventLoopThreshold) {
      console.warn(`[PerformanceMonitor] 🚨 平均イベントループ遅延が閾値超過: ${avgLag.toFixed(2)}ms > ${this.eventLoopThreshold}ms`);
    }
  }
  
  /**
   * 直近メトリクス取得
   */
  getRecentMetrics(timeWindow = 60000) {
    const cutoff = Date.now() - timeWindow;
    
    return {
      eventLoopLag: this.metrics.eventLoopLag.filter(m => m.timestamp > cutoff),
      cpuUsage: this.metrics.cpuUsage.filter(m => m.timestamp > cutoff),
      memoryUsage: this.metrics.memoryUsage.filter(m => m.timestamp > cutoff),
      gcEvents: this.metrics.gcEvents.filter(m => m.timestamp > cutoff)
    };
  }
  
  /**
   * 詳細統計レポート生成
   */
  generateDetailedReport() {
    const recent = this.getRecentMetrics(300000); // 直近5分
    
    const report = {
      timestamp: Date.now(),
      timeWindow: '5 minutes',
      eventLoopLag: this.calculateStats(recent.eventLoopLag.map(m => m.lag)),
      cpuUsage: this.calculateStats(recent.cpuUsage.map(m => m.percent)),
      memoryUsage: {
        rss: this.calculateStats(recent.memoryUsage.map(m => m.rss)),
        heapUsed: this.calculateStats(recent.memoryUsage.map(m => m.heapUsed)),
        heapTotal: this.calculateStats(recent.memoryUsage.map(m => m.heapTotal))
      },
      gcEvents: {
        count: recent.gcEvents.length,
        totalDuration: recent.gcEvents.reduce((sum, gc) => sum + gc.duration, 0)
      },
      performanceTiming: this.getPerformanceTimingStats()
    };
    
    return report;
  }
  
  /**
   * 統計計算
   */
  calculateStats(values) {
    if (values.length === 0) return { count: 0 };
    
    const sorted = values.sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }
  
  /**
   * パフォーマンスタイミング統計
   */
  getPerformanceTimingStats() {
    const stats = {};
    
    for (const [name, timings] of this.metrics.performanceTiming) {
      const recent = timings.filter(t => t.timestamp > Date.now() - 300000);
      if (recent.length > 0) {
        stats[name] = this.calculateStats(recent.map(t => t.duration));
      }
    }
    
    return stats;
  }
  
  /**
   * メトリクスクリア
   */
  clearMetrics() {
    this.metrics.eventLoopLag = [];
    this.metrics.cpuUsage = [];
    this.metrics.memoryUsage = [];
    this.metrics.gcEvents = [];
    this.metrics.performanceTiming.clear();
    console.log('[PerformanceMonitor] メトリクスをクリアしました');
  }
}

module.exports = PerformanceMonitor;