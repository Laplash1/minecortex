# MineCortex v1.6.4

**mineflayer**（Minecraft操作用）と**Voyager**インスパイアなAI機能（インテリジェントな計画と学習）を組み合わせた、知的なMinecraftボット群です。

> 🧠 **MineCortex** = **Mine**（採掘/私の）+ **Cortex**（大脳皮質）  
> あなた専用の賢いMinecraft大脳皮質システム

## 🚀 v1.6.4 大規模リファクタリング - プロジェクト構造最適化
- **プロジェクト簡素化** - `npm start` のみでの完全動作、不要ファイル大量削除
- **ドキュメント体系再構築** - カテゴリ別整理による発見性向上
- **ESLint品質管理** - コード品質保証の継続
- **Gemini協調評価** - AI協調による客観的品質確認システム
- **マルチプレイヤー協調** - 5体のAIプレイヤーが安定協調動作

## 🎯 簡素化された使用方法
- **単一コマンド**: `npm start` で5体のAIプレイヤーが即座に起動
- **環境変数設定**: プレイヤー数やデバッグモードを柔軟にカスタマイズ
- **コード品質**: `npm run lint` による継続的な品質管理

## ディレクトリ構成

```
minecortex/
├── README.md                      # このファイル
├── package.json                   # プロジェクト設定（簡素化済み）
├── examples/
│   └── multiple-players.js       # メインエントリーポイント（npm start）
├── src/                           # AIコンポーネント群
│   ├── MinecraftAI.js            # メインAIコントローラー
│   ├── VoyagerAI.js              # AI学習エンジン（メモリ内学習）
│   ├── SkillLibrary.js           # スキル管理・実行
│   ├── TaskPlanner.js            # タスク分解・計画
│   ├── MultiPlayerCoordinator.js # 複数プレイヤー協調制御
│   ├── StateManager.js           # 状態管理・同期
│   ├── EnvironmentObserver.js    # 環境認識・監視
│   ├── PathfindingCache.js       # 移動最適化
│   ├── SharedEnvironment.js      # 共有環境データ
│   ├── OpenAIRequestQueue.js     # AI API制御
│   └── utils/                    # 共通ユーティリティ
│       ├── ErrorHandler.js
│       ├── Logger.js
│       └── ValidationUtils.js
├── config/                        # 設定ファイル
│   ├── players-config.json       # プレイヤー設定
│   └── item-alias.json           # アイテム別名管理
├── docs/                          # 整理済みドキュメント
│   ├── guides/                   # ユーザー向けガイド
│   ├── references/               # 技術リファレンス
│   ├── development/              # 開発者向け
│   └── changelogs/               # 変更履歴
└── logs/                          # 実行ログ
```

## 機能

### コア機能
- **自律移動**: パスファインディングを使用してMinecraftワールドをナビゲート
- **環境観察**: 周囲、エンティティ、ゲーム状態を継続的に監視
- **タスク計画**: インテリジェントなタスク分解と実行
- **スキルライブラリ**: 拡張可能な再利用可能な行動のコレクション
- **学習と適応**: AI駆動のスキル生成と改善

### VoyagerインスパイアなAI
- **動的スキル生成**: 必要に応じてGPT-4を使用して新しいスキルを作成
- **経験学習**: 成功と失敗から学習
- **カリキュラム生成**: 進歩的な学習タスクを自動生成
- **コンテキスト認識計画**: 環境とゲーム状態に基づいて決定を行う

### 基本スキル
- **探索**: 自律的な地域探索と地形認識
- **資源収集**: 木材、石材、その他の材料の効率的収集
- **道具作成**: 自動道具作成とレシピ管理
- **サバイバル**: 食料収集と基本的なサバイバル行動
- **社会的相互作用**: チャットコマンドに応答し、プレイヤーを追跡
- **🆕 マルチプレイヤー協調**: 複数ボット間でのリソース管理と役割分担

## セットアップ

