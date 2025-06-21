# Minecraft認証ガイド

このガイドでは、Minecraft AI Playerでの認証設定について説明します。オフライン・オンライン両方の認証方式に対応しています。

## 🔐 認証方式の選択

### 認証方式比較

| 認証方式 | 用途 | 設定 | セキュリティ | Minecraftライセンス |
|---------|------|------|-------------|-------------------|
| **offline** | ローカル/プライベートサーバー | `MINECRAFT_AUTH=offline` | 低 | 不要 |
| **microsoft** | 公式/オンラインサーバー | `MINECRAFT_AUTH=microsoft` | 高 | 必要 |

---

## 🚀 オフライン認証（推奨初心者向け）

### 特徴
- **ライセンス不要**: Minecraft購入の必要なし
- **簡単設定**: 即座に開始可能
- **ローカル専用**: プライベートサーバーのみ対応

### 設定方法

`.env` ファイルを編集：
```bash
# オフライン認証設定
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=AIPlayer        # 任意の名前
MINECRAFT_AUTH=offline            # オフライン認証

# デバッグモード
DEBUG_MODE=true
AUTO_RESPAWN=true
```

### 対応サーバー
```bash
# ローカルサーバー
MINECRAFT_HOST=localhost
MINECRAFT_AUTH=offline

# プライベートサーバー（offline-mode=true）
MINECRAFT_HOST=your-private-server.com
MINECRAFT_AUTH=offline

# 開発用サーバー
MINECRAFT_HOST=192.168.1.100
MINECRAFT_AUTH=offline
```

### クイックスタート
```bash
# 1. 設定
cp .env.example .env
# .envを編集してMINECRAFT_AUTH=offlineに設定

# 2. 実行
npm start
```

---

## 🛡️ Microsoft認証（オンラインサーバー用）

### 前提条件
- **Minecraft Java Edition**の有効なライセンス
- **Microsoftアカウント**（Minecraftと連携済み）
- **インターネット接続**

### 設定方法

`.env` ファイルを編集：
```bash
# Microsoft認証設定
MINECRAFT_HOST=hypixel.net              # オンラインサーバー
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=YourMinecraftUsername # 実際のMinecraft名
MINECRAFT_AUTH=microsoft                # Microsoft認証

# その他設定
DEBUG_MODE=true
AUTO_RESPAWN=true
```

### 認証プロセス

初回起動時の自動認証：
```bash
npm start
```

**認証フロー**:
1. **ブラウザが自動起動** → Microsoftログインページ
2. **Minecraftアカウント**でログイン
3. **認証許可**をクリック
4. **認証完了** → ボット接続開始

### 対応サーバー例

#### 大手パブリックサーバー
```bash
# Hypixel
MINECRAFT_HOST=hypixel.net
MINECRAFT_AUTH=microsoft

# Mineplex  
MINECRAFT_HOST=mineplex.com
MINECRAFT_AUTH=microsoft

# CubeCraft
MINECRAFT_HOST=play.cubecraft.net
MINECRAFT_AUTH=microsoft
```

#### Minecraft Realms
```bash
MINECRAFT_HOST=your-realm-address.realms.minecraft.net
MINECRAFT_AUTH=microsoft
```

#### プライベートサーバー（online-mode=true）
```bash
MINECRAFT_HOST=your-server.com
MINECRAFT_PORT=25565
MINECRAFT_AUTH=microsoft
```

---

## 🔧 高度な認証設定

### 詳細な認証オプション

`index.js` での設定例：
```javascript
const botConfig = {
  host: process.env.MINECRAFT_HOST || 'localhost',
  port: parseInt(process.env.MINECRAFT_PORT) || 25565,
  username: process.env.MINECRAFT_USERNAME || 'AIPlayer',
  auth: process.env.MINECRAFT_AUTH || 'offline',
  
  // Microsoft認証の詳細設定
  profilesFolder: './minecraft_profiles',  // 認証情報保存先
  onMsaCode: (data) => {
    console.log('認証コード:', data.user_code);
    console.log('認証URL:', data.verification_uri);
  },
  
  // その他オプション
  skipValidation: false,  // スキン検証をスキップしない
  hideErrors: false      // エラーを表示
};
```

### 認証トークン管理

#### 自動保存
認証トークンは自動的に保存・再利用されます：
```
プロジェクトフォルダ/
├── nmp-cache/           # 認証キャッシュ
├── .minecraft-profile   # 認証プロファイル
└── minecraft_profiles/  # プロファイル情報
```

#### 手動リセット
```bash
# 認証情報をクリア（再認証が必要）
rm -rf nmp-cache/
rm -f .minecraft-profile
rm -rf minecraft_profiles/

# 再認証
npm start
```

---

## 🔄 マルチプレイヤー認証

### 複数アカウント管理

#### 環境変数方式（推奨）
```bash
# Bot 1
MINECRAFT_USERNAME=MinecraftUser1
MINECRAFT_AUTH=microsoft

# Bot 2（別のアカウント）
MINECRAFT_USERNAME=MinecraftUser2  
MINECRAFT_AUTH=microsoft
```

