// src/game/farm.js
// Farm Game Variety / Game Time bằng cách chạy stub exe đúng tên game.

import { pickExe, launchGame, stopGame, cleanupTemp } from './launcher.js';
import { recordSession, saveState, todayCredited } from '../badges/engine.js';
import { sleep } from '../rate-limit.js';

const MIN_CREDIT_SEC = 600;

function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export class Farmer {
  constructor({ detectable, state, log = console, signal = null }) {
    this.detectable = detectable;
    this.state = state;
    this.log = log;
    this.signal = signal;
    this.aborted = false;
    this.current = null;
    this.controller = new AbortController();
    this._onExternalAbort = () => this.abort();
    this.signal?.addEventListener('abort', this._onExternalAbort, { once: true });
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.controller.abort();

    if (this.current) {
      try {
        this.current.proc.kill();
      } catch {
        // bỏ qua
      }
    }
  }

  #sleep(ms) {
    return sleep(ms, this.controller.signal);
  }

  #candidates(allowed) {
    const list = [];

    for (const game of this.detectable.games || []) {
      if (!game.exes?.length || !game.steamAppIds?.length) continue;

      const ids = game.steamAppIds.map(String);
      if (allowed && !ids.some((id) => allowed.has(id))) continue;

      const exe = pickExe(game);
      if (!exe) continue;

      const credited = ids.some((id) => this.state.games[id]?.varietyCredited);
      list.push({
        game,
        exe,
        ids,
        credited,
        simple: !exe.includes('\\'),
      });
    }

    list.sort((a, b) => {
      if (a.credited !== b.credited) return Number(a.credited) - Number(b.credited);
      if (a.simple !== b.simple) return Number(b.simple) - Number(a.simple);
      return Math.random() - 0.5;
    });

    return list;
  }

  async run({
    limit = 5,
    dwellSec = 900,
    minutes = 0,
    mode = 'variety',
    dryRun = false,
    allowed = null,
    dailyCap = 20,
  } = {}) {
    await cleanupTemp(this.log);

    const all = this.#candidates(allowed);
    const queue = mode === 'time' ? all : all.filter((item) => !item.credited);

    if (!queue.length) {
      this.log.ok?.('Không còn game nào chưa credit trong nguồn đã chọn.');
      return { sessions: 0, credited: 0 };
    }

    if (dwellSec < MIN_CREDIT_SEC) {
      this.log.warn?.(
        `Thời gian giữ mỗi game (${dwellSec}s) thấp hơn ngưỡng ${MIN_CREDIT_SEC}s. Có thể Discord không credit variety.`,
      );
    }

    if (dryRun) {
      const preview = queue.slice(0, limit || queue.length);
      this.log.step?.(`Danh sách sẽ chạy (${preview.length} game):`);
      for (const item of preview) {
        const mark = item.credited ? 'đã credit' : 'chưa credit';
        this.log.dim?.(`${item.game.name}  ->  ${item.exe}  (${mark})`);
      }
      return { sessions: 0, credited: 0 };
    }

    const deadline = mode === 'time' ? Date.now() + minutes * 60 * 1000 : 0;
    let sessions = 0;
    let creditedCount = 0;
    let index = 0;
    let cap = todayCredited(this.state);

    try {
      while (!this.aborted) {
        if (cap >= dailyCap) {
          this.log.warn?.(`Đã đạt giới hạn ${dailyCap} game unique hôm nay. Dừng để an toàn.`);
          break;
        }

        if (mode === 'time') {
          if (Date.now() >= deadline) break;
        } else {
          if (sessions >= limit) break;
          if (index >= queue.length) break;
        }

        if (index >= queue.length) index = 0;
        const item = queue[index];
        index += 1;

        let dwell = Math.max(60, Math.round(dwellSec));

        if (mode === 'time') {
          const remaining = Math.ceil((deadline - Date.now()) / 1000);
          if (remaining < 120) break;
          dwell = Math.min(dwell, remaining);
        }

        this.log.step?.(`Chạy: ${item.game.name}`);
        this.log.dim?.(`exe: ${item.exe}`);

        const startedAt = new Date().toISOString();
        const sessionStart = Date.now();
        let handle;

        try {
          handle = launchGame(item.game, { title: item.game.name });
          this.current = handle;
        } catch (err) {
          this.log.error?.(`Không chạy được ${item.game.name}: ${err.message}`);
          continue;
        }

        const earlyExit = await this.#hold(dwell, item, handle);
        const seconds = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));

        await stopGame(handle);
        this.current = null;

        const needed = Math.max(MIN_CREDIT_SEC, Math.min(dwell, 900));
        const credited = !earlyExit && seconds >= needed;

        recordSession(this.state, {
          appId: item.ids[0],
          name: item.game.name,
          seconds,
          credited,
          startedAt,
        });
        saveState(this.state);

        sessions += 1;
        if (credited) {
          creditedCount += 1;
          item.credited = true;
          this.log.ok?.(`${item.game.name} - ${formatClock(seconds)} - đã credit variety.`);
        } else if (earlyExit) {
          this.log.warn?.(`${item.game.name} - process thoát sớm, không credit.`);
        } else {
          this.log.info?.(`${item.game.name} - ${formatClock(seconds)} - cộng giờ, chưa đủ ngưỡng credit.`);
        }

        cap = todayCredited(this.state);

        if (!this.aborted) {
          this.log.dim?.('Nghỉ 10 giây...');
          await this.#sleep(10_000);
        }
      }
    } finally {
      if (this.current) {
        await stopGame(this.current);
        this.current = null;
      }
      this.signal?.removeEventListener('abort', this._onExternalAbort);
    }

    this.log.ok?.(`Xong phiên farm: ${sessions} game, ${creditedCount} game được credit.`);
    return { sessions, credited: creditedCount };
  }

  async #hold(dwell, item, handle) {
    const started = Date.now();
    let lastPrint = 0;
    let earlyExit = false;

    while (true) {
      if (this.aborted) break;

      const elapsed = Math.round((Date.now() - started) / 1000);
      if (elapsed >= dwell) break;

      if (handle.exited()) {
        earlyExit = true;
        break;
      }

      if (process.stdout.isTTY) {
        const line = `  [>] ${item.game.name.slice(0, 32)}  ${formatClock(elapsed)} / ${formatClock(dwell)}`;
        process.stdout.write(`\r\x1b[2K${line}`);
      } else if (elapsed - lastPrint >= 60) {
        this.log.dim?.(`${item.game.name}: ${formatClock(elapsed)} / ${formatClock(dwell)}`);
        lastPrint = elapsed;
      }

      await this.#sleep(1000);
    }

    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');

    return earlyExit;
  }
}
