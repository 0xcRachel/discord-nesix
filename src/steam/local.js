// src/steam/local.js
// Đọc thư viện Steam cục bộ: libraryfolders.vdf + appmanifest_*.acf.
// Không cần thư viện ngoài.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, normalize } from 'node:path';
import { homedir } from 'node:os';

/**
 * Tokenizer VDF tối giản: hỗ trợ chuỗi có escape, dấu {} và comment //.
 */
function tokenize(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '{' || ch === '}') {
      tokens.push(ch);
      i += 1;
      continue;
    }

    if (ch === '"') {
      let value = '';
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          value += text[i + 1];
          i += 2;
        } else {
          value += text[i];
          i += 1;
        }
      }
      tokens.push(value);
      i += 1;
      continue;
    }

    let value = '';
    while (i < text.length && !/[\s{}"]/.test(text[i])) {
      value += text[i];
      i += 1;
    }
    tokens.push(value);
  }

  return tokens;
}

function parseBlock(tokens, pos) {
  const obj = {};

  while (pos.i < tokens.length) {
    const key = tokens[pos.i];
    pos.i += 1;

    if (key === '}') break;
    if (key === '{') continue;

    const value = tokens[pos.i];
    pos.i += 1;

    if (value === '{') {
      obj[key] = parseBlock(tokens, pos);
    } else if (value === '}') {
      obj[key] = '';
      break;
    } else if (value === undefined) {
      break;
    } else {
      obj[key] = value;
    }
  }

  return obj;
}

export function parseVDF(text) {
  const tokens = tokenize(String(text || ''));
  const pos = { i: 0 };
  const result = {};

  while (pos.i < tokens.length) {
    const key = tokens[pos.i];
    pos.i += 1;
    if (key === '}' || key === '{') continue;

    const value = tokens[pos.i];
    pos.i += 1;

    if (value === '{') {
      result[key] = parseBlock(tokens, pos);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

export function normalizeWindowsPath(input) {
  if (!input) return '';
  return normalize(String(input).replace(/\//g, '\\')).replace(/[\\/]+$/, '');
}

export function getSteamPath() {
  const candidates = [];

  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true },
    );
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match?.[1]) candidates.push(match[1].trim());
  } catch {
    // Không có registry key.
  }

  candidates.push(
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    join(homedir(), 'Steam'),
  );

  for (const candidate of candidates) {
    const path = normalizeWindowsPath(candidate);
    if (path && existsSync(join(path, 'steamapps'))) return path;
  }

  return null;
}

export function getLibraryFolders(steamPath = getSteamPath()) {
  if (!steamPath) return [];

  const paths = [steamPath];
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf');

  if (existsSync(vdfPath)) {
    try {
      const parsed = parseVDF(readFileSync(vdfPath, 'utf8'));
      const root = parsed.libraryfolders || parsed.LibraryFolders || {};

      for (const value of Object.values(root)) {
        if (typeof value === 'string' && /^[a-zA-Z]:[\\/]/.test(value)) {
          paths.push(value);
        } else if (value && typeof value === 'object' && typeof value.path === 'string') {
          paths.push(value.path);
        }
      }
    } catch {
      // Dùng steamPath mặc định.
    }
  }

  const unique = [];
  const seen = new Set();

  for (const path of paths) {
    const normalized = normalizeWindowsPath(path);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    if (existsSync(join(normalized, 'steamapps'))) unique.push(normalized);
  }

  return unique;
}

export function parseAppManifest(text) {
  const parsed = parseVDF(text);
  const state = parsed.AppState || parsed.appstate || {};
  return {
    appid: String(state.appid || '').trim(),
    name: String(state.name || '').trim(),
    installdir: String(state.installdir || '').trim(),
    stateFlags: Number(state.StateFlags || 0),
    sizeOnDisk: Number(state.SizeOnDisk || 0),
    lastUpdated: Number(state.LastUpdated || 0),
    buildid: String(state.buildid || ''),
  };
}

/**
 * Trả về Map appid -> thông tin game đã cài.
 */
export function getInstalledGames(steamPath = getSteamPath()) {
  const games = new Map();
  if (!steamPath) return games;

  for (const library of getLibraryFolders(steamPath)) {
    const steamapps = join(library, 'steamapps');
    let entries = [];

    try {
      entries = readdirSync(steamapps);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue;

      try {
        const manifest = parseAppManifest(readFileSync(join(steamapps, entry), 'utf8'));
        if (!manifest.appid || !manifest.name) continue;

        const installPath = join(steamapps, 'common', manifest.installdir);
        const installed = (manifest.stateFlags & 4) === 4 || existsSync(installPath);
        if (!installed) continue;

        games.set(manifest.appid, {
          ...manifest,
          library,
          installPath,
        });
      } catch {
        // Manifest hỏng, bỏ qua.
      }
    }
  }

  return games;
}
