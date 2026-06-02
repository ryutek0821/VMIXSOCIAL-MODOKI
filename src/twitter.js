// X(Twitter)投稿の「API無し」取得ロジック（ベストエフォート）。
//
// 公式APIは使わず、Xの埋め込みウィジェットが内部利用する非公式エンドポイント
//   https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>
// を叩いて投稿内容を取得する（Vercel の react-tweet 等と同じ手法）。
// 非公式のためX側の仕様変更で停止し得る → 失敗時はエラーを投げ、操作画面で手入力に切替える。

import { existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { MEDIA_DIR, ensureDirs } from './paths.js';

const UA = 'Mozilla/5.0 (compatible; vmixsocial-modoki/1.0)';

// URL/文字列から tweet ID を抽出
export function extractTweetId(input) {
  if (!input) return null;
  const s = input.toString().trim();
  if (/^\d{1,25}$/.test(s)) return s; // 数字だけならIDとみなす
  const m = s.match(/status(?:es)?\/(\d{1,25})/);
  return m ? m[1] : null;
}

// react-tweet 等が使う token 生成アルゴリズム
function getToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export async function fetchTweet(input) {
  const id = extractTweetId(input);
  if (!id) throw fail('INVALID_URL', '有効なX(Twitter)の投稿URL/IDではありません');

  const token = getToken(id);
  const url =
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=ja`;

  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw fail('NETWORK', '取得サーバーへ接続できませんでした（ネットワーク/タイムアウト）');
  }

  if (res.status === 404) throw fail('NOT_FOUND', '投稿が見つかりません（削除/非公開/ID誤り）');
  if (!res.ok) {
    throw fail('HTTP_ERROR', `取得に失敗しました（HTTP ${res.status}）。手入力に切り替えてください`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw fail('PARSE', '応答の解析に失敗しました（X側仕様変更の可能性）。手入力に切り替えてください');
  }

  if (!json || !json.user || json.__typename === 'TweetTombstone') {
    throw fail('UNAVAILABLE', 'この投稿は取得できません（非公開/年齢制限/取得制限など）。手入力に切り替えてください');
  }

  return normalize(json, id);
}

function normalize(json, id) {
  const user = json.user || {};

  // 写真（最初の1枚）を抽出
  let image = null;
  const photos =
    (Array.isArray(json.photos) && json.photos) ||
    (Array.isArray(json.mediaDetails) && json.mediaDetails.filter((m) => m.type === 'photo')) ||
    [];
  if (photos.length) image = photos[0].url || photos[0].media_url_https || null;

  return {
    id,
    name: user.name || '',
    handle: user.screen_name || '',
    // アイコンは高解像度版に置換（..._normal.jpg → ..._400x400.jpg）
    avatar: (user.profile_image_url_https || '').replace('_normal', '_400x400'),
    text: json.text || json.full_text || '',
    image,
    verified: !!(user.verified || user.is_blue_verified || user.isBlueVerified),
    source: 'syndication',
  };
}

// 画像URLをローカル media/ にダウンロードキャッシュし、配信用パス(/media/xxx)を返す。
// 配信PCが twimg へ到達できなくてもツールPC経由で安定表示でき、URL失効も回避できる。
export async function cacheImage(url) {
  if (!url || !/^https?:\/\//.test(url)) return url || null; // /media や data: 等はそのまま
  try {
    ensureDirs();
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
    let ext = (extname(new URL(url).pathname) || '.jpg').split(/[?#]/)[0];
    if (!/^\.(jpg|jpeg|png|gif|webp)$/i.test(ext)) ext = '.jpg';
    const filename = `${hash}${ext}`;
    const filepath = join(MEDIA_DIR, filename);
    const served = `/media/${filename}`;
    if (existsSync(filepath)) return served;

    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return url; // 失敗時は元URLにフォールバック
    writeFileSync(filepath, Buffer.from(await res.arrayBuffer()));
    return served;
  } catch {
    return url;
  }
}

// base64 data URL（操作画面からのアップロード）を保存し /media パスを返す
export function saveDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  ensureMediaDir();
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const filename = `${hash}.${ext}`;
  writeFileSync(join(MEDIA_DIR, filename), buf);
  return `/media/${filename}`;
}
