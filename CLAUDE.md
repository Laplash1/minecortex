# CLAUDE.md

このファイルは、このリポジトリでコード作業を行う際のClaude Code (claude.ai/code) への指針を提供します。

## プロジェクト概要

これは、自律的なMinecraftゲームプレイのためのインテリジェントボットを作成するMinecraft AIプレイヤープロジェクトです。システムは、mineflayer（Minecraftボットフレームワーク）とVoyagerインスパイアなAI機能を組み合わせて、スキル生成、学習、適応行動を実現します。

## 開発コマンド

### AIプレイヤーの開始
```bash
npm start                     # デフォルト設定でシングルボットを開始
npm run dev                   # デバッグモードを有効にして開始
node index.js <username>      # カスタムユーザー名で開始
```

### マルチプレイヤー操作
```bash
npm run multi-server          # 複数サーバーに接続
npm run multi-players         # 1つのサーバーで複数ボットを実行
npm run advanced-multi        # 設定ファイルを使用した高度なマルチプレイヤー
npm run squad                 # 5体のAIプレイヤーをデプロイ
npm run army                  # 10体のAIプレイヤーをデプロイ
npm run config-squad          # players-config.jsonを使用してデプロイ
```

### テスト
```bash
npm test                      # 基本設定テストを実行
npm run test:ai               # AI学習検証テストを実行
```

## アーキテクチャ

### コアシステムコンポーネント

**MinecraftAI** (`src/MinecraftAI.js`)
- 全サブシステムを統括するメインAIコントローラー
- AIライフサイクルを管理：初期化 → メインループ → タスク実行
- チャットコマンドを処理（`!status`, `!goto`, `!follow`, `!stop`, `!learn`, `!curriculum`）
- TaskPlanner、SkillLibrary、EnvironmentObserver、VoyagerAI間の調整

**VoyagerAI** (`src/VoyagerAI.js`)
- OpenAI駆動のスキル生成と学習システム
- タスク要件に基づいて新しいスキルのJavaScriptコードを生成
- タスク実行結果から学習し、経験履歴を維持
- スキル開発のための段階的学習カリキュラムを作成
- OpenAIが利用できない場合は基本スキルにフォールバック

**SkillLibrary** (`src/SkillLibrary.js`)
- 再利用可能なボット行動のコレクション（移動、相互作用、サバイバル）
- `execute(bot, params)`メソッドを持つベース`Skill`クラス
- 事前構築スキル：移動（`move_to`, `follow`, `explore`）、相互作用（`mine_block`, `place_block`, `attack_entity`）、サバイバル（`gather_wood`, `find_food`）
- 拡張可能なスキル登録システム

**TaskPlanner** (`src/TaskPlanner.js`)
- 高レベルの目標をパラメータ付きの実行可能タスクに変換
- タスクの前提条件と依存関係を処理
- タイムアウト管理を使用したタスク完了追跡
- 基本サバイバルタスクとAI生成カリキュラムタスクをサポート

**EnvironmentObserver** (`src/EnvironmentObserver.js`)
- ゲーム状態、近くのエンティティ、ブロック、インベントリの継続的監視
- 危険検出（敵対MOB、低体力/食料、天候）
- 資源機会の特定
- 学習コンテキストのための観察履歴

**InventoryUtils** (`src/InventoryUtils.js`) - v1.2.7新機能
- 共通インベントリ計算機能を提供する統一ユーティリティクラス
- 重複コード削除とパフォーマンス最適化のため新規作成
- 主要機能：木材/石材カウント、プランク変換計算、ツール所持判定
- 全コンポーネントで使用される一貫したAPI提供
- エラーハンドリングとnull安全性を内蔵

### AI学習ループ
1. **観察**：EnvironmentObserverがワールド状態を監視
2. **計画**：TaskPlannerが目標を実行可能タスクに変換
3. **実行**：SkillLibraryがタスク行動を実行
4. **学習**：VoyagerAIが結果を分析し改善

### マルチプレイヤーアーキテクチャ

**設定駆動デプロイメント**
- `config/players-config.json`：最大10のAIパーソナリティを定義（探索者、採掘者、建築者、農家、警備員など）
- 各パーソナリティは異なる目標、行動パターン、リスク許容度を持つ
- スタガードスポーン遅延でサーバー負荷を防止

**マルチサーバーサポート**
- `examples/multi-server.js`：複数のMinecraftサーバーへの接続管理
- 指数バックオフによる自動再接続
- インスタンス毎のステータス監視とグレースフルシャットダウン

## 重要なパターン

### スキル開発
新しいスキルを追加する際は、ベース`Skill`クラスパターンに従ってください：
```javascript
class MySkill extends Skill {
  constructor() {
    super('my_skill', 'Description');
  }
  
  async execute(bot, params) {
    try {
      // mineflayer bot APIを使用した実装
      return { success: true, result: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
```

