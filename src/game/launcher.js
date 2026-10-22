// src/game/launcher.js
// Tạo process giả: copy stub thành đúng tên exe Discord cần rồi chạy.

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { rm, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { TEMP_DIR } from '../paths.js';
import { ensureStub } from './stub.js';

const BLOCKED_EXES = new Set([
  'steam.exe',
  'steamwebhelper.exe',
  'discord.exe',
  'discordptb.exe',
  'discordcanary.exe',
  'explorer.exe',
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'node.exe',
  'unins000.exe',
  'uninstall.exe',
  'setup.exe',
  'launcher.exe',
]);

export function pickExe(game) {
  const exes = [...(game?.exes || [])].sort((a, b) => {
    const launcherDiff = Number(a.launcher) - Number(b.launcher);
    if (launcherDiff) return launcherDiff;

    const aSimple = a.path.includes('\\') ? 1 : 0;
    const bSimple = b.path.includes('\\') ? 1 : 0;
    if (aSimple !== bSimple) return aSimple - bSimple;

    return a.path.length - b.path.length;
  });

  for (const exe of exes) {
    if (!exe?.path || !exe.path.toLowerCase().endsWith('.exe')) continue;
    if (BLOCKED_EXES.has(basename(exe.path).toLowerCase())) continue;
    return exe.path;
  }

  return null;
}

export function launchGame(game, { title } = {}) {
  const exeRel = pickExe(game);
  if (!exeRel) throw new Error('không có exe hợp lệ');

  const appKey = String(game.steamAppIds?.[0] || game.id);
  const dir = join(TEMP_DIR, appKey);
  const exePath = join(dir, exeRel);

  if (exePath.length > 240) {
    throw new Error('đường dẫn exe quá dài');
  }

  mkdirSync(dirname(exePath), { recursive: true });
  copyFileSync(ensureStub(), exePath);

  const proc = spawn(exePath, [title || game.name], {
    cwd: dirname(exePath),
    windowsHide: false,
    stdio: 'ignore',
  });

  let exited = false;
  proc.on('exit', () => {
    exited = true;
  });
  proc.on('error', () => {
    exited = true;
  });

  return {
    proc,
    dir,
    exePath,
    exeRel,
    exited: () => exited || proc.exitCode !== null,
  };
}

export async function stopGame(handle) {
  if (!handle) return;

  try {
    if (!handle.exited()) handle.proc.kill();
  } catch {
    // bỏ qua
  }

  await new Promise((resolve) => setTimeout(resolve, 700));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(handle.dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

export async function cleanupTemp(log = console) {
  try {
    const entries = await readdir(TEMP_DIR, { withFileTypes: true });
    let removed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await rm(join(TEMP_DIR, entry.name), { recursive: true, force: true });
        removed += 1;
      } catch {
        // Thư mục đang bị process khác dùng.
      }
    }

    if (removed) log.dim?.(`Đã dọn ${removed} thư mục tạm cũ.`);
  } catch {
    // TEMP_DIR chưa tồn tại.
  }
}

export { TEMP_DIR, BLOCKED_EXES };
