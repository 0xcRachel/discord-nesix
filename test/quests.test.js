import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyQuest,
  getQuestCapabilities,
  detectQuestType,
  extractGameInfo,
} from '../src/discord/quests.js';

function makeQuest(overrides = {}) {
  const now = Date.now();
  return {
    id: 'quest-1',
    config: {
      expires_at: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
      messages: { quest_name: 'Test Quest', game_title: 'Test Game' },
      application: { id: '123', name: 'Test Game' },
      task_config_v2: {
        tasks: {
          PLAY_ON_DESKTOP: { target: 900 },
        },
      },
      ...overrides.config,
    },
    ...overrides,
  };
}

test('classifyQuest: unenrolled quest is available', () => {
  const info = classifyQuest(makeQuest());
  assert.equal(info.bucket, 'available');
  assert.equal(info.type, 'GAME');
  assert.equal(info.gameTarget, 900);
  assert.equal(info.gameTitle, 'Test Game');
});

test('classifyQuest: in-progress quest is active', () => {
  const quest = makeQuest({
    user_status: { progress: { PLAY_ON_DESKTOP: { value: 120 } } },
  });
  const info = classifyQuest(quest);
  assert.equal(info.bucket, 'active');
  assert.equal(info.gameCurrent, 120);
});

test('classifyQuest: reaching target marks completed', () => {
  const quest = makeQuest({
    user_status: { progress: { PLAY_ON_DESKTOP: { value: 900 } } },
  });
  assert.equal(classifyQuest(quest).bucket, 'completed');
});

test('classifyQuest: completed_at marks completed even without progress', () => {
  const quest = makeQuest({
    user_status: { completed_at: new Date().toISOString(), progress: {} },
  });
  assert.equal(classifyQuest(quest).bucket, 'completed');
});

test('classifyQuest: claimed and expired', () => {
  const claimed = makeQuest({
    user_status: { claimed_at: new Date().toISOString() },
  });
  assert.equal(classifyQuest(claimed).bucket, 'claimed');

  const expired = makeQuest({
    config: { expires_at: new Date(Date.now() - 3600_000).toISOString() },
  });
  assert.equal(classifyQuest(expired).bucket, 'expired');
});

test('video quest capabilities and type', () => {
  const quest = makeQuest({
    config: {
      task_config_v2: {
        tasks: {
          WATCH_VIDEO: { target: 180 },
        },
      },
    },
  });

  const caps = getQuestCapabilities(quest);
  assert.equal(caps.video, true);
  assert.equal(caps.game, false);
  assert.equal(detectQuestType(quest), 'VIDEO');
  assert.equal(classifyQuest(quest).videoTarget, 180);
});

test('stream quest is detected but has no supported capability', () => {
  const quest = makeQuest({
    config: {
      task_config_v2: {
        tasks: {
          STREAM_ON_DESKTOP: { target: 900 },
        },
      },
    },
  });

  const caps = getQuestCapabilities(quest);
  assert.equal(caps.stream, true);
  assert.equal(caps.video, false);
  assert.equal(caps.game, false);
  assert.equal(detectQuestType(quest), 'STREAM');
});

test('extractGameInfo falls back to application name', () => {
  const quest = makeQuest({
    config: {
      messages: { quest_name: 'Quest only' },
      application: { id: '999', name: 'Fallback Game' },
    },
  });
  const info = extractGameInfo(quest);
  assert.equal(info.appId, '999');
  assert.equal(info.title, 'Fallback Game');
});
