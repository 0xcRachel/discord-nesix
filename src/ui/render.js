// src/ui/render.js
// Toàn bộ output terminal: không emoji, không icon trang trí.

import chalk from 'chalk';
import Table from 'cli-table3';
import readline from 'node:readline';
import { classifyQuest, extractGameInfo } from '../discord/quests.js';

export function banner(version = '1.2.0') {
  const line = '='.repeat(62);
  console.log(chalk.cyan(`\n${line}`));
  console.log(chalk.cyan.bold(`  NESIX ${version}  -  Discord Quest & Badge Toolkit`));
  console.log(chalk.cyan(`${line}\n`));
}

export const log = {
  info: (...args) => console.log(chalk.blue('[i]'), ...args),
  ok: (...args) => console.log(chalk.green('[ok]'), ...args),
  warn: (...args) => console.log(chalk.yellow('[!]'), ...args),
  error: (...args) => console.log(chalk.red('[x]'), ...args),
  step: (...args) => console.log(chalk.magenta('[>]'), ...args),
  dim: (...args) => console.log(chalk.gray('    -'), ...args),
};

export function progressBar(current, total, width = 24) {
  const pct = Math.min(Math.max((Number(current) || 0) / (Number(total) || 1), 0), 1);
  const filled = Math.round(pct * width);
  const bar = '#'.repeat(filled) + '-'.repeat(Math.max(0, width - filled));
  return `[${bar}] ${String(Math.round(pct * 100)).padStart(3)}%`;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function typeLabel(type) {
  const labels = {
    VIDEO: chalk.blue('Video'),
    GAME: chalk.green('Game'),
    STREAM: chalk.magenta('Stream'),
    ACTIVITY: chalk.yellow('Activity'),
    OTHER: chalk.gray('Khác'),
    UNKNOWN: chalk.gray('?'),
  };
  return labels[type] || chalk.gray(type);
}

function formatReward(quest) {
  const rewards = quest?.config?.rewards_config?.rewards || [];
  if (!rewards.length) return '-';

  const reward = rewards[0];
  if (reward.orb_quantity) return `${reward.orb_quantity} Orbs`;
  if (reward.messages?.name) return reward.messages.name;
  if (reward.name) return reward.name;
  return 'Vật phẩm';
}

function formatExpiry(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return '-';

  const days = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return chalk.red('Hết hạn');
  if (days === 1) return chalk.yellow('1 ngày');
  return chalk.gray(`${days} ngày`);
}

function questProgressText(info) {
  if (info.bucket === 'available') return chalk.gray('Chưa nhận');
  if (info.bucket === 'claimed') return chalk.green('Đã nhận');
  if (info.bucket === 'completed') return chalk.green('Chờ nhận');
  if (info.bucket === 'expired') return chalk.red('Hết hạn');

  const parts = [];
  if (info.caps.video) parts.push(`video ${info.videoCurrent}/${info.videoTarget}s`);
  if (info.caps.game) parts.push(`game ${info.gameCurrent}/${info.gameTarget}s`);
  if (!parts.length) return chalk.yellow('Không hỗ trợ');

  return chalk.yellow(parts.join('  '));
}

export function renderQuestTable(quests, title) {
  const table = new Table({
    head: ['#', 'Quest', 'Game / Target', 'Loại', 'Tiến độ', 'Thưởng', 'Hết hạn'],
    style: { head: [], border: ['gray'] },
    chars: {
      top: '-',
      'top-mid': '+',
      'top-left': '+',
      'top-right': '+',
      bottom: '-',
      'bottom-mid': '+',
      'bottom-left': '+',
      'bottom-right': '+',
      left: '|',
      'left-mid': '+',
      mid: '-',
      'mid-mid': '+',
      right: '|',
      'right-mid': '+',
      middle: '|',
    },
  });

  quests.forEach((quest, index) => {
    const info = quest._info || classifyQuest(quest);
    const game = extractGameInfo(quest);
    table.push([
      index + 1,
      chalk.bold.white(String(quest.config?.messages?.quest_name || quest.name || 'Unknown').slice(0, 24)),
      chalk.gray(String(game.title).slice(0, 22)),
      typeLabel(info.type),
      questProgressText(info),
      chalk.yellow(formatReward(quest)),
      formatExpiry(quest.config?.expires_at),
    ]);
  });

  console.log(`\n${chalk.bold(title)} (${quests.length})\n`);
  console.log(table.toString());
}

export function renderBatchProgress(states) {
  return states
    .map((state) => {
      const type = state.type === 'VIDEO' ? 'VIDEO' : state.type === 'GAME' ? 'GAME ' : 'SKIP ';
      const current = state.type === 'VIDEO' ? state.videoCurrent : state.type === 'GAME' ? state.gameCurrent : 0;
      const target = state.type === 'VIDEO' ? state.videoTarget : state.type === 'GAME' ? state.gameTarget : 0;

      const pct = target ? Math.min(1, current / target) : state.done ? 1 : 0;
      const width = 18;
      const filled = Math.round(pct * width);
      const bar = '#'.repeat(filled) + '-'.repeat(Math.max(0, width - filled));
      const name = String(state.name).padEnd(26).slice(0, 26);
      const status = state.skipped
        ? chalk.gray('bỏ qua')
        : state.done
          ? chalk.green('xong')
          : chalk.gray(`${formatTime(Math.max(0, target - current))} còn lại`);

      return `  ${type} [${bar}] ${String(Math.round(pct * 100)).padStart(3)}%  ${name} ${String(current).padStart(4)}/${target}s  ${status}`;
    })
    .join('\n');
}

export function makeBatchRenderer() {
  let renderedLines = 0;

  return (states) => {
    const text = renderBatchProgress(states);

    if (process.stdout.isTTY) {
      if (renderedLines > 0) {
        readline.moveCursor(process.stdout, 0, -renderedLines);
        readline.clearScreenDown(process.stdout);
      }
      process.stdout.write(`${text}\n`);
      renderedLines = text.split('\n').length;
    } else {
      console.log(text);
    }
  };
}

function tierLine(label, evaluation, unit) {
  const current = evaluation.current;
  const next = evaluation.next;

  if (!current) {
    const target = unit === 'games' ? `${next?.games ?? '?'} game` : `${next?.hours ?? '?'}h`;
    const value = unit === 'games' ? `${evaluation.value} game` : `${Number(evaluation.value).toFixed(1)}h`;
    return `  ${label.padEnd(13)}: ${value.padEnd(16)} chưa đạt tier 1 (cần ${target})`;
  }

  const value = unit === 'games' ? `${evaluation.value} game` : `${Number(evaluation.value).toFixed(1)}h`;
  const nextText = next
    ? ` -> ${next.name} (${unit === 'games' ? `${next.games} game` : `${next.hours}h`})`
    : ' (tối đa)';

  return `  ${label.padEnd(13)}: ${value.padEnd(16)} tier ${current.tier}/10 (${current.name})${nextText}`;
}

export function renderStatus(stats, extra = {}) {
  const lines = [];
  lines.push(chalk.bold('\nTrạng thái'));
  lines.push(chalk.bold('\nBadge Discord (ước tính từ dữ liệu farm)'));
  lines.push(tierLine('Game Variety', stats.variety, 'games'));
  lines.push(tierLine('Game Time', stats.time, 'hours'));
  lines.push(`  Hôm nay      : ${stats.today} game được credit`);
  lines.push(`  Tổng phiên   : ${stats.sessions}`);

  lines.push(chalk.bold('\nNguồn dữ liệu'));
  if (extra.detectableCount != null) lines.push(`  Detectable   : ${extra.detectableCount} game có Steam + exe Windows`);
  if (extra.steam) {
    lines.push(`  Steam        : ${extra.steam.installedCount} game đã cài, ${extra.steam.ownedCount} game sở hữu`);
  }
  if (extra.discordRunning != null) lines.push(`  Discord      : ${extra.discordRunning ? 'đang chạy' : 'chưa chạy'}`);
  if (extra.cacheAge) lines.push(`  Cache game   : ${extra.cacheAge}`);

  lines.push(chalk.bold('\nQuest'));
  lines.push(`  Đã nhận      : ${stats.quests.accepted || 0}`);
  lines.push(`  Hoàn thành   : ${stats.quests.completed || 0}`);
  lines.push(`  Đã claim     : ${stats.quests.claimed || 0}`);

  return lines.join('\n');
}
