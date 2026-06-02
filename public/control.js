// 操作画面：投稿の作成/編集、キュー操作、オンエア切替、表示設定。
// 変更は REST で送信し、サーバーからの WebSocket ブロードキャストでUIを更新する。

import { cardHTML } from '/card.js';

const $ = (id) => document.getElementById(id);
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

const api = (path, opts = {}) =>
  fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then((r) => r.json());

let state = { queue: [], onAirId: null, settings: { theme: 'dark', position: 'bottom-left' } };
let editingId = null;
let avatarData = null; // アップロードした画像の data URL（あれば優先）
let imageData = null;

// ---- WebSocket（受信専用） ----
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => setConn(true);
  ws.onclose = () => {
    setConn(false);
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'state') {
      state = msg.state;
      renderQueue();
      syncSettings();
    }
  };
}
function setConn(ok) {
  const el = $('conn');
  el.textContent = ok ? '接続中' : '未接続';
  el.className = 'conn ' + (ok ? 'conn--on' : 'conn--off');
}

// サーバー設定を取得し、出力URL（必要ならトークン付き）とログアウトボタンを構成
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    const token = cfg.outputToken ? `?token=${encodeURIComponent(cfg.outputToken)}` : '';
    const url = `${location.origin}/output${token}`;
    $('outputLink').href = url;
    $('outputLink').title = `vMixに設定するURL: ${url}`;
    if (cfg.authEnabled) {
      const lb = $('logoutBtn');
      lb.hidden = false;
      lb.onclick = () => fetch('/logout', { method: 'POST' }).then(() => (location.href = '/login'));
    }
  })
  .catch(() => {});

// ---- フォーム ----
function formData() {
  return {
    avatar: avatarData || $('avatar').value.trim(),
    name: $('name').value.trim(),
    handle: $('handle').value.trim().replace(/^@/, ''),
    text: $('text').value,
    image: imageData || $('image').value.trim() || null,
    verified: $('verified').checked,
    theme: $('theme').value || null,
  };
}

function updatePreview() {
  $('preview').innerHTML = cardHTML(formData(), state.settings);
  $('avatarPreview').src = avatarData || $('avatar').value.trim() || TRANSPARENT;
}

['avatar', 'name', 'handle', 'text', 'image', 'verified', 'theme'].forEach((id) => {
  $(id).addEventListener('input', () => {
    if (id === 'avatar') avatarData = null; // テキスト編集したらアップロード画像を破棄
    if (id === 'image') imageData = null;
    updatePreview();
  });
});

// ---- 画像アップロード（data URL化） ----
function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
$('avatarFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  avatarData = await readFile(f);
  $('avatar').value = '（アップロード画像）';
  updatePreview();
});
$('imageFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  imageData = await readFile(f);
  $('image').value = '（アップロード画像）';
  updatePreview();
});
$('clearImage').addEventListener('click', () => {
  imageData = null;
  $('image').value = '';
  $('imageFile').value = '';
  updatePreview();
});

// ---- 自動取得 ----
$('fetchBtn').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!url) return;
  const msg = $('fetchMsg');
  msg.textContent = '取得中…';
  msg.className = 'msg';
  $('fetchBtn').disabled = true;
  try {
    const r = await api('/api/fetch', { method: 'POST', body: JSON.stringify({ url }) });
    if (!r.ok) throw new Error(r.error || '取得に失敗しました');
    const t = r.tweet;
    avatarData = null;
    imageData = null;
    $('avatar').value = t.avatar || '';
    $('name').value = t.name || '';
    $('handle').value = t.handle || '';
    $('text').value = t.text || '';
    $('image').value = t.image || '';
    $('verified').checked = !!t.verified;
    updatePreview();
    msg.textContent = '取得しました。内容を確認して「キューに追加」してください。';
    msg.className = 'msg msg--ok';
  } catch (err) {
    msg.textContent = '取得できませんでした：' + err.message;
    msg.className = 'msg msg--err';
  } finally {
    $('fetchBtn').disabled = false;
  }
});

