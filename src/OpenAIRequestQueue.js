/**
 * OpenAIRequestQueue - OpenAI APIリクエストキュー制御システム
 * 5体ボット環境でのAPI呼び出し最適化とレート制限管理
 */

const { Logger } = require('./utils/Logger');

class OpenAIRequestQueue {
  constructor(options = {}) {
    this.maxConcurrentRequests = options.maxConcurrentRequests || 3;
    this.requestsPerMinute = options.requestsPerMinute || 50; // TPMではなくRPM制限
    this.requestQueue = [];
    this.activeRequests = new Set();
    this.requestHistory = [];
    this.logger = Logger.createLogger('OpenAIRequestQueue');

    // パフォーマンス統計
    this.stats = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      queuedRequests: 0,
      averageWaitTime: 0,
      averageResponseTime: 0
    };

    // レート制限管理
    this.rateLimitWindow = 60000; // 1分間
    this.isProcessing = false;

    // キュー処理開始
    this.startQueueProcessor();

    this.logger.log(`[OpenAIRequestQueue] API制御システム初期化: 同時${this.maxConcurrentRequests}件, ${this.requestsPerMinute}req/min`);
  }

  /**
   * APIリクエストをキューに追加
   */
  async enqueueRequest(requestType, requestData, botId = 'unknown', priority = 5) {
    return new Promise((resolve, reject) => {
      const request = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: requestType,
        data: requestData,
        botId,
        priority,
        timestamp: Date.now(),
        resolve,
        reject,
        retryCount: 0,
        maxRetries: 3
      };

      // 優先度でソート挿入
      this.insertByPriority(request);
      this.stats.queuedRequests++;
      this.stats.totalRequests++;

      if (this.stats.totalRequests % 10 === 0) {
        this.logger.log(`[OpenAIRequestQueue] キュー状況: ${this.requestQueue.length}待機, ${this.activeRequests.size}実行中`);
      }
    });
  }

  /**
   * 優先度に基づいてキューに挿入
   */
  insertByPriority(newRequest) {
    let inserted = false;
    for (let i = 0; i < this.requestQueue.length; i++) {
      if (newRequest.priority < this.requestQueue[i].priority) {
        this.requestQueue.splice(i, 0, newRequest);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.requestQueue.push(newRequest);
    }
  }

  /**
   * キュー処理メインループ
   */
  startQueueProcessor() {
    setInterval(() => {
      this.processQueue();
    }, 1000); // 1秒ごとにチェック
  }

  /**
   * キューの処理
   */
  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    // レート制限チェック
    if (!this.canMakeRequest()) {
      return;
    }

    // 同時実行数制限チェック
    if (this.activeRequests.size >= this.maxConcurrentRequests) {
      return;
    }

    this.isProcessing = true;

    try {
      const request = this.requestQueue.shift();
      this.stats.queuedRequests--;

      if (request) {
        this.executeRequest(request);
      }
    } catch (error) {
      this.logger.error('[OpenAIRequestQueue] キュー処理エラー:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * リクエスト実行可能かチェック
   */
  canMakeRequest() {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;

    // 過去1分間のリクエスト数をカウント
    const recentRequests = this.requestHistory.filter(
      timestamp => timestamp > windowStart
    ).length;

    return recentRequests < this.requestsPerMinute;
  }

  /**
   * 個別リクエストの実行
   */
  async executeRequest(request) {
    const startTime = Date.now();
    const waitTime = startTime - request.timestamp;

    try {
      this.activeRequests.add(request.id);
      this.requestHistory.push(startTime);

      // 実際のAPIリクエスト実行
      const result = await this.callOpenAIAPI(request);

      const responseTime = Date.now() - startTime;
      this.updateStats(waitTime, responseTime, true);

      request.resolve(result);
      this.stats.completedRequests++;
    } catch (error) {
      this.logger.error(`[OpenAIRequestQueue] API呼び出し失敗 (${request.type}):`, error.message);

      // リトライ処理
      if (request.retryCount < request.maxRetries && this.shouldRetry(error)) {
        request.retryCount++;
        this.logger.log(`[OpenAIRequestQueue] リトライ ${request.retryCount}/${request.maxRetries}: ${request.id}`);

        // 指数バックオフでリトライ
        setTimeout(() => {
          this.requestQueue.unshift(request); // 優先的に再キューイング
        }, Math.pow(2, request.retryCount) * 1000);
      } else {
        this.stats.failedRequests++;
        request.reject(error);
      }
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  /**
   * 実際のOpenAI API呼び出し
   */
  async callOpenAIAPI(request) {
    const { type, data } = request;

    try {
      switch (type) {
      case 'skill_generation':
        return await this.generateSkill(data);
      case 'curriculum_generation':
        return await this.generateCurriculum(data);
      case 'analysis':
        return await this.performAnalysis(data);
      case 'chat_completion':
        return await this.chatCompletion(data);
      default:
        throw new Error(`Unknown request type: ${type}`);
      }
    } catch (apiError) {
      // APIエラーの詳細ログ
      this.logger.error(`[OpenAIRequestQueue] ${type} API エラー:`, {
        message: apiError.message,
        status: apiError.status,
        botId: request.botId
      });
      throw apiError;
    }
  }

  async generateSkill(data) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SKILL_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a Minecraft bot skill generator. Generate executable JavaScript code for Minecraft bot skills.'
        },
        {
          role: 'user',
          content: data.prompt || 'Generate a basic skill'
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });

    return {
      success: true,
      skill: response.choices[0].message.content,
      fromQueue: true
    };
  }

  async generateCurriculum(data) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_CURRICULUM_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Generate a learning curriculum for a Minecraft bot based on its current state.'
        },
        {
          role: 'user',
          content: data.prompt || 'Generate a basic curriculum'
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });

    return {
      success: true,
      curriculum: JSON.parse(response.choices[0].message.content),
      fromQueue: true
    };
  }

  async performAnalysis(data) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an AI that learns from failures to improve Minecraft bot performance.'
        },
        {
          role: 'user',
          content: data.prompt || 'Analyze bot performance'
        }
      ],
      max_tokens: 800,
      temperature: 0.2
    });

    return {
      success: true,
      analysis: response.choices[0].message.content,
      fromQueue: true
    };
  }

  async chatCompletion(data) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: data.model || 'gpt-4o-mini',
      messages: data.messages || [],
      max_tokens: data.max_tokens || 500,
      temperature: data.temperature || 0.7
    });

    return {
      success: true,
      response: response.choices[0].message.content,
      fromQueue: true
    };
  }

  /**
   * リトライすべきエラーかどうか判定
   */
  shouldRetry(error) {
    // レート制限、タイムアウト、一時的エラーの場合はリトライ
    if (error.status === 429 || // Rate limit
        error.status === 502 || // Bad gateway
        error.status === 503 || // Service unavailable
        error.message.includes('timeout') ||
        error.message.includes('network')) {
      return true;
    }
    return false;
  }

  /**
   * 統計更新
   */
  updateStats(waitTime, responseTime, _success) {
    // 移動平均で更新
    const alpha = 0.1;
    this.stats.averageWaitTime =
      this.stats.averageWaitTime * (1 - alpha) + waitTime * alpha;
    this.stats.averageResponseTime =
      this.stats.averageResponseTime * (1 - alpha) + responseTime * alpha;
  }

  /**
   * 統計取得
   */
  getStats() {
    const successRate = this.stats.totalRequests > 0
      ? (this.stats.completedRequests / this.stats.totalRequests) * 100
      : 0;

    return {
      ...this.stats,
      activeRequests: this.activeRequests.size,
      queueLength: this.requestQueue.length,
      successRate: successRate.toFixed(1),
      recentRequestRate: this.getRecentRequestRate()
    };
  }

  /**
   * 直近のリクエストレート計算
   */
  getRecentRequestRate() {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;
    const recentCount = this.requestHistory.filter(
      timestamp => timestamp > windowStart
    ).length;

    return `${recentCount}/${this.requestsPerMinute} req/min`;
  }

  /**
   * 特定ボットのリクエストをキャンセル
   */
  cancelBotRequests(botId) {
    const cancelledCount = this.requestQueue.length;

    this.requestQueue = this.requestQueue.filter(request => {
      if (request.botId === botId) {
        request.reject(new Error('Request cancelled due to bot shutdown'));
        return false;
      }
      return true;
    });

    const actualCancelled = cancelledCount - this.requestQueue.length;
    this.stats.queuedRequests -= actualCancelled;

    this.logger.log(`[OpenAIRequestQueue] ボット ${botId} のリクエスト ${actualCancelled}件をキャンセル`);
  }

  /**
   * キューのクリア
   */
  clearQueue() {
    const cancelledCount = this.requestQueue.length;

    this.requestQueue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });

    this.requestQueue = [];
    this.stats.queuedRequests = 0;

    this.logger.log(`[OpenAIRequestQueue] キューをクリア: ${cancelledCount}件のリクエストをキャンセル`);
  }

  /**
   * システム終了処理
   */
  async shutdown() {
    this.logger.log('[OpenAIRequestQueue] システム終了中...');

    // アクティブなリクエストの完了を待機
    const maxWait = 30000; // 最大30秒
    const startTime = Date.now();

    while (this.activeRequests.size > 0 && (Date.now() - startTime) < maxWait) {
      this.logger.log(`[OpenAIRequestQueue] アクティブリクエスト ${this.activeRequests.size}件の完了待機中...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 残りのキューをキャンセル
    this.clearQueue();

    this.logger.log(`[OpenAIRequestQueue] 終了時統計: 成功率 ${this.getStats().successRate}%, 完了 ${this.stats.completedRequests}件`);
    this.logger.log('[OpenAIRequestQueue] システム終了完了');
  }
}

module.exports = { OpenAIRequestQueue };
