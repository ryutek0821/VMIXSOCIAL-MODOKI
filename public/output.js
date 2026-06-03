// 出力画面：WebSocketで状態を受信し、オンエア中の投稿カードを透過オーバーレイ表示する。

import { renderCard } from '/card.js';

const stage = document.getElementById('stage');
const wrap = document.getElementById('card-wrap');

let lastKey = ''; // 現在表示中カードの識別キー（内容変化の検出用）

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // 出力URLの ?service= と ?token= をWS接続にも引き継ぐ（サービス単位のルームに参加）
  const params = new URLSearchParams(location.search);
  const qs = new URLSearchParams();
  if (params.get('service')) qs.set('service', params.get('service'));
  if (params.get('token')) qs.set('token', params.get('token'));
  const suffix = qs.toString() ? `?${qs}` : '';
  const ws = new WebSocket(`${proto}://${location.host}/${suffix}`);
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'state') applyState(msg.state);
  };
  ws.onclose = () => setTimeout(connect, 1500); // 自動再接続
  ws.onerror = () => ws.close();
}

function applyState(state) {
  const pos = state.settings?.position || 'bottom-left';
  stage.className = `stage pos-${pos}`;

  const onAir = state.queue.find((t) => t.id === state.onAirId) || null;
  if (!onAir) {
    hide();
    return;
  }

  const key = JSON.stringify(onAir) + '|' + (state.settings?.theme || '');
  if (key === lastKey) {
    show(); // 同一内容なら表示維持
    return;
  }

  // 内容が変わった：表示中なら一旦隠してから差し替え（切替アニメ）
  if (!wrap.classList.contains('hidden')) {
    swapOut();
    setTimeout(() => {
      renderCard(wrap, onAir, state.settings);
      show();
    }, 260);
  } else {
    renderCard(wrap, onAir, state.settings);
    show();
  }
  lastKey = key;
}

function show() {
  wrap.classList.remove('hidden');
  requestAnimationFrame(() => wrap.classList.add('show'));
}
function swapOut() {
  wrap.classList.remove('show');
  wrap.classList.add('hidden');
}
function hide() {
  swapOut();
  lastKey = '';
}

connect();
