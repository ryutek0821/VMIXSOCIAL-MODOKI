// X風投稿カードの描画（操作画面のプレビューと出力画面で共用するESモジュール）

// 認証バッジ（Xの公式チェックマーク形状）
const BADGE_SVG =
  '<svg class="x-card__badge" viewBox="0 0 22 22" aria-label="認証済み"><path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.27-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.748 1.688.878.633.13 1.29.08 1.896-.144.274.587.705 1.087 1.245 1.443s1.17.555 1.817.574c.647-.02 1.276-.218 1.817-.574.54-.356.972-.856 1.245-1.443.606.224 1.263.274 1.896.144.634-.13 1.218-.435 1.688-.878.443-.47.748-1.054.878-1.688.13-.633.08-1.29-.144-1.896.587-.273 1.087-.705 1.443-1.245.356-.54.555-1.17.574-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';

// Xロゴ
const LOGO_SVG =
  '<svg class="x-card__logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

// 既定アイコン（グレーの人型）
const DEFAULT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' fill='%23536471'/%3E%3Ccircle cx='24' cy='19' r='8' fill='%23fff'/%3E%3Cpath d='M8 46c1-9 7-14 16-14s15 5 16 14' fill='%23fff'/%3E%3C/svg%3E";

function esc(s) {
  return (s ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 本文内の URL / @メンション / #ハッシュタグ を青色に（実リンクにはしない）
function formatText(text) {
  let html = esc(text);
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<span class="x-link">$1</span>');
  html = html.replace(/(^|[\s(])([@＠][A-Za-z0-9_]+)/g, '$1<span class="x-link">$2</span>');
  html = html.replace(/(^|[\s(])([#＃][^\s#＃<]+)/g, '$1<span class="x-link">$2</span>');
  return html;
}

// カード/バナーで共通の部品（テーマ・アイコン・名前など）をまとめて作る
function cardParts(tweet, settings) {
  return {
    theme: tweet.theme || settings.theme || 'dark',
    avatar: tweet.avatar || DEFAULT_AVATAR,
    badge: tweet.verified ? BADGE_SVG : '',
    handle: tweet.handle ? '@' + esc(tweet.handle) : '',
    name: esc(tweet.name) || '名前未設定',
  };
}

// 標準（縦型）カード
function standardHTML(tweet, settings) {
  const { theme, avatar, badge, handle, name } = cardParts(tweet, settings);
  const media = tweet.image
    ? `<div class="x-card__media"><img src="${esc(tweet.image)}" alt=""></div>`
    : '';
  return `
    <div class="x-card" data-theme="${esc(theme)}">
      <div class="x-card__header">
        <img class="x-card__avatar" src="${esc(avatar)}" alt=""
             onerror="this.src='${DEFAULT_AVATAR}'">
        <div class="x-card__names">
          <span class="x-card__name"><span class="x-card__display">${name}</span>${badge}</span>
          <span class="x-card__handle">${handle}</span>
        </div>
        ${LOGO_SVG}
      </div>
      <div class="x-card__body">${formatText(tweet.text)}</div>
      ${media}
    </div>`;
}

// 横長バナー（下部テロップ／ローワーサード）。実況2人などの画面下に全幅で出す。
function bannerHTML(tweet, settings) {
  const { theme, avatar, badge, handle, name } = cardParts(tweet, settings);
  const media = tweet.image
    ? `<div class="x-banner__media"><img src="${esc(tweet.image)}" alt=""></div>`
    : '';
  return `
    <div class="x-card x-card--banner" data-theme="${esc(theme)}">
      <img class="x-card__avatar" src="${esc(avatar)}" alt=""
           onerror="this.src='${DEFAULT_AVATAR}'">
      <div class="x-banner__main">
        <div class="x-banner__head">
          <span class="x-card__name"><span class="x-card__display">${name}</span>${badge}</span>
          <span class="x-card__handle">${handle}</span>
        </div>
        <div class="x-card__body">${formatText(tweet.text)}</div>
      </div>
      ${media}
      ${LOGO_SVG}
    </div>`;
}

export function cardHTML(tweet = {}, settings = {}) {
  return (settings.layout || 'card') === 'banner'
    ? bannerHTML(tweet, settings)
    : standardHTML(tweet, settings);
}

export function renderCard(el, tweet, settings) {
  el.innerHTML = tweet ? cardHTML(tweet, settings) : '';
}
