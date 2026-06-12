// VMIXSOCIAL もどき サーバー本体（マルチテナント）
// - 「アカウント（ID + パスワード）＝ 1 サービス」。各サービスは独立したキュー/オンエア/出力URLを持つ。
// - 管理者は管理画面(/admin)からサービスを追加/削除/パスワード変更できる。
// - 状態の変更は REST、出力への反映は WebSocket（サービス単位のルーム）ブロードキャスト。
// - 旧・単一テナント運用（APP_PASSWORD / data/queue.json）は起動時に default サービスへ自動移行。

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';

import * as state from './src/state.js';
import * as accounts from './src/accounts.js';
import { fetchTweet, cacheImage, saveDataUrl } from './src/twitter.js';
import { ensureDirs, MEDIA_DIR, QUEUE_FILE, serviceQueueFile, ensureServiceDir } from './src/paths.js';
import {
  issueSession,
  clearSession,
  readSession,
  requireService,
  requireAdmin,
  constantTimeEqual,
} from './src/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(__dirname, 'public');

// ---- 起動時マイグレーション/初期化 ----
const generated = {}; // 初回自動生成したパスワードを起動バナーで知らせる
const randomPw = () => randomBytes(6).toString('hex'); // 12桁

function migrate() {
  // 管理者：ADMIN_PASSWORD があれば常にそれを採用（env優先で再設定）。無ければ未設定時のみ自動生成。
  if (process.env.ADMIN_PASSWORD) {
    accounts.setAdminPassword(process.env.ADMIN_PASSWORD);
  } else if (!accounts.hasAdmin()) {
    const pw = randomPw();
    generated.admin = pw;
    accounts.setAdminPassword(pw);
  }
  // 旧・単一テナント（queue.json / APP_PASSWORD）を default サービスへ引き継ぎ
  const legacyExists = existsSync(QUEUE_FILE);
  if ((legacyExists || process.env.APP_PASSWORD) && !accounts.serviceExists('default')) {
    let pw = process.env.APP_PASSWORD;
    if (!pw) {
      pw = randomPw();
      generated.default = pw;
    }
    accounts.ensureService('default', {
      name: 'default',
      password: pw,
      outputToken: process.env.OUTPUT_TOKEN || undefined,
    });
    if (legacyExists && !existsSync(serviceQueueFile('default'))) {
      ensureServiceDir('default');
      try {
        copyFileSync(QUEUE_FILE, serviceQueueFile('default'));
      } catch (err) {
        console.error('[migrate] 旧 queue.json の移行に失敗:', err.message);
      }
    }
  }
}

ensureDirs();
accounts.loadAccounts();
migrate();

// サービスの出力URL（相対パス。クライアント側で origin を前置）
const outputPath = (sid) =>
  `/output?service=${encodeURIComponent(sid)}&token=${accounts.getOutputToken(sid)}`;

// サービスの操作用URL（ログインページに ID をプリフィル）
const controlPath = (sid) => `/login?id=${encodeURIComponent(sid)}`;

// 出力（/output・WS）へのアクセス可否：管理者 or そのサービスの操作Cookie or 正しい出力トークン
function outputAuthorized(req, sid, token) {
  const sess = readSession(req);
  if (sess?.role === 'admin') return true;
  if (sess?.role === 'service' && sess.sid === sid) return true;
  const expected = accounts.getOutputToken(sid);
  return !!expected && constantTimeEqual(token, expected);
}

const app = express();
app.set('trust proxy', 1); // PaaS/プロキシ越しでも req.secure / IP を正しく判定
app.use(express.json({ limit: '20mb' })); // アップロード画像(data URL)用に上限を引き上げ

const isSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

