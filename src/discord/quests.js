// src/discord/quests.js
// Quản lý Discord Quests: phân loại, nhận, chạy video/game, nhận thưởng.
// Đã sửa lỗi treo vô hạn với quest STREAM/ACTIVITY.

import { EventEmitter } from 'node:events';
import { sleep } from '../rate-limit.js';

export function getTaskConfig(quest) {
  return quest?.config?.task_config_v2 || quest?.config?.task_config || null;
}

export function getQuestTasks(quest) {
  const taskConfig = getTaskConfig(quest);
  const tasks = taskConfig?.tasks && typeof taskConfig.tasks === 'object' ? taskConfig.tasks : {};
  const videoKey = Object.keys(tasks).find((key) => key.includes('VIDEO')) || null;

  return {
    tasks,
    videoKey,
    video: videoKey ? tasks[videoKey] : null,
    play: tasks.PLAY_ON_DESKTOP || null,
    stream: tasks.STREAM_ON_DESKTOP || null,
    activity: tasks.PLAY_ACTIVITY || null,
  };
}

export function detectQuestType(quest) {
  const tasks = getQuestTasks(quest);
  if (tasks.videoKey) return 'VIDEO';
  if (tasks.play) return 'GAME';
  if (tasks.stream) return 'STREAM';
  if (tasks.activity) return 'ACTIVITY';
  return Object.keys(tasks.tasks).length ? 'OTHER' : 'UNKNOWN';
}

export function getQuestCapabilities(quest) {
  const tasks = getQuestTasks(quest);
  return {
    video: Boolean(tasks.videoKey),
    game: Boolean(tasks.play),
    stream: Boolean(tasks.stream),
    activity: Boolean(tasks.activity),
  };
}

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function extractGameInfo(quest) {
  const tasks = getQuestTasks(quest);
  const playTask = tasks.play;

  const appId =
    quest?.config?.application?.id ||
    playTask?.applications?.[0]?.id ||
    null;

  const title =
    quest?.config?.messages?.game_title ||
    quest?.config?.application?.name ||
    quest?.config?.messages?.quest_name ||
    'Unknown Game';

  return {
    appId: appId ? String(appId) : null,
    title,
    targetSeconds: toPositiveNumber(playTask?.target ?? playTask?.target_seconds, 900),
  };
}

export function extractVideoInfo(quest) {
  const tasks = getQuestTasks(quest);
  return {
    videoKey: tasks.videoKey,
    targetSeconds: toPositiveNumber(tasks.video?.target ?? tasks.video?.target_seconds, 180),
  };
}

