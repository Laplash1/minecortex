# セットアップとインストールガイド

このガイドでは、MineCortex v1.2.1の完全なセットアップ手順を説明します。

## 🚨 v1.2.1 インストール注意事項
- このバージョンには重要なバグ修正が含まれています
- 既存のv1.2.0以前からの更新を強く推奨します
- npm installで最新の依存関係が自動インストールされます

## 📋 システム要件

### 💻 対応OS
✅ **完全対応**
- macOS 10.15 (Catalina) 以降
- Windows 10/11 (64-bit)
- Linux Ubuntu 18.04 LTS 以降
- Linux CentOS 7 以降
- Linux Debian 10 以降

### ⚙️ システム要件

| 要件 | 最小 | 推奨 | 高負荷環境 |
|------|------|------|-----------|
| CPU | 1コア | 2コア | 4コア以上 |
| メモリ | 512MB | 1GB | 2GB以上 |
| ストレージ | 100MB | 1GB | 5GB以上 |
| Node.js | v16.13.0+ | v18.0.0+ | v20.0.0+ |

### 🚫 GUI不要！
- **ヘッドレス動作**: GUI不要で完全動作
- **SSH対応**: リモート環境での実行可能
- **サーバー運用**: VPS・クラウドでの24時間稼働対応
- **Docker対応**: コンテナ環境での実行可能

---

## 🚀 クイックスタート

### 1. Node.js インストール

#### macOS
```bash
# Homebrew使用
brew install node

# 公式インストーラー
# https://nodejs.org/からLTS版をダウンロード
```

#### Windows
```cmd
# 公式サイトからLTS版をダウンロード
# https://nodejs.org/

# または Chocolatey使用
choco install nodejs

# 確認
node --version
npm --version
```

#### Linux (Ubuntu/Debian)
```bash
# Node.js 18.x インストール
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 必要なパッケージ
sudo apt-get install -y build-essential python3
```

#### Linux (CentOS/RHEL)
```bash
# Node.js インストール
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# 必要なパッケージ
sudo yum groupinstall -y "Development Tools"
```

### 2. プロジェクトセットアップ
```bash
# プロジェクトをクローンまたはダウンロード
git clone <repository-url>
cd minecraft-ai-player

# 依存関係インストール
npm install

# 環境設定
cp .env.example .env
```

### 3. 基本設定
`.env` ファイルを編集：
```bash
# 必須設定
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=AIPlayer
MINECRAFT_AUTH=offline

# デバッグモード（開発時）
DEBUG_MODE=true

# OpenAI設定（オプション）
OPENAI_API_KEY=your_api_key_here
```

### 4. 実行
```bash
# 標準実行
npm start

# デバッグモード
npm run dev

# マルチプレイヤー（5人チーム）
npm run squad

# マルチプレイヤー（10人軍団）
npm run army
```

---

## 🪟 Windows特有の設定

### PowerShell実行ポリシー
```powershell
# 実行ポリシー変更が必要な場合
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Windows Defender設定
誤検知される場合：
1. Windows セキュリティを開く
2. ウイルスと脅威の防止 → 除外の追加
3. プロジェクトフォルダを除外に追加

### ファイアウォール設定
1. Windowsファイアウォール設定を開く
2. アプリまたは機能をWindowsファイアウォール経由で許可
3. Node.jsにチェック

### 文字化け対策
```cmd
# コマンドプロンプトでUTF-8使用
chcp 65001
```

### パフォーマンス最適化
```cmd
# 高優先度で実行
start /high npm start

# バックグラウンド実行
start /min npm start
```

---

## 🐧 Linux特有の設定

### パッケージマネージャー別設定

#### Alpine Linux
```bash
apk add nodejs npm python3 make g++
```

#### Arch Linux
```bash
pacman -S nodejs npm python make gcc
```

### サービス化（systemd）
```bash
# サービスファイル作成
sudo tee /etc/systemd/system/minecraft-ai.service > /dev/null <<EOF
[Unit]
Description=MineCortex
After=network.target

