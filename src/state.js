// 状態管理 ＋ 永続化（マルチテナント）。
// サービス(sid)ごとに キュー/オンエア/表示設定 を保持し、変更のたびに
//   data/services/<sid>/queue.json へ保存する。
// 変更は events('change', { serviceId, state }) で通知し、server.js が
// 該当サービスのWebSocketクライアントにのみブロードキャストする。

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { serviceQueueFile, ensureServiceDir } from './paths.js';

export const events = new EventEmitter();

const defaultState = () => ({
  queue: [],
  onAirId: null,
  settings: { theme: 'dark', position: 'bottom-left', layout: 'card' },
});

// sid -> ServiceState（メモリキャッシュ。初回アクセス時にディスクから遅延ロード）
const registry = new Map();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 入力データを安全な形へ正規化（文字数制限・型のサニタイズ）
function normalizeTweet(data, keepId) {
  return {
    id: keepId || data.id || genId(),
    name: (data.name ?? '').toString().slice(0, 80),
    handle: (data.handle ?? '').toString().replace(/^@/, '').slice(0, 50),
    avatar: (data.avatar ?? '').toString().slice(0, 2000),
    text: (data.text ?? '').toString().slice(0, 1000),
    image: data.image ? data.image.toString().slice(0, 2000) : null,
    verified: !!data.verified,
    theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : null,
    createdAt: data.createdAt || Date.now(),
  };
}

function readFromDisk(sid) {
  try {
    const file = serviceQueueFile(sid);
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const def = defaultState();
      const s = {
        ...def,
        ...raw,
        settings: { ...def.settings, ...(raw.settings || {}) },
        queue: Array.isArray(raw.queue) ? raw.queue.map((t) => normalizeTweet(t, t.id)) : [],
      };
      if (s.onAirId && !s.queue.some((t) => t.id === s.onAirId)) s.onAirId = null;
      return s;
    }
  } catch (err) {
    console.error(`[state:${sid}] 読み込み失敗。初期化します:`, err.message);
  }
  return defaultState();
}

// sid の状態を取得（未ロードならディスクから遅延ロード）
function get(sid) {
  let s = registry.get(sid);
  if (!s) {
    s = readFromDisk(sid);
    registry.set(sid, s);
  }
  return s;
}

function persist(sid) {
  try {
    ensureServiceDir(sid);
    writeFileSync(serviceQueueFile(sid), JSON.stringify(get(sid), null, 2));
  } catch (err) {
    console.error(`[state:${sid}] 保存失敗:`, err.message);
  }
}

function changed(sid) {
  persist(sid);
  events.emit('change', { serviceId: sid, state: get(sid) });
}

// ---- 公開API（すべて sid 指定） ----
export function getState(sid) {
  return get(sid);
}

// サービス作成時：空状態を用意して保存
export function initService(sid) {
  const s = defaultState();
  registry.set(sid, s);
  persist(sid);
  return s;
}

// サービス削除時：メモリキャッシュから破棄（ディスクは accounts.deleteService が削除）
export function dropService(sid) {
  registry.delete(sid);
}

export function addTweet(sid, data) {
  const s = get(sid);
  const tweet = normalizeTweet(data);
  s.queue.push(tweet);
  changed(sid);
  return tweet;
}

export function updateTweet(sid, id, patch) {
  const s = get(sid);
  const t = s.queue.find((t) => t.id === id);
  if (!t) return null;
  const merged = normalizeTweet({ ...t, ...patch }, id);
  Object.assign(t, merged);
  changed(sid);
  return t;
}

export function deleteTweet(sid, id) {
  const s = get(sid);
  const idx = s.queue.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  s.queue.splice(idx, 1);
  if (s.onAirId === id) s.onAirId = null;
  changed(sid);
  return true;
}

// up/down で隣の要素と入れ替え
export function reorderTweet(sid, id, direction) {
  const s = get(sid);
  const idx = s.queue.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= s.queue.length) return false;
  [s.queue[idx], s.queue[swap]] = [s.queue[swap], s.queue[idx]];
  changed(sid);
  return true;
}

export function setOnAir(sid, id) {
  const s = get(sid);
  if (id !== null && !s.queue.some((t) => t.id === id)) return false;
  s.onAirId = id;
  changed(sid);
  return true;
}

export function updateSettings(sid, patch) {
  const s = get(sid);
  const next = { ...s.settings };
  if (patch.theme === 'light' || patch.theme === 'dark') next.theme = patch.theme;
  if (typeof patch.position === 'string') next.position = patch.position;
  if (patch.layout === 'card' || patch.layout === 'banner') next.layout = patch.layout;
  s.settings = next;
  changed(sid);
  return s.settings;
}
