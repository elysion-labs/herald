import { EventEmitter } from 'node:events';

import type { LiveActivity } from '@herald/live';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { createLiveAssistant } from './engine.ts';
import type { AssistantHost, AssistantMessage } from './engine.ts';
import { reminderPrompt } from './prompt.ts';
import { defaultAssistantSettings } from './settings.ts';

function setup(id: string) {
  const events = new EventEmitter<{ message: [AssistantMessage]; activity: [LiveActivity] }>();
  const remind = vi.fn<AssistantHost<string[]>['remind']>().mockResolvedValue({ delivered: true });

  const assistant = createLiveAssistant({
    activeConversation: () => id,
    platforms: () => ['bilibili', 'douyin'],
    isRunning: () => false,
    remind,
    viewerFacts: () => [],
    roomConnected: () => true,
    viewerSeenBefore: () => false,
    onMessage(listener) {
      events.on('message', listener);

      return () => events.off('message', listener);
    },
    onActivity(listener) {
      events.on('activity', listener);

      return () => events.off('activity', listener);
    },
    settings: () => ({
      ...defaultAssistantSettings,
      periodic: { enabled: true, minutes: 1, minMessages: 2 },
      silence: { enabled: false, seconds: 120 },
    }),
  });

  return { assistant, events, remind };
}

afterEach(() => vi.useRealTimers());

it('按工作区合并定时统计，互动提醒保留事件平台', async () => {
  vi.useFakeTimers();
  const combined = setup('combined');
  const separate = setup('separate');

  try {
    await vi.advanceTimersByTimeAsync(5000);
    const message = { text: '你好', authorId: '123', authorName: '观众', receivedAt: Date.now() };
    combined.events.emit('message', { ...message, platform: 'bilibili' });
    combined.events.emit('message', { ...message, platform: 'douyin' });
    separate.events.emit('message', { ...message, platform: 'bilibili' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(combined.remind).toHaveBeenCalledWith(
      'combined',
      { kind: 'periodic', minutes: 1, count: 2 },
      expect.any(Function),
    );
    expect(separate.remind).not.toHaveBeenCalled();

    combined.events.emit('activity', {
      kind: 'gift',
      platform: 'douyin',
      roomId: '2',
      key: null,
      receivedAt: Date.now(),
      giftName: '礼物',
      count: 1,
      value: 20,
      viewer: { id: '123', name: '观众', badge: null, guardLevel: null, payLevel: null },
    });
    expect(combined.remind).toHaveBeenLastCalledWith(
      'combined',
      expect.objectContaining({ kind: 'gift', platform: 'douyin' }),
      expect.any(Function),
    );
  } finally {
    combined.assistant.dispose();
    separate.assistant.dispose();
  }
});

it.each([
  ['bilibili', '荣耀等级'],
  ['douyin', '财富等级'],
] as const)('按 %s 的等级判断进场提醒并使用平台称呼', (platform, levelName) => {
  const { assistant, events, remind } = setup('live');

  try {
    const entry = {
      kind: 'entry',
      platform,
      roomId: '1',
      key: null,
      receivedAt: Date.now(),
    } as const;

    const viewer = { id: '42', name: '观众', badge: null, guardLevel: null };

    events.emit('activity', { ...entry, viewer: { ...viewer, payLevel: null } });
    expect(remind).not.toHaveBeenCalled();

    events.emit('activity', { ...entry, viewer: { ...viewer, payLevel: 35 } });
    const trigger = remind.mock.calls[0]?.[1];

    expect(trigger).toMatchObject({ kind: 'entry', platform, identity: `${levelName} 35 级` });

    if (trigger) {
      expect(reminderPrompt(trigger, '[]')).toContain(`${levelName} 35 级`);
    }
  } finally {
    assistant.dispose();
  }
});
