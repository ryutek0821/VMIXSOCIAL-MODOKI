// データ/画像の保存先を一元管理。
// DATA_DIR 環境変数でマウント先を指定できる（PaaSの永続ボリューム等）。未指定はローカル ./data。

import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
export const MEDIA_DIR = join(DATA_DIR, 'media');
export const QUEUE_FILE = join(DATA_DIR, 'queue.json');

export function ensureDirs() {
  for (const d of [DATA_DIR, MEDIA_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}
