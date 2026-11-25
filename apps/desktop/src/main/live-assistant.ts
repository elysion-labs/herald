import { EventEmitter, on } from 'node:events';

import type { LivePlatform } from '@herald/live';

import type { ReminderTrigger } from '../shared/assistant-settings.ts';
import { platforms } from '../shared/platforms.ts';
import type { LiveMessage } from './live-rooms.ts';
import type { openWorkspace } from './workspace.ts';

type Workspace = ReturnType<typeof openWorkspace>;
type Turns = Parameters<Parameters<Workspace['remind']>[3]>[0];

export type AssistantEvent =
  | { conversationId: string; phase: 'start'; trigger: ReminderTrigger }
  | { conversationId: string; phase: 'update'; turns: Turns }
  | { conversationId: string; phase: 'done'; delivered: boolean; error?: string };

interface PlatformState {
  conversationId?: string;
  /** 冷场计时的起点：最近一条弹幕或打开会话的时刻。 */
  quietSince: number;
  silenceFired: boolean;
  lastTriggerAt: number;
  lastPeriodicAt: number;
  sincePeriodic: number;
  viewerCooldown: Map<string, number>;
}

const tickInterval = 5000;
const viewerCooldown = 10 * 60 * 1000;
const periodicMinimum = 3;

/**
 * 弹幕自动提醒的调度：规则触发（冷场、有记忆的观众、关注词）与定时批量分析。
 * 只在当前聚焦的会话里提醒，受冷却时间限制，会话运行中时跳过。
 */
export function createLiveAssistant(
  workspace: Workspace,
  tools: Parameters<Workspace['remind']>[2],
) {
  const events = new EventEmitter<{ event: [AssistantEvent] }>();
  events.setMaxListeners(0);

  const states = new Map<LivePlatform, PlatformState>(
    platforms.map(platform => [
      platform,
      {
        quietSince: Date.now(),
        silenceFired: false,
        lastTriggerAt: 0,
        lastPeriodicAt: Date.now(),
        sincePeriodic: 0,
        viewerCooldown: new Map(),
      },
    ]),
  );

  function fire(platform: LivePlatform, trigger: ReminderTrigger) {
    const state = states.get(platform);
    const conversationId = state?.conversationId;
    const now = Date.now();
    const { cooldownSeconds } = workspace.settings.assistant();

    if (
      !state ||
      !conversationId ||
      now - state.lastTriggerAt < cooldownSeconds * 1000 ||
      workspace.isRunning(conversationId)
    ) {
      return false;
    }

    state.lastTriggerAt = now;
    events.emit('event', { conversationId, phase: 'start', trigger });

    workspace
      .remind(conversationId, trigger, tools, turns =>
        events.emit('event', { conversationId, phase: 'update', turns }),
      )
      .then(
        ({ delivered }) => events.emit('event', { conversationId, phase: 'done', delivered }),
        (error: unknown) =>
          events.emit('event', {
            conversationId,
            phase: 'done',
            delivered: false,
            error: error instanceof Error ? error.message : '提醒失败',
          }),
      );

    return true;
  }

  function viewerTrigger(message: LiveMessage, state: PlatformState): ReminderTrigger | undefined {
    const viewerId = message.authorId;
    const last = viewerId ? state.viewerCooldown.get(viewerId) : undefined;

    if (!viewerId || (last && Date.now() - last < viewerCooldown)) {
      return undefined;
    }

    const facts = workspace.memory
      .list(message.platform)
      .filter(record => record.viewerId === viewerId)
      .slice(0, 8)
      .map(record => record.fact);

    if (!facts.length) {
      return undefined;
    }

    state.viewerCooldown.set(viewerId, Date.now());

    return {
      kind: 'viewer',
      viewerId,
      viewerName: message.authorName,
      text: message.text,
      facts,
    };
  }

  function onMessage(message: LiveMessage) {
    const state = states.get(message.platform);

    if (!state) {
      return;
    }

    state.quietSince = message.receivedAt;
    state.silenceFired = false;
    state.sincePeriodic += 1;

    if (!state.conversationId) {
      return;
    }

    const config = workspace.settings.assistant();
    const viewer = config.memoryViewers.enabled ? viewerTrigger(message, state) : undefined;

    if (viewer && fire(message.platform, viewer)) {
      return;
    }

    const keyword = config.keywords.enabled
      ? config.keywords.words.find(word => message.text.includes(word))
      : undefined;

    if (keyword) {
      fire(message.platform, {
        kind: 'keyword',
        keyword,
        viewerName: message.authorName,
        text: message.text,
      });
    }
  }

  function tick() {
    const now = Date.now();
    const config = workspace.settings.assistant();

    for (const [platform, state] of states) {
      if (!state.conversationId || workspace.rooms.status(platform)?.state !== 'connected') {
        continue;
      }

      const quiet = now - state.quietSince;

      if (config.silence.enabled && !state.silenceFired && quiet >= config.silence.seconds * 1000) {
        state.silenceFired = fire(platform, {
          kind: 'silence',
          seconds: Math.round(quiet / 1000),
        });
      }

      if (
        config.periodic.enabled &&
        now - state.lastPeriodicAt >= config.periodic.minutes * 60_000
      ) {
        const count = state.sincePeriodic;
        state.lastPeriodicAt = now;
        state.sincePeriodic = 0;

        if (count >= periodicMinimum) {
          fire(platform, { kind: 'periodic', minutes: config.periodic.minutes, count });
        }
      }
    }
  }

  const unsubscribe = workspace.rooms.onMessage(onMessage);
  const timer = setInterval(tick, tickInterval);

  return {
    /** 主播打开某个会话时调用，之后该平台的提醒都写进这个会话。 */
    focus(conversationId: string) {
      const { platform } = workspace.conversation(conversationId);
      const state = states.get(platform);

      if (state && state.conversationId !== conversationId) {
        state.conversationId = conversationId;
        state.quietSince = Date.now();
        state.silenceFired = false;
      }
    },
    async *watch(signal?: AbortSignal) {
      const updates = on(events, 'event', { signal });

      try {
        for await (const [event] of updates as AsyncIterableIterator<[AssistantEvent]>) {
          yield event;
        }
      } finally {
        await updates.return?.();
      }
    },
    dispose() {
      clearInterval(timer);
      unsubscribe();
    },
  };
}
