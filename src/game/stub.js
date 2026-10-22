// src/game/stub.js
// Build một stub .exe WinForms nhỏ, dùng lại cho mọi game.
// Stub chỉ mở cửa sổ với title game và sống đến khi bị kill.
// Build bằng Add-Type của Windows PowerShell, fallback sang csc.exe.

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CACHE_DIR } from '../paths.js';

const STUB_PATH = join(CACHE_DIR, 'nesix-stub.exe');
const CS_PATH = join(CACHE_DIR, 'nesix-stub.cs');
const PS_PATH = join(CACHE_DIR, 'build-stub.ps1');

const CS_CODE = `using System;
using System.Drawing;
using System.Windows.Forms;

public static class NesixStub
{
    [STAThread]
    public static void Main(string[] args)
    {
        string title = args.Length > 0 ? string.Join(" ", args) : "Game";
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Form form = new Form();
        form.Text = title;
        form.Width = 640;
        form.Height = 360;
        form.MinimumSize = new Size(320, 180);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.BackColor = Color.FromArgb(22, 22, 26);
        form.ForeColor = Color.Gainsboro;
        form.ShowIcon = false;

        Label label = new Label();
        label.Text = title;
        label.Dock = DockStyle.Fill;
        label.TextAlign = ContentAlignment.MiddleCenter;
        label.Font = new Font("Segoe UI", 14F);
        form.Controls.Add(label);

        Application.Run(form);
    }
}
`;

function escapePs(value) {
  return String(value).replace(/'/g, "''");
}

function fileOk(path) {
  try {
    return statSync(path).size > 2048;
  } catch {
    return false;
  }
}

export function ensureStub({ log = console, force = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (!force && fileOk(STUB_PATH)) return STUB_PATH;

  writeFileSync(CS_PATH, CS_CODE, 'utf8');

  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$code = Get-Content -Raw -LiteralPath '${escapePs(CS_PATH)}'`,
    `$out = '${escapePs(STUB_PATH)}'`,
    'if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }',
    "Add-Type -TypeDefinition $code -OutputAssembly $out -OutputType WindowsApplication -ReferencedAssemblies @('System.Windows.Forms','System.Drawing')",
  ].join('\n');

  writeFileSync(PS_PATH, ps, 'utf8');

  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_PATH],
      { encoding: 'utf8', timeout: 120_000, windowsHide: true, stdio: 'pipe' },
    );
  } catch (err) {
    log.warn?.('PowerShell build stub thất bại, thử csc.exe...');
  }

  if (fileOk(STUB_PATH)) return STUB_PATH;

  const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (existsSync(csc)) {
    try {
      execFileSync(
        csc,
        ['/nologo', '/target:winexe', `/out:${STUB_PATH}`, CS_PATH, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll'],
        { encoding: 'utf8', timeout: 120_000, windowsHide: true, stdio: 'pipe' },
      );
    } catch {
      // rơi xuống lỗi bên dưới
    }
  }

  if (fileOk(STUB_PATH)) return STUB_PATH;

  try {
    rmSync(STUB_PATH, { force: true });
  } catch {
    // bỏ qua
  }

  throw new Error(
    'Không build được stub exe. Hãy chắc chắn Windows PowerShell 5.1 hoặc .NET Framework 4.x còn hoạt động.',
  );
}

export { STUB_PATH };
