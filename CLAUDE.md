# VMIXSOCIAL もどき — プロジェクトメモ

API 無しで動く X(Twitter) 投稿オーバーレイ表示ツール（vMix Social もどき）。
Node.js（Express + WebSocket）。詳細は README.md、構成・補足は DEPLOY.md を参照。

## 本番環境・デプロイ（重要・最初に読むこと）

- **本番URL**: https://vmixsocial-modoki.ryuteklabo.com
- **インフラ**: **自前サーバー（自鯖）を Cloudflare Tunnel で公開**している。
- **Render は使っていない**（過去に使用 → 現在は廃止）。
  - リポジトリ内の `render.yaml` と `DEPLOY.md` の「Render / Railway / Fly.io」手順は
    **レガシー（参考情報）**であり、本番の実体ではない。
  - ⚠️ デプロイの話をするとき **Render を前提にしないこと**（ユーザーに何度も訂正させている）。

### デプロイの流れ
1. 変更を `main` に反映（PR マージ等）する。
2. **`main` への push だけでは本番に反映されない**。自鯖側のコード更新＋再起動が必要。
   - **自動化（想定）**: SSH デプロイ用ワークフロー `.github/workflows/deploy.yml` が
     ブランチ `chore/ci-ssh-deploy` にある。`main` への push で自鯖へ SSH 接続し
     `git reset --hard origin/main` → `npm install --omit=dev` → 再起動、という内容。
     **`main` にマージされて初めて有効**になる（2026-06 時点では未マージ＝無効）。
     稼働には Secrets（`SSH_HOST` / `SSH_USER` / `SSH_KEY` / `SSH_PORT`）と
     Variables（`APP_DIR` / `RESTART_CMD`）の設定が必要。
   - **手動**: 自鯖上で
     `git fetch && git reset --hard origin/main && npm install --omit=dev && <再起動コマンド>`。
3. **反映確認**: 認証不要の公開アセットで判定できる。例
   `curl -s https://vmixsocial-modoki.ryuteklabo.com/card.js | grep -c x-card--banner`
   （0 なら旧コード、1 以上なら新コードが反映済み）

## 開発メモ
- 表示設定は `settings`（`theme` / `position` / `layout`）。`layout` は `card`（縦型）/ `banner`（下部横長テロップ）。
- カード描画は `public/card.js`（操作画面プレビューと出力画面で共用）。
- 認証必須ルート以外（`/card.js` `/card.css` `/output.css` `/control.js` などの静的アセット）は
  未認証で取得可能 → 本番反映チェックに使える。
- 主要ファイルの役割は README.md「構成」表を参照。
