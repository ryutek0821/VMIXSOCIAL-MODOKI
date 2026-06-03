// データ/画像の保存先を一元管理。
// DATA_DIR 環境変数でマウント先を指定できる（PaaSの永続ボリューム等）。未指定はローカル ./data。

import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
export const MEDIA_DIR = join(DATA_DIR, 'media');
// 旧・単一テナントのキュー（マイグレーション元として参照）。
export const QUEUE_FILE = join(DATA_DIR, 'queue.json');
// マルチテナント: アカウント定義 と サービス別の状態ディレクトリ。
export const ACCOUNTS_FILE = join(DATA_DIR, 'accounts.json');
export const SERVICES_DIR = join(DATA_DIR, 'services');

// サービスID（＝ログインID）の許容形式。パストラバーサル防止のため厳格に制限。
export const SERVICE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,30}$/;
export const isValidServiceId = (id) => typeof id === 'string' && SERVICE_ID_RE.test(id);

// サービスIDから保存先を解決（不正IDは例外）。
export function serviceDir(id) {
  if (!isValidServiceId(id)) throw new Error(`invalid service id: ${id}`);
  return join(SERVICES_DIR, id);
}
export function serviceQueueFile(id) {
  return join(serviceDir(id), 'queue.json');
}

export function ensureDirs() {
  for (const d of [DATA_DIR, MEDIA_DIR, SERVICES_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

// 指定サービスの保存ディレクトリを用意し、そのパスを返す。
export function ensureServiceDir(id) {
  const d = serviceDir(id);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
