// src/config.js
// Cấu hình lưu bằng Conf. Token có thể override bằng biến môi trường NESIX_TOKEN.

import Conf from 'conf';

export const CONFIG_VERSION = 2;

export const config = new Conf({
  projectName: 'discord-nesix',
  schema: {
    configVersion: { type: 'number', default: CONFIG_VERSION },
    token: { type: 'string', default: '' },
    steamApiKey: { type: 'string', default: '' },
    steamId: { type: 'string', default: '' },
    gameSource: {
      type: 'string',
      enum: ['detectable', 'installed', 'owned'],
      default: 'detectable',
    },
    dwellSec: { type: 'number', minimum: 60, default: 900 },
    dailyGameCap: { type: 'number', minimum: 1, default: 20 },
    heartbeatSec: { type: 'number', minimum: 15, default: 30 },
    videoStepSec: { type: 'number', minimum: 5, default: 10 },
    maxBatchHours: { type: 'number', minimum: 0.1, default: 6 },
    pollIntervalMin: { type: 'number', minimum: 5, default: 30 },
    autoAccept: { type: 'boolean', default: true },
    autoClaim: { type: 'boolean', default: true },
  },
});

export function migrateConfig() {
  // Các key của bản cũ, không còn dùng.
  for (const key of ['selectedGame']) {
    try {
      if (config.has(key)) config.delete(key);
    } catch {
      // bỏ qua
    }
  }

  if (config.get('configVersion') !== CONFIG_VERSION) {
    config.set('configVersion', CONFIG_VERSION);
  }
}

export function getToken() {
  return (process.env.NESIX_TOKEN || config.get('token') || '').trim();
}

export function setToken(token) {
  config.set('token', String(token || '').trim());
}

export function getSteamKey() {
  return (process.env.STEAM_API_KEY || config.get('steamApiKey') || '').trim();
}

export function getSteamId() {
  return (process.env.STEAM_ID || config.get('steamId') || '').trim();
}

export function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '(chưa có)';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function configPath() {
  return config.path;
}
