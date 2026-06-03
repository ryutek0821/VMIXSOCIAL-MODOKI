# デプロイ手順（PaaS）

クラウドにデプロイして、別拠点のvMixからインターネット越しに使うための手順です。
**WebSocket常駐サーバー**なので、**Vercel / Netlify（サーバーレス）は使えません**。
WebSocket対応のPaaS（**Render** / **Railway** / Fly.io など）を使います。

---

## 公開前に必ず押さえる3点

1. **認証**：`ADMIN_PASSWORD`（管理画面）を設定し、各サービスは ID＋パスワードで保護。未設定だと管理者パスワードが**初回起動時に自動生成**されるので、起動ログを必ず確認して控えてください。
2. **永続化**：無料プランの多くは再起動でファイルが消えます（キュー/画像がリセット）。
   保持したいなら**永続ディスク**を付けて `DATA_DIR` をそのパスに向けます。なくても運用は可能（都度登録）。
3. **HTTPS/wss**：PaaSは自動でHTTPS化されます。`wss://` 切替はアプリ側で対応済みなので設定不要。

> 補足：自動取得は `cdn.syndication.twimg.com` への通信です。**データセンターIPは住宅IPより弾かれやすい**
> 可能性があり、クラウド上では取得が不安定になることがあります（**手入力は影響なし**）。

---

## 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | ◎(公開時) | 管理画面(/admin)のパスワード。ここからサービス(ID+PW)を追加/削除。未設定だと初回起動時に自動生成 |
| `APP_PASSWORD` | 任意 | 移行用。設定すると旧データを引き継ぐ `default` サービスを自動作成 |
| `OUTPUT_TOKEN` | 任意 | 移行用。`default` サービスの出力トークンとして引き継ぎ（新規サービスは自動発行）。vMix URLは `…/output?service=<ID>&token=値` |
| `SESSION_SECRET` | 推奨 | ログインCookie署名用。PaaSでは自動生成推奨 |
| `DATA_DIR` | 任意 | データ/画像の保存先。永続ディスクのマウント先を指定（例 `/var/data`） |
| `PORT` | 不要 | PaaSが自動設定。手動指定は通常不要 |

---

## A. Render（おすすめ・Blueprint）

リポジトリ同梱の `render.yaml` で自動構築できます。

1. コードをGitHub（等）にpush。
2. [Render](https://render.com) で **New → Blueprint** → リポジトリを選択。
3. `render.yaml` が読まれ、Webサービスが作成される。
4. **Environment** で `APP_PASSWORD` を設定（必要なら `OUTPUT_TOKEN` も）。`SESSION_SECRET` は自動生成。
5. デプロイ完了後、`https://<name>.onrender.com/` が操作画面。
6. **キュー/画像を永続化したい場合**（有料プラン）:
   - `render.yaml` の `disk:` のコメントを外す（`mountPath: /var/data`）。
   - 環境変数に `DATA_DIR=/var/data` を追加して再デプロイ。

> 無料プランは「無操作でスリープ→次アクセスで数十秒のコールドスタート」。
> 本番配信で使うなら **Starter 以上** を推奨。

## B. Railway

1. [Railway](https://railway.app) で **New Project → Deploy from GitHub repo**。
2. 自動で `npm install` → `npm start`（同梱 `Procfile` も利用可）。
3. **Variables** に `APP_PASSWORD`（任意で `OUTPUT_TOKEN` / `SESSION_SECRET`）を設定。
4. **Settings → Networking** で公開ドメインを生成。
5. 永続化する場合: **Volume** を作成してマウント（例 `/data`）し、`DATA_DIR=/data` を設定。

## C. Fly.io（参考）

`fly launch`（Dockerfile無しでもNode検出）→ `fly volumes create data` でボリューム作成 →
`fly.toml` の `[mounts]` で `/data` にマウント →
`fly secrets set APP_PASSWORD=… SESSION_SECRET=…` → `DATA_DIR=/data` を設定。

---

## デプロイ後：vMix側の設定（配信PC）

1. デプロイ先URLを確認：
   - 操作画面 … `https://<your-host>/`（ログイン）
   - 出力URL … `https://<your-host>/output`
     （`OUTPUT_TOKEN`設定時は `https://<your-host>/output?token=<値>`。
      操作画面の「出力画面を開く」リンクが正しいURLになっています）
2. vMix → **入力の追加 → その他 → Web ブラウザ** → 出力URLを入力、解像度 1920×1080。
3. オーバーレイに重ね、操作画面で「オンエア」を押すと表示。

---

## トラブルシュート

- **操作画面が403/ログインに戻る** … `APP_PASSWORD` 未設定 or 誤り。Cookieは7日有効。
- **出力画面が「トークンが必要」** … `OUTPUT_TOKEN` 設定時は `?token=…` 付きURLでアクセス。
- **WebSocketが繋がらない**（"未接続"のまま） … サーバーレス環境ではないか確認（Vercel/Netlify不可）。
- **再起動でキューが消える** … 永続ディスク＋`DATA_DIR` を設定（無料プランは消える前提）。
- **自動取得が失敗する** … クラウドIPが弾かれている可能性。**手入力に切替**で運用継続可。