export function readProgress(quest, key) {
  const value = quest?.user_status?.progress?.[key]?.value;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Phân loại một quest. Hàm thuần, dùng cho test.
 */
export function classifyQuest(quest, now = Date.now()) {
  const caps = getQuestCapabilities(quest);
  const gameInfo = extractGameInfo(quest);
  const videoInfo = extractVideoInfo(quest);

  const videoCurrent = caps.video ? readProgress(quest, videoInfo.videoKey) : 0;
  const gameCurrent = caps.game ? readProgress(quest, 'PLAY_ON_DESKTOP') : 0;

  const status = quest?.user_status;
  const claimed = Boolean(status?.claimed_at);

  const expiry = Date.parse(quest?.config?.expires_at || '');
  const expired = Number.isFinite(expiry) && expiry <= now;

  let done = Boolean(status?.completed_at);
  if (!done && status) {
    const checks = [];
    if (caps.video) checks.push(videoCurrent >= videoInfo.targetSeconds);
    if (caps.game) checks.push(gameCurrent >= gameInfo.targetSeconds);
    if (checks.length) done = checks.every(Boolean);
  }

  let bucket;
  if (claimed) bucket = 'claimed';
  else if (expired) bucket = 'expired';
  else if (!status) bucket = 'available';
  else if (done) bucket = 'completed';
  else bucket = 'active';

  return {
    bucket,
    type: detectQuestType(quest),
    caps,
    claimed,
    expired,
    done,
    videoKey: videoInfo.videoKey,
    videoCurrent,
    videoTarget: videoInfo.targetSeconds,
    gameCurrent,
    gameTarget: gameInfo.targetSeconds,
    gameTitle: gameInfo.title,
    appId: gameInfo.appId,
  };
}

export class QuestManager extends EventEmitter {
  constructor(api, { heartbeatSec = 30, videoStepSec = 10, maxBatchHours = 6, log = console } = {}) {
    super();
    this.api = api;
    this.heartbeatSec = heartbeatSec;
    this.videoStepSec = videoStepSec;
    this.maxBatchHours = maxBatchHours;
    this.log = log;
    this._running = false;
    this._abort = null;
  }

  get running() {
    return this._running;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._abort = new AbortController();
  }

  stop() {
    this._running = false;
    this._abort?.abort();
    this._abort = null;
  }

  get signal() {
    return this._abort?.signal;
  }

  async fetchQuests() {
    const quests = await this.api.getQuests();
    const now = Date.now();

    const groups = {
      available: [],
      active: [],
      completed: [],
      claimed: [],
      expired: [],
    };
    const seen = new Set();

    for (const quest of quests) {
      if (!quest?.id || seen.has(quest.id)) continue;
      seen.add(quest.id);
      const info = classifyQuest(quest, now);
      groups[info.bucket].push({ ...quest, _info: info });
    }

    return { ...groups, raw: quests };
  }

  async acceptAll(quests) {
    const results = [];
    for (const quest of quests) {
      try {
        const res = await this.api.enrollQuest(quest.id);
        results.push({ quest, res, ok: true });
        this.emit('accepted', quest);
      } catch (err) {
        results.push({ quest, err, ok: false });
        this.emit('error', { quest, err, step: 'enroll' });
      }
      await sleep(500, this.signal);
    }
    return results;
  }

  async completeVideoById(questId, targetSeconds = 60, onProgress, { timeoutSec = 900 } = {}) {
    if (!this._running) this.start();
    const signal = this.signal;
    const target = toPositiveNumber(targetSeconds, 60);
    const deadline = Date.now() + timeoutSec * 1000;
    let current = 0;

    try {
      await this.api.enrollQuest(questId);
    } catch {
      // Có thể đã enroll từ trước.
    }

    while (!signal?.aborted && current < target && Date.now() < deadline) {
      await sleep(this.videoStepSec * 1000, signal);
      if (signal?.aborted) break;

      const next = Math.min(target, current + this.videoStepSec);
      try {
        const res = await this.api.videoProgress(questId, next);
        current = next;
        onProgress?.(current, target);
        if (res?.completed_at) break;
      } catch (err) {
        this.emit('error', { quest: { id: questId }, err, step: 'video_progress' });
        await sleep(3000, signal);
      }
    }

    if (!signal?.aborted) {
      await this.api.videoProgress(questId, target).catch(() => {});
      this.emit('video:done', { quest: { id: questId } });
    }
    return current;
  }

  /**
   * Chạy tất cả quest VIDEO và GAME song song trong một vòng lặp duy nhất.
   * Quest STREAM/ACTIVITY được đánh dấu skip, không làm treo tool.
   */
  async completeAllBatch(quests, onProgressUpdate) {
    if (!this._running) this.start();
    const signal = this.signal;

    const states = quests.map((quest) => {
      const caps = getQuestCapabilities(quest);
      const gameInfo = extractGameInfo(quest);
      const videoInfo = extractVideoInfo(quest);

      const videoCurrent = caps.video ? Math.min(readProgress(quest, videoInfo.videoKey), videoInfo.targetSeconds) : 0;
      const gameCurrent = caps.game ? Math.min(readProgress(quest, 'PLAY_ON_DESKTOP'), gameInfo.targetSeconds) : 0;

      const skipped = !caps.video && !caps.game;
      const videoDone = !caps.video || videoCurrent >= videoInfo.targetSeconds;
      const gameDone = !caps.game || gameCurrent >= gameInfo.targetSeconds;

      return {
        quest,
        id: quest.id,
        name: quest.config?.messages?.quest_name || quest.id,
        type: detectQuestType(quest),
        caps,
        videoKey: videoInfo.videoKey,
        videoCurrent,
        videoTarget: videoInfo.targetSeconds,
        videoDone,
        gameCurrent,
        gameTarget: gameInfo.targetSeconds,
        gameDone,
        skipped,
        reason: skipped ? 'loại quest stream/activity chưa hỗ trợ' : '',
        done: skipped || (videoDone && gameDone),
        failCount: 0,
        lastProgressAt: Date.now(),
        nextVideoAt: 0,
        nextGameAt: 0,
      };
    });

    for (const state of states) {
      if (state.skipped) {
        this.emit('skipped', { quest: state.quest, reason: state.reason });
      } else if (state.done) {
        this.emit('quest:done', { quest: state.quest });
      }
    }

    const deadline = Date.now() + this.maxBatchHours * 3600 * 1000;
    onProgressUpdate?.(states);

    while (!signal?.aborted && states.some((state) => !state.done)) {
      if (Date.now() > deadline) {
        this.emit('warn', `Đã chạm giới hạn ${this.maxBatchHours} giờ cho một batch. Dừng batch.`);
        break;
      }

      const now = Date.now();
      const pending = states.filter((state) => !state.done && !state.skipped);
      await Promise.allSettled(pending.map((state) => this.#step(state, now)));
      onProgressUpdate?.(states);
      await sleep(1000, signal);
    }

    for (const state of states) {
      if (!state.done && signal?.aborted) {
        state.done = true;
        state.reason = 'đã huỷ';
      }
    }

    return states;
  }

  async #step(state, now) {
    const jobs = [];

    if (state.caps.video && !state.videoDone && now >= state.nextVideoAt) {
      jobs.push(this.#videoStep(state));
    }
    if (state.caps.game && !state.gameDone && now >= state.nextGameAt) {
      jobs.push(this.#gameStep(state));
    }

    if (jobs.length) await Promise.allSettled(jobs);

    const videoFinished = !state.caps.video || state.videoDone;
    const gameFinished = !state.caps.game || state.gameDone;

    if (videoFinished && gameFinished) {
      state.done = true;
      this.emit('quest:done', { quest: state.quest });
      return;
    }

    // Không có tiến độ thành công trong 5 phút thì bỏ qua, tránh treo.
    if (Date.now() - state.lastProgressAt > 5 * 60 * 1000) {
      state.done = true;
      state.reason = 'không có tiến độ trong 5 phút';
      this.emit('warn', `Quest "${state.name}" không tiến triển, bỏ qua.`);
    }
  }

  async #videoStep(state) {
    const next = Math.min(state.videoTarget, state.videoCurrent + this.videoStepSec);
    try {
      const res = await this.api.videoProgress(state.id, next);
      state.videoCurrent = next;
      state.lastProgressAt = Date.now();
      state.failCount = 0;
      state.nextVideoAt = Date.now() + this.videoStepSec * 1000;

      if (res?.completed_at || next >= state.videoTarget) {
        state.videoDone = true;
        this.emit('video:done', { quest: state.quest });
      }
    } catch (err) {
      state.failCount += 1;
      state.nextVideoAt = Date.now() + 5000;
      this.emit('error', { quest: state.quest, err, step: 'video_progress' });
      if (state.failCount >= 6) {
        state.done = true;
        state.reason = 'lỗi video quá nhiều lần';
        this.emit('warn', `Quest "${state.name}" lỗi video 6 lần, bỏ qua.`);
      }
    }
  }

  async #gameStep(state) {
    try {
      const res = await this.api.gameHeartbeat(state.id, { terminal: false });
      state.lastProgressAt = Date.now();
      state.failCount = 0;
      state.nextGameAt = Date.now() + this.heartbeatSec * 1000;

      const value = res?.progress?.PLAY_ON_DESKTOP?.value;
      if (Number.isFinite(Number(value))) {
        state.gameCurrent = Math.min(state.gameTarget, Number(value));
      } else {
        state.gameCurrent = Math.min(state.gameTarget, state.gameCurrent + this.heartbeatSec);
      }

      if (res?.completed_at || state.gameCurrent >= state.gameTarget) {
        state.gameDone = true;
        await this.api.gameHeartbeat(state.id, { terminal: true }).catch(() => {});
        this.emit('game:done', { quest: state.quest });
      }
    } catch (err) {
      state.failCount += 1;
      state.nextGameAt = Date.now() + 8000;
      this.emit('error', { quest: state.quest, err, step: 'game_heartbeat' });
      if (state.failCount >= 6) {
        state.done = true;
        state.reason = 'lỗi heartbeat quá nhiều lần';
        this.emit('warn', `Quest "${state.name}" lỗi heartbeat 6 lần, bỏ qua.`);
      }
    }
  }

  async claimAll(quests) {
    const results = [];
    for (const quest of quests) {
      if (quest.user_status?.claimed_at) continue;

      const name = quest.config?.messages?.quest_name || quest.id;
      try {
        const res = await this.api.claimReward(quest.id);
        results.push({ quest, res, ok: true });
        this.emit('claimed', quest);
      } catch (err) {
        const isCaptcha = Boolean(err.raw?.captcha_key || err.raw?.captcha_sid) || /captcha/i.test(err.message);
        results.push({ quest, err, ok: false, isCaptcha });
        if (isCaptcha) {
          this.emit('warn', `Quest "${name}" đã 100% nhưng Discord yêu cầu captcha. Hãy nhận trong Discord.`);
        } else {
          this.emit('error', { quest, err, step: 'claim' });
        }
      }
      await sleep(1000, this.signal);
    }
    return results;
  }
}
