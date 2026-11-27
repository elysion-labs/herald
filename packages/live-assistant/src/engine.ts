import { EventEmitter, on } from 'node:events';

import { adapters, supports } from '@herald/live';
import type { LiveActivity, LivePlatform } from '@herald/live';

import { createHeatState, heatTrigger, recordHeat } from './heat.ts';
import type { HeatState } from './heat.ts';
import { entryQualifies, giftTrigger, identityOf } from './interactions.ts';
import type { AssistantSettings, ReminderTrigger } from './settings.ts';

/** 调度需要的弹幕字段。 */
export interface AssistantMessage {
  platform: LivePlatform;
  authorId: string | null;
  authorName: string | null;
  text: string;
  receivedAt: number;
}

/** 宿主应用提供给调度器的能力；调度器本身不接触会话存储、记忆或直播连接。 */
export interface AssistantHost<Turns> {
  /** 当前正在直播的助手会话 id。 */
  activeConversation: () => string | undefined;
  platforms: () => readonly LivePlatform[];
  isRunning: (conversationId: string) => boolean;
  /** 让 agent 处理一次提醒；delivered=false 表示模型判断无需提醒。 */
  remind: (
    conversationId: string,
    trigger: ReminderTrigger,
    publish: (turns: Turns) => void,
  ) => Promise<{ delivered: boolean }>;
  settings: () => AssistantSettings;
  /** 该观众在此平台已有的记忆内容。 */
  viewerFacts: (platform: LivePlatform, viewerId: string) => string[];
  roomConnected: () => boolean;
  onMessage: (listener: (message: AssistantMessage) => void) => () => void;
  /** 礼物、醒目留言、上舰、进场等互动。 */
  onActivity: (listener: (activity: LiveActivity) => void) => () => void;
  /** 该观众在本场开播之前是否发过弹幕。 */
  viewerSeenBefore: (platform: LivePlatform, viewerId: string) => boolean;
}

export type AssistantEvent<Turns> =
  | { conversationId: string; phase: 'start'; trigger: ReminderTrigger }
  | { conversationId: string; phase: 'update'; turns: Turns }
  | { conversationId: string; phase: 'done'; delivered: boolean; error?: string };

interface WorkspaceState {
  /** 助手会话运行中时暂存的最新一条提醒，空闲后再发。 */
  pending?: ReminderTrigger;
  /** 冷场计时的起点：最近一条弹幕或打开会话的时刻。 */
  quietSince: number;
  silenceFired: boolean;
  lastTriggerAt: number;
  lastPeriodicAt: number;
  sincePeriodic: number;
  viewerCooldown: Map<string, number>;
  /** 本场已分析过进场的观众。 */
  entered: Set<string>;
  /** 本场已发过言的观众。 */
  spoken: Set<string>;
  heat: HeatState;
}

const tickInterval = 5000;
/** 主播最后一次输入后这么久内，非紧急提醒先暂存。 */
const typingHold = 8000;

/**
 * 弹幕自动提醒的调度：规则触发（冷场、有记忆的观众、关注词）与定时批量分析。
 * 只发给当前工作区的助手会话，受冷却时间限制；会话运行中时暂存最新一条，空闲后补发。
 */