### 前提条件
- Node.js >= 16.13.0
- Minecraft Java Edition 1.21サーバー（ローカルまたはリモート）
- OpenAI APIキー（オプション、高度なAI機能用）
- **新規**: minecraft-data 3.90.0対応 - Minecraft 1.21完全サポート

### インストール

1. **クローンとセットアップ**
   ```bash
   cd マインクラフト
   npm install
   ```

2. **環境設定**
   ```bash
   cp .env.example .env
   # .envファイルを設定で編集
   ```

3. **環境変数**
   ```bash
   # Minecraftサーバー
   MINECRAFT_HOST=localhost
   MINECRAFT_PORT=25565
   MINECRAFT_USERNAME=AIPlayer
   MINECRAFT_AUTH=offline

   # OpenAI（オプション）
   OPENAI_API_KEY=your_api_key_here
   OPENAI_MODEL=gpt-4o-mini

   # ボット設定
   DEBUG_MODE=true
   AUTO_RESPAWN=true
   ```

## 🚀 クイックスタート

### 基本起動
```bash
# 5体のAIプレイヤーが協調動作（推奨）
npm start

# プレイヤー数カスタマイズ
MULTIPLE_PLAYERS_COUNT=3 npm start    # 3体で起動
MULTIPLE_PLAYERS_COUNT=10 npm start   # 10体で起動

# デバッグモード
DEBUG_MODE=true npm start

# コード品質チェック（開発時）
npm run lint
npm run lint:fix
```

### チャットコマンド
ボットはMinecraftチャットのコマンドに応答します：

- `!status` - ボットのステータスを表示（体力、食料、位置）
- `!goto <x> <y> <z>` - 特定の座標に移動
- `!follow <player>` - プレイヤーを追跡
- `!stop` - 現在のタスクを停止
- `!learn` - 学習統計を表示
- `!curriculum` - 新しい学習カリキュラムを生成

### コマンド例
```
!status
!goto 100 64 200
!follow Steve
!learn
!curriculum
```

## アーキテクチャ

### コアコンポーネント

1. **MinecraftAI** (`src/MinecraftAI.js`)
   - メインAIコントローラー
   - すべてのサブシステムを調整
   - メインAIループを管理

2. **SkillLibrary** (`src/SkillLibrary.js`)
   - 再利用可能な行動のコレクション
   - 移動、相互作用、サバイバルの基本スキル
   - 拡張可能なスキルシステム

3. **TaskPlanner** (`src/TaskPlanner.js`)
   - 高レベルの目標を実行可能なタスクに変換
   - タスクの前提条件と依存関係を処理
   - タスクの完了を監視

4. **EnvironmentObserver** (`src/EnvironmentObserver.js`)
   - ゲーム状態と周囲を監視
   - エンティティ、ブロック、プレイヤーステータスを追跡
   - 意思決定のためのコンテキストを提供

5. **VoyagerAI** (`src/VoyagerAI.js`)
   - AI駆動のスキル生成
   - 経験からの学習
   - カリキュラム生成
   - OpenAI統合

6. **🆕 StateManager** (`src/StateManager.js`)
   - 状態同期と整合性管理
   - パフォーマンス追跡
   - マルチプレイヤー状態管理

7. **🆕 MultiPlayerCoordinator** (`src/MultiPlayerCoordinator.js`)
   - 複数ボット間の協調制御
   - リソース競合解決
   - 役割分担システム

### AI学習ループ

1. **観察** - 環境とゲーム状態を監視
2. **計画** - 目標に基づいて適切なタスクを選択
3. **実行** - スキルを実行してタスクを完了
4. **学習** - 結果を分析して改善

## 設定

### Minecraftサーバーセットアップ
ボットはmineflayerライブラリをサポートする任意のMinecraftサーバーで動作します：
- ローカルサーバー（バニラ、Paper、Spigot）
- リモートサーバー（適切な認証付き）
- オンラインおよびオフラインモード両方対応

### OpenAI統合
高度なAI機能のため、OpenAI APIを設定：
- 新しいタスクのスキル生成
- 経験からの学習
- カリキュラム開発
- パターン分析と改善

