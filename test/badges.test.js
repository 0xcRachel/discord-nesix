import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateVariety,
  evaluateTime,
  formatDuration,
} from '../src/badges/catalog.js';
import { computeStats } from '../src/badges/engine.js';

test('Game Variety tier boundaries', () => {
  assert.equal(evaluateVariety(0).current, null);
  assert.equal(evaluateVariety(1).current, null);
  assert.equal(evaluateVariety(2).current.name, 'Sampler');
  assert.equal(evaluateVariety(4).current.name, 'Sampler');
  assert.equal(evaluateVariety(5).current.name, 'Dabbler');
  assert.equal(evaluateVariety(9).current.name, 'Dabbler');
  assert.equal(evaluateVariety(10).current.name, 'Enthusiast');
  assert.equal(evaluateVariety(100).current.name, 'Universalist');
  assert.equal(evaluateVariety(150).current.name, 'Universalist');
  assert.equal(evaluateVariety(100).next, null);
});

test('Game Time tier boundaries', () => {
  assert.equal(evaluateTime(0).current, null);
  assert.equal(evaluateTime(3600).current.name, 'Casual');
  assert.equal(evaluateTime(5 * 3600).current.name, 'Recreational');
  assert.equal(evaluateTime(20 * 3600).current.name, 'Dedicated');
  assert.equal(evaluateTime(75 * 3600).current.name, 'Committed');
  assert.equal(evaluateTime(5000 * 3600).current.name, 'Eternal');
  assert.equal(evaluateTime(6000 * 3600).next, null);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(59), '59s');
  assert.equal(formatDuration(90), '1m');
  assert.equal(formatDuration(5400), '1.5h');
});

test('computeStats sums sessions and unique credited games', () => {
  const state = {
    games: {
      1: { name: 'A', totalSeconds: 900, sessions: 1, varietyCredited: true },
      2: { name: 'B', totalSeconds: 1800, sessions: 2, varietyCredited: true },
      3: { name: 'C', totalSeconds: 300, sessions: 1, varietyCredited: false },
    },
    history: [],
    quests: { accepted: 1, completed: 2, claimed: 3 },
  };

  const stats = computeStats(state);
  assert.equal(stats.unique, 2);
  assert.equal(stats.seconds, 3000);
  assert.equal(stats.sessions, 4);
  assert.equal(stats.variety.current.name, 'Sampler');
  assert.equal(stats.time.current, null);
  assert.equal(stats.quests.claimed, 3);
});
