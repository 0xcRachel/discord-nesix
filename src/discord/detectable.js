// src/discord/detectable.js
// Tải và chuẩn hoá danh sách game Discord có thể detect.
// Endpoint công khai: GET /api/v9/applications/detectable

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDirs } from '../paths.js';
import { fileLog } from '../logger.js';

const URL = 'https://discord.com/api/v9/applications/detectable';
const CACHE_PATH = join(DATA_DIR, 'detectable.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) discord/1.0.9163 Chrome/124.0.6367.243 ' +
  'Electron/30.4.0 Safari/537.36';

function cleanExeName(name) {
  let value = String(name || '')
    .replace(/^>/, '')
    .replace(/\//g, '\\')
    .trim();

  if (!value) return null;
  if (value.length > 180) return null;
  if (/^[a-zA-Z]:/.test(value) || value.startsWith('\\')) return null;
  if (!value.toLowerCase().endsWith('.exe')) return null;

  const parts = value.split('\\');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(value)) return null;

  return value;
}

/**
 * Chuyển payload thô của Discord thành cấu trúc gọn, dễ cache.
 * Hàm thuần để test được.
 */
export function normalizeDetectable(raw) {
  if (!Array.isArray(raw)) throw new Error('Dữ liệu detectable không phải mảng');

  const games = [];

  for (const app of raw) {
    if (!app || !app.name) continue;

    const exes = [];
    const seenExe = new Set();

    for (const exe of app.executables || []) {
      if (!exe || exe.os !== 'win32') continue;
      const cleaned = cleanExeName(exe.name);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seenExe.has(key)) continue;
      seenExe.add(key);
      exes.push({ path: cleaned, launcher: Boolean(exe.is_launcher) });
    }

    if (!exes.length) continue;

    // exe không phải launcher lên trước.
    exes.sort((a, b) => Number(a.launcher) - Number(b.launcher) || a.path.localeCompare(b.path));

    const steamAppIds = [];
    for (const sku of app.third_party_skus || []) {
      if (sku?.distributor !== 'steam') continue;
      const id = String(sku.id || '').trim();
      if (/^\d+$/.test(id) && !steamAppIds.includes(id)) steamAppIds.push(id);
    }

    games.push({
      id: String(app.id),
      name: String(app.name),
      aliases: Array.isArray(app.aliases) ? app.aliases.map(String) : [],
      exes,
      steamAppIds,
    });
  }

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    count: games.length,
    games,
  };
}

export function loadCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.games)) return null;
    return data;
  } catch {
    return null;
  }
}

export function cacheAgeMs(data) {
  const ts = Date.parse(data?.fetchedAt || '');
  return Number.isFinite(ts) ? Date.now() - ts : Infinity;
}

export async function refreshDetectable({ log = console } = {}) {
  ensureDirs();
  log.info?.('Đang tải danh sách game detectable từ Discord...');

  const res = await fetch(URL, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Không tải được detectable list: HTTP ${res.status}`);
  }

  const raw = await res.json();
  const normalized = normalizeDetectable(raw);
  writeFileSync(CACHE_PATH, JSON.stringify(normalized), 'utf8');
  fileLog.info(`detectable: ${normalized.count} game, ${CACHE_PATH}`);
  return normalized;
}

export async function loadDetectable({ refresh = false, maxAgeMs = MAX_AGE_MS, log = console } = {}) {
  const cached = loadCache();

  if (!refresh && cached && cacheAgeMs(cached) < maxAgeMs) {
    return cached;
  }

  try {
    return await refreshDetectable({ log });
  } catch (err) {
    if (cached) {
      log.warn?.(`Không refresh được, dùng cache cũ (${cached.count} game).`);
      fileLog.warn(`refresh detectable lỗi: ${err.message}`);
      return cached;
    }
    throw err;
  }
}

export function steamDetectableGames(data) {
  return (data?.games || []).filter((game) => game.steamAppIds.length > 0 && game.exes.length > 0);
}

export { CACHE_PATH };