export function createLiveAssistant<Turns>(host: AssistantHost<Turns>) {
  const events = new EventEmitter<{ event: [AssistantEvent<Turns>] }>();
  events.setMaxListeners(0);

  const lifetime = new AbortController();
  let activeId: string | undefined;
  let state: WorkspaceState;
  let typingAt: { id: string; time: number } | undefined;

  function syncSession() {
    const id = host.activeConversation();

    if (id !== activeId || !state) {
      const now = Date.now();
      activeId = id;
      state = {
        quietSince: now,
        silenceFired: false,
        lastTriggerAt: 0,
        lastPeriodicAt: now,
        sincePeriodic: 0,
        viewerCooldown: new Map(),
        entered: new Set(),
        spoken: new Set(),
        heat: createHeatState(),
      };
    }

    return id;
  }

  const typing = (conversationId: string) =>
    typingAt?.id === conversationId && Date.now() - typingAt.time < typingHold;

  /** urgent：答谢等时效性强的提醒，不受全局提醒间隔限制。 */
  function fire(trigger: ReminderTrigger, urgent = false) {
    const conversationId = syncSession();
    const now = Date.now();
    const { cooldownSeconds } = host.settings();
    const cooling = !urgent && now - state.lastTriggerAt < cooldownSeconds * 1000;

    if (!conversationId || cooling) {
      return false;
    }

    // 会话正在回复或主播正在输入时只保留最新一条，之后补发；冷场提醒过时就没有意义，直接丢弃。
    if (host.isRunning(conversationId) || (!urgent && typing(conversationId))) {
      if (trigger.kind !== 'silence') {
        state.pending = trigger;
      }

      return false;
    }

    state.pending = undefined;
    state.lastTriggerAt = now;
    void deliver(conversationId, trigger);

    return true;
  }

  /** 交给 agent 处理一次提醒，并把开始、过程与结果广播给界面。 */
  async function deliver(conversationId: string, trigger: ReminderTrigger) {
    events.emit('event', { conversationId, phase: 'start', trigger });

    try {
      const { delivered } = await host.remind(conversationId, trigger, turns =>
        events.emit('event', { conversationId, phase: 'update', turns }),
      );

      events.emit('event', { conversationId, phase: 'done', delivered });
    } catch (error) {
      events.emit('event', {
        conversationId,
        phase: 'done',
        delivered: false,
        error: error instanceof Error ? error.message : '提醒失败',
      });
    }
  }

  function viewerTrigger(
    message: AssistantMessage,
    state: WorkspaceState,
  ): ReminderTrigger | undefined {
    const viewerId = message.authorId;
    const key = `${message.platform}:${viewerId}`;
    const last = state.viewerCooldown.get(key);

    const cooldown = host.settings().memoryViewers.cooldownMinutes * 60_000;

    if (!viewerId || (last && Date.now() - last < cooldown)) {
      return undefined;
    }

    const facts = host.viewerFacts(message.platform, viewerId).slice(0, 8);

    if (!facts.length) {
      return undefined;
    }

    state.viewerCooldown.set(key, Date.now());

    return {
      kind: 'viewer',
      platform: message.platform,
      viewerId,
      viewerName: message.authorName,
      text: message.text,
      facts,
    };
  }

  function onMessage(message: AssistantMessage) {
    if (!syncSession() || !adapters[message.platform].capabilities.danmaku) {
      return;
    }

    state.quietSince = message.receivedAt;
    state.silenceFired = false;
    state.sincePeriodic += 1;
    recordHeat(state.heat, message.receivedAt);

    const config = host.settings();
    const welcome = welcomeTrigger(message, state, config);

    if (welcome && fire(welcome)) {
      return;
    }

    const viewer = config.memoryViewers.enabled ? viewerTrigger(message, state) : undefined;

    if (viewer && fire(viewer)) {
      return;
    }

    const keyword = config.keywords.enabled
      ? config.keywords.words.find(word => message.text.includes(word))
      : undefined;

    if (keyword) {
      fire({
        kind: 'keyword',
        platform: message.platform,
        keyword,
        viewerName: message.authorName,
        text: message.text,
      });
    }
  }

  type Config = AssistantSettings;

  /** 新观众本场第一次发言，且之前没有弹幕和记忆时，给出欢迎话术。 */
  function welcomeTrigger(
    message: AssistantMessage,
    state: WorkspaceState,
    config: Config,
  ): ReminderTrigger | undefined {
    const viewerId = message.authorId;

    const key = `${message.platform}:${viewerId}`;

    if (!viewerId || state.spoken.has(key)) {
      return undefined;
    }

    state.spoken.add(key);

    const fresh =
      config.welcome.enabled &&
      adapters[message.platform].capabilities.welcome &&
      !host.viewerFacts(message.platform, viewerId).length &&
      !host.viewerSeenBefore(message.platform, viewerId);

    return fresh
      ? {
          kind: 'welcome',
          platform: message.platform,
          viewerId,
          viewerName: message.authorName,
          text: message.text,
        }
      : undefined;
  }

  /** 进场分析：观众在本场首次满足进场分析条件时触发。 */
  function onEntry(activity: LiveActivity, state: WorkspaceState, config: Config) {
    const viewerId = activity.viewer.id;

    const key = `${activity.platform}:${viewerId}`;

    if (!viewerId || !config.entry.enabled || state.entered.has(key)) {
      return;
    }

    const facts = host.viewerFacts(activity.platform, viewerId).slice(0, 8);
    const { capabilities } = adapters[activity.platform];

    const viewer = {
      ...activity.viewer,
      guardLevel: capabilities.guard ? activity.viewer.guardLevel : null,
      badge: capabilities.badgeLevel ? activity.viewer.badge : null,
      payLevel: capabilities.payLevel ? activity.viewer.payLevel : null,
    };

    if (entryQualifies(viewer, facts.length > 0, config.entry)) {
      // 两种进场事件携带的资料可能不同，符合条件后才去重。
      state.entered.add(key);
      fire({
        kind: 'entry',
        platform: activity.platform,
        viewerId,
        viewerName: viewer.name,
        identity: identityOf(viewer, activity.platform),
        facts,
      });
    }
  }

  /** 互动事件只在已开播的场次里处理。 */
  function onActivity(activity: LiveActivity) {
    const { kind, platform } = activity;

    if (kind === 'follow' || !adapters[platform].capabilities[kind]) {
      return;
    }

    if (!syncSession()) {
      return;
    }

    const config = host.settings();

    if (kind === 'entry') {
      onEntry(activity, state, config);

      return;
    }

    const trigger = giftTrigger(activity, config.gifts);

    if (trigger) {
      fire(trigger, true);
    }
  }

  /** 冷场提醒：只在确认直播中时计时；刚开播时从开播时刻重新计时。 */
  function checkSilence(config: Config, now: number) {
    const quiet = now - state.quietSince;

    if (config.silence.enabled && !state.silenceFired && quiet >= config.silence.seconds * 1000) {
      state.silenceFired = fire({ kind: 'silence', seconds: Math.round(quiet / 1000) });
    }
  }

  function checkHeat(config: Config, now: number) {
    const trigger = heatTrigger(state.heat, config.heat, now);

    if (trigger) {
      fire(trigger);
    }
  }

  function checkPeriodic(config: Config, now: number) {
    if (!config.periodic.enabled || now - state.lastPeriodicAt < config.periodic.minutes * 60_000) {
      return;
    }

    const count = state.sincePeriodic;
    state.lastPeriodicAt = now;
    state.sincePeriodic = 0;

    if (count >= config.periodic.minMessages) {
      fire({ kind: 'periodic', minutes: config.periodic.minutes, count });
    }
  }

  function tick() {
    const conversationId = syncSession();

    if (!conversationId || !host.roomConnected()) {
      return;
    }

    if (state.pending && !host.isRunning(conversationId) && !typing(conversationId)) {
      if (fire(state.pending, state.pending.kind === 'gift')) {
        return;
      }
    }

    if (supports(host.platforms(), 'danmaku')) {
      const now = Date.now();
      const config = host.settings();
      checkSilence(config, now);
      checkPeriodic(config, now);
      checkHeat(config, now);
    }
  }

  const unsubscribe = host.onMessage(onMessage);
  const unsubscribeActivity = host.onActivity(onActivity);
  const timer = setInterval(tick, tickInterval);

  return {
    /**
     * 立即在指定会话处理一次提醒（开播推荐、下播复盘），不受冷却限制；
     * 会话正在回复时等它空闲（最多 2 分钟）。返回时这次提醒已经处理完。
     */
    async run(conversationId: string, trigger: ReminderTrigger) {
      const deadline = Date.now() + 2 * 60_000;

      while (!lifetime.signal.aborted && host.isRunning(conversationId) && Date.now() < deadline) {
        await new Promise(resolve => {
          setTimeout(resolve, 1000);
        });
      }

      if (!lifetime.signal.aborted) {
        await deliver(conversationId, trigger);
      }
    },
    /** 主播正在助手会话里输入。 */
    typing(conversationId: string) {
      typingAt = { id: conversationId, time: Date.now() };
    },
    async *watch(signal?: AbortSignal) {
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;

      if (combined.aborted) {
        return;
      }

      const updates = on(events, 'event', { signal: combined });

      try {
        for await (const [event] of updates as AsyncIterableIterator<[AssistantEvent<Turns>]>) {
          yield event;
        }
      } catch (error) {
        if (!combined.aborted) {
          throw error;
        }
      } finally {
        await updates.return?.();
      }
    },
    dispose() {
      lifetime.abort();
      clearInterval(timer);
      unsubscribe();
      unsubscribeActivity();
    },
  };
}
