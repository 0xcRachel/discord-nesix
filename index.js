#!/usr/bin/env node
// index.js
// NESIX - Discord Quest & Badge Toolkit.
// Chạy: node index.js --help

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import inquirer from 'inquirer';
import ora from 'ora';

import { DATA_DIR, ensureDirs } from './src/paths.js';
import {
  config,
  migrateConfig,
  getToken,
  setToken,
  getSteamKey,
  getSteamId,
  maskSecret,
} from './src/config.js';
import { fileLog } from './src/logger.js';
import { acquireLock } from './src/lock.js';
import { sleep } from './src/rate-limit.js';
import { DiscordAPI } from './src/discord/api.js';
import { QuestManager } from './src/discord/quests.js';
import {
  loadCache,
  loadDetectable,
  refreshDetectable,
  steamDetectableGames,
  cacheAgeMs,
} from './src/discord/detectable.js';
import { getSteamPath, getInstalledGames } from './src/steam/local.js';
import { buildAllowedSet, fetchOwnedGames, steamOverview } from './src/steam/index.js';
import { Farmer } from './src/game/farm.js';
import { ensureStub } from './src/game/stub.js';
import { loadState, saveState, computeStats, bumpQuest } from './src/badges/engine.js';
import {
  banner,
  log,
  progressBar,
  renderQuestTable,
  makeBatchRenderer,
  renderStatus,
} from './src/ui/render.js';
import {
  mainMenu,
  settingsMenu,
  askNumber,
  askConfirm,
  askText,
} from './src/ui/menu.js';

const VERSION = '1.2.1';

const globalAbort = new AbortController();
let shuttingDown = false;
let currentManager = null;
let currentFarmer = null;
let currentLock = null;

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '-h') {
      out.help = true;
      continue;
    }
    if (token === '-v') {
      out.version = true;
      continue;
    }
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }

  return out;
}

function printHelp() {
  banner(VERSION);
  console.log(`Cách dùng:
  node index.js                         Menu tương tác
  node index.js --status                Xem trạng thái badge
  node index.js --quests                Xem danh sách quest
  node index.js --farm                  Farm Game Variety (mặc định)
  node index.js --farm --mode time      Farm Game Time
  node index.js --farm --minutes 120    Farm time trong 120 phút
  node index.js --farm --limit 10       Farm 10 game
  node index.js --farm --dwell 900      Giữ mỗi game 900 giây
  node index.js --farm --source installed
  node index.js --farm --dry-run        Chỉ in danh sách, không chạy
  node index.js --games refresh         Làm mới danh sách game detectable
  node index.js --steam import          Import thư viện Steam
  node index.js --doctor                Kiểm tra môi trường
  node index.js --auto                  Quest auto 24/7
  node index.js --setup                 Nhập token Discord
  node index.js --debug                 Dump JSON quest

Lưu ý:
  - Farm badge chỉ cần Discord desktop đang mở, không cần token.
  - Bật Settings > Activity Privacy > "Share your detected activities".
  - Badge Game Variety/Game Time đang experimental, không phải tài khoản nào cũng có.
`);
}

// ─── Discord helpers ──────────────────────────────────────────────────────────

