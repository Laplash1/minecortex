# OpenAI API 設定・最適化ガイド

このガイドでは、MineCortex v1.2.1でのOpenAI API設定と最適化について説明します。

## 🚨 v1.2.1 OpenAI 改善
- **エラーハンドリング強化**: API呼び出し失敗時の適切な処理
- **学習システム安定化**: null参照エラーの完全防止
- **フォールバック機能**: API利用不可時の基本機能維持

## 🎯 概要

MineCortex v1.2.1では、異なるタスクに対して最適化されたOpenAIモデルを使用しています。各タスクの特性に応じて適切なモデルを選択することで、性能とコスト効率を最大化します。

---

## 🔑 APIキー設定

### 1. OpenAI APIキー取得

1. [OpenAI Platform](https://platform.openai.com/) にアクセス
2. アカウント作成・ログイン
3. **API Keys** セクションで新しいキーを作成
4. キーをコピー（⚠️ 一度しか表示されません）

### 2. 環境変数設定

`.env.example` を `.env` にコピーして編集：

```bash
cp .env.example .env
```

`.env` ファイルを編集：
```bash
# 必須：APIキー
OPENAI_API_KEY=sk-proj-your-actual-api-key-here

# 推奨：タスク別モデル設定
OPENAI_SKILL_MODEL=gpt-4o           # スキル生成用
OPENAI_ANALYSIS_MODEL=gpt-4o-mini   # 失敗分析用  
OPENAI_CURRICULUM_MODEL=gpt-4o-mini # カリキュラム生成用

# フォールバック設定
OPENAI_MODEL=gpt-4o-mini
```

---

## 📊 モデル選択基準

### 推奨モデル設定

| タスク | 推奨モデル | 理由 | コスト |
|--------|------------|------|---------|
| **スキル生成** | `gpt-4o` | 高品質なJavaScriptコード生成 | 高 |
| **失敗分析** | `gpt-4o-mini` | 十分な分析能力、コスト効率 | 低 |
| **カリキュラム生成** | `gpt-4o-mini` | バランス型、創造性 | 低 |

### モデル比較表

| モデル | 速度 | コスト | コード生成 | 分析能力 | 用途 |
|--------|------|--------|------------|----------|------|
| **gpt-4o** | 高速 | 高 ($0.0050/1K) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 重要なコード生成 |
| **gpt-4o-mini** | 超高速 | 低 ($0.00015/1K) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 一般的なタスク |
| **gpt-3.5-turbo** | 高速 | 極低 | ⭐⭐ | ⭐⭐⭐ | 非推奨 |

---

## ⚙️ タスク別最適化設定

### 1. スキル生成 (`generateSkill`)
**推奨モデル**: `gpt-4o`

```bash
OPENAI_SKILL_MODEL=gpt-4o
```

**特徴**:
- 複雑なmineflayer APIの理解
- エラーハンドリングを含む堅牢なコード生成
- Minecraftゲームロジックの深い理解

**パラメータ最適化**:
- `max_tokens: 1500` - 十分なコード長を確保
- `temperature: 0.3` - 一貫性のあるコード生成

### 2. 失敗分析 (`analyzeAndImprove`)
**推奨モデル**: `gpt-4o-mini`

```bash
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
```

**特徴**:
- エラー分析は複雑なコード生成が不要
- 論理的思考とパターン認識に優れる
- コスト効率が良い

**パラメータ最適化**:
- `max_tokens: 800` - 分析結果に十分な長さ
- `temperature: 0.2` - 客観的で一貫した分析

### 3. カリキュラム生成 (`generateCurriculum`)
**推奨モデル**: `gpt-4o-mini`

```bash
OPENAI_CURRICULUM_MODEL=gpt-4o-mini
```

**特徴**:
- 教育的構造化に適している
- 創造性とコストのバランス
- 多様性のある学習計画生成

**パラメータ最適化**:
- `max_tokens: 1000` - 詳細なカリキュラム生成
- `temperature: 0.7` - 創造性とバランス

---

## 🎛️ 設定パターン

### 高性能設定（品質重視）
```bash
# 最高品質を求める場合
OPENAI_SKILL_MODEL=gpt-4o
OPENAI_ANALYSIS_MODEL=gpt-4o
OPENAI_CURRICULUM_MODEL=gpt-4o

# 推定月額コスト: $50-100
```

### バランス設定（推奨）
```bash
# 品質とコストのバランス
OPENAI_SKILL_MODEL=gpt-4o           # 重要なコード生成のみ高品質
OPENAI_ANALYSIS_MODEL=gpt-4o-mini   # 分析は効率重視
OPENAI_CURRICULUM_MODEL=gpt-4o-mini # カリキュラムも効率重視

# 推定月額コスト: $20-40
```

### コスト効率設定
```bash
# コスト重視の場合
OPENAI_SKILL_MODEL=gpt-4o-mini
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
OPENAI_CURRICULUM_MODEL=gpt-4o-mini

# 推定月額コスト: $10-20
```

### シンプル設定
```bash
# 全て同じモデルを使用
OPENAI_MODEL=gpt-4o-mini

# 最もシンプルで安価
```

---

## 💰 コスト管理

### 料金体系（2024年現在）
- **gpt-4o**: 入力$0.0050/1K、出力$0.0150/1K
- **gpt-4o-mini**: 入力$0.000150/1K、出力$0.000600/1K

### 使用量制限設定
1. OpenAI Platformにログイン
2. **Settings** → **Billing** → **Usage limits**
3. 月額制限を設定（例：$25）
4. 使用量アラートを設定（80%で通知）

### コスト削減テクニック
```bash
# 1. 不要なAI機能を無効化
DISABLE_AI_LEARNING=true

# 2. ローカルスキルを優先使用
PREFER_LOCAL_SKILLS=true

# 3. リクエスト頻度を制限
AI_REQUEST_COOLDOWN=5000  # 5秒間隔
```

---

## 📈 パフォーマンス最適化

### レスポンス時間改善
```javascript
// タイムアウト設定
const timeout = {
  'gpt-4o': 10000,        // 10秒
  'gpt-4o-mini': 5000     // 5秒
};

// 並列処理の活用
Promise.allSettled([
  analyzeTask(task),
  generateAlternatives(task)
]);
```

### レート制限対策
```javascript
// 指数バックオフでリトライ
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        await new Promise(resolve => 
          setTimeout(resolve, Math.pow(2, i) * 1000)
        );
        continue;
      }
      throw error;
    }
  }
};
```

---

## 🔧 環境別設定

### 開発環境
```bash
# 開発時はコスト重視
OPENAI_SKILL_MODEL=gpt-4o-mini
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
OPENAI_CURRICULUM_MODEL=gpt-4o-mini
DEBUG_MODE=true
```

### 本番環境
```bash
# 本番は品質重視
OPENAI_SKILL_MODEL=gpt-4o
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
OPENAI_CURRICULUM_MODEL=gpt-4o-mini
DEBUG_MODE=false
```

### 研究・実験環境
```bash
# 最高品質でデータ収集
OPENAI_SKILL_MODEL=gpt-4o
OPENAI_ANALYSIS_MODEL=gpt-4o
OPENAI_CURRICULUM_MODEL=gpt-4o
COLLECT_METRICS=true
```

---

## 🛠️ トラブルシューティング

### よくあるエラーと対策

#### API Key無効
```
Error: Incorrect API key provided
```
**対策**: 
- APIキーが正しく設定されているか確認
- `.env`ファイルのスペースや改行をチェック

#### レート制限
```
Error: Rate limit exceeded
```
**対策**: 
- リクエスト間隔を調整
- より高いTierのAPIプランに変更

#### モデル不正
```
Error: Model gpt-4o does not exist
```
**対策**: 
- モデル名のスペルを確認
- 利用可能なモデルリストを確認

#### quota超過
```
Error: You exceeded your current quota
```
**対策**: 
- 使用量制限を確認
- 支払い情報を更新

### デバッグツール

#### モデル可用性確認
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  | jq '.data[].id' | grep gpt-4
```

#### 使用量確認
```bash
curl https://api.openai.com/v1/usage \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

#### ログ分析
```bash
# OpenAI関連のログのみ表示
grep "OpenAI" logs/minecraft-ai.log

# エラーログの確認
grep "Error.*OpenAI" logs/minecraft-ai.log
```

---

## 📊 監視とモニタリング

### 使用量追跡
```javascript
// ログに使用量を記録
console.log(`Model: ${model}, Tokens: ${response.usage.total_tokens}`);
console.log(`Estimated cost: $${estimateCost(response.usage)}`);

// 月次サマリー
const monthlySummary = {
  totalRequests: 1250,
  totalTokens: 45000,
  estimatedCost: 12.50,
  averageResponseTime: 2.3
};
```

### アラート設定
```javascript
// コスト上限アラート
if (monthlyCost > COST_LIMIT) {
  console.warn(`⚠️ Monthly cost exceeded: $${monthlyCost}`);
  // 自動的にAI機能を無効化
  process.env.DISABLE_AI_LEARNING = 'true';
}

// レスポンス時間監視
if (responseTime > 10000) {
  console.warn(`⚠️ Slow response: ${responseTime}ms`);
}
```

---

## 🔐 セキュリティ注意事項

### APIキー管理
- `.env` ファイルを `.gitignore` に追加済み
- APIキーを公開リポジトリにコミットしない
- 定期的にキーをローテーション（3-6ヶ月）
- 使用量を定期的に監視

### 本番環境での設定
```bash
# 環境変数での設定（推奨）
export OPENAI_API_KEY="sk-proj-..."

# またはシークレット管理サービス
kubectl create secret generic openai-secret \
  --from-literal=api-key="sk-proj-..."
```

---

## 🎯 AI機能の動作

OpenAI APIが設定されると以下の機能が有効になります：

### 1. 動的スキル生成
未知のタスクに対してJavaScriptコードを自動生成
```javascript
// 例：カスタムブロック設置タスク
const skill = await voyagerAI.generateSkill({
  type: 'place_pattern',
  params: { pattern: 'circle', radius: 5 }
}, context);
```

### 2. 経験学習
失敗から学んで改善提案を生成
```javascript
// 失敗分析と改善提案
const analysis = await voyagerAI.analyzeAndImprove(
  failedTask, 
  errorResult, 
  context
);
```

### 3. カリキュラム生成
プレイヤーの状況に応じた学習プログラムを自動作成
```javascript
// 段階的学習プログラム
const curriculum = await voyagerAI.generateCurriculum(
  playerState, 
  achievements
);
```

### 4. パターン分析
行動パターンの最適化と推奨
```javascript
// 行動パターン分析
const optimization = await voyagerAI.optimizeBehavior(
  behaviorHistory
);
```

---

## ✨ まとめ

適切なOpenAI設定により、Minecraft AI Playerは：

- **高品質なコード生成**: gpt-4oによる堅牢なスキル
- **効率的な分析**: gpt-4o-miniによるコスト最適化
- **柔軟な学習**: タスクに応じた適応的AI
- **コスト管理**: 予算内での最大パフォーマンス

API未設定でも基本機能は動作しますが、OpenAI設定により真の自律的AI体験を実現できます。