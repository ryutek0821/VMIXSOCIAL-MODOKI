// 管理画面：サービス(ID+PW)の一覧・追加・削除・パスワード再設定・出力URL確認。
// 認証はサーバ側 /api/admin/* で行い、401 ならログインフォームを表示する。

const $ = (id) => document.getElementById(id);

// fetch ラッパ：{status, body} を返す（401 検出のため status も見る）
const api = (path, opts = {}) =>
  fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then((r) =>
    r
      .json()
      .then((body) => ({ status: r.status, body }))
      .catch(() => ({ status: r.status, body: {} }))
  );

function showLogin() {
  $('loginView').hidden = false;
  $('dashView').hidden = true;
  $('adminPw').focus();
}
function showDash() {
  $('loginView').hidden = true;
  $('dashView').hidden = false;
}

async function refresh() {
  const { status, body } = await api('/api/admin/services');
  if (status === 401) return showLogin();
  showDash();
  renderList(body.services || []);
}

function renderList(services) {
  $('count').textContent = services.length;
  $('empty').hidden = services.length > 0;
  const list = $('list');
  list.innerHTML = '';
  for (const s of services) {
    const url = location.origin + s.outputUrl;
    const li = document.createElement('li');
    li.className = 'svc panel';
    li.innerHTML = `
      <div>
        <div class="svc__name"></div>
        <div class="svc__id"></div>
      </div>
      <div class="svc__url"><input type="text" readonly /></div>
      <div class="svc__actions">
        <button class="btn btn--ghost btn--sm" data-act="copy">URLコピー</button>
        <button class="btn btn--ghost btn--sm" data-act="open">出力 ↗</button>
        <button class="btn btn--ghost btn--sm" data-act="pw">PW変更</button>
        <button class="btn btn--danger btn--sm" data-act="del">削除</button>
      </div>`;
    li.querySelector('.svc__name').textContent = s.name;
    li.querySelector('.svc__id').textContent = 'ID: ' + s.id;
    const input = li.querySelector('.svc__url input');
    input.value = url;
    li.querySelector('[data-act="copy"]').onclick = () => {
      input.select();
      navigator.clipboard?.writeText(url).catch(() => {});
    };
    li.querySelector('[data-act="open"]').onclick = () => window.open(url, '_blank', 'noopener');
    li.querySelector('[data-act="pw"]').onclick = () => changePw(s.id);
    li.querySelector('[data-act="del"]').onclick = () => del(s.id, s.name);
    list.appendChild(li);
  }
}

async function changePw(id) {
  const password = prompt(`「${id}」の新しいパスワード（4文字以上）`);
  if (!password) return;
  const { status, body } = await api(`/api/admin/services/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ password }),
  });
  if (status === 401) return showLogin();
  alert(body.ok ? 'パスワードを変更しました' : body.error || '変更に失敗しました');
}

async function del(id, name) {
  if (!confirm(`サービス「${name}」(ID: ${id}) を削除しますか？\nキュー等のデータも消えます。`)) return;
  const { status, body } = await api(`/api/admin/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (status === 401) return showLogin();
  if (!body.ok) alert('削除に失敗しました');
  refresh();
}

$('addBtn').addEventListener('click', async () => {
  const id = $('newId').value.trim();
  const name = $('newName').value.trim();
  const password = $('newPw').value;
  const msg = $('addMsg');
  msg.className = 'msg';
  msg.textContent = '';
  const { status, body } = await api('/api/admin/services', {
    method: 'POST',
    body: JSON.stringify({ id, name, password }),
  });
  if (status === 401) return showLogin();
  if (!body.ok) {
    msg.textContent = body.error || '追加に失敗しました';
    msg.className = 'msg msg--err';
    return;
  }
  $('newId').value = '';
  $('newName').value = '';
  $('newPw').value = '';
  msg.textContent = `追加しました：${body.service.name}`;
  msg.className = 'msg msg--ok';
  refresh();
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('adminPw').value;
  const { body } = await api('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
  if (body.ok) {
    $('adminPw').value = '';
    $('loginMsg').textContent = '';
    refresh();
  } else {
    $('loginMsg').textContent = body.error || 'ログインに失敗しました';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

refresh();
