// src/lock.js
// Chống chạy nhiều instance cùng lúc (tránh tranh nhau farm/presence).

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDirs } from './paths.js';

const LOCK_PATH = join(DATA_DIR, 'nesix.lock');

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function acquireLock() {
  ensureDirs();

  if (existsSync(LOCK_PATH)) {
    let pid = 0;
    try {
      pid = Number(readFileSync(LOCK_PATH, 'utf8').trim());
    } catch {
      pid = 0;
    }

    if (isAlive(pid) && pid !== process.pid) {
      return { ok: false, pid };
    }
  }

  writeFileSync(LOCK_PATH, String(process.pid), 'utf8');

  return {
    ok: true,
    release() {
      try {
        if (existsSync(LOCK_PATH) && readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) {
          unlinkSync(LOCK_PATH);
        }
      } catch {
        // bỏ qua
      }
    },
  };
}
