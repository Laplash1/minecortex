# MineCortex フェーズ0〜3 実装ログ

作業日: 2026-11-15。開始時 HEAD: bb72dde。事前に FIX_PLAN.md と SUMMARY.md を読み、Lap の本依頼の承認事項を実装範囲とした。両文書は調査時点の記録として変更していない。

## 環境・依存

- Node.js 24.22.1 / npm 10.9.4。最初に既存 lockfile に対して `npm ci` を実行し、585パッケージを導入。
- 初期 Lint はエラー0・警告32。既存のテストはなし。
- Java 未導入から Ubuntu の `openjdk-21-jre-headless` を導入。実行版21.0.13.0.3。既定 apt ソースの副ミラーが応答しなかったため、作業用ソースリストで Ubuntu Azure ミラーを指定して導入した。システムの apt ソース設定は変更していない。
- Paper 1.21.4 build 232、Java 21に固定。公式の安定ビルド情報とSHA-256を確認。ループバック127.0.0.1:25565のみ、offline、RCON/Query無効、プラグイン追加なし、ヒープ上限768MiB。
- Java の初回ダウンロードはこのVMのHTTPS経路で失敗したため、Paper内の download-context から元のMojang jarのURL・SHA-256を読み、curlで先行取得した。セットアップスクリプトに同じ照合処理を残した。
- ボットは環境変数による1体・固定英数字名 MineCortexBot1・auth=offline。OPENAI_API_KEY は設定しない。受け入れスクリプトでは空を明示し、OpenAIクライアントが未生成であることも確認。
- package.json / lockfileのNode要件を>=22へ整合。

### 承認範囲内の依存更新と理由

`npm install --save-exact mineflayer@4.39.0` により4.30.0から更新。1.21.4以降の初回操作に必要な `player_loaded` を4.30.0は送らず、サーバ上に原木が残るのにクライアント上では空気になる不一致を再現した。4.39.0にはこの送信処理があり、受け入れテストでも各接続の送信回数1回を確認する。根拠: [4.30.0 health.js](https://raw.githubusercontent.com/PrismarineJS/mineflayer/4.30.0/lib/plugins/health.js)、[4.39.0 health.js](https://raw.githubusercontent.com/PrismarineJS/mineflayer/4.39.0/lib/plugins/health.js)。

npmによる関連依存の更新（minecraft-data 3.119.0、minecraft-protocol 1.68.0等）も lockfile に記録。クラフトのサーバ応答に合わせたスロット形式の変換を直接使用するため、既に導入されていた prismarine-item 1.18.0 を直接依存として固定した。無関係なライブラリへの一括移行は行っていない。

## 実装

- 共通 Skill 基底クラスで logger を生成し、17スキルすべての初期化条件を統一。
- 初期化を一度だけ実行し、チャンク待機中の切断・初期化失敗でも終了できるようにした。botやManagerが所有するイベントリスナーを一括削除しない。通常終了ではAI停止後に接続終了を待つ。
- 自分の位置・体力・食料・在庫・環境は250msごとに更新。周辺ブロック・エンティティ走査は2秒間隔。更新時刻を保持。StateManagerはbot.health/foodを参照し、0を保持。他の状態更新で定期同期が永久に延期される点も修正。
- 初期目標を原木3個→作業台作成→設置→木のツルハシ→石から丸石3個へ固定。素手の木材収集に斧の前提を置かない。完了後は待機し、アイドル・回復・自動クラフトから別工程に進まない。
- 未対応の目標・道具・ブロックは理由を示して停止。生成による穴埋めや無限再試行を使わない。未定義メソッドを含んでいた旧採掘経路を、対象限定の採掘・回収処理へ置換。
- 採掘回数だけで成功とせず、対象ブロックと取得品を分け、在庫増加が指定数に達した時のみ成功。木の上部が接近を塞ぐ場合に備え、必要数の幹を取り除いた後でドロップを追って回収。
- mineflayerの通常クラフトでは結果の予測とサーバ在庫が一致しないケースも再現した。固定版のウィンドウ同期機構を使用し、クラフトはサーバ応答を待つクリックを直列実行。素材を1個ずつ配置し、サーバが提示した結果スロットを検査して取り出す。結果スロットの合成、レシピのダミー生成、成功ログだけによる判定は行わない。
- `!stop` は実操作の取消、キュー削除、待機を行う。`!start` / `!goto` / `!resume` が明示的な再開操作。死亡後も勝手に再始動しない。
- AbortControllerによる操作取消を共通化。pathfinder目標・キー・採掘・ウィンドウを止め、実行Promise終了まで次を開始しない。遅い非同期処理の結果を新しいタスクへ混入させない。ネイティブ操作の遅延継続にも取消後の採掘・クラフト等のパケット送信を許さない。
- 実行入口を import 可能にし、通常の `npm start` と同じManager/AI/Planner/登録スキルを受け入れ試験で使用。test/のGit除外を解消し、回帰テストと実機試験スクリプトを追加。

## 検証結果

**到達点C: 同条件3回連続成功。** 最終実機試験の開始は2026-11-15 12:30 UTC台、終了は12:32:26 UTC。完了前の失敗試行は成功回数に含めていない。詳細の開始時刻・各工程の時刻は [実機証跡JSON](docs/validation/arrival-c.json) に記録。

| 試行 | 開始在庫 | 原木取得 | 作業台作成・設置 | 木のツルハシ | 丸石取得 | 終了後のサーバ参加人数 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 空 | 3 | 1個作成、設置ブロック確認 | 1 | 3 | 0 |
| 2 | 空 | 3 | 1個作成、設置ブロック確認 | 1 | 3 | 0 |
| 3 | 空 | 3 | 1個作成、設置ブロック確認 | 1 | 3 | 0 |

全試行で最終在庫は oak_planks:3、stick:2、wooden_pickaxe:1、cobblestone:3。原木と作業台は後工程で消費・設置するため、各工程の在庫とサーバの個数をその時点で確認した。工程の境界で検証スクリプトが一時待機させて照合し、その後自動で継続する。素材・道具の補充やボットの採集操作を代行するコマンドは使用していない。

追加の実機確認11項目: spawn/初期化前の切断、状態と近距離goto、移動中のstopと停止維持、期限切れ、取消後のgoto、採集中stop、対象なし・素材不足・道具なし・到達不能の明示的失敗、通常の `npm start` とSIGTERM終了。各試行は17スキル登録・OpenAI未生成・player_loaded送信1回も確認。サーバの実際の待受は `[::ffff:127.0.0.1]:25565` だった。

- 更新後の `npm ci`: 584パッケージ導入成功。`npm ls --depth=0` は未充足依存なし。
- `npm test -- --runInBand`: **3スイート・14テスト成功**。取消後の遅延操作・パケット送信の阻止、非同期処理の直列性、採掘と在庫増加の区別、古いウィンドウ応答の拒否、初期化失敗時の終了等を含む。
- `npm run lint`: **エラー0・警告28**（既存箇所を含む行長警告）。
- `git diff --check`: 成功。
- 実機試験・通常入口試験の終了後、ボット0体、Paper停止、25565の待受なしを確認。

対象は固定した安全地形での短時間検証。一般地形での長期生存、全17スキルのゲーム内成功、複数体、OpenAI連携は合格範囲に含めない。

## 再実行・証跡

手順は [docs/LOCAL_ACCEPTANCE.md](docs/LOCAL_ACCEPTANCE.md)。`npm run server:setup`、`npm run test:acceptance`、`npm test -- --runInBand`、`npm run lint` で再実行できる。生ログ・実ワールド・取得jarは `.runtime/`、固定版情報は `config/paper-version.json` に保存。サーバの jar・ワールド・個人用.env はGit対象に含めない。

公式環境資料: [PaperのJava対応表](https://docs.papermc.io/paper/getting-started/)、[ダウンロードAPI](https://docs.papermc.io/misc/downloads-service/)、[server.properties](https://docs.papermc.io/paper/reference/server-properties/)。
