import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVDF, parseAppManifest, normalizeWindowsPath } from '../src/steam/local.js';

test('parseVDF parses nested library folders (new format)', () => {
  const text = String.raw`
    "libraryfolders"
    {
      "0"
      {
        "path" "C:\\Program Files (x86)\\Steam"
        "label" ""
        "apps"
        {
          "570" "123456"
        }
      }
      "1"
      {
        "path" "D:\\SteamLibrary"
      }
    }
  `;

  const parsed = parseVDF(text);
  assert.equal(parsed.libraryfolders['0'].path, String.raw`C:\Program Files (x86)\Steam`);
  assert.equal(parsed.libraryfolders['0'].apps['570'], '123456');
  assert.equal(parsed.libraryfolders['1'].path, String.raw`D:\SteamLibrary`);
});

test('parseVDF parses old flat format', () => {
  const text = String.raw`
    "LibraryFolders"
    {
      "TimeNextStatsReport" "123"
      "1" "D:\\SteamLibrary"
      "2" "E:\\Games"
    }
  `;

  const parsed = parseVDF(text);
  assert.equal(parsed.LibraryFolders['1'], String.raw`D:\SteamLibrary`);
  assert.equal(parsed.LibraryFolders['2'], String.raw`E:\Games`);
});

test('parseAppManifest extracts game metadata', () => {
  const text = String.raw`
    "AppState"
    {
      "appid" "570"
      "name" "Dota 2"
      "installdir" "dota 2 beta"
      "StateFlags" "4"
      "SizeOnDisk" "123456"
      "LastUpdated" "1700000000"
      "buildid" "999"
    }
  `;

  const manifest = parseAppManifest(text);
  assert.equal(manifest.appid, '570');
  assert.equal(manifest.name, 'Dota 2');
  assert.equal(manifest.installdir, 'dota 2 beta');
  assert.equal(manifest.stateFlags, 4);
  assert.equal(manifest.sizeOnDisk, 123456);
});

test('normalizeWindowsPath converts slashes', () => {
  assert.equal(normalizeWindowsPath('D:/SteamLibrary/'), String.raw`D:\SteamLibrary`);
});
