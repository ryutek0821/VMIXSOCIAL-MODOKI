// 認証ヘルパー（マルチテナント対応）。
// セッションはステートレスな「署名付きCookie」。payload {role:'admin'|'service', sid?} を
//   base64url(JSON) + "." + HMAC-SHA256(SESSION_SECRET)
// として Cookie(vms_auth) に格納する。改ざんは署名検証で弾く。
// パスワード照合は accounts.js（scrypt）側で行い、ここはセッションの発行/検証/認可のみを担う。

import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET =
  process.env.SESSION_SECRET ||
  process.env.ADMIN_PASSWORD ||
  process.env.APP_PASSWORD ||
  'vmixsocial-dev-secret';
const COOKIE = 'vms_auth';
const MAX_AGE = 7 * 24 * 60 * 60; // 7日

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (str) => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sign = (data) => createHmac('sha256', SECRET).update(data).digest('hex');

// 定数時間の文字列比較（トークン照合などに使用）
export function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function encodeToken(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
function decodeToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac || !constantTimeEqual(mac, sign(body))) return null;
  try {
    return JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
}

export function issueSession(res, payload, secure) {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${MAX_AGE}`];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeToken(payload)}; ${attrs.join('; ')}`);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
}

// 現在のセッション {role, sid} を取得（無効/未ログインなら null）
export function readSession(req) {
  const token = parseCookies(req.headers?.cookie || '')[COOKIE];
  const data = decodeToken(token);
  if (!data || (data.role !== 'admin' && data.role !== 'service')) return null;
  return data;
}

// 操作画面・操作API用ミドルウェア：service セッション必須。成功時 req.serviceId を付与。
export function requireService(req, res, next) {
  const s = readSession(req);
  if (s && s.role === 'service' && s.sid) {
    req.serviceId = s.sid;
    return next();
  }
  // /api/* は originalUrl で判定（マウントで req.path が相対化されるため）
  if ((req.originalUrl || req.url).startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: '認証が必要です（再ログインしてください）' });
  }
  return res.redirect('/login');
}

// 管理画面・管理API用ミドルウェア：admin セッション必須。
export function requireAdmin(req, res, next) {
  const s = readSession(req);
  if (s && s.role === 'admin') return next();
  if ((req.originalUrl || req.url).startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: '管理者認証が必要です' });
  }
  return res.redirect('/admin/login');
}
