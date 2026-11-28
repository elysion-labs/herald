import { EventEmitter } from 'node:events';

import type { LiveActivity, LivePlatform, LiveViewer } from '@herald/live';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { createLiveAssistant } from './engine.ts';
import type { AssistantHost, AssistantMessage } from './engine.ts';
import { reminderPrompt } from './prompt.ts';
import {
  defaultAssistantSettings,
  describeTrigger,
  reminderPlatform,
  reminderTrigger,
} from './settings.ts';

type HostOverrides = Partial<
  Pick<AssistantHost<string[]>, 'activeConversation' | 'isRunning' | 'viewerFacts'>
>;

function setup(id: string, overrides: HostOverrides = {}) {
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
    ...overrides,
  });

  function enter(
    viewerId: string,
    viewer: Partial<LiveViewer>,
    platform: LivePlatform = 'bilibili',
  ) {
    events.emit('activity', {
      kind: 'entry',
      platform,
      roomId: '1',
      key: null,
      receivedAt: Date.now(),
      viewer: {
        id: viewerId,
        name: viewerId,
        badge: null,
        guardLevel: null,
        payLevel: null,
        ...viewer,
      },
    });
  }

  return { assistant, enter, events, remind };
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
    await vi.advanceTimersByTimeAsync(55_000);
    combined.enter('进场观众', { payLevel: 35 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(combined.remind).toHaveBeenCalledExactlyOnceWith(
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

    await vi.advanceTimersByTimeAsync(60_000);
    expect(combined.remind.mock.lastCall?.[1]).toMatchObject({
      kind: 'entry',
      viewers: [{ viewerId: '进场观众' }],
    });
  } finally {
    combined.assistant.dispose();
    separate.assistant.dispose();
  }
});

it.each([
  ['bilibili', '荣耀等级'],
  ['douyin', '财富等级'],
] as const)('按 %s 的等级判断进场提醒并使用平台称呼', async (platform, levelName) => {
  vi.useFakeTimers();
  const { assistant, enter, remind } = setup('live');

  try {
    enter('42', {}, platform);
    await vi.advanceTimersByTimeAsync(5000);
    expect(remind).not.toHaveBeenCalled();

    enter('42', { payLevel: 35 }, platform);
    await vi.advanceTimersByTimeAsync(5000);
    const trigger = reminderTrigger.parse(remind.mock.lastCall?.[1]);

    expect(trigger).toMatchObject({
      kind: 'entry',
      viewers: [{ platform, viewerId: '42', identity: `${levelName} 35 级` }],
    });
    expect(reminderPrompt(trigger, '[]')).toContain(`${levelName} 35 级`);
  } finally {
    assistant.dispose();
  }
});

