// VMIXSOCIAL もどき サーバー本体
// - express で操作画面/出力画面/メディアを配信
// - WebSocket で状態をリアルタイム配信（操作画面 → サーバー → 出力画面/vMix内ブラウザ）
// - 状態の変更は REST API、出力への反映は WebSocket ブロードキャストという一方向フロー
// - APP_PASSWORD で操作画面/書き込みAPIを保護（公開デプロイ向け）

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import * as state from './src/state.js';
import { fetchTweet, cacheImage, saveDataUrl } from './src/twitter.js';
import { ensureDirs, MEDIA_DIR } from './src/paths.js';
import {
  authEnabled,
  outputTokenEnabled,
  getOutputToken,
  checkPassword,
  checkOutputToken,
  hasValidCookie,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} from './src/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(__dirname, 'public');

ensureDirs();
state.load();

const app = express();
app.set('trust proxy', 1); // PaaSのリバースプロキシ越しでも req.secure / IP を正しく判定
app.use(express.json({ limit: '20mb' })); // アップロード画像(data URL)用に上限を引き上げ

const isSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

// ヘルスチェック（PaaS用・認証不要）
app.get('/healthz', (req, res) => res.json({ ok: true }));

// --- ログイン ---
app.get('/login', (req, res) => {
  if (!authEnabled() || hasValidCookie(req)) return res.redirect('/');
  res.sendFile(join(PUBLIC_DIR, 'login.html'));
});
app.post('/login', (req, res) => {
  if (!authEnabled()) return res.json({ ok: true });
  if (checkPassword(req.body?.password)) {
    setAuthCookie(res, isSecure(req));
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'パスワードが違います' });
});
app.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// 静的アセット（css/js/画像）— 認証不要。出力画面やログイン画面でも使うため。
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/media', express.static(MEDIA_DIR));

// 出力画面（OUTPUT_TOKEN設定時はトークン or ログインCookie必須）
app.get('/output', (req, res) => {
  if (outputTokenEnabled() && !hasValidCookie(req) && !checkOutputToken(req.query.token)) {
    return res
      .status(401)
      .send('この出力画面はトークンが必要です。URL末尾に ?token=... を付けてアクセスしてください。');
  }
  res.sendFile(join(PUBLIC_DIR, 'output.html'));
});

// 操作画面（認証必須）
app.get('/', requireAuth, (req, res) => res.sendFile(join(PUBLIC_DIR, 'control.html')));

// --- ここから下の /api/* はすべて認証必須 ---
app.use('/api', requireAuth);

// クライアント設定（出力URL生成・ログアウト表示用）
app.get('/api/config', (req, res) => {
  res.json({ authEnabled: authEnabled(), outputToken: getOutputToken() || null });
});

// 現在状態の取得
app.get('/api/state', (req, res) => res.json(state.getState()));

// avatar / image を保存形式（/media パス or 外部URL）に解決する
async function resolveMedia(body) {
  const out = { ...body };
  for (const key of ['avatar', 'image']) {
    const v = out[key];
    if (!v || typeof v !== 'string') continue;
    if (v.startsWith('data:')) out[key] = saveDataUrl(v) || (key === 'image' ? null : '');
    else if (/^https?:\/\//.test(v)) out[key] = await cacheImage(v);
    // それ以外（/media/... など）はそのまま
  }
  return out;
}

// X投稿の自動取得（正規化データを返すだけ。キューには追加しない）
app.post('/api/fetch', async (req, res) => {
  try {
    const tweet = await fetchTweet(req.body?.url);
    tweet.avatar = await cacheImage(tweet.avatar);
    if (tweet.image) tweet.image = await cacheImage(tweet.image);
    res.json({ ok: true, tweet });
  } catch (err) {
    res.status(400).json({ ok: false, code: err.code || 'ERROR', error: err.message });
  }
});

// 画像アップロード（data URL → /media パス）
app.post('/api/upload', (req, res) => {
  const path = saveDataUrl(req.body?.dataUrl);
  if (!path) return res.status(400).json({ ok: false, error: '画像データが不正です' });
  res.json({ ok: true, path });
});

// 追加
app.post('/api/tweets', async (req, res) => {
  const body = await resolveMedia(req.body || {});
  res.json({ ok: true, tweet: state.addTweet(body) });
});

// 更新
app.put('/api/tweets/:id', async (req, res) => {
  const body = await resolveMedia(req.body || {});
  const tweet = state.updateTweet(req.params.id, body);
  if (!tweet) return res.status(404).json({ ok: false, error: '対象が見つかりません' });
  res.json({ ok: true, tweet });
});

// 削除
app.delete('/api/tweets/:id', (req, res) => {
  res.json({ ok: state.deleteTweet(req.params.id) });
});

// 並べ替え（up/down）
app.post('/api/tweets/:id/reorder', (req, res) => {
  res.json({ ok: state.reorderTweet(req.params.id, req.body?.direction) });
});

// オンエア切替（id を渡すと表示、null で非表示）
app.post('/api/onair', (req, res) => {
  res.json({ ok: state.setOnAir(req.body?.id ?? null) });
});

// 表示設定（テーマ/位置）
app.post('/api/settings', (req, res) => {
  res.json({ ok: true, settings: state.updateSettings(req.body || {}) });
});

// --- WebSocket（状態ブロードキャスト） ---
const server = createServer(app);
const wss = new WebSocketServer({ server });

// OUTPUT_TOKEN設定時はWS接続もトークン/Cookie必須にする
function wsAllowed(req) {
  if (!outputTokenEnabled()) return true; // 公開 or パスワードのみ → WS開放
  if (hasValidCookie(req)) return true; // ログイン済み操作画面
  let token = null;
  try {
    token = new URL(req.url, 'http://localhost').searchParams.get('token');
  } catch {
    token = null;
  }
  return checkOutputToken(token);
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  if (!wsAllowed(req)) {
    try {
      ws.close(1008, 'unauthorized');
    } catch {
      /* noop */
    }
    return;
  }
  ws.send(JSON.stringify({ type: 'state', state: state.getState() }));
});

state.events.on('change', (s) => broadcast({ type: 'state', state: s }));

// --- 起動 ---
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ポート衝突などの起動エラーを分かりやすく表示
function onServerError(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ ポート ${PORT} は既に使用中です。別ポートで起動してください:`);
    console.error(`      PORT=8080 npm start\n`);
  } else {
    console.error('\n  ✗ サーバー起動エラー:', err.message, '\n');
  }
  process.exit(1);
}
server.on('error', onServerError);
wss.on('error', onServerError);

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLanIp();
  const line = '─'.repeat(52);
  console.log('\n  VMIXSOCIAL もどき が起動しました');
  console.log(`  ${line}`);
  console.log(`  操作画面 (このPC) : http://localhost:${PORT}/`);
  console.log(`  操作画面 (LAN)    : http://${ip}:${PORT}/`);
  console.log(`  ${line}`);
  console.log('  ↓ vMix の「Webブラウザ」入力に設定する出力URL');
  const tokenSuffix = outputTokenEnabled() ? `?token=${getOutputToken()}` : '';
  console.log(`  出力URL           : http://${ip}:${PORT}/output${tokenSuffix}`);
  console.log(`  ${line}`);
  console.log(`  認証              : ${authEnabled() ? 'ON（APP_PASSWORD）' : 'OFF（LAN想定／公開時は要設定）'}`);
  console.log(`  出力トークン      : ${outputTokenEnabled() ? 'ON（OUTPUT_TOKEN）' : 'OFF'}`);
  console.log(`  ${line}`);
  console.log('  停止: Ctrl + C\n');
});
