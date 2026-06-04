# VMIXSOCIAL もどき — プロジェクトメモ

API 無しで動く X(Twitter) 投稿オーバーレイ表示ツール（vMix Social もどき）。
Node.js（Express + WebSocket）。詳細は README.md、構成・補足は DEPLOY.md を参照。

## 本番環境・デプロイ（重要・最初に読むこと）

- **本番URL**: https://vmixsocial-modoki.ryuteklabo.com
- **インフラ**: **このリポジトリが置かれたマシン自体が本番サーバー（自鯖）**。
  launchd 常駐ジョブ **`com.ryuteklabo.vmixsocial`**（`~/Library/LaunchAgents/com.ryuteklabo.vmixsocial.plist`、KeepAlive）が
  起動スクリプト **`start-fixed.sh`** を常時稼働させ、その中で
  `node server.js`（PORT は毎回ランダム）＋ `cloudflared run vmix`（名前付きトンネル＝固定URL）を起動している。
  - 本体 worktree は `/Users/ryuheitakeda/ClaudeCode/VMIXSOCIAL-MODOKI`（ブランチ `main`）。
  - パスワードは `.public-pass.txt`（操作）/ `.admin-pass.txt`（管理）に永続 → 再起動でも不変。
  - データは `data/`（git 管理外）。`DATA_DIR` 未設定。`start-fixed.sh` 等の起動スクリプトも git 管理外のローカルファイル。
- **Render は使っていない**（過去に使用 → 現在は廃止）。
  - `render.yaml` / `DEPLOY.md` の「Render / Railway / Fly.io」手順、および `chore/ci-ssh-deploy` の
    SSH デプロイ用 `deploy.yml` は **いずれも未使用のレガシー/参考**。デプロイ時に前提にしないこと。

### デプロイ手順（この自鯖で実際に有効な方法）
1. 変更を `main` にマージ（PR 経由）する。
2. 本体 worktree のコードを最新化（フロントの静的アセットはこれだけで即反映。`server.js`/`src/*` は次の再起動で反映）:
   ```bash
   git -C /Users/ryuheitakeda/ClaudeCode/VMIXSOCIAL-MODOKI fetch origin
   git -C /Users/ryuheitakeda/ClaudeCode/VMIXSOCIAL-MODOKI merge --ff-only origin/main
   ```
3. 再起動は **launchd 経由**で行う:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.ryuteklabo.vmixsocial
   ```
   - ⚠️ **`./start-fixed.sh` を手動で叩かないこと。** launchd が常に1本生かしているため、手動起動すると
     supervisor / cloudflared が二重になり、同一トンネル `vmix` を奪い合って不安定化する
     （プロセスを kill しても launchd が即再起動する＝手動起動は不要）。
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