function isDiscordRunning() {
  try {
    const out = execFileSync('tasklist', ['/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    return /Discord(PTB|Canary)?\.exe/i.test(out);
  } catch {
    return false;
  }
}

function userTag(me) {
  if (!me) return 'unknown';
  return me.discriminator && me.discriminator !== '0'
    ? `${me.username}#${me.discriminator}`
    : `@${me.username}`;
}

async function verifyToken(token) {
  const api = new DiscordAPI(token, { concurrency: 1 });
  const me = await api.getMe();
  return { api, me };
}

async function ensureToken({ allowSetup = true } = {}) {
  let token = getToken();

  if (!token && allowSetup) {
    await runSetup();
    token = getToken();
  }

  if (!token) throw new Error('Chưa có token Discord. Chạy: node index.js --setup');

  try {
    const { api, me } = await verifyToken(token);
    log.ok(`Đăng nhập: ${userTag(me)}`);
    return { api, me };
  } catch (err) {
    log.error(`Token không hợp lệ hoặc hết hạn: ${err.message}`);
    if (!allowSetup) throw err;

    const again = await askConfirm('Nhập lại token mới?', true);
    if (!again) throw err;

    await runSetup();
    token = getToken();
    if (!token) throw new Error('Chưa có token');

    const { api, me } = await verifyToken(token);
    log.ok(`Đăng nhập: ${userTag(me)}`);
    return { api, me };
  }
}

async function runSetup() {
  console.log('\nCách lấy Discord token:');
  console.log('  1. Mở Discord trên trình duyệt (discord.com/app)');
  console.log('  2. Nhấn F12, mở tab Console');
  console.log('  3. Dán đoạn script lấy token đang có trong README');
  console.log('  4. Copy token và dán vào đây\n');
  console.log('Cảnh báo: token là mật khẩu tài khoản. Không chia sẻ cho ai.\n');

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Dán Discord token:',
      mask: '*',
      validate: (value) => String(value).trim().length > 20 || 'Token quá ngắn',
    },
  ]);

  const candidate = String(token).trim();
  const spinner = ora({ text: 'Đang kiểm tra token...', spinner: 'line', color: 'cyan' }).start();

  try {
    const { me } = await verifyToken(candidate);
    spinner.succeed(`Token hợp lệ: ${userTag(me)}`);
    setToken(candidate);
  } catch (err) {
    spinner.fail(`Token không hợp lệ: ${err.message}`);
    const keep = await askConfirm('Vẫn lưu token này?', false);
    if (keep) setToken(candidate);
    else return false;
  }

  log.ok('Đã lưu token.');
  return true;
}

// ─── Quest ────────────────────────────────────────────────────────────────────

function setupEventListeners(manager, state) {
  manager.on('accepted', (quest) => {
    bumpQuest(state, 'accepted');
    saveState(state);
    log.ok(`Đã nhận quest: ${quest.config?.messages?.quest_name || quest.id}`);
  });

  manager.on('claimed', (quest) => {
    bumpQuest(state, 'claimed');
    saveState(state);
    log.ok(`Đã nhận thưởng: ${quest.config?.messages?.quest_name || quest.id}`);
  });

  manager.on('video:done', ({ quest }) => {
    log.ok(`Video xong: ${quest.config?.messages?.quest_name || quest.id}`);
  });

  manager.on('game:done', ({ quest }) => {
    log.ok(`Game xong: ${quest.config?.messages?.quest_name || quest.id}`);
  });

  manager.on('quest:done', ({ quest }) => {
    bumpQuest(state, 'completed');
    saveState(state);
    log.ok(`Quest hoàn thành: ${quest.config?.messages?.quest_name || quest.id}`);
  });

  manager.on('skipped', ({ quest, reason }) => {
    log.warn(`Bỏ qua "${quest.config?.messages?.quest_name || quest.id}": ${reason}`);
  });

  manager.on('warn', (message) => log.warn(message));

  manager.on('error', ({ quest, err, step }) => {
    const name = quest?.config?.messages?.quest_name || quest?.id || '?';
    log.error(`[${step}] ${name}: ${err.message}`);
  });
}

function createManager(api, state) {
  const manager = new QuestManager(api, {
    heartbeatSec: Number(config.get('heartbeatSec')),
    videoStepSec: Number(config.get('videoStepSec')),
    maxBatchHours: Number(config.get('maxBatchHours')),
    log,
  });

  setupEventListeners(manager, state);
  manager.start();
  currentManager = manager;
  return manager;
}

async function questList(manager) {
  const spinner = ora({ text: 'Đang lấy quest...', spinner: 'line' }).start();

  try {
    const groups = await manager.fetchQuests();
    spinner.stop();

    if (groups.available.length) renderQuestTable(groups.available, 'Quest có sẵn');
    if (groups.active.length) renderQuestTable(groups.active, 'Quest đang làm');
    if (groups.completed.length) renderQuestTable(groups.completed, 'Quest chờ nhận thưởng');
    if (groups.claimed.length) renderQuestTable(groups.claimed, 'Quest đã nhận');
    if (groups.expired.length) renderQuestTable(groups.expired, 'Quest hết hạn');

    if (!groups.available.length && !groups.active.length && !groups.completed.length) {
      log.warn('Không có quest nào đang hoạt động.');
    }
  } catch (err) {
    spinner.fail(`Lỗi: ${err.message}`);
  }
}

async function questAccept(manager) {
  const spinner = ora({ text: 'Đang lấy quest...', spinner: 'line' }).start();
  const { available } = await manager.fetchQuests();
  spinner.stop();

  if (!available.length) {
    log.warn('Không có quest nào để nhận.');
    return;
  }

  log.step(`Nhận ${available.length} quest...`);
  await manager.acceptAll(available);
}