// ---- 追加 / 更新 ----
$('addBtn').addEventListener('click', async () => {
  const data = formData();
  if (!data.name && !data.text) {
    alert('表示名か本文を入力してください');
    return;
  }
  await api('/api/tweets', { method: 'POST', body: JSON.stringify(data) });
  resetForm();
});
$('updateBtn').addEventListener('click', async () => {
  if (!editingId) return;
  await api(`/api/tweets/${editingId}`, { method: 'PUT', body: JSON.stringify(formData()) });
  resetForm();
});
$('cancelEdit').addEventListener('click', resetForm);
$('resetForm').addEventListener('click', resetForm);

function resetForm() {
  editingId = null;
  avatarData = null;
  imageData = null;
  ['avatar', 'name', 'handle', 'text', 'image', 'url'].forEach((id) => ($(id).value = ''));
  $('verified').checked = false;
  $('theme').value = '';
  $('avatarFile').value = '';
  $('imageFile').value = '';
  $('fetchMsg').textContent = '';
  $('addBtn').hidden = false;
  $('updateBtn').hidden = true;
  $('cancelEdit').hidden = true;
  updatePreview();
}

function startEdit(t) {
  editingId = t.id;
  avatarData = null;
  imageData = null;
  $('avatar').value = t.avatar || '';
  $('name').value = t.name || '';
  $('handle').value = t.handle || '';
  $('text').value = t.text || '';
  $('image').value = t.image || '';
  $('verified').checked = !!t.verified;
  $('theme').value = t.theme || '';
  $('addBtn').hidden = true;
  $('updateBtn').hidden = false;
  $('cancelEdit').hidden = false;
  updatePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- キュー描画 ----
function renderQueue() {
  const list = $('queueList');
  $('queueCount').textContent = state.queue.length;
  $('queueEmpty').hidden = state.queue.length > 0;
  list.innerHTML = '';

  state.queue.forEach((t, i) => {
    const onAir = t.id === state.onAirId;
    const li = document.createElement('li');
    li.className = 'qitem' + (onAir ? ' qitem--onair' : '');
    li.innerHTML = `
      <div class="qitem__preview">${cardHTML(t, state.settings)}</div>
      <div class="qitem__bar">
        ${onAir ? '<span class="onair-badge">ON AIR</span>' : ''}
        <button class="btn btn--air" data-act="air">${onAir ? '表示中' : 'オンエア'}</button>
        <button class="btn" data-act="edit">編集</button>
        <button class="btn" data-act="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn" data-act="down" ${i === state.queue.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn--danger" data-act="del">削除</button>
      </div>`;
    li.querySelector('[data-act="air"]').onclick = () =>
      api('/api/onair', { method: 'POST', body: JSON.stringify({ id: t.id }) });
    li.querySelector('[data-act="edit"]').onclick = () => startEdit(t);
    li.querySelector('[data-act="up"]').onclick = () =>
      api(`/api/tweets/${t.id}/reorder`, { method: 'POST', body: JSON.stringify({ direction: 'up' }) });
    li.querySelector('[data-act="down"]').onclick = () =>
      api(`/api/tweets/${t.id}/reorder`, { method: 'POST', body: JSON.stringify({ direction: 'down' }) });
    li.querySelector('[data-act="del"]').onclick = () => {
      if (confirm('この投稿を削除しますか？')) api(`/api/tweets/${t.id}`, { method: 'DELETE' });
    };
    list.appendChild(li);
  });
}

$('offAir').addEventListener('click', () =>
  api('/api/onair', { method: 'POST', body: JSON.stringify({ id: null }) })
);

// ---- 表示設定 ----
$('position').addEventListener('change', () =>
  api('/api/settings', { method: 'POST', body: JSON.stringify({ position: $('position').value }) })
);
$('globalTheme').addEventListener('change', () =>
  api('/api/settings', { method: 'POST', body: JSON.stringify({ theme: $('globalTheme').value }) })
);
function syncSettings() {
  // 操作中のセレクトは上書きしない
  if (document.activeElement !== $('position')) $('position').value = state.settings.position || 'bottom-left';
  if (document.activeElement !== $('globalTheme')) $('globalTheme').value = state.settings.theme || 'dark';
}

// ---- 起動 ----
connect();
updatePreview();
