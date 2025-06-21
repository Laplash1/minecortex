# MineCortex v1.1.0

**mineflayer**（Minecraft操作用）と**Voyager**インスパイアなAI機能（インテリジェントな計画と学習）を組み合わせた、知的なMinecraftボット群です。

> 🧠 **MineCortex** = **Mine**（採掘/私の）+ **Cortex**（大脳皮質）  
> あなた専用の賢いMinecraft大脳皮質システム

## 🎉 v1.1.0の新機能
- **マルチプレイヤー協調システム** - 最大10体のAIボットが連携
- **コード品質向上** - null安全性とエラーハンドリング強化
- **関数リファクタリング** - 保守性とテスト性の向上
- **統合ドキュメント** - 一元化された使いやすいドキュメント構成

## ディレクトリ構成

```
mc-ai/
├── README.md                 # このファイル
├── index.js                  # メインエントリーポイント
├── package.json              # プロジェクト設定
├── src/                      # メインソースコード
│   ├── MinecraftAI.js       # メインAIコントローラー
│   ├── VoyagerAI.js         # AI学習エンジン
│   ├── SkillLibrary.js      # スキル管理
│   └── ...
├── docs/                     # ドキュメント
│   ├── USER_GUIDE.md        # 完全なユーザーガイド
│   ├── SETUP_AND_INSTALLATION.md  # セットアップ・インストール
│   ├── AUTHENTICATION_GUIDE.md    # 認証設定
│   ├── OPENAI_CONFIGURATION.md    # OpenAI設定・最適化
│   ├── TECHNICAL_REFERENCE.md     # 技術アーキテクチャ
│   └── CHANGELOG.md         # 変更履歴
├── config/                   # 設定ファイル
│   ├── players-config.json  # プレイヤー設定
│   └── servers.json         # サーバー設定
├── examples/                 # 使用例
│   ├── multi-server.js      # マルチサーバー例
│   └── ...
├── tests/                    # テストファイル
│   ├── ai_training_verification.js  # AI学習テスト
│   └── ...
├── training/                 # 学習関連
│   ├── sample_training_data.json    # サンプル学習データ
│   ├── training_scenarios.js       # 学習シナリオ
│   └── ...
└── references/              # 参考資料（Voyagerスキルライブラリ等）
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
- Minecraft Java Editionサーバー（ローカルまたはリモート）
- OpenAI APIキー（オプション、高度なAI機能用）

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
# シングルボット
npm start

# 複数AIプレイヤー（3体）
npm run multi-players

# 5体チーム
npm run squad

# 10体軍団
npm run army
```

### 🆕 マルチプレイヤー機能
v1.1.0では複数のAIプレイヤーが協調して動作します：
```bash
# 設定ファイルベースの高度な管理
npm run advanced-multi

# 複数サーバー同時接続
npm run multi-server
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
| 1体 | 5-10% | 100MB | 最小環境 |
| 5体 | 15-25% | 500MB | 推奨環境 |
| 10体 | 30-50% | 1GB | 高性能環境 |

- **ネットワーク**: 効率的、必要なパケットのみ送信
- **学習**: 経験とともに徐々に改善
- **🆕 協調システム**: 複数ボット間の効率的なリソース管理

## 📚 詳細ドキュメント

プロジェクトの詳細情報は以下のドキュメントを参照してください：

- **[USER_GUIDE.md](docs/USER_GUIDE.md)** - 完全なユーザー使用ガイド
- **[SETUP_AND_INSTALLATION.md](docs/SETUP_AND_INSTALLATION.md)** - 詳細なセットアップ手順
- **[AUTHENTICATION_GUIDE.md](docs/AUTHENTICATION_GUIDE.md)** - オフライン・Microsoft認証設定
- **[OPENAI_CONFIGURATION.md](docs/OPENAI_CONFIGURATION.md)** - OpenAI API設定と最適化
- **[TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md)** - 技術アーキテクチャとAI学習詳細
- **[CHANGELOG.md](docs/CHANGELOG.md)** - バージョン履歴と変更記録

## ライセンス

MITライセンス - 必要に応じてボットを自由に変更・拡張してください。

## 貢献

1. リポジトリをフォーク
2. 機能ブランチを作成
3. 変更を実装
4. 徹底的にテスト
5. プルリクエストを提出

## 謝辞

- **mineflayer** - 優秀なMinecraftボットフレームワーク
- **Voyager** - AI学習アーキテクチャのインスピレーション（MITライセンス）
- **PrismarineJS** - Minecraftプロトコル実装
- **OpenAI** - インテリジェントなスキル生成のためのGPT-4

### Voyager参考資料
Voyagerプロジェクトのスキルライブラリとライセンス情報は`references/`ディレクトリに保存されています。# minecortex
