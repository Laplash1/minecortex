# MineCortex v1.5.0 ユーザーガイド

🧠 **MineCortex v1.5.0** の完全なユーザー向け使用方法ガイドです。簡素化されたプロジェクト構造で、より使いやすくなりました。

## 🚨 v1.5.0 重要アップデート
このバージョンではプロジェクト構造が大幅に簡素化されました：
- **npm startのみ**: 単一コマンドで複数AIプレイヤーが起動
- **不要ファイル削除**: tests/, training/, scripts/等を削除
- **コード品質**: ESLintによる品質管理を維持
- **メンテナンス性**: ドキュメント構造を整理・最新化

## 📋 目次
- [初期設定](#初期設定)
- [基本的な使い方](#基本的な使い方)
- [マルチプレイヤー機能](#マルチプレイヤー機能)
- [チャットコマンド](#チャットコマンド)
- [AI機能の活用](#ai機能の活用)
- [カスタマイズ](#カスタマイズ)
- [トラブルシューティング](#トラブルシューティング)
- [実践シナリオ](#実践シナリオ)
- [パフォーマンス最適化](#パフォーマンス最適化)

---

## 🚀 初期設定

### 前提条件
- **Node.js**: v16.13.0以上
- **Minecraft Java Edition**: 1.8〜1.21対応
- **Minecraftサーバー**: ローカル/リモート両対応

### クイックスタート
```bash
# 1. 依存関係インストール
npm install

# 2. 設定ファイル作成
touch .env

# 3. 基本設定（.envを編集）
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=AIPlayer
MINECRAFT_AUTH=offline

# 4. MineCortex起動（5体のAIプレイヤーが協調動作）
npm start
```

---

## 🎮 基本的な使い方

### MineCortex起動方法

#### 標準起動（推奨）
```bash
# 5体のAIプレイヤーでマルチプレイヤー協調システム起動
npm start

# プレイヤー数をカスタマイズ
MULTIPLE_PLAYERS_COUNT=3 npm start     # 3体で起動
MULTIPLE_PLAYERS_COUNT=10 npm start    # 10体で起動

# デバッグモードで起動
DEBUG_MODE=true npm start
```

#### 環境変数による設定変更
```bash
# サーバー設定変更
MINECRAFT_HOST=192.168.1.100 npm start

# 複数設定の組み合わせ
MULTIPLE_PLAYERS_COUNT=3 DEBUG_MODE=true npm start
```

### 環境設定の詳細

#### 必須設定
```bash
# .env ファイルの基本設定
MINECRAFT_HOST=localhost        # サーバーアドレス
MINECRAFT_PORT=25565           # サーバーポート
MINECRAFT_USERNAME=AIPlayer    # ボット名
MINECRAFT_AUTH=offline         # 認証方式
```

#### オプション設定
```bash
# マルチプレイヤー設定
MULTIPLE_PLAYERS_COUNT=5     # AIプレイヤー数（デフォルト: 5）

# デバッグ・運用設定
DEBUG_MODE=true              # 詳細ログ表示
AUTO_RESPAWN=true           # 自動リスポーン

# AI設定（オプション）
OPENAI_API_KEY=your-key     # OpenAI API使用時
OPENAI_MODEL=gpt-4o-mini    # 使用モデル
OPENAI_SKILL_MODEL=gpt-4o   # スキル生成モデル
```

---

## 👥 マルチプレイヤー機能

### プリセット起動コマンド

```bash
# 3人のAIプレイヤー（デフォルト）
npm run multi-players

# 5人チーム
npm run squad

# 10人軍団
npm run army

# 設定ファイルベース（高度な設定）
npm run advanced-multi

# 設定ファイルから5人チーム
npm run config-squad

# 複数サーバー同時接続
npm run multi-server
```

### マルチプレイヤー設定

#### 環境変数方式（簡単）
```bash
# 同時起動するプレイヤー数
MULTIPLE_PLAYERS_COUNT=5

# 起動間隔（サーバー負荷軽減）
SPAWN_DELAY=3000

# 個別プレイヤー設定
PLAYER1_USERNAME=ExplorerBot
PLAYER2_USERNAME=MinerBot
PLAYER3_USERNAME=BuilderBot
PLAYER4_USERNAME=FarmerBot
PLAYER5_USERNAME=GuardBot
```

#### 設定ファイル方式（詳細制御）
`config/players-config.json`:
```json
{
  "players": [
    {
      "id": "explorer",
      "username": "ExplorerAI",
      "personality": "explorer",
      "goals": ["explore", "map_terrain"],
      "enabled": true
    },
    {
      "id": "miner", 
      "username": "MinerAI",
      "personality": "miner",
      "goals": ["gather_resources", "mine_ores"],
      "enabled": true
    }
  ]
}
```

### AIパーソナリティ

各AIプレイヤーは異なる専門性を持ちます：

| パーソナリティ | 専門分野 | 行動パターン |
|-------------|----------|-------------|
| **explorer** | 探索 | 新エリア発見、マッピング |
| **miner** | 採掘 | 鉱石収集、地下探索 |
| **builder** | 建築 | 構造物建設、都市計画 |
| **farmer** | 農業 | 食料生産、動物管理 |
| **guard** | 警備 | エリア保護、敵排除 |
| **collector** | 収集 | アイテム収集、倉庫管理 |
| **scout** | 偵察 | 広範囲探索、情報収集 |
| **crafter** | 製作 | アイテム製作、技術開発 |
| **trader** | 交易 | 村人取引、経済活動 |
| **helper** | 支援 | 他プレイヤーサポート |

---

## 💬 チャットコマンド

ボットはゲーム内チャットコマンドに応答します。

### 基本コマンド

#### 状態確認
```
!status          # 体力、食料、位置情報
!inventory       # インベントリ内容
!skills          # 利用可能スキル一覧
!goals          # 現在の目標
```

#### 移動制御
```
!goto <x> <y> <z>    # 指定座標に移動
!goto <x> <z>        # Y座標自動（地表）
!follow <player>     # プレイヤーを追跡
!stop               # 現在の行動を停止
!come               # コマンド発言者の元へ
```

#### タスク制御
```
!task <task_name>    # 特定タスクを実行
!learn              # 学習状況表示
!curriculum         # AIカリキュラム生成
!reset              # タスクリセット
```

### 高度なコマンド

#### AI学習・分析
```
!analyze            # 現在状況の分析
!optimize           # 行動パターン最適化
!experiment <type>  # 実験モード開始
!stats              # 詳細統計表示
```

#### マルチプレイヤー協調
```
!coord              # 協調状況表示
!claim <x> <y> <z> <type>  # リソース要求
!release            # リソース要求解除
!team <command>     # チーム操作
```

#### デバッグ・メンテナンス
```
!debug              # デバッグモード切替
!log <level>        # ログレベル変更
!memory             # メモリ使用量
!performance        # パフォーマンス統計
!restart            # ソフト再起動
```

### 使用例
```
プレイヤー: !goto 100 70 200
ボット: 座標 (100, 70, 200) に移動中...

プレイヤー: !follow Steve
ボット: Steveを追跡開始します

プレイヤー: !status
ボット: 体力 20/20, 食料 18/20, 位置 (102, 71, 203)

プレイヤー: !task gather_wood
ボット: 木材収集タスクを開始します
```

---

## 🤖 AI機能の活用

### OpenAI連携（オプション）

#### 設定
```bash
# OpenAI API設定
OPENAI_API_KEY=your-api-key-here
OPENAI_SKILL_MODEL=gpt-4o           # スキル生成用
OPENAI_ANALYSIS_MODEL=gpt-4o-mini   # 分析用
OPENAI_CURRICULUM_MODEL=gpt-4o-mini # カリキュラム用
```

#### 機能
1. **動的スキル生成**: 未知のタスクに対するコード自動生成
2. **経験学習**: 失敗から学習し改善提案
3. **カリキュラム生成**: 段階的学習プログラム作成
4. **行動分析**: パターン分析と最適化

### 学習システム

#### 学習データの蓄積
```bash
# 学習データ確認
!learn

# 出力例
学習状況: 47回の経験、成功率 78%
最近の改善: 木材収集効率 +23%
推奨次ステップ: 石器ツール作成を学習
```

#### カリキュラム自動生成
```bash
# AIによる学習プログラム生成
!curriculum

# 生成される例
=== AI生成カリキュラム ===
1. 基本サバイバル (完了)
2. 道具製作 (進行中)
3. 農業システム (推奨次)
4. 建築技術 (未来)
5. レッドストーン回路 (上級)
```

---

## ⚙️ カスタマイズ

### 行動パターンのカスタマイズ

#### 目標設定
```javascript
// CLAUDE.md の開発ガイドラインに従って
// カスタム目標を設定可能

const customGoals = [
  { type: 'build_house', priority: 1 },
  { type: 'create_farm', priority: 2 },
  { type: 'explore_caves', priority: 3 }
];
```

#### スキルの追加
```javascript
// カスタムスキルの追加例
class CustomMiningSkill extends Skill {
  constructor() {
    super('custom_mining', 'カスタム採掘スキル');
  }
  
  async execute(bot, params) {
    // カスタム採掘ロジック
    return { success: true, mined: 10 };
  }
}
```

### 設定のテンプレート

#### 初心者向け設定
```bash
# .env - 初心者向け
MINECRAFT_HOST=localhost
MINECRAFT_AUTH=offline
DEBUG_MODE=true
AUTO_RESPAWN=true
OPENAI_API_KEY=  # 空欄（基本機能のみ）
```

#### 上級者向け設定
```bash
# .env - 上級者向け
MINECRAFT_HOST=your-server.com
MINECRAFT_AUTH=microsoft
DEBUG_MODE=false
OPENAI_API_KEY=your-key
MULTIPLE_PLAYERS_COUNT=10
```

---

## 🔧 トラブルシューティング

### よくある問題と解決策

#### 1. 接続できない
```
Error: connect ECONNREFUSED
```
**解決策**:
- Minecraftサーバーが起動しているか確認
- ホスト・ポート設定を確認
- ファイアウォール設定を確認

#### 2. 認証エラー
```
Error: Invalid session
```
**解決策**:
- Microsoft認証の場合：ライセンス確認
- オフライン認証への変更を検討
- 認証キャッシュのクリア

#### 3. ボットが動かない
```
ボットがスポーン後に行動しない
```
**解決策**:
- `!status` で状態確認
- `!debug` でデバッグモード有効化
- ログファイルの確認

#### 4. メモリ不足
```
FATAL ERROR: Ineffective mark-compacts
```
**解決策**:
- Node.jsメモリ制限増加：`--max-old-space-size=2048`
- 不要なプロセス終了
- システムリソース確認

### デバッグ手順

#### 1. ログ確認
```bash
# リアルタイムログ確認
tail -f logs/minecraft-ai.log

# エラーログのみ
grep "ERROR" logs/minecraft-ai.log

# 特定期間のログ
grep "2025-06-21" logs/minecraft-ai.log
```

#### 2. システム状態確認
```bash
# プロセス確認
ps aux | grep node

# メモリ使用量
free -h  # Linux
vm_stat  # macOS

# ネットワーク接続
netstat -tuln | grep 25565
```

#### 3. 設定確認
```bash
# 環境変数確認
printenv | grep MINECRAFT

# 設定ファイル確認
cat .env | grep -v "^#"

# Node.jsバージョン確認
node --version
npm --version
```

---

## 🎯 使用例・シナリオ

### シナリオ1: 初回セットアップ
```bash
# 1. プロジェクトセットアップ
git clone <repository>
cd minecraft-ai-player
npm install

# 2. ローカルサーバー用設定
cp .env.example .env
# .envを編集: MINECRAFT_AUTH=offline

# 3. 起動・確認
npm start
# ゲーム内で !status コマンドを実行
```

### シナリオ2: マルチプレイヤー運用
```bash
# 1. プレイヤー設定
export MULTIPLE_PLAYERS_COUNT=5

# 2. チーム起動
npm run squad

# 3. 協調動作確認
# ゲーム内で !coord コマンドを実行
```

### シナリオ3: AI学習実験
```bash
# 1. OpenAI設定
echo "OPENAI_API_KEY=your-key" >> .env

# 2. 学習モード起動
DEBUG_MODE=true npm start

# 3. 学習進行確認
# ゲーム内で !learn, !curriculum コマンドを実行
```

### シナリオ4: 本番サーバー運用
```bash
# 1. 本番設定
MINECRAFT_HOST=your-server.com
MINECRAFT_AUTH=microsoft
DEBUG_MODE=false

# 2. サービス化
pm2 start index.js --name minecraft-ai

# 3. 監視設定
pm2 monit
```

---

## 📊 パフォーマンス最適化

### リソース使用量

| プレイヤー数 | CPU使用率 | メモリ使用量 | 推奨環境 |
|-------------|-----------|-------------|----------|
| 1人 | 5-10% | 100MB | 最小環境 |
| 5人 | 15-25% | 500MB | 推奨環境 |
| 10人 | 30-50% | 1GB | 高性能環境 |

### 最適化設定
```bash
# メモリ制限設定
node --max-old-space-size=1024 index.js

# PM2でのプロセス管理
pm2 start index.js --max-memory-restart 500M

# Docker環境での制限
docker run --memory=512m minecraft-ai-player
```

---

## ✨ 高度な活用法

### カスタムプラグイン開発
```javascript
// プラグイン例: 自動農場管理
class AutoFarmPlugin {
  constructor(bot) {
    this.bot = bot;
    this.farmTasks = [];
  }
  
  async manageFarm() {
    // 自動種まき・収穫ロジック
  }
}
```

### API連携
```javascript
// 外部APIとの連携例
const discordBot = require('./discord-integration');

bot.on('message', (message) => {
  discordBot.sendToChannel(message);
});
```

### データ分析
```bash
# ログ分析例
grep "タスク完了" logs/minecraft-ai.log | wc -l  # 完了タスク数
grep "探索" logs/minecraft-ai.log | tail -10     # 最近の探索ログ
```

---

## 🎯 実践シナリオ

### シナリオ1: 初期サバイバル支援
```bash
# ボット起動後の自動行動
1. 木材収集 (20個)
2. 作業台作成
3. 木製道具一式作成
4. 食料確保
5. 簡易シェルター建設
```

### シナリオ2: プレイヤーサポート
```
!follow YourName          # プレイヤーに追従
!goto 150 64 300         # 指定地点で待機
# 自動的に周辺の資源を収集
```

### シナリオ3: 探索ミッション
```
# 自動探索モード
- 半径100ブロック内を系統的に探索
- 鉱石や構造物を発見時に報告
- 危険回避とマッピング
```

### シナリオ4: 学習・実験
```
!curriculum              # 新しい挑戦課題を生成
# AI が提案するタスク例:
- 地下鉱山の開発
- 自動農場の建設
- エンチャント装備の作成
```

### シナリオ5: 複数プレイヤー協調
```bash
# 複数プレイヤー起動
npm run squad

# 協調動作確認
!coord
!claim 100 64 200 wood    # リソース要求
!team status              # チーム状況確認
```

---

## 📊 パフォーマンス最適化

### システム要件とベンチマーク

| プレイヤー数 | CPU使用率 | メモリ使用量 | 推奨環境 |
|-------------|-----------|-------------|----------|
| 1人 | 5-10% | 100MB | 最小環境 |
| 5人 | 15-25% | 500MB | 推奨環境 |
| 10人 | 30-50% | 1GB | 高性能環境 |

### 監視すべき指標
- **タスク成功率**: 80%以上が目標
- **レスポンス時間**: 平均2秒以下
- **リソース使用量**: CPU 10%以下、メモリ 100MB以下（シングル）
- **API使用量**: 1日あたり1000リクエスト以下

### 最適化設定
```bash
# メモリ制限設定
node --max-old-space-size=1024 index.js

# PM2でのプロセス管理
pm2 start index.js --max-memory-restart 500M

# Docker環境での制限
docker run --memory=512m minecraft-ai-player
```

### パフォーマンス改善のコツ
1. **不要なAI機能を無効化**
2. **基本スキルを優先使用**
3. **バッチ処理でAPI効率化**
4. **定期的な設定見直し**

### ログ分析とモニタリング
```bash
# 行動パターン分析
grep "Task completed" logs/*.log | wc -l

# 成功率計算
grep -c "success: true" logs/*.log

# CPU/メモリ使用量確認
top -p $(pgrep -f "node index.js")

# ネットワーク負荷確認
netstat -i
```

---

## 🛡️ セキュリティとベストプラクティス

### セキュリティ注意事項
- APIキーの漏洩防止
- サーバーアクセス権限の適切な設定
- ログファイルの定期的なクリーンアップ
- 不正使用の監視

### 認証情報の保護
```bash
# ファイル権限設定
chmod 600 .env
chmod 700 nmp-cache/
chmod 700 minecraft_profiles/

# 環境変数での管理
export MINECRAFT_USERNAME="YourUser"
export MINECRAFT_AUTH="microsoft"
```

---

## 📞 サポート・コミュニティ

- **Issues**: GitHub Issues報告
- **Documentation**: プロジェクト内ドキュメント
- **Examples**: 使用例とサンプルコード
- **Technical Reference**: TECHNICAL_REFERENCE.md

---

**🎉 これでMineCortexを最大限活用できます！**

このガイドに従って、MineCortexを効果的に活用してください。さらに詳しい技術情報は、プロジェクト内の他のドキュメントを参照してください。