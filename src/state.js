// 状態管理 ＋ 永続化
// キュー（投稿一覧）/ オンエア中ID / 表示設定 を保持し、変更のたびに data/queue.json へ保存する。
// 変更は events('change') で通知し、server.js が全WebSocketクライアントへブロードキャストする。

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { QUEUE_FILE, ensureDirs } from './paths.js';

export const events = new EventEmitter();

const defaultState = () => ({
  queue: [],
  onAirId: null,
  settings: { theme: 'dark', position: 'bottom-left' },
});

let state = defaultState();

// 起動時に保存済み状態を復元（無ければ初期化）
export function load() {
  try {
    if (existsSync(QUEUE_FILE)) {
      const raw = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
      const def = defaultState();
      state = {
        ...def,
        ...raw,
        settings: { ...def.settings, ...(raw.settings || {}) },
        queue: Array.isArray(raw.queue) ? raw.queue.map((t) => normalizeTweet(t, t.id)) : [],
      };
      if (state.onAirId && !state.queue.some((t) => t.id === state.onAirId)) state.onAirId = null;
    }
  } catch (err) {
    console.error('[state] 読み込み失敗。初期化します:', err.message);
    state = defaultState();
  }
  return state;
}

function persist() {
  try {
    ensureDirs();
    writeFileSync(QUEUE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[state] 保存失敗:', err.message);
  }
}

function changed() {
  persist();
  events.emit('change', state);
}

export function getState() {
  return state;
}

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

export function addTweet(data) {
  const tweet = normalizeTweet(data);
  state.queue.push(tweet);
  changed();
  return tweet;
}

export function updateTweet(id, patch) {
  const t = state.queue.find((t) => t.id === id);
  if (!t) return null;
  const merged = normalizeTweet({ ...t, ...patch }, id);
  Object.assign(t, merged);
  changed();
  return t;
}

export function deleteTweet(id) {
  const idx = state.queue.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  state.queue.splice(idx, 1);
  if (state.onAirId === id) state.onAirId = null;
  changed();
  return true;
}

// up/down で隣の要素と入れ替え
export function reorderTweet(id, direction) {
  const idx = state.queue.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= state.queue.length) return false;
  [state.queue[idx], state.queue[swap]] = [state.queue[swap], state.queue[idx]];
  changed();
  return true;
}

export function setOnAir(id) {
  if (id !== null && !state.queue.some((t) => t.id === id)) return false;
  state.onAirId = id;
  changed();
  return true;
}

export function updateSettings(patch) {
  const next = { ...state.settings };
  if (patch.theme === 'light' || patch.theme === 'dark') next.theme = patch.theme;
  if (typeof patch.position === 'string') next.position = patch.position;
  state.settings = next;
  changed();
  return state.settings;
}