### タスク計画
TaskPlannerは目標を以下の構造でタスクに変換します：
```javascript
{
  type: 'skill_name',
  params: { /* スキルパラメータ */ },
  priority: 1-10,
  timeout: Date.now() + milliseconds,
  prerequisites: [/* 依存タスク */]
}
```

## 環境変数

```bash
# Minecraft接続
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=AIPlayer
MINECRAFT_AUTH=offline

# OpenAI統合（オプション）
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4o-mini
OPENAI_SKILL_MODEL=gpt-4o
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
OPENAI_CURRICULUM_MODEL=gpt-4o-mini

# ボット設定
DEBUG_MODE=true
AUTO_RESPAWN=true
MULTIPLE_PLAYERS_COUNT=5
```

## 重要な依存関係

- **mineflayer**：コアMinecraftボット機能
- **mineflayer-pathfinder**：ナビゲーションと移動
- **openai**：AIスキル生成（オプション）
- **dotenv**：環境変数管理

## テスト戦略

プロジェクトには、AI学習と設定検証のための検証テストが含まれています。AIコンポーネントを変更する際は、`npm run test:ai`を実行して学習システムが正しく機能することを確認してください。

## チャットコマンド

ボットはゲーム内コマンドに応答します：
- `!status` - 体力、食料、位置レポート
- `!goto <x> <y> <z>` - 座標に移動
- `!follow <player>` - プレイヤーを追跡
- `!stop` - 現在のタスクを停止
- `!learn` - 学習統計を表示
- `!curriculum` - 新しいAIカリキュラムを生成

## スキルと機能

AIシステムは、探索、資源収集、道具製作、基本サバイバル、社会的相互作用を含む自律的行動をサポートします。Voyagerインスパイアな学習システムにより、経験を通じてスキルを向上させ、GPT-4を使用して新しい機能を生成できます。

## 開発ルール

## 開発日誌を作成すること

`dev_daily/yyyy-mm-dd_hhmm.md`の形式で開発日誌を作成してください。内容は以下のとおりです。

- **日付**: yyyy-mm-dd hh:mm
- **作業内容**:
  - 何をしたか
  - どのような問題が解決したか
  - どのように解決したか
- **次回の予定**:

- **感想**: 開発の進捗や学び
- **気分**: 思ったことを評価しないので素直に書いて
- **愚痴**: 思ったことを評価しないので素直に書いて

### 変更記録ルール（必須遵守）

このプロジェクトでは、すべての変更について以下のルールを厳格に遵守する必要があります：

#### 1. 変更記録の作成義務
- 何らかのファイル変更を行った場合、必ずCHANGELOG.mdに記録する
- 変更が軽微であっても記録を省略してはならない
- セッション終了前に必ず変更記録を更新する

#### 2. 記録フォーマット
各変更について以下の情報を必ず含める：

```markdown
#### ファイル名
**変更内容**: [具体的な変更内容]
**変更意図**: [なぜこの変更が必要だったか]
**期待効果**: [この変更により何が改善されるか]
```

#### 3. 記録すべき変更の範囲
- 新規ファイルの作成
- 既存ファイルの修正（1行でも）
- ファイルの削除
- 設定の変更
- 依存関係の追加・変更

#### 4. 変更意図の記録
技術的な「何を」だけでなく、「なぜ」を重視して記録する：
- 問題解決のため
- 機能向上のため  
- ユーザー要求への対応
- 保守性向上のため
- パフォーマンス改善のため

#### 5. 日付ベースの管理
- 変更日ごとにセクションを分ける
- 日付は YYYY-MM-DD フォーマットを使用
- 複数日にわたる場合は各日付で区分

#### 6. 影響範囲の明記
変更が他の部分に与える影響についても記録：
- 破壊的変更の有無
- 他ファイルへの影響
- 動作への影響
- 設定変更の必要性

#### 7. 変更記録の確認
- セッション中に変更記録を定期的に更新
- セッション終了前に記録の完整性を確認
- 記録漏れがないかチェックリストで確認

### コーディング規則

#### 1. エラーハンドリング
- すべての非同期関数にtry-catch文を使用
- エラーメッセージは具体的で理解しやすく
- 回復可能なエラーには回復戦略を実装

#### 2. ログ出力
- 重要な処理の開始・終了をログ出力
- ユーザーにとって有用な情報をチャット出力
- デバッグ情報とユーザー情報を区別

#### 3. 設定管理
- ハードコードされた値は設定ファイルまたは定数として分離
- 環境変数を活用した柔軟な設定
- デフォルト値の適切な設定