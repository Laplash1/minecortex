# 1体・OpenAIなしのローカル検証

今回の対象は FIX_PLAN フェーズ0〜3、到達点Cです。安全な固定地形の Survival で、空の在庫から原木3個を集め、作業台を作成・設置し、木のツルハシを作り、石から丸石3個を取得します。全17スキルを登録しますが、この工程と移動以外のゲーム内成功は保証していません。食料・探索・建築・複数体・OpenAI は今回の対象外です。未対応目標は理由を記録して停止します。

## 準備

Node.js >=22（検証版24.22.1）、npm、Java 21、curl、python3 が必要です。

```bash
cd ~/workspace/minecortex
sudo apt-get update
sudo apt-get install -y openjdk-21-jre-headless curl python3
npm ci
npm run server:setup
cp .env.example .env
```

`server:setup` は固定した Paper 1.21.4 build 232 と Mojang の元jarを取得し、SHA-256を検証します。サーバ起動を承認されたローカル検証用として `.runtime/paper/eula.txt` に `eula=true` を設定します。既存の server.properties は上書きしません。バイナリ・ワールド・生ログは Git 対象外の `.runtime/` に保存します。

Paper は `server-ip=127.0.0.1`、ポート25565、`online-mode=false`、RCON/Query無効です。起動スクリプトはこれらの設定が変わっていたら拒否します。Java のヒープ上限は768MiBです。外部からの接続は受け付けません。

## 受け入れ試験

```bash
# 既に起動したテストサーバ・ボットを停止してから実行
npm run test:acceptance
npm test -- --runInBand
npm run lint
```

受け入れスクリプトが専用サーバを起動し、接続・初期化、状態、近距離移動、移動中・採集中の停止、移動の期限切れ、取消後の別指示を確認した後、到達点Cを3回実行します。サーバを別途起動する必要はありません。25565が使用中なら、既存サーバに変更を加えず終了します。

各試行で昼・晴天・敵なし、同じ地形・開始位置・空の在庫を復元します。素材・道具をボットへ与えるコマンドは使いません。ボットは常に1体、固定名 `MineCortexBot1`（`PLAYER1_USERNAME` で英数字3〜16文字に変更可）、offline認証です。試行間で切断し、サーバの `list` が0人になることを確認します。

各工程の実インベントリ差分に加え、サーバの `data get entity ... Inventory` と `clear ... <item> 0`（削除なしの個数確認）を記録します。作業台は在庫への生成と、設置ブロックの両方を確認します。石ブロックと取得品 `cobblestone` を分けて判定し、未達・部分取得は成功扱いにしません。

今回の成功記録は [validation/arrival-c.json](validation/arrival-c.json)、実装・依存更新の理由と検証結果は [FIX_IMPLEMENTATION_LOG.md](../FIX_IMPLEMENTATION_LOG.md) に保存しています。

再実行時の証跡は `.runtime/acceptance-report.json`、`.runtime/acceptance-bot.log`、`.runtime/acceptance-paper.log` です。例外・アサーション失敗で終了コードが非0になり、失敗時にも在庫・ドロップの診断を保存します。終了時はボットとサーバの両方を停止します。

## 手動起動

```bash
# ターミナル1（サーバコンソール。stop で終了）
npm run server:start

# ターミナル2（Ctrl+Cでボットを終了）
npm start
```

`.env.example` の `AI_AUTOSTART=true` は基本工程を1回開始し、完了後は待機します。接続・観測だけなら `AI_AUTOSTART=false` にします。OPENAI_API_KEY は空のまま使います。`--config` は付けません。受け入れ試験後のワールドには採取済みブロックと保存済み在庫が残るため、手動起動だけで試験の初期条件が復元されるわけではありません。同条件を再現するには受け入れ試験を再実行してください。

ゲーム内チャットの操作:

- `!status`: 実際の体力・食料・位置を表示。
- `!goto x y z`: 近距離の移動指示。停止中なら再開。
- `!stop`: 実操作を取り消し、目標キューを空にして待機。
- `!start`: 現操作を停止して基本工程を先頭から実行。
- `!resume`: 待機を解除。停止で消した目標は復元しません。

クラフトは固定した1.21.4のウィンドウプロトコルと mineflayer 4.39.0 の同期機構を使用します。サーバ応答のカーソル・スロットが期待する結果と一致するまで待ち、古い応答で次のクリックへ進みません。

操作は直列です。停止・期限切れ時は経路目標・操作キー・採掘・開いたウィンドウを止め、スキルの Promise が終了するまで次の操作を開始しません。処理終了を確認できなければ待機し続けます。取消後の古い処理から操作が再発しないよう、スキルへ渡す bot の操作メソッドも保護しています。

観測は250msごとに自分の位置・体力・食料・在庫を更新し、周辺走査は2秒間隔です。更新時刻を保持し、作業中にも更新します。停止後・死亡後の自動目標生成、アイドル採集、自動クラフト、自動再接続は使いません。
