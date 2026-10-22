// src/rate-limit.js
// Semaphore + sleep có thể huỷ, dùng cho API và farm loop.

export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export class Semaphore {
  constructor(limit = 2) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }

    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export function jitter(maxMs = 400) {
  return Math.floor(Math.random() * maxMs);
}