// ヘルスチェック（PaaS用・認証不要）
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- 操作画面ログイン（ID + パスワード）----
app.get('/login', (req, res) => {
  if (readSession(req)?.role === 'service') return res.redirect('/');
  res.sendFile(join(PUBLIC_DIR, 'login.html'));
});
app.post('/login', (req, res) => {
  const { id, password } = req.body || {};
  if (accounts.verifyService(id, password)) {
    issueSession(res, { role: 'service', sid: id }, isSecure(req));
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'IDまたはパスワードが違います' });
});
app.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// ---- 管理者ログイン ----
app.post('/admin/login', (req, res) => {
  if (accounts.verifyAdmin(req.body?.password)) {
    issueSession(res, { role: 'admin' }, isSecure(req));
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: '管理者パスワードが違います' });
});

// 静的アセット（css/js/画像）— 認証不要。出力画面・ログイン画面・管理画面でも使う。
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/media', express.static(MEDIA_DIR));

// 管理画面（UIは静的。実データ取得/操作は /api/admin/* 側で認可）
app.get(['/admin', '/admin/login'], (req, res) => res.sendFile(join(PUBLIC_DIR, 'admin.html')));

// 出力画面（service + token、またはそのサービスの操作Cookie/管理者）
app.get('/output', (req, res) => {
  // 後方互換: service未指定でサービスが1つだけなら、その正規URL（service+token付き）へ転送。
  // 旧 "/output" だけの vMix 設定をそのまま使える（サービスが複数になると無効）。
  if (!req.query.service) {
    const only = accounts.listServices();
    if (only.length === 1) return res.redirect(outputPath(only[0].id));
  }
  const sid = req.query.service;
  if (!sid || !accounts.serviceExists(sid)) {
    return res.status(404).send('サービスが見つかりません。出力URLを確認してください。');
  }
  if (!outputAuthorized(req, sid, req.query.token)) {
    return res
      .status(401)
      .send('この出力画面はトークンが必要です。管理画面のサービス別「出力URL」からアクセスしてください。');
  }
  res.sendFile(join(PUBLIC_DIR, 'output.html'));
});

// 操作画面（service セッション必須）
app.get('/', requireService, (req, res) => res.sendFile(join(PUBLIC_DIR, 'control.html')));

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

// ================= 管理API（admin セッション必須） =================
const adminApi = express.Router();
adminApi.use(requireAdmin);

adminApi.get('/services', (req, res) => {
  res.json({
    ok: true,
    services: accounts.listServices().map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      outputUrl: outputPath(s.id),
      controlUrl: controlPath(s.id),
    })),
  });
});

adminApi.post('/services', (req, res) => {
  try {
    const { id, name, password } = req.body || {};
    const svc = accounts.createService({ id, name, password });
    state.initService(svc.id);
    res.json({ ok: true, service: { id: svc.id, name: svc.name, outputUrl: outputPath(svc.id), controlUrl: controlPath(svc.id) } });
  } catch (err) {
    res.status(400).json({ ok: false, code: err.code || 'ERROR', error: err.message });
  }
});

adminApi.patch('/services/:id', (req, res) => {
  const id = req.params.id;
  if (!accounts.serviceExists(id)) return res.status(404).json({ ok: false, error: 'サービスが見つかりません' });
  try {
    const { name, password, regenerateToken } = req.body || {};
    if (typeof name === 'string' && name.trim()) accounts.renameService(id, name.trim());
    if (password) accounts.setServicePassword(id, password);
    if (regenerateToken) accounts.regenerateOutputToken(id);
    res.json({ ok: true, outputUrl: outputPath(id) });
  } catch (err) {
    res.status(400).json({ ok: false, code: err.code || 'ERROR', error: err.message });
  }
});

adminApi.delete('/services/:id', (req, res) => {
  const ok = accounts.deleteService(req.params.id);
  if (ok) state.dropService(req.params.id);
  res.json({ ok });
});

app.use('/api/admin', adminApi);

// ================= 操作API（service セッション必須・req.serviceId にスコープ） =================
const api = express.Router();
api.use(requireService);

// クライアント設定（サービス名・出力URL）
api.get('/config', (req, res) => {
  const svc = accounts.getService(req.serviceId);
  res.json({
    serviceId: req.serviceId,
    serviceName: svc?.name || req.serviceId,
    outputUrl: outputPath(req.serviceId),
  });
});

