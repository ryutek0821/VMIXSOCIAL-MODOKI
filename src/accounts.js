// アカウント/サービス（テナント）の管理＋永続化。
// data/accounts.json に「管理者」と「サービス（= ログインID + パスワード のテナント）」を保存する。
// - パスワードは scrypt + ランダムsalt でハッシュ化（平文は保存しない）。
// - 出力トークンはサービスごとにランダム発行（vMix用の出力URLに使う）。
// 新規npm依存は使わず node:crypto のみを利用する。

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  ACCOUNTS_FILE,
  ensureDirs,
  ensureServiceDir,
  serviceDir,
  isValidServiceId,
} from './paths.js';

let accounts = { admin: null, services: {} };

export function loadAccounts() {
  try {
    if (existsSync(ACCOUNTS_FILE)) {
      const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
      accounts = {
        admin: raw.admin || null,
        services: raw.services && typeof raw.services === 'object' ? raw.services : {},
      };
    }
  } catch (err) {
    console.error('[accounts] 読み込み失敗。初期化します:', err.message);
    accounts = { admin: null, services: {} };
  }
  return accounts;
}

function persist() {
  try {
    ensureDirs();
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  } catch (err) {
    console.error('[accounts] 保存失敗:', err.message);
  }
}

// ---- パスワードハッシュ（scrypt） ----
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw ?? ''), salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  let actual;
  try {
    actual = scryptSync(String(pw ?? ''), Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const genToken = () => randomBytes(16).toString('hex');

function weakPasswordError() {
  const e = new Error('パスワードは4文字以上にしてください');
  e.code = 'WEAK_PASSWORD';
  return e;
}

// ---- 管理者 ----
export function hasAdmin() {
  return !!(accounts.admin && accounts.admin.passwordHash);
}
export function setAdminPassword(pw) {
  accounts.admin = { passwordHash: hashPassword(pw) };
  persist();
}
export function verifyAdmin(pw) {
  return hasAdmin() && verifyPassword(pw, accounts.admin.passwordHash);
}

// ---- サービス（テナント） ----
export function getService(id) {
  return accounts.services[id] || null;
}
export function serviceExists(id) {
  return !!accounts.services[id];
}
export function getOutputToken(id) {
  const s = accounts.services[id];
  return s ? s.outputToken : null;
}
export function verifyService(id, pw) {
  const s = accounts.services[id];
  return !!s && verifyPassword(pw, s.passwordHash);
}

// パスワードハッシュを除いた公開情報の一覧（管理画面用）。outputToken は出力URL生成に必要なので含む。
export function listServices() {
  return Object.entries(accounts.services)
    .map(([id, s]) => ({
      id,
      name: s.name || id,
      outputToken: s.outputToken,
      createdAt: s.createdAt || 0,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// 管理画面からの新規作成（厳格バリデーション）。
export function createService({ id, name, password }) {
  if (!isValidServiceId(id)) {
    const e = new Error('IDは英小文字・数字・「-」「_」のみ（先頭は英数字、2〜31文字）で指定してください');
    e.code = 'INVALID_ID';
    throw e;
  }
  if (accounts.services[id]) {
    const e = new Error('そのIDは既に使われています');
    e.code = 'DUPLICATE';
    throw e;
  }
  if (!password || String(password).length < 4) throw weakPasswordError();

  accounts.services[id] = {
    name: (name || id).toString().slice(0, 60),
    passwordHash: hashPassword(password),
    outputToken: genToken(),
    createdAt: Date.now(),
  };
  ensureServiceDir(id);
  persist();
  return { id, name: accounts.services[id].name, outputToken: accounts.services[id].outputToken };
}

export function renameService(id, name) {
  const s = accounts.services[id];
  if (!s) return false;
  s.name = (name || id).toString().slice(0, 60);
  persist();
  return true;
}
export function setServicePassword(id, password) {
  const s = accounts.services[id];
  if (!s) return false;
  if (!password || String(password).length < 4) throw weakPasswordError();
  s.passwordHash = hashPassword(password);
  persist();
  return true;
}
export function regenerateOutputToken(id) {
  const s = accounts.services[id];
  if (!s) return null;
  s.outputToken = genToken();
  persist();
  return s.outputToken;
}
export function deleteService(id) {
  if (!accounts.services[id]) return false;
  delete accounts.services[id];
  persist();
  try {
    rmSync(serviceDir(id), { recursive: true, force: true });
  } catch (err) {
    console.error('[accounts] サービスデータ削除失敗:', err.message);
  }
  return true;
}

// マイグレーション/初期化用（冪等・寛容）。既存なら何もしない。outputToken を指定可（旧OUTPUT_TOKEN引継ぎ）。
export function ensureService(id, { name, password, outputToken } = {}) {
  if (accounts.services[id]) return accounts.services[id];
  if (!isValidServiceId(id)) throw new Error(`invalid service id: ${id}`);
  accounts.services[id] = {
    name: (name || id).toString().slice(0, 60),
    passwordHash: hashPassword(password),
    outputToken: outputToken || genToken(),
    createdAt: Date.now(),
  };
  ensureServiceDir(id);
  persist();
  return accounts.services[id];
}
