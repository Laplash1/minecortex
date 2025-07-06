/**
 * PathfindingCache - パス計算結果キャッシュシステム
 * 5体ボット環境での重複パスファインディング計算を削減
 */

class PathfindingCache {
  constructor(options = {}) {
    this.cache = new Map(); // key -> pathResult
    this.maxCacheSize = options.maxCacheSize || 1000;
    this.maxCacheAge = options.maxCacheAge || 300000; // 5分
    this.hitRadius = options.hitRadius || 3; // キャッシュヒット判定半径

    // パフォーマンス統計
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalPaths: 0
    };

    // 定期クリーンアップ
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // 1分ごと

    console.log('[PathfindingCache] パスファインディングキャッシュ初期化完了');
  }

  /**
   * パス計算結果をキャッシュに保存
   */
  storePath(fromPos, toPos, pathResult, botId = 'unknown') {
    const key = this.generateKey(fromPos, toPos);
    const cacheEntry = {
      fromPos: this.normalizePosition(fromPos),
      toPos: this.normalizePosition(toPos),
      pathResult: this.clonePathResult(pathResult),
      timestamp: Date.now(),
      botId,
      accessCount: 1
    };

    // キャッシュサイズ制限チェック
    if (this.cache.size >= this.maxCacheSize) {
      this.evictOldest();
    }

    this.cache.set(key, cacheEntry);
    this.stats.totalPaths++;

    if (this.stats.totalPaths % 100 === 0) {
      console.log(`[PathfindingCache] キャッシュ状況: ${this.cache.size}個, ヒット率: ${this.getHitRate().toFixed(1)}%`);
    }
  }

  /**
   * キャッシュからパス結果を取得
   */
  getPath(fromPos, toPos, maxAge = this.maxCacheAge) {
    const startTime = Date.now();

    // 近似マッチングでキャッシュエントリを検索
    const matchingEntry = this.findNearbyPath(fromPos, toPos, maxAge);

    if (matchingEntry) {
      matchingEntry.accessCount++;
      this.stats.hits++;

      const adaptedPath = this.adaptPathToNewPositions(
        matchingEntry.pathResult,
        matchingEntry.fromPos,
        matchingEntry.toPos,
        fromPos,
        toPos
      );

      const searchTime = Date.now() - startTime;
      if (searchTime > 10) {
        console.log(`[PathfindingCache] キャッシュヒット (${searchTime}ms): ${this.formatPos(fromPos)} → ${this.formatPos(toPos)}`);
      }

      return adaptedPath;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * 近似位置でのパス検索
   */
  findNearbyPath(fromPos, toPos, maxAge) {
    const currentTime = Date.now();
    const fromNorm = this.normalizePosition(fromPos);
    const toNorm = this.normalizePosition(toPos);

    for (const [key, entry] of this.cache.entries()) {
      // 年齢チェック
      if (currentTime - entry.timestamp > maxAge) {
        continue;
      }

      // 近似位置マッチング
      const fromDistance = this.calculateDistance(fromNorm, entry.fromPos);
      const toDistance = this.calculateDistance(toNorm, entry.toPos);

      if (fromDistance <= this.hitRadius && toDistance <= this.hitRadius) {
        return entry;
      }
    }

    return null;
  }

  /**
   * パス結果を新しい位置に適応
   */
  adaptPathToNewPositions(originalPath, originalFrom, originalTo, newFrom, newTo) {
    if (!originalPath || !originalPath.path || originalPath.path.length === 0) {
      return null;
    }

    try {
      // パスの各ポイントをオフセット調整
      const fromOffset = {
        x: newFrom.x - originalFrom.x,
        y: newFrom.y - originalFrom.y,
        z: newFrom.z - originalFrom.z
      };

      const adaptedPath = originalPath.path.map(point => ({
        x: Math.round(point.x + fromOffset.x),
        y: Math.round(point.y + fromOffset.y),
        z: Math.round(point.z + fromOffset.z)
      }));

      return {
        ...originalPath,
        path: adaptedPath,
        fromCache: true,
        originalCacheKey: this.generateKey(originalFrom, originalTo)
      };
    } catch (error) {
      console.log(`[PathfindingCache] パス適応エラー: ${error.message}`);
      return null;
    }
  }

  /**
   * 最も古いエントリを削除
   */
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 期限切れエントリのクリーンアップ
   */
  cleanup() {
    const currentTime = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this.cache.entries()) {
      if (currentTime - entry.timestamp > this.maxCacheAge) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.cache.delete(key));

    if (expiredKeys.length > 0) {
      console.log(`[PathfindingCache] クリーンアップ: ${expiredKeys.length}個の期限切れエントリを削除`);
    }
  }

  /**
   * キーの生成
   */
  generateKey(fromPos, toPos) {
    const from = this.normalizePosition(fromPos);
    const to = this.normalizePosition(toPos);
    return `${from.x},${from.y},${from.z}->${to.x},${to.y},${to.z}`;
  }

  /**
   * 位置の正規化
   */
  normalizePosition(pos) {
    return {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      z: Math.round(pos.z)
    };
  }

  /**
   * 距離計算
   */
  calculateDistance(pos1, pos2) {
    return Math.sqrt(
      Math.pow(pos1.x - pos2.x, 2) +
      Math.pow(pos1.y - pos2.y, 2) +
      Math.pow(pos1.z - pos2.z, 2)
    );
  }

  /**
   * パス結果の複製
   */
  clonePathResult(pathResult) {
    if (!pathResult) return null;

    return {
      path: pathResult.path ? [...pathResult.path] : [],
      status: pathResult.status,
      cost: pathResult.cost,
      time: pathResult.time,
      movements: pathResult.movements
    };
  }

  /**
   * 位置フォーマット
   */
  formatPos(pos) {
    return `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
  }

  /**
   * ヒット率計算
   */
  getHitRate() {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * キャッシュ統計取得
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      hitRate: this.getHitRate(),
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * メモリ使用量推定
   */
  estimateMemoryUsage() {
    let totalSize = 0;

    for (const entry of this.cache.values()) {
      // エントリのサイズを概算
      totalSize += JSON.stringify(entry).length;
    }

    return {
      totalBytes: totalSize,
      averageEntrySize: this.cache.size > 0 ? Math.round(totalSize / this.cache.size) : 0,
      estimatedMB: (totalSize / 1024 / 1024).toFixed(2)
    };
  }

  /**
   * 特定のボットのキャッシュエントリを削除
   */
  clearBotCache(botId) {
    const keysToDelete = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.botId === botId) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
    console.log(`[PathfindingCache] ボット ${botId} のキャッシュ ${keysToDelete.length}個を削除`);
  }

  /**
   * キャッシュリセット
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0, totalPaths: 0 };
    console.log(`[PathfindingCache] キャッシュクリア: ${size}個のエントリを削除`);
  }

  /**
   * システム終了処理
   */
  shutdown() {
    console.log('[PathfindingCache] システム終了中...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log(`[PathfindingCache] 終了時統計: ヒット率 ${this.getHitRate().toFixed(1)}%, ${this.cache.size}個のエントリ`);
    this.cache.clear();

    console.log('[PathfindingCache] システム終了完了');
  }
}

module.exports = { PathfindingCache };