## ボットの拡張

### 新しいスキルの追加
```javascript
// SkillLibrary.js内
class MyCustomSkill extends Skill {
  constructor() {
    super('my_skill', 'スキルの説明');
  }

  async execute(bot, params) {
    // 実装
    return { success: true, result: '完了' };
  }
}

// スキルを登録
this.registerSkill('my_skill', new MyCustomSkill());
```

### 新しい目標の追加
```javascript
// TaskPlanner.js内
planMyGoal(goal) {
  return {
    type: 'my_skill',
    params: goal.params,
    priority: goal.priority,
    timeout: Date.now() + 60000
  };
}
```

## トラブルシューティング

### よくある問題

1. **接続失敗**
   - サーバーアドレスとポートを確認
   - サーバーが稼働中か確認
   - 認証設定を確認

2. **ボットが動かない**
   - `!stop`コマンドを使用
   - パスファインディングの問題を確認
   - 必要に応じて再起動

3. **AI機能が動作しない**
   - OpenAI APIキーを確認
   - APIレート制限を確認
   - ボットは基本スキルにフォールバック

### デバッグモード
詳細なログのためにデバッグモードを有効化：
```bash
DEBUG_MODE=true
```

## 📊 パフォーマンス

| プレイヤー数 | CPU使用率 | メモリ使用量 | 推奨環境 |
|-------------|-----------|-------------|----------|
| 3体 | 10-15% | 300MB | 最小環境 |
| 5体 | 15-25% | 416MB | 推奨環境（実測値） |
| 10体 | 30-50% | 1GB | 高性能環境 |

- **ネットワーク**: 効率的、必要なパケットのみ送信
- **学習**: メモリ内学習により高速・リアルタイム改善
- **協調システム**: 複数ボット間の効率的なリソース管理と同期制御
- **実測パフォーマンス**: イベントループ遅延平均0.67ms、最大2.26ms

## 📚 詳細ドキュメント

プロジェクトの詳細情報は以下のドキュメントを参照してください：

### ガイド
- **[インストールガイド](docs/guides/installation.md)** - 詳細なセットアップ手順
- **[ユーザーガイド](docs/guides/user_guide.md)** - 完全なユーザー使用ガイド
- **[認証設定](docs/guides/authentication.md)** - オフライン・Microsoft認証設定
- **[OpenAI設定](docs/guides/openai_setup.md)** - OpenAI API設定と最適化

### リファレンス
- **[技術リファレンス](docs/references/technical_reference.md)** - 技術アーキテクチャとAI学習詳細
- **[スキルリファレンス](docs/references/skills_reference.md)** - Minecraftスキルの詳細分析

### 開発者向け
- **[貢献ガイド](docs/development/CONTRIBUTING.md)** - 開発参加方法とコーディング規約
- **[NLU実装計画](docs/development/nlu_plan.md)** - NLU機能の実装計画

### 変更履歴
- **[変更履歴](docs/changelogs/CHANGELOG.md)** - バージョン履歴と変更記録
- **[v1.6.4](docs/changelogs/CHANGELOG_1.6.4.md)** - 大規模リファクタリング記録

## ライセンス

MITライセンス - 必要に応じてボットを自由に変更・拡張してください。

## 貢献

1. リポジトリをフォーク
2. 機能ブランチを作成
3. 変更を実装
4. `npm run lint` でコード品質確認
5. `npm start` で動作確認
6. プルリクエストを提出

詳細は[貢献ガイド](docs/development/CONTRIBUTING.md)を参照してください。

## 謝辞

- **mineflayer** - 優秀なMinecraftボットフレームワーク
- **Voyager** - AI学習アーキテクチャのインスピレーション（MITライセンス）
- **PrismarineJS** - Minecraftプロトコル実装
- **OpenAI** - インテリジェントなスキル生成のためのGPT-4

### Voyager参考資料
Voyagerプロジェクトのスキルライブラリとライセンス情報は`references/`ディレクトリに保存されています。# minecortex