async function questComplete(manager, { silent = false } = {}) {
  const spinner = ora({ text: 'Đang lấy quest đang làm...', spinner: 'line' }).start();
  const { active } = await manager.fetchQuests();
  spinner.stop();

  if (!active.length) {
    if (!silent) log.warn('Không có quest nào đang làm.');
    return [];
  }

  log.step(`Chạy batch ${active.length} quest...`);
  const render = makeBatchRenderer();
  const states = await manager.completeAllBatch(active, render);

  const skipped = states.filter((state) => state.skipped).length;
  if (skipped) log.warn(`${skipped} quest bị bỏ qua (stream/activity hoặc không hỗ trợ).`);

  return states;
}

async function questClaim(manager, { silent = false } = {}) {
  const spinner = ora({ text: 'Đang lấy quest đã xong...', spinner: 'line' }).start();
  const { completed } = await manager.fetchQuests();
  spinner.stop();

  if (!completed.length) {
    if (!silent) log.warn('Không có quest nào chờ nhận thưởng.');
    return;
  }

  await manager.claimAll(completed);
}

async function questFull(manager) {
  if (config.get('autoAccept')) {
    const { available } = await manager.fetchQuests();
    if (available.length) {
      log.step(`Tự động nhận ${available.length} quest...`);
      await manager.acceptAll(available);
    }
  }

  await questComplete(manager);

  if (config.get('autoClaim')) {
    await questClaim(manager);
  }
}

