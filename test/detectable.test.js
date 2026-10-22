import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDetectable, steamDetectableGames } from '../src/discord/detectable.js';

const raw = [
  {
    id: '100',
    name: 'Test Game',
    aliases: ['Test Alias'],
    executables: [
      { os: 'win32', name: '>testgame.exe', is_launcher: false },
      { os: 'win32', name: 'win64/testgame.exe', is_launcher: true },
      { os: 'linux', name: 'testgame', is_launcher: false },
      { os: 'win32', name: '../evil.exe', is_launcher: false },
      { os: 'win32', name: 'C:\\Windows\\system32\\calc.exe', is_launcher: false },
      { os: 'win32', name: 'bad<name>.exe', is_launcher: false },
    ],
    third_party_skus: [
      { distributor: 'steam', id: '570' },
      { distributor: 'xbox', id: 'ABC' },
    ],
  },
  {
    id: '101',
    name: 'No Windows Exe',
    executables: [{ os: 'darwin', name: 'game', is_launcher: false }],
    third_party_skus: [{ distributor: 'steam', id: '1' }],
  },
];

test('normalizeDetectable trims markers, filters invalid paths and OS', () => {
  const data = normalizeDetectable(raw);
  assert.equal(data.games.length, 1);

  const game = data.games[0];
  assert.equal(game.id, '100');
  assert.equal(game.name, 'Test Game');
  assert.deepEqual(game.steamAppIds, ['570']);
  assert.deepEqual(
    game.exes.map((exe) => exe.path),
    ['testgame.exe', 'win64\\testgame.exe'],
  );
  assert.equal(game.exes[0].launcher, false);
  assert.equal(game.exes[1].launcher, true);
});

test('steamDetectableGames filters games without Steam appid', () => {
  const data = normalizeDetectable(raw);
  const games = steamDetectableGames(data);
  assert.equal(games.length, 1);
  assert.equal(games[0].name, 'Test Game');
});

test('normalizeDetectable rejects non-array input', () => {
  assert.throws(() => normalizeDetectable(null), /không phải mảng/i);
});