[Service]
Type=simple
User=minecraft
WorkingDirectory=/opt/minecraft-ai-player
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# サービス有効化
sudo systemctl enable minecraft-ai
sudo systemctl start minecraft-ai
```

---

## 🍎 macOS特有の設定

### Xcode Command Line Tools
```bash
xcode-select --install
```

### Rosetta 2 (Apple Silicon)
```bash
# Intel互換が必要な場合
softwareupdate --install-rosetta
```

### セキュリティ設定
```bash
# Gatekeeper設定（必要に応じて）
sudo spctl --master-disable
```

---

## 🐳 Docker対応

### Dockerfile
```dockerfile
FROM node:18-alpine

# 必要なパッケージインストール
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm ci --only=production

# アプリケーションファイルコピー
COPY . .

# 非rootユーザーで実行
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
```

### Docker Compose
```yaml
version: '3.8'
services:
  minecraft-ai:
    build: .
    environment:
      - MINECRAFT_HOST=minecraft-server
      - MINECRAFT_PORT=25565
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    depends_on:
      - minecraft-server

  minecraft-server:
    image: itzg/minecraft-server
    environment:
      EULA: "TRUE"
      ONLINE_MODE: "FALSE"
    ports:
      - "25565:25565"
    volumes:
      - minecraft-data:/data
    restart: unless-stopped

volumes:
  minecraft-data:
```

---

## ☁️ クラウド対応

### AWS EC2
```bash
# Amazon Linux 2
sudo yum update -y
sudo yum install -y git

# Node.js インストール
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# プロジェクトセットアップ
git clone <repository>
cd minecraft-ai-player
npm install
```

### Google Cloud Platform
```bash
# Ubuntu on GCP
sudo apt update
sudo apt install -y curl git

# Node.js インストール
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Azure VM
```bash
# Ubuntu on Azure
# 同様の手順でNode.jsインストール後
# ファイアウォール設定
sudo ufw allow out 25565
sudo ufw allow out 443
```

---

## 📊 パフォーマンス最適化

### システム監視
```bash
# CPU/メモリ使用量確認
top
htop  # より見やすい

# プロセス確認
ps aux | grep node

# ログ確認
tail -f logs/minecraft-ai.log
```

### メモリ使用量最適化
```bash
# Node.js メモリ制限
node --max-old-space-size=512 index.js

# スワップ設定（Linux）
sudo swapon --show
```

### プロセス管理
```bash
# PM2 インストール・使用
npm install -g pm2
pm2 start index.js --name minecraft-ai
pm2 startup
pm2 save
```

---

## 🔍 トラブルシューティング

### よくある問題

#### Node.js関連
```bash
# Node.jsバージョン確認
node --version

# npm設定確認
npm config list

# キャッシュクリア
npm cache clean --force
```

#### 接続関連
```bash
# Minecraftサーバー接続テスト
telnet localhost 25565

# DNS確認
nslookup minecraft-server.com

# ポート確認
netstat -tuln | grep 25565
```

#### 権限関連
```bash
# ファイル権限確認
ls -la

# オーナー変更
sudo chown -R $USER:$USER .

# 実行権限付与
chmod +x index.js
```

### ログ確認
```bash
# デバッグモードでログ確認
DEBUG_MODE=true npm start

# ログファイル確認
tail -f logs/minecraft-ai.log

# エラーログのみ確認
grep ERROR logs/minecraft-ai.log
```

---

## 📋 運用チェックリスト

### 初期セットアップ
- [ ] Node.js v16.13.0+ インストール済み
- [ ] プロジェクトファイル展開済み
- [ ] `npm install` 実行済み
- [ ] `.env` ファイル設定済み
- [ ] Minecraftサーバー接続確認済み
- [ ] 基本動作テスト完了

### 本番運用準備
- [ ] サービス化設定完了（Linux/Windows）
- [ ] ログローテーション設定
- [ ] 監視・アラート設定
- [ ] バックアップ設定
- [ ] セキュリティ設定確認

### 定期メンテナンス
- [ ] ログファイル確認（週次）
- [ ] システムリソース確認（週次）
- [ ] 依存関係更新確認（月次）
- [ ] 設定ファイルバックアップ（月次）

---

このガイドに従って、どの環境でもMinecraft AI Playerを安定して運用することができます。問題が発生した場合は、該当するセクションのトラブルシューティングを参照してください。