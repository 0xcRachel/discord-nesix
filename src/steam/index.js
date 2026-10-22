// src/steam/index.js
// Ghép nguồn game Steam: detectable / installed / owned.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDirs } from '../paths.js';
import { getInstalledGames, getSteamPath } from './local.js';
import { getOwnedGames } from './web.js';

const OWNED_CACHE = join(DATA_DIR, 'steam-owned.json');
const OWNED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadOwnedCache() {
  if (!existsSync(OWNED_CACHE)) return null;
  try {
    const data = JSON.parse(readFileSync(OWNED_CACHE, 'utf8'));
    if (!Array.isArray(data.games)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function fetchOwnedGames({ key, steamId, force = false, log = console }) {
  ensureDirs();

  if (!force) {
    const cached = loadOwnedCache();
    const age = Date.now() - Date.parse(cached?.fetchedAt || '');
    if (cached && Number.isFinite(age) && age < OWNED_MAX_AGE_MS) {
      return cached;
    }
  }

  if (!key || !steamId) {
    throw new Error('Cần Steam API key và SteamID64 để lấy thư viện sở hữu.');
  }

  log.info?.('Đang lấy thư viện Steam...');
  const games = await getOwnedGames(key, steamId);
  const data = { fetchedAt: new Date().toISOString(), games };
  writeFileSync(OWNED_CACHE, JSON.stringify(data), 'utf8');
  return data;
}

export function installedAppIds() {
  return new Set(getInstalledGames().keys());
}

export function ownedAppIds() {
  const cache = loadOwnedCache();
  return new Set((cache?.games || []).map((game) => String(game.appid)));
}

/**
 * null = không lọc (toàn bộ detectable có Steam).
 */
export async function buildAllowedSet(source, { key, steamId, log = console } = {}) {
  if (source === 'detectable') return { allowed: null, label: 'toàn bộ detectable trên Steam' };

  if (source === 'installed') {
    const steamPath = getSteamPath();
    if (!steamPath) throw new Error('Không tìm thấy thư viện Steam trên máy.');
    const set = installedAppIds();
    if (!set.size) throw new Error('Không tìm thấy game Steam nào đã cài.');
    return { allowed: set, label: `${set.size} game đã cài` };
  }

  if (source === 'owned') {
    const data = await fetchOwnedGames({ key, steamId, log });
    const set = new Set(data.games.map((game) => String(game.appid)));
    if (!set.size) throw new Error('Thư viện Steam sở hữu đang rỗng hoặc private.');
    return { allowed: set, label: `${set.size} game sở hữu` };
  }

  throw new Error(`Nguồn game không hợp lệ: ${source}`);
}

export function steamOverview() {
  const steamPath = getSteamPath();
  const installed = steamPath ? getInstalledGames() : new Map();
  const owned = loadOwnedCache();
  return {
    steamPath,
    installedCount: installed.size,
    ownedCount: owned?.games?.length || 0,
    ownedFetchedAt: owned?.fetchedAt || null,
  };
}

export { OWNED_CACHE };
