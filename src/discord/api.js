// src/discord/api.js
// Wrapper Discord REST API v9, có semaphore và xử lý 429.

import { Semaphore, jitter, sleep } from '../rate-limit.js';

const BASE_URL = 'https://discord.com/api/v9';

// Discord Desktop UA là bắt buộc cho heartbeat quest PLAY_ON_DESKTOP.
const DISCORD_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) discord/1.0.9163 Chrome/124.0.6367.243 ' +
  'Electron/30.4.0 Safari/537.36';

export class APIError extends Error {
  constructor(status, message, raw = null) {
    super(`[HTTP ${status}] ${message}`);
    this.name = 'APIError';
    this.status = status;
    this.raw = raw;
    this.url = '';
  }
}

export class DiscordAPI {
  constructor(token, { concurrency = 2, timeoutMs = 25_000 } = {}) {
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.verbose = process.env.DEBUG_API === '1';
    this.semaphore = new Semaphore(concurrency);

    this.headers = {
      Authorization: token,
      'User-Agent': DISCORD_DESKTOP_UA,
      'X-Discord-Locale': 'vi',
    };
  }

  async request(method, path, body = null) {
    return this.semaphore.run(() => this.#requestWithRetry(method, path, body));
  }

  async #requestWithRetry(method, path, body) {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const headers = { ...this.headers };
    if (body !== null) headers['Content-Type'] = 'application/json';

    const options = { method, headers };
    if (body !== null) options.body = JSON.stringify(body);

    let lastError = null;

    for (let attempt = 0; attempt <= 4; attempt += 1) {
      let res;
      try {
        options.signal = AbortSignal.timeout(this.timeoutMs);
        res = await fetch(url, options);
      } catch (err) {
        lastError = err;
        if (attempt >= 3) break;
        await sleep(500 * 2 ** attempt + jitter(300));
        continue;
      }

      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text };
      }

      if (this.verbose) {
        console.log(`\n  -> ${method} ${url}`);
        if (body) console.log('     body:', JSON.stringify(body));
        console.log(`  <- ${res.status} ${res.statusText}`);
      }

      if (res.status === 429) {
        const bodyWait = Number(parsed?.retry_after);
        const headerWait = Number(res.headers.get('retry-after'));
        const seconds = Number.isFinite(bodyWait) ? bodyWait : Number.isFinite(headerWait) ? headerWait : 1;
        const waitMs = Math.min(60_000, Math.max(500, seconds * 1000)) + jitter(400);
        if (this.verbose) console.log(`     429: chờ ${Math.round(waitMs)}ms`);
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        lastError = new APIError(res.status, parsed?.message || text || res.statusText, parsed);
        if (attempt >= 3) break;
        await sleep(800 * 2 ** attempt + jitter(400));
        continue;
      }

      if (!res.ok) {
        const err = new APIError(res.status, parsed?.message || text || res.statusText, parsed);
        err.url = url;
        throw err;
      }

      return parsed;
    }

    if (lastError instanceof APIError) throw lastError;
    throw new Error(`Không kết nối được Discord API: ${lastError?.message || 'unknown'}`);
  }

  // ── User ────────────────────────────────────────────────────────────────────
  getMe() {
    return this.request('GET', '/users/@me');
  }

  // ── Quests ──────────────────────────────────────────────────────────────────
  async getQuests() {
    const data = await this.request('GET', '/quests/@me');
    return Array.isArray(data?.quests) ? data.quests : [];
  }

  enrollQuest(questId, location = 1) {
    return this.request('POST', `/quests/${questId}/enroll`, { location });
  }

  videoProgress(questId, timestamp) {
    return this.request('POST', `/quests/${questId}/video-progress`, { timestamp });
  }

  gameHeartbeat(questId, { terminal = false, streamKey = null } = {}) {
    const body = { terminal };
    if (streamKey) body.stream_key = streamKey;
    return this.request('POST', `/quests/${questId}/heartbeat`, body);
  }

  claimReward(questId, location = 1) {
    return this.request('POST', `/quests/${questId}/claim-reward`, {
      platform: 0,
      location,
    });
  }
}
