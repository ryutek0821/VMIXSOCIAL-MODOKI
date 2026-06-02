// 認証ヘルパー。
// - APP_PASSWORD: 設定すると操作画面と書き込みAPIをパスワード保護（Cookieセッション）。
//   未設定なら認証なし（LAN内利用向け）。
// - OUTPUT_TOKEN: 設定すると出力画面とWebSocketもトークン必須にできる（完全非公開化）。

import { createHmac, timingSafeEqual } from 'node:crypto';

const PASSWORD = process.env.APP_PASSWORD || '';
const OUTPUT_TOKEN = process.env.OUTPUT_TOKEN || '';
const SECRET = process.env.SESSION_SECRET || PASSWORD || 'vmixsocial-dev-secret';
const COOKIE = 'vms_auth';

export const authEnabled = () => PASSWORD.length > 0;
export const outputTokenEnabled = () => OUTPUT_TOKEN.length > 0;
export const getOutputToken = () => OUTPUT_TOKEN;

// ログイン状態を表すCookie値（パスワード/シークレットから決定的に生成）
function expectedCookieValue() {
  return createHmac('sha256', SECRET).update('authorized').digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkPassword(input) {
  return authEnabled() && safeEqual(input, PASSWORD);
}
export function checkOutputToken(input) {
  return outputTokenEnabled() && safeEqual(input, OUTPUT_TOKEN);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function hasValidCookie(req) {
  if (!authEnabled()) return true; // 認証無効なら常に許可
  const cookies = parseCookies(req.headers?.cookie || '');
  return safeEqual(cookies[COOKIE], expectedCookieValue());
}

export function setAuthCookie(res, secure) {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']; // 7日
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${expectedCookieValue()}; ${attrs.join('; ')}`);
}
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
}

// 操作画面・書き込みAPIを保護するミドルウェア
export function requireAuth(req, res, next) {
  if (hasValidCookie(req)) return next();
  // /api/* マウント時は req.path が相対化されるため originalUrl で判定する
  if ((req.originalUrl || req.url).startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: '認証が必要です（再ログインしてください）' });
  }
  return res.redirect('/login');
}
