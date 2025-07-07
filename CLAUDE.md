# CLAUDE.md

## プロジェクト概要

**MineCortex**: mineflayerとVoyagerインスパイアなAI機能を組み合わせた、自律的なMinecraft AIボットシステム。スキル生成、学習、適応行動を実現。

- **詳細情報**: @README.md を参照
- **現在のバージョン**: v1.6.4（簡素化アーキテクチャ）
- **エントリーポイント**: `npm start` のみ

## 技術スタック

- **Node.js**: >= 16.13.0
- **mineflayer**: コアMinecraftボットフレームワーク
- **mineflayer-pathfinder**: ナビゲーションと移動
- **openai**: AIスキル生成（オプション）
- **dotenv**: 環境変数管理
- **ESLint**: コード品質管理（必須）

## コマンド

```bash
# 基本使用法
npm start                    # 5体のAIプレイヤー起動（デフォルト）
MULTIPLE_PLAYERS_COUNT=3 npm start  # プレイヤー数カスタマイズ

# コード品質（必須）
npm run lint                 # コード品質チェック
npm run lint:fix            # リント問題自動修正

# 日付ユーティリティ
date "+%F %T"               # ログ用標準日付フォーマット
```

## プロジェクト構造

```
src/
├── MinecraftAI.js          # メインAIコントローラー
├── VoyagerAI.js            # AI学習エンジン（メモリベース）
├── SkillLibrary.js         # スキル管理
├── TaskPlanner.js          # タスク分解
├── MultiPlayerCoordinator.js # マルチプレイヤー協調
├── StateManager.js         # 状態同期
└── utils/                  # 共有ユーティリティ

examples/
└── multiple-players.js     # メインエントリーポイント

config/
├── players-config.json     # プレイヤー設定
└── item-alias.json        # アイテム別名

docs/
├── guides/                 # ユーザーガイド
├── references/            # 技術リファレンス
├── development/           # 開発者リソース
└── changelogs/           # バージョン履歴
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

# ボット設定
DEBUG_MODE=true
AUTO_RESPAWN=true
MULTIPLE_PLAYERS_COUNT=5
```

## AI協調開発 - Gemini統合

### トリガーパターン
- ユーザーが「Geminiと相談しながら進めて」（または類似表現）と言った場合
- 協調分析・評価にGemini CLIを使用

### フロー
1. ユーザー要件から統合プロンプトを生成
2. Gemini CLI呼び出し: `gemini <<EOF $PROMPT EOF`
3. GeminiのレスポンスとClaudeの分析を提示
4. 両AIの視点を統合して最適解を導出

## コアパターン

### スキル開発
```javascript
class MySkill extends Skill {
  constructor() {
    super('my_skill', 'Description');
  }
  
  async execute(bot, params) {
    try {
      // mineflayer bot APIを使用
      return { success: true, result: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
```

### タスク計画構造
```javascript
{
  type: 'skill_name',
  params: { /* スキルパラメータ */ },
  priority: 1-10,
  timeout: Date.now() + milliseconds,
  prerequisites: [/* 依存タスク */]
}
```

## ゲーム内コマンド

- `!status` - 体力、食料、位置レポート
- `!goto <x> <y> <z>` - 座標に移動
- `!follow <player>` - プレイヤーを追跡
- `!stop` - 現在のタスクを停止
- `!learn` - 学習統計を表示
- `!curriculum` - 新しいAIカリキュラムを生成

## コードスタイル・品質

### ESLint - 必須使用
- **開発前**: 新機能実装前に `npm run lint` を実行
- **コミット前**: すべてのクリティカルエラーを解決
- **新規ファイル**: 作成時からESLintルールに準拠
- **系統的アプローチ**: 重要度別に問題を分類（エラー > 警告 > その他）

### コーディング規約
- **エラーハンドリング**: すべての非同期関数でtry-catchを使用
- **ログ出力**: 重要な操作をログ記録、デバッグとユーザー情報を区別
- **設定管理**: ハードコーディングを避け、環境変数を使用
- **未使用パラメータ**: アンダースコア接頭辞を使用（`_params`, `_context`）

### セキュリティパターン
- **非同期安全性**: 適切な `async/await` または `.then()/.catch()` チェーンを使用
- **プロパティアクセス**: プロトタイプ汚染対策で `Object.prototype.hasOwnProperty.call()` を使用
- **Function constructor**: 必要時のみ明示的ESLint例外で使用

## ドキュメント要件

### 開発日誌
- **フォーマット**: `dev_daily/yyyy-mm-dd_hhmm.md`
- **内容**: 日付、作業内容、解決した問題、次のステップ、感想、愚痴
- **ルール**: 毎回新規ファイル作成、過去エントリの変更・削除禁止

### 変更ログ
- **フォーマット**: `/docs/CHANGELOG_$version.md`
- **要件**: すべての変更を記録（軽微でも）
- **内容**: ファイル名、変更詳細、意図、期待効果
- **範囲**: 新規ファイル、変更、削除、設定変更、依存関係

### フォーマットテンプレート
```markdown
#### ファイル名
**変更内容**: [具体的な変更詳細]
**変更意図**: [なぜこの変更が必要だったか]
**期待効果**: [この変更により何が改善されるか]
```

## リポジトリエチケット

### コミットプロセス
- コミット前に `npm run lint` を実行
- セッション終了前にCHANGELOGを更新
- コミットに変更記録を含める
- 説明的なコミットメッセージを使用

### 「触ってはいけない」リスト
- 過去の開発日誌エントリ
- 完了済みの変更ログエントリ
- 議論なしでのコアアーキテクチャ変更

