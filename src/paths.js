// src/paths.js
// Đường dẫn dùng chung cho toàn bộ tool.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = dirname(here);
export const DATA_DIR = join(ROOT, 'data');
export const LOG_DIR = join(ROOT, 'logs');
export const CACHE_DIR = join(ROOT, 'cache');
export const TEMP_DIR = join(process.env.TEMP || process.env.TMP || ROOT, 'nesix-games');

export function ensureDirs() {
  for (const dir of [DATA_DIR, LOG_DIR, CACHE_DIR, TEMP_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
