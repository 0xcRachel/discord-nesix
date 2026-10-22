// src/logger.js
// Ghi log ra file, có che token và API key.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR, ensureDirs } from './paths.js';

const TOKEN_RE = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g;
const KEY_RE = /\b[A-Fa-f0-9]{32}\b/g;

function logFile() {
  const day = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `nesix-${day}.log`);
}

export function redact(input) {
  return String(input ?? '')
    .replace(TOKEN_RE, '[REDACTED_TOKEN]')
    .replace(KEY_RE, '[REDACTED_KEY]');
}

export function writeLog(level, ...parts) {
  try {
    ensureDirs();
    const line = `${new Date().toISOString()} [${level}] ${redact(parts.join(' '))}\n`;
    appendFileSync(logFile(), line, 'utf8');
  } catch {
    // Không để lỗi log làm chết chương trình.
  }
}

export const fileLog = {
  info: (...a) => writeLog('INFO', ...a),
  warn: (...a) => writeLog('WARN', ...a),
  error: (...a) => writeLog('ERROR', ...a),
  debug: (...a) => writeLog('DEBUG', ...a),
};