async function questWatch(manager) {
  const questId = await askText('Nhập Quest ID video:', '');
  if (!questId) {
    log.warn('Quest ID rỗng.');
    return;
  }

  const seconds = await askNumber('Số giây cần xem:', 60, { min: 5, max: 3600 });
  log.step(`Xem video quest ${questId} (${seconds}s)...`);

  await manager.completeVideoById(questId, seconds, (current, total) => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  ${progressBar(current, total)}`);
    }
  });

  if (process.stdout.isTTY) process.stdout.write('\n');
  log.ok(`Đã xem xong video quest ${questId}.`);
}

async function cmdDebug() {
  const token = getToken();
  if (!token) {
    log.error('Chưa có token. Chạy --setup trước.');
    return;
  }

  const api = new DiscordAPI(token, { concurrency: 1 });
  const quests = await api.getQuests();
  const out = join(DATA_DIR, 'quests-debug.json');
  writeFileSync(out, JSON.stringify(quests, null, 2), 'utf8');

  log.ok(`${quests.length} quest, đã ghi JSON ra ${out}`);
  console.log(JSON.stringify(quests.slice(0, 3), null, 2));
}

async function cmdAuto(state) {
  const lock = acquireLock();
  if (!lock.ok) {
    log.error(`Đang có instance khác chạy (PID ${lock.pid}).`);
    return;
  }
  currentLock = lock;

  try {
    const { api } = await ensureToken();
    const manager = createManager(api, state);
    const pollMin = Math.max(5, Number(config.get('pollIntervalMin')));
    const pollMs = pollMin * 60 * 1000;

    log.info(`Auto mode: poll mỗi ${pollMin} phút. Ctrl+C để dừng.`);

    while (!globalAbort.signal.aborted) {
      log.step(`[${new Date().toLocaleTimeString()}] Bắt đầu chu kỳ quest...`);

      try {
        if (config.get('autoAccept')) {
          const { available } = await manager.fetchQuests();
          if (available.length) await manager.acceptAll(available);
        }

        await questComplete(manager, { silent: true });

        if (config.get('autoClaim')) {
          await questClaim(manager, { silent: true });
        }
      } catch (err) {
        log.error(`Lỗi chu kỳ: ${err.message}`);
        fileLog.error(err.stack || err.message);
      }

      log.dim(`Chu kỳ tiếp theo sau ${pollMin} phút.`);
      await sleep(pollMs, globalAbort.signal);
    }
  } finally {
    currentManager?.stop();
    currentManager = null;
    lock.release();
    currentLock = null;
  }
}

// ─── Badge / farm ─────────────────────────────────────────────────────────────

function cacheAgeText(data) {
  if (!data?.fetchedAt) return 'chưa có cache';
  const ms = cacheAgeMs(data);
  if (!Number.isFinite(ms)) return 'không rõ';
  if (ms < 60 * 60 * 1000) return `${Math.max(1, Math.round(ms / 60000))} phút`;
  return `${Math.round(ms / 3600000)} giờ`;
}

async function cmdStatus(state) {
  const cached = loadCache();
  const steam = steamOverview();
  const stats = computeStats(state);

  console.log(
    renderStatus(stats, {
      detectableCount: cached ? steamDetectableGames(cached).length : 0,
      steam,
      discordRunning: isDiscordRunning(),
      cacheAge: cacheAgeText(cached),
    }),
  );
}

async function cmdRefreshGames() {
  const data = await refreshDetectable({ log });
  const steam = steamDetectableGames(data);
  log.ok(`${data.count} game detectable.`);
  log.ok(`${steam.length} game có Steam appid + exe Windows.`);
  log.dim('Chạy --farm để bắt đầu.');
}

async function cmdSteamImport() {
  const steamPath = getSteamPath();

  if (!steamPath) {
    log.error('Không tìm thấy thư mục Steam trên máy.');
  } else {
    const installed = getInstalledGames(steamPath);
    log.ok(`Steam: ${steamPath}`);
    log.ok(`${installed.size} game đã cài.`);
  }

  const key = getSteamKey();
  const steamId = getSteamId();

  if (!key || !steamId) {
    log.warn('Chưa có Steam API key / SteamID64. Bỏ qua phần thư viện sở hữu.');
    log.dim('Cấu hình trong Settings, hoặc đặt STEAM_API_KEY và STEAM_ID.');
    return;
  }

  try {
    const data = await fetchOwnedGames({ key, steamId, force: true, log });
    log.ok(`${data.games.length} game sở hữu.`);
  } catch (err) {
    log.error(`Không lấy được thư viện Steam: ${err.message}`);
  }
}

async function cmdFarm(args, state) {
  const mode = args.mode === 'time' ? 'time' : 'variety';
  const lock = acquireLock();

  if (!lock.ok) {
    log.error(`Đang có instance khác chạy (PID ${lock.pid}).`);
    return;
  }
  currentLock = lock;

  try {
    const dryRun = Boolean(args['dry-run']);

    if (!dryRun && !isDiscordRunning()) {
      log.error('Discord desktop chưa chạy. Hãy mở Discord trước khi farm.');
      return;
    }

    log.warn('Kiểm tra: Settings > Activity Privacy > "Share your detected activities" phải bật.');
    log.dim('Badge Game Variety/Game Time đang experimental, không phải tài khoản nào cũng được bật.');

    const detectable = await loadDetectable({ refresh: Boolean(args.refresh), log });
    const available = steamDetectableGames(detectable);
    log.info(`Detectable: ${available.length} game có Steam + exe Windows.`);

    const source = String(args.source || config.get('gameSource'));
    const { allowed, label } = await buildAllowedSet(source, {
      key: getSteamKey(),
      steamId: getSteamId(),
      log,
    });
    log.info(`Nguồn game: ${label}`);

    if (!dryRun) {
      ensureStub({ log });
      log.ok('Stub exe sẵn sàng.');
    }

    const limit = Math.max(1, Math.min(500, Number(args.limit) || (mode === 'time' ? 500 : 5)));
    const dwellSec = Math.max(60, Math.min(3600, Number(args.dwell) || Number(config.get('dwellSec'))));
    const minutes = Math.max(1, Math.min(720, Number(args.minutes) || 60));
    const dailyCap = Math.max(1, Number(config.get('dailyGameCap')) || 20);

    if (mode === 'variety') {
      log.info(`Farm ${limit} game, mỗi game ${dwellSec}s. Dự kiến ~${Math.round((limit * dwellSec) / 60)} phút.`);
    } else {
      log.info(`Farm time trong ${minutes} phút, mỗi game ${dwellSec}s.`);
    }

    const farmer = new Farmer({
      detectable,
      state,
      log,
      signal: globalAbort.signal,
    });
    currentFarmer = farmer;

    await farmer.run({
      limit: mode === 'time' ? Number.MAX_SAFE_INTEGER : limit,
      dwellSec,
      minutes,
      mode,
      dryRun,
      allowed,
      dailyCap,
    });
  } finally {
    currentFarmer = null;
    lock.release();
    currentLock = null;
  }
}

// ─── Doctor ───────────────────────────────────────────────────────────────────

function printCheck(ok, label, detail = '') {
  if (ok === true) log.ok(`${label}${detail ? `: ${detail}` : ''}`);
  else if (ok === null) log.warn(`${label}${detail ? `: ${detail}` : ''}`);
  else log.error(`${label}${detail ? `: ${detail}` : ''}`);
}

async function cmdDoctor() {
  console.log('\nKiểm tra môi trường\n');

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  printCheck(nodeMajor >= 18, 'Node.js', process.versions.node);
  printCheck(process.platform === 'win32', 'Windows', process.platform);

  const discord = isDiscordRunning();
  printCheck(discord, 'Discord desktop', discord ? 'đang chạy' : 'chưa chạy');

  const discordDir = join(process.env.APPDATA || '', 'discord');
  printCheck(existsSync(discordDir) ? true : null, 'Thư mục Discord', discordDir);

  const steamPath = getSteamPath();
  const installed = steamPath ? getInstalledGames(steamPath) : new Map();
  printCheck(Boolean(steamPath), 'Steam', steamPath ? `${installed.size} game đã cài` : 'không tìm thấy');

  const cached = loadCache();
  printCheck(
    Boolean(cached),
    'Detectable cache',
    cached ? `${cached.count} game, ${cacheAgeText(cached)} trước` : 'chưa có, chạy --games refresh',
  );

  try {
    ensureStub({ log });
    printCheck(true, 'Stub exe', 'build thành công');
  } catch (err) {
    printCheck(false, 'Stub exe', err.message);
  }

  const token = getToken();
  if (token) {
    try {
      const { me } = await verifyToken(token);
      printCheck(true, 'Token Discord', userTag(me));
    } catch (err) {
      printCheck(false, 'Token Discord', err.message);
    }
  } else {
    printCheck(null, 'Token Discord', 'chưa có (không bắt buộc để farm badge)');
  }

  try {
    const probe = join(DATA_DIR, '.write-test');
    writeFileSync(probe, 'ok', 'utf8');
    unlinkSync(probe);
    printCheck(true, 'Quyền ghi data', DATA_DIR);
  } catch (err) {
    printCheck(false, 'Quyền ghi data', err.message);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function runSettings() {
  const field = await settingsMenu();

  if (field === 'token') {
    await runSetup();
  }

  if (field === 'poll') {
    const value = await askNumber('Poll interval (phút):', Number(config.get('pollIntervalMin')), { min: 5, max: 1440 });
    config.set('pollIntervalMin', value);
    log.ok(`Poll interval: ${value} phút.`);
  }

  if (field === 'dwell') {
    const value = await askNumber('Thời gian giữ mỗi game (giây):', Number(config.get('dwellSec')), { min: 60, max: 3600 });
    config.set('dwellSec', value);
    log.ok(`Dwell: ${value}s.`);
  }

  if (field === 'cap') {
    const value = await askNumber('Số game credit tối đa mỗi ngày:', Number(config.get('dailyGameCap')), { min: 1, max: 200 });
    config.set('dailyGameCap', value);
    log.ok(`Daily cap: ${value} game.`);
  }

  if (field === 'source') {
    const { value } = await inquirer.prompt([
      {
        type: 'list',
        name: 'value',
        message: 'Nguồn game:',
        default: config.get('gameSource'),
        choices: [
          { name: 'Tất cả game detectable có trên Steam (khuyên dùng)', value: 'detectable' },
          { name: 'Chỉ game đã cài trên máy', value: 'installed' },
          { name: 'Chỉ game sở hữu (cần Steam API)', value: 'owned' },
        ],
      },
    ]);
    config.set('gameSource', value);
    log.ok(`Nguồn game: ${value}.`);
  }

  if (field === 'steam') {
    const key = await askText('Steam API key (để trống để xóa):', getSteamKey() ? maskSecret(getSteamKey()) : '');
    const id = await askText('SteamID64 (để trống để xóa):', getSteamId());

    if (key === maskSecret(getSteamKey())) {
      // giữ nguyên
    } else {
      config.set('steamApiKey', key);
    }

    config.set('steamId', id);
    log.ok('Đã cập nhật cấu hình Steam.');
  }

  if (field === 'claim') {
    const value = await askConfirm('Bật auto claim?', Boolean(config.get('autoClaim')));
    config.set('autoClaim', value);
    log.ok(`Auto claim: ${value ? 'BẬT' : 'TẮT'}.`);
  }
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

async function runMenu(state) {
  let api = null;
  let manager = null;

  const getManager = async () => {
    if (manager) return manager;
    const auth = await ensureToken();
    api = auth.api;
    manager = createManager(api, state);
    return manager;
  };

  while (!shuttingDown && !globalAbort.signal.aborted) {
    const action = await mainMenu();

    if (action === 'exit') break;

    try {
      if (action === 'quest:list') await questList(await getManager());
      if (action === 'quest:accept') await questAccept(await getManager());
      if (action === 'quest:complete') await questComplete(await getManager());
      if (action === 'quest:claim') await questClaim(await getManager());
      if (action === 'quest:watch') await questWatch(await getManager());
      if (action === 'quest:full') await questFull(await getManager());

      if (action === 'badge:status') await cmdStatus(state);

      if (action === 'badge:variety') {
        const limit = await askNumber('Số game muốn farm:', 5, { min: 1, max: 100 });
        const dwell = await askNumber('Giữ mỗi game bao nhiêu giây:', Number(config.get('dwellSec')), { min: 60, max: 3600 });
        log.info(`Dự kiến ~${Math.round((limit * dwell) / 60)} phút.`);
        if (await askConfirm('Bắt đầu farm?', true)) {
          await cmdFarm({ limit, dwell }, state);
        }
      }

      if (action === 'badge:time') {
        const minutes = await askNumber('Farm time bao nhiêu phút:', 60, { min: 5, max: 720 });
        if (await askConfirm('Bắt đầu farm?', true)) {
          await cmdFarm({ mode: 'time', minutes }, state);
        }
      }

      if (action === 'data:steam') await cmdSteamImport();
      if (action === 'data:games') await cmdRefreshGames();
      if (action === 'data:doctor') await cmdDoctor();
      if (action === 'settings') await runSettings();
    } catch (err) {
      log.error(err.message);
      fileLog.error(err.stack || err.message);
    }

    console.log();
  }

  manager?.stop();
  currentManager = null;
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    currentFarmer?.abort();
  } catch {
    // bỏ qua
  }
  try {
    currentManager?.stop();
  } catch {
    // bỏ qua
  }
  try {
    currentLock?.release();
  } catch {
    // bỏ qua
  }

  await sleep(400);
  process.exit(code);
}

process.on('SIGINT', () => {
  if (!shuttingDown) console.log('\n[!] Đang dừng...');
  shutdown(0);
});

process.on('SIGTERM', () => shutdown(0));

process.on('uncaughtException', (err) => {
  log.error(err.message);
  fileLog.error(err.stack || err.message);
  if (process.env.DEBUG) console.error(err);
  shutdown(1);
});

process.on('unhandledRejection', (err) => {
  log.error(err?.message || String(err));
  fileLog.error(err?.stack || String(err));
  if (process.env.DEBUG) console.error(err);
  shutdown(1);
});

process.on('exit', () => {
  try {
    currentFarmer?.current?.proc?.kill();
  } catch {
    // bỏ qua
  }
});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureDirs();
  migrateConfig();

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.version) {
    console.log(VERSION);
    return;
  }

  const state = loadState();

  if (args.setup) {
    const ok = await runSetup();
    const hasOtherCommand = ['status', 'quests', 'doctor', 'games', 'steam', 'debug', 'farm', 'auto'].some((key) => args[key]);
    if (!ok || !hasOtherCommand) return;
  }

  if (args.status) {
    await cmdStatus(state);
    return;
  }

  if (args.quests) {
    const { api } = await ensureToken();
    const manager = createManager(api, state);
    try {
      await questList(manager);
    } finally {
      manager.stop();
      currentManager = null;
    }
    return;
  }

  if (args.doctor) {
    await cmdDoctor();
    return;
  }

  if (args.games) {
    await cmdRefreshGames();
    return;
  }

  if (args.steam) {
    await cmdSteamImport();
    return;
  }

  if (args.debug) {
    await cmdDebug();
    return;
  }

  if (args.farm) {
    await cmdFarm(args, state);
    return;
  }

  if (args.auto) {
    await cmdAuto(state);
    return;
  }

  banner(VERSION);

  if (process.stdout.isTTY) {
    console.log('Token: ' + (getToken() ? 'đã có' : 'chưa có') + '  |  Discord: ' + (isDiscordRunning() ? 'đang chạy' : 'chưa chạy'));
    console.log('Farm badge không cần token. Quest cần token.\n');
  }

  await runMenu(state);
}

main().catch((err) => {
  log.error(err.message);
  fileLog.error(err.stack || err.message);
  if (process.env.DEBUG) console.error(err);
  process.exitCode = 1;
});
