# Contributing to MineCortex

MineCortexプロジェクトへの貢献を歓迎します。v1.5.0で大幅に簡素化されたプロジェクト構造での開発参加方法を説明します。

## 開発環境のセットアップ

1. リポジトリをクローン
2. 依存関係をインストール: `npm install`
3. 環境設定ファイルを作成: `touch .env`
4. コード品質チェック: `npm run lint`
5. 動作確認: `npm start`

## コーディング規約

### ESLint継続使用
- 開発時: `npm run lint` でコード品質をチェック
- 修正完了時: すべてのcritical errorsを解決してからコミット
- 新規ファイル: ESLintルールに準拠したコードを作成

### エラーハンドリング
- すべての非同期関数にtry-catch文を使用
- エラーメッセージは具体的で理解しやすく
- 回復可能なエラーには回復戦略を実装

### ログ出力
- 重要な処理の開始・終了をログ出力
- ユーザーにとって有用な情報をチャット出力
- デバッグ情報とユーザー情報を区別

## ブランチ戦略

- `main`: 安定版リリース
- `develop`: 開発中の機能統合
- `feature/*`: 新機能開発
- `fix/*`: バグ修正
- `refactor/*`: リファクタリング

## プルリクエスト

1. feature/fix ブランチを作成
2. 変更を実装
3. テストを追加・更新
4. ESLintエラーを解決
5. プルリクエストを作成
6. レビューを受ける

## 変更記録

すべての変更は `/docs/changelogs/` に記録する必要があります。

### 記録フォーマット
```markdown
#### ファイル名
**変更内容**: [具体的な変更内容]
**変更意図**: [なぜこの変更が必要だったか]
**期待効果**: [この変更により何が改善されるか]
```

## スキル開発

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

## テスト

v1.5.0では、テスト構造を簡素化しました：

- **実動作確認**: `npm start` で5体のAIプレイヤーが正常動作することを確認
- **コード品質**: `npm run lint` でESLintによる品質チェック
- **手動テスト**: Minecraftゲーム内でのチャットコマンド(`!status`, `!learn`等)による動作確認

## 質問・議論

- GitHub Issues: バグ報告・機能要求
- GitHub Discussions: 設計議論・質問
- Wiki: 設計思想・アーキテクチャ記録

MineCortexプロジェクトをより良くするためのご協力をお願いします。