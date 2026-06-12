# VMIXSOCIAL もどき — プロジェクトメモ

API 無しで動く X(Twitter) 投稿オーバーレイ表示ツール（vMix Social もどき）。
Node.js（Express + WebSocket）。詳細は README.md、構成・補足は DEPLOY.md を参照。

## 本番環境・デプロイ（重要・最初に読むこと）

- **本番URL**: https://vmixsocial-modoki.ryuteklabo.com
- **インフラ（2026-06-11 移行）**: 本番は **RYU-SERVER**（Ubuntu VM `vm-0a86daa0-1d`、Tailscale `100.87.72.38`、`ssh RYU-SERVER` で接続可）。
  **このMac（開発機）はもう本番ではない**（旧 launchd 構成 `com.ryuteklabo.vmixsocial` は廃止済み）。
  - アプリ: `/home/ryu/VMIXSOCIAL-MODOKI`（ブランチ `main`）を **systemd ユニット `vmixsocial.service`** で常駐
    （`User=ryu` / `Restart=always` / `EnvironmentFile=/home/ryu/VMIXSOCIAL-MODOKI/.env.systemd`）。
  - **PORT=3100 固定**・`SESSION_SECRET` は `.env.systemd`（chmod 600、git 管理外）に永続。
  - データは `/home/ryu/VMIXSOCIAL-MODOKI/data/`（git 管理外、`DATA_DIR` 未設定）。
    管理者/サービスのパスワードは `data/accounts.json` 内に永続（旧Macから移行済み）。
  - 公開: 同サーバーの **`cloudflared.service`**（トークン式トンネル `6fb3a187-4570-4c87-997b-b7d933b278a6`、**lr2ir-miuchi と共用**）経由。
    ingress（`vmixsocial-modoki.ryuteklabo.com` → `http://localhost:3100`）は
    **リモート設定（Cloudflare ダッシュボード/API）とサーバー上の `/etc/cloudflared/config.yml` の両方**に定義してある
    （2026-06-12 整備。変更時は両方を揃えること。config.yml 反映には cloudflared 再起動が必要 → lr2ir も数秒断）。
  - DNS: `vmixsocial-modoki` の CNAME は `6fb3a187-….cfargotunnel.com` を指すこと。
    旧Macトンネル `885037b7-…`（削除せず down のまま残存）を指すと **Error 1033** になる（2026-06-12 障害の原因）。
  - ufw 有効: 3100 は外部非公開（トンネル経由のみ）。SSH は Tailscale 経由のみ許可。
- **Render は使っていない**（過去に使用 → 現在は廃止）。
  - `render.yaml` / `DEPLOY.md` の「Render / Railway / Fly.io」手順、および `chore/ci-ssh-deploy` の
    SSH デプロイ用 `deploy.yml` は **いずれも未使用のレガシー/参考**。デプロイ時に前提にしないこと。

### デプロイ手順（RYU-SERVER で実際に有効な方法）
1. 変更を `main` にマージ（PR 経由）する。
2. 本番のコードを最新化（フロントの静的アセットはこれだけで即反映。`server.js`/`src/*` は次の再起動で反映）:
   ```bash
   ssh RYU-SERVER 'git -C ~/VMIXSOCIAL-MODOKI fetch origin && git -C ~/VMIXSOCIAL-MODOKI merge --ff-only origin/main'
   ```
   ※ GitHub から pull できない場合（認証等）は、開発機から bundle を送る:
   ```bash
   git -C /Users/ryuheitakeda/ClaudeCode/VMIXSOCIAL-MODOKI bundle create /tmp/vmixsocial.bundle main
   scp /tmp/vmixsocial.bundle RYU-SERVER:/tmp/ && ssh RYU-SERVER 'git -C ~/VMIXSOCIAL-MODOKI pull /tmp/vmixsocial.bundle main'
   ```
3. 再起動は **systemd 経由**で行う（cloudflared は別ユニットなので触らない）:
   ```bash
   ssh RYU-SERVER 'sudo systemctl restart vmixsocial'
   ```
   - ⚠️ `cloudflared.service` は他プロジェクトと共用の可能性があるため、本アプリのデプロイでは再起動しない。
4. **反映確認**（認証不要の公開アセットで判定）:
   ```bash
   curl -s https://vmixsocial-modoki.ryuteklabo.com/card.js | grep -c x-card--banner
   ```
   （0 なら旧コード、1 以上で新コード反映済み）

## 開発メモ
- 表示設定は `settings`（`theme` / `position` / `layout`）。`layout` は `card`（縦型）/ `banner`（下部横長テロップ）。
- カード描画は `public/card.js`（操作画面プレビューと出力画面で共用）。
- 認証必須ルート以外（`/card.js` `/card.css` `/output.css` `/control.js` などの静的アセット）は
  未認証で取得可能 → 本番反映チェックに使える。
- 主要ファイルの役割は README.md「構成」表を参照。