// 現在状態の取得
api.get('/state', (req, res) => res.json(state.getState(req.serviceId)));

// X投稿の自動取得（正規化データを返すだけ。キューには追加しない）
api.post('/fetch', async (req, res) => {
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
api.post('/upload', (req, res) => {
  const path = saveDataUrl(req.body?.dataUrl);
  if (!path) return res.status(400).json({ ok: false, error: '画像データが不正です' });
  res.json({ ok: true, path });
});

// 追加
api.post('/tweets', async (req, res) => {
  const body = await resolveMedia(req.body || {});
  res.json({ ok: true, tweet: state.addTweet(req.serviceId, body) });
});

// 更新
api.put('/tweets/:id', async (req, res) => {
  const body = await resolveMedia(req.body || {});
  const tweet = state.updateTweet(req.serviceId, req.params.id, body);
  if (!tweet) return res.status(404).json({ ok: false, error: '対象が見つかりません' });
  res.json({ ok: true, tweet });
});

// 削除
api.delete('/tweets/:id', (req, res) => {
  res.json({ ok: state.deleteTweet(req.serviceId, req.params.id) });
});

// 並べ替え（up/down）
api.post('/tweets/:id/reorder', (req, res) => {
  res.json({ ok: state.reorderTweet(req.serviceId, req.params.id, req.body?.direction) });
});

// オンエア切替（id を渡すと表示、null で非表示）
api.post('/onair', (req, res) => {
  res.json({ ok: state.setOnAir(req.serviceId, req.body?.id ?? null) });
});

// 表示設定（テーマ/位置）
api.post('/settings', (req, res) => {
  res.json({ ok: true, settings: state.updateSettings(req.serviceId, req.body || {}) });
});

app.use('/api', api);

// ================= WebSocket（サービス単位のルーム） =================
const server = createServer(app);
const wss = new WebSocketServer({ server });

// 接続元の所属サービスを決定（操作Cookie or 出力トークン）。未認可は null。
function wsResolveService(req) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return null;
  }
  const qSid = url.searchParams.get('service');
  const token = url.searchParams.get('token');
  const sess = readSession(req);
  // 操作画面：service セッション（service未指定 or 自分のserviceなら許可）
  if (sess?.role === 'service' && sess.sid && (!qSid || qSid === sess.sid)) return sess.sid;
  // 出力画面/プレビュー：service + 正しいトークン（または管理者/該当操作Cookie）
  if (qSid && accounts.serviceExists(qSid) && outputAuthorized(req, qSid, token)) return qSid;
  return null;
}

function broadcast(serviceId, data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */ && client.serviceId === serviceId) client.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const sid = wsResolveService(req);
  if (!sid) {
    try {
      ws.close(1008, 'unauthorized');
    } catch {
      /* noop */
    }
    return;
  }
  ws.serviceId = sid;
  ws.send(JSON.stringify({ type: 'state', state: state.getState(sid) }));
});

state.events.on('change', ({ serviceId, state: s }) => broadcast(serviceId, { type: 'state', state: s }));

// ---- 起動 ----
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

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
  const line = '─'.repeat(56);
  console.log('\n  VMIXSOCIAL もどき（マルチテナント）が起動しました');
  console.log(`  ${line}`);
  console.log(`  管理画面          : http://localhost:${PORT}/admin`);
  console.log(`  操作画面ログイン  : http://localhost:${PORT}/login   （LAN: http://${ip}:${PORT}/login）`);
  console.log(`  ${line}`);
  console.log(`  登録サービス数    : ${accounts.listServices().length}`);
  console.log('  各サービスの出力URL（vMix用）は管理画面で確認/コピーできます。');
  console.log(`  ${line}`);
  if (generated.admin) console.log(`  ★ 管理者パスワード（自動生成）          : ${generated.admin}`);
  if (generated.default) console.log(`  ★ default サービスのパスワード（自動生成）: ${generated.default}`);
  if (generated.admin || generated.default) console.log(`  ${line}`);
  console.log('  停止: Ctrl + C\n');
});