#### 設定ファイル方式
`config/players-config.json`:
```json
{
  "players": [
    {
      "id": "player1",
      "username": "MinecraftUser1",
      "auth": "microsoft",
      "enabled": true
    },
    {
      "id": "player2", 
      "username": "MinecraftUser2",
      "auth": "microsoft",
      "enabled": true
    }
  ]
}
```

### 混合認証（オフライン + オンライン）
```json
{
  "players": [
    {
      "id": "local_bot",
      "username": "LocalAI",
      "auth": "offline",
      "host": "localhost"
    },
    {
      "id": "online_bot",
      "username": "OnlineAI",
      "auth": "microsoft", 
      "host": "hypixel.net"
    }
  ]
}
```

---

## 🛠️ トラブルシューティング

### 共通問題

#### 1. 接続タイムアウト
```
Error: connect ETIMEDOUT
```
**解決策**:
- ホスト名とポートを確認
- ファイアウォール設定を確認
- インターネット接続を確認

#### 2. 不正なユーザー名
```
Error: Invalid username
```
**解決策**:
- ユーザー名の文字数制限（3-16文字）
- 使用可能文字（a-z, A-Z, 0-9, _）
- 既存ユーザーとの重複回避

### オフライン認証特有の問題

#### サーバーがオンラインモード
```
Error: Server is in online mode
```
**解決策**:
- Microsoft認証に切り替え
- サーバーのオンラインモードを確認

### Microsoft認証特有の問題

#### 1. 認証失敗
```
Error: Failed to authenticate with Microsoft
```
**解決策**:
- Microsoftアカウントのパスワード確認
- 2段階認証有効時はアプリパスワード使用
- ブラウザのCookieクリア

#### 2. ライセンス問題
```
Error: User not premium
```
**解決策**:
- Minecraft Java Editionライセンス確認
- アカウントのMicrosoft移行完了確認
- [minecraft.net](https://minecraft.net)でアカウント状態確認

#### 3. 認証サーバーダウン
```
Error: Authentication servers are down
```
**解決策**:
- [status.mojang.com](https://status.mojang.com)で状態確認
- 時間をおいて再試行

---

## 🔐 セキュリティ設定

### 2段階認証（2FA）対応

#### アプリパスワード生成
1. **Microsoft アカウント設定**を開く
2. **セキュリティ** → **アプリパスワード**
3. **新しいアプリパスワード**を生成
4. 生成されたパスワードを認証時に使用

### ベストプラクティス

#### 認証情報の保護
```bash
# ファイル権限設定
chmod 600 .env
chmod 700 nmp-cache/
chmod 700 minecraft_profiles/

# 環境変数での管理
export MINECRAFT_USERNAME="YourUser"
export MINECRAFT_AUTH="microsoft"
```

#### セキュリティ監視
- **異常なログイン通知**を有効化
- **セッション管理**を定期確認
- **認証ログ**の監視

---

## 📊 認証監視とログ

### 認証状態確認
```javascript
// 認証成功時のログ
bot.on('login', () => {
  console.log(`✅ 認証成功: ${bot.username}`);
  console.log(`📝 UUID: ${bot.uuid}`);
  console.log(`🌐 サーバー: ${bot.game.serverBrand || 'Unknown'}`);
  console.log(`🔐 認証方式: ${process.env.MINECRAFT_AUTH}`);
});

// 認証エラー処理
bot.on('error', (err) => {
  if (err.message.includes('authentication')) {
    console.log('❌ 認証エラー: 再認証が必要です');
    console.log(`💡 解決策: rm -rf nmp-cache/ && npm start`);
  }
});
```

### デバッグモード
```bash
# 詳細な認証ログを表示
DEBUG_MODE=true npm start
```

---

## 🎯 実践例

### 1. 初心者向け（オフライン）
```bash
# .env設定
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565  
MINECRAFT_USERNAME=AIPlayer
MINECRAFT_AUTH=offline
DEBUG_MODE=true

# 実行
npm start
```

### 2. 上級者向け（Microsoft認証）
```bash
# .env設定
MINECRAFT_HOST=hypixel.net
MINECRAFT_USERNAME=YourMinecraftName
MINECRAFT_AUTH=microsoft
DEBUG_MODE=false

# 実行
npm start
```

### 3. マルチプレイヤー（混合認証）
```bash
# 高度なマルチプレイヤー起動
npm run advanced-multi
```

---

## 📈 パフォーマンス考慮事項

### 認証頻度最適化
- **トークン有効期限**: 通常24時間
- **自動更新**: mineflayerが自動処理
- **再認証**: 期限切れ時のみ

### 帯域幅使用量
| 認証方式 | 初回認証 | トークン更新 | 通常プレイ |
|---------|----------|-------------|-----------|
| offline | 0KB | 0KB | 変化なし |
| microsoft | ~1MB | ~100KB | 変化なし |

---

## ✨ まとめ

### 認証方式の選択指針

**オフライン認証を選ぶべき場合**:
- 初心者・学習目的
- プライベートサーバーのみ使用
- Minecraftライセンスなし

**Microsoft認証を選ぶべき場合**:
- パブリックサーバーで遊びたい
- 正規のMinecraftアカウント所有
- 高いセキュリティが必要

どちらの認証方式でも、Minecraft AI Playerの全機能を使用できます。まずはオフライン認証で慣れてから、必要に応じてMicrosoft認証に移行することをお勧めします。