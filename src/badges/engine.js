// src/badges/engine.js
// Lưu tiến độ farm và tính tier ước tính.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDirs } from '../paths.js';
import { evaluateTime, evaluateVariety } from './catalog.js';

export const STATE_PATH = join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  version: 1,
  games: {},
  history: [],
  quests: { accepted: 0, completed: 0, claimed: 0 },
  updatedAt: null,
};

export function localDayKey(date = new Date()) {
  return date.toLocaleDateString('en-CA');
}

export function defaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export function loadState() {
  ensureDirs();
  if (!existsSync(STATE_PATH)) return defaultState();

  try {
    const data = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return {
      ...defaultState(),
      ...data,
      games: data?.games && typeof data.games === 'object' ? data.games : {},
      history: Array.isArray(data?.history) ? data.history : [],
      quests: { ...DEFAULT_STATE.quests, ...(data?.quests || {}) },
    };
  } catch {
    try {
      renameSync(STATE_PATH, `${STATE_PATH}.corrupt-${Date.now()}`);
    } catch {
      // bỏ qua
    }
    return defaultState();
  }
}

export function saveState(state) {
  ensureDirs();
  state.updatedAt = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, STATE_PATH);
}

export function recordSession(state, { appId, name, seconds, credited, startedAt }) {
  const id = String(appId);
  const duration = Math.max(0, Math.round(Number(seconds) || 0));
  const game = state.games[id] || {
    name,
    totalSeconds: 0,
    sessions: 0,
    varietyCredited: false,
    creditedAt: null,
  };

  game.name = name || game.name;
  game.totalSeconds += duration;
  game.sessions += 1;
  game.lastRunAt = new Date().toISOString();

  if (credited && !game.varietyCredited) {
    game.varietyCredited = true;
    game.creditedAt = new Date().toISOString();
  }

  state.games[id] = game;
  state.history.push({
    appId: id,
    name,
    seconds: duration,
    credited: Boolean(credited),
    startedAt,
    day: localDayKey(new Date(startedAt)),
  });

  if (state.history.length > 1000) {
    state.history = state.history.slice(-1000);
  }
}

export function bumpQuest(state, key, amount = 1) {
  if (!state.quests) state.quests = { accepted: 0, completed: 0, claimed: 0 };
  state.quests[key] = (state.quests[key] || 0) + amount;
}

export function todayCredited(state) {
  const today = localDayKey();
  const ids = new Set(
    state.history
      .filter((entry) => entry.credited && entry.day === today)
      .map((entry) => entry.appId),
  );
  return ids.size;
}

export function computeStats(state) {
  const games = Object.values(state.games || {});
  const unique = games.filter((game) => game.varietyCredited).length;
  const seconds = games.reduce((sum, game) => sum + (Number(game.totalSeconds) || 0), 0);
  const sessions = games.reduce((sum, game) => sum + (Number(game.sessions) || 0), 0);

  return {
    unique,
    seconds,
    sessions,
    today: todayCredited(state),
    trackedGames: games.length,
    variety: evaluateVariety(unique),
    time: evaluateTime(seconds),
    quests: { ...state.quests },
  };
}