it('合并冷却、回复和输入期间的进场，同平台 UID 去重', async () => {
  vi.useFakeTimers();
  let running = false;
  const { assistant, enter, remind } = setup('live', { isRunning: () => running });

  try {
    enter('首位', { payLevel: 35 });
    expect(remind).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(remind).toHaveBeenCalledTimes(1);

    enter('42', { name: 'A', payLevel: 35 });
    enter('42', { name: '重复事件', payLevel: 35 });
    await vi.advanceTimersByTimeAsync(55_000);
    expect(remind).toHaveBeenCalledTimes(1);

    running = true;
    enter('42', { name: 'B', payLevel: 35 }, 'douyin');
    await vi.advanceTimersByTimeAsync(5000);
    expect(remind).toHaveBeenCalledTimes(1);

    running = false;
    assistant.typing('live');
    enter('43', { name: 'C', payLevel: 35 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(remind).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(remind).toHaveBeenCalledTimes(2);
    const trigger = reminderTrigger.parse(remind.mock.lastCall?.[1]);
    expect(trigger).toMatchObject({
      kind: 'entry',
      viewers: [
        { platform: 'bilibili', viewerId: '42', viewerName: 'A' },
        { platform: 'douyin', viewerId: '42', viewerName: 'B' },
        { platform: 'bilibili', viewerId: '43', viewerName: 'C' },
      ],
    });
    expect(describeTrigger(trigger)).toBe('A、B 等 3 人进场');
    expect(reminderPlatform(trigger)).toBeUndefined();

    enter('42', { payLevel: 35 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remind).toHaveBeenCalledTimes(2);
  } finally {
    assistant.dispose();
  }
});

it('队列满时保留优先级最高的五人，同级以先到为准', async () => {
  vi.useFakeTimers();

  const { assistant, enter, remind } = setup('live', {
    viewerFacts: (_platform, id) => (id === 'memory' ? ['喜欢聊音乐'] : []),
  });

  try {
    enter('low-badge', { badge: { name: '粉丝牌', level: 21 } });
    enter('first-badge', { badge: { name: '粉丝牌', level: 30 } });
    enter('second-badge', { badge: { name: '粉丝牌', level: 30 } });
    enter('low-pay', { payLevel: 30 }, 'douyin');
    enter('high-pay', { payLevel: 40 });
    enter('guard', { guardLevel: 3 });
    enter('memory', {});
    await vi.advanceTimersByTimeAsync(5000);

    expect(remind).toHaveBeenCalledTimes(1);
    const trigger = reminderTrigger.parse(remind.mock.lastCall?.[1]);
    expect(trigger).toMatchObject({
      kind: 'entry',
      viewers: [
        { viewerId: 'memory', facts: ['喜欢聊音乐'] },
        { viewerId: 'guard', identity: '舰长' },
        { viewerId: 'high-pay' },
        { viewerId: 'low-pay' },
        { viewerId: 'first-badge' },
      ],
    });
    const prompt = reminderPrompt(trigger, '[]', true);
    expect(prompt).toContain('"platform": "douyin"');
    expect(prompt).toContain('"uid": "low-pay"');
    expect(prompt).toContain('喜欢聊音乐');
    expect(prompt).toContain('可以一个都不选');
    expect(prompt).toContain('理由和一句自然');
    expect(prompt).toContain('只回复 SKIP');
  } finally {
    assistant.dispose();
  }
});

it('等候满两分钟的进场会过期，之后再次进场可以入队', async () => {
  vi.useFakeTimers();
  let running = true;
  const { assistant, enter, remind } = setup('live', { isRunning: () => running });

  try {
    enter('过期观众', { payLevel: 40 });
    await vi.advanceTimersByTimeAsync(115_000);
    enter('新观众', { payLevel: 35 });
    running = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(remind.mock.lastCall?.[1]).toMatchObject({
      kind: 'entry',
      viewers: [{ viewerId: '新观众' }],
    });

    enter('过期观众', { payLevel: 40 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remind).toHaveBeenCalledTimes(2);
    expect(remind.mock.lastCall?.[1]).toMatchObject({
      kind: 'entry',
      viewers: [{ viewerId: '过期观众' }],
    });
  } finally {
    assistant.dispose();
  }
});

it('进场队列独立于其他工作区，换场后清空', async () => {
  vi.useFakeTimers();
  let activeId = 'first';
  const first = setup(activeId, { activeConversation: () => activeId });
  const separate = setup('separate');

  try {
    first.enter('旧场观众', { payLevel: 35 });
    separate.enter('隔壁观众', { payLevel: 35 });
    activeId = 'next';
    first.enter('新场观众', { payLevel: 35 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(first.remind).toHaveBeenCalledExactlyOnceWith(
      'next',
      expect.objectContaining({ viewers: [expect.objectContaining({ viewerId: '新场观众' })] }),
      expect.any(Function),
    );
    expect(separate.remind).toHaveBeenCalledExactlyOnceWith(
      'separate',
      expect.objectContaining({ viewers: [expect.objectContaining({ viewerId: '隔壁观众' })] }),
      expect.any(Function),
    );
  } finally {
    first.assistant.dispose();
    separate.assistant.dispose();
  }
});

it('旧单人进场记录仍可读取并使用原有摘要', () => {
  const viewer = {
    platform: 'bilibili',
    viewerId: '42',
    viewerName: null,
    identity: '舰长',
    facts: [],
  };

  const trigger = reminderTrigger.parse({ kind: 'entry', ...viewer });

  expect(trigger).toEqual({ kind: 'entry', viewers: [viewer] });
  expect(describeTrigger(trigger)).toBe('42 进场 · 舰长');
  expect(reminderPlatform(trigger)).toBe('bilibili');
});
