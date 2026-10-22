import { execFileSync } from 'node:child_process';
import { loadDetectable } from '../src/discord/detectable.js';
import { pickExe, launchGame, stopGame } from '../src/game/launcher.js';

const data = await loadDetectable({ log: console });
const game = data.games.find((entry) => entry.steamAppIds.includes('570')) || data.games.find((entry) => entry.exes.length);

if (!game) throw new Error('No game found');

console.log('game:', game.name);
console.log('steam:', game.steamAppIds.join(','));
console.log('exe:', pickExe(game));

const handle = launchGame(game, { title: game.name });
console.log('pid:', handle.proc.pid);
console.log('path:', handle.exePath);

await new Promise((resolve) => setTimeout(resolve, 45_000));

const out = execFileSync('tasklist', ['/FI', `PID eq ${handle.proc.pid}`, '/NH'], { encoding: 'utf8' });
console.log(out.trim());

await stopGame(handle);
console.log('stopped');
