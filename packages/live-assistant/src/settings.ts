import { z } from 'zod';

const platform = z.enum(['bilibili', 'douyin']);

const enabled = z.boolean();
const silenceSeconds = z.number().int().min(30).max(1800);
const periodicMinutes = z.number().int().min(1).max(60);
/** 新增字段带默认值，旧版本保存的设置仍能解析。 */
const viewerCooldownMinutes = z.number().int().min(1).max(240).default(10);
const periodicMinMessages = z.number().int().min(1).max(500).default(3);
const giftValue = z.number().min(0).max(100_000);
/** 0 表示不按这项筛选。 */
const badgeLevel = z.number().int().min(0).max(40);
const payLevel = z.number().int().min(0).max(80);
const keyword = z.string().trim().min(1).max(32);
const keywordList = z.array(keyword).max(50);

/** 弹幕自动提醒：规则触发（冷场 / 有记忆的观众 / 关注词）+ 定时批量分析。 */
export const assistantSettings = z.object({
  silence: z.object({ enabled, seconds: silenceSeconds }),
  memoryViewers: z.object({ enabled, cooldownMinutes: viewerCooldownMinutes }),
  keywords: z.object({ enabled, words: keywordList }),
  periodic: z.object({ enabled, minutes: periodicMinutes, minMessages: periodicMinMessages }),
  /** 礼物、醒目留言、上舰答谢：礼物达到金额（元）才提醒。 */
  gifts: z
    .object({ enabled, minValue: giftValue, superChat: z.boolean(), guard: z.boolean() })
    .default({ enabled: true, minValue: 10, superChat: true, guard: true }),
  /** 进场分析：满足任一条件的观众进场时，判断是否值得互动。 */
  entry: z
    .object({
      enabled,
      withMemory: z.boolean(),
      guard: z.boolean(),
      minBadgeLevel: badgeLevel,
      minPayLevel: payLevel,
    })
    .default({ enabled: true, withMemory: true, guard: true, minBadgeLevel: 20, minPayLevel: 30 }),
  /** 热度变化：刚结束的一分钟弹幕量相对之前平均值突增或下滑时提醒。 */
  heat: z
    .object({
      enabled,
      windowMinutes: z.number().int().min(3).max(30),
      spikeRatio: z.number().min(1.2).max(10),
      dropRatio: z.number().min(0).max(0.9),
      minPerMinute: z.number().int().min(1).max(1000),
      cooldownMinutes: z.number().int().min(1).max(60),
    })
    .default({
      enabled: true,
      windowMinutes: 10,
      spikeRatio: 2,
      dropRatio: 0.4,
      minPerMinute: 5,
      cooldownMinutes: 5,
    }),
  /** 新观众第一次发言时给出欢迎话术。 */
  welcome: z.object({ enabled }).default({ enabled: false }),
  /** 开播时推荐本场话题。 */
  liveStart: z.object({ enabled }).default({ enabled: true }),
  /** 下播后自动复盘。 */
  liveEnd: z.object({ enabled }).default({ enabled: true }),
  /** 两次提醒之间的最短间隔。 */
  cooldownSeconds: z.number().int().min(15).max(3600),
});

export type AssistantSettings = z.infer<typeof assistantSettings>;

export const defaultAssistantSettings: AssistantSettings = {
  silence: { enabled: true, seconds: 120 },
  memoryViewers: { enabled: true, cooldownMinutes: 10 },
  keywords: { enabled: false, words: [] },
  periodic: { enabled: false, minutes: 5, minMessages: 3 },
  liveStart: { enabled: true },
  liveEnd: { enabled: true },
  gifts: { enabled: true, minValue: 10, superChat: true, guard: true },
  entry: { enabled: true, withMemory: true, guard: true, minBadgeLevel: 20, minPayLevel: 30 },
  welcome: { enabled: false },
  heat: {
    enabled: true,
    windowMinutes: 10,
    spikeRatio: 2,
    dropRatio: 0.4,
    minPerMinute: 5,
    cooldownMinutes: 5,
  },
  cooldownSeconds: 60,
};

const entryViewer = z.object({
  platform,
  viewerId: z.string(),
  viewerName: z.string().nullable(),
  identity: z.string(),
  facts: z.string().array(),
});

export type EntryViewer = z.infer<typeof entryViewer>;

const currentReminderTrigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('silence'), seconds: z.number() }),
  z.object({
    kind: z.literal('viewer'),
    platform,
    viewerId: z.string(),
    viewerName: z.string().nullable(),
    text: z.string(),
    facts: z.string().array(),
  }),
  z.object({
    kind: z.literal('keyword'),
    platform,
    keyword: z.string(),
    viewerName: z.string().nullable(),
    text: z.string(),
  }),
  z.object({ kind: z.literal('periodic'), minutes: z.number(), count: z.number() }),
  z.object({ kind: z.literal('liveStart'), startedAt: z.number() }),
  z.object({ kind: z.literal('liveEnd'), startedAt: z.number(), endedAt: z.number() }),
  z.object({
    kind: z.literal('gift'),
    platform,
    viewerId: z.string().nullable(),
    viewerName: z.string().nullable(),
    item: z.string(),
    value: z.number().nullable(),
  }),
  z.object({
    kind: z.literal('entry'),
    viewers: entryViewer.array().min(1),
  }),
  z.object({
    kind: z.literal('heat'),
    direction: z.enum(['up', 'down']),
    current: z.number(),
    baseline: z.number(),
  }),
  z.object({
    kind: z.literal('welcome'),
    platform,
    viewerId: z.string(),
    viewerName: z.string().nullable(),
    text: z.string(),
  }),
]);

/** 已保存的单人进场提醒在读取时转成同样的观众列表。 */
const legacyEntryTrigger = entryViewer
  .extend({ kind: z.literal('entry') })
  .transform(({ kind, ...viewer }) => ({ kind, viewers: [viewer] }));

export const reminderTrigger = z.union([currentReminderTrigger, legacyEntryTrigger]);

/** 开播推荐、下播复盘与礼物答谢必须给出结果，不能回复 SKIP。 */
export function isLifecycleTrigger(trigger: ReminderTrigger) {
  return trigger.kind === 'liveStart' || trigger.kind === 'liveEnd' || trigger.kind === 'gift';
}

/** 直播场次的显示时间，例如 11-25 20:03。 */
export function liveTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type ReminderTrigger = z.infer<typeof reminderTrigger>;

type Summary = {
  [K in ReminderTrigger['kind']]: (trigger: Extract<ReminderTrigger, { kind: K }>) => string;
};

const summaries: Summary = {
  silence: trigger => `冷场 ${trigger.seconds} 秒`,
  viewer: trigger => `${trigger.viewerName ?? trigger.viewerId} 发言：${trigger.text}`,
  keyword: trigger => `关注词「${trigger.keyword}」：${trigger.text}`,
  periodic: trigger => `近 ${trigger.minutes} 分钟 ${trigger.count} 条弹幕`,
  liveStart: trigger => `${liveTime(trigger.startedAt)} 开播`,
  liveEnd: trigger => `${liveTime(trigger.startedAt)} 至 ${liveTime(trigger.endedAt)}`,
  gift: trigger => `${trigger.viewerName ?? '观众'} ${trigger.item}`,
  entry: ({ viewers }) => {
    const [first, second] = viewers;

    if (!first) {
      return '观众进场';
    }

    const name = first.viewerName ?? first.viewerId;

    if (!second) {
      return `${name} 进场 · ${first.identity}`;
    }

    const names = `${name}、${second.viewerName ?? second.viewerId}`;

    return viewers.length === 2 ? `${names} 进场` : `${names} 等 ${viewers.length} 人进场`;
  },
  welcome: trigger => `${trigger.viewerName ?? trigger.viewerId}：${trigger.text}`,
  heat: trigger =>
    `弹幕${trigger.direction === 'up' ? '升到' : '降到'} ${trigger.current} 条/分（之前平均 ${trigger.baseline}）`,
};

/** 聊天里提醒条目的一行摘要。 */
export function describeTrigger(trigger: ReminderTrigger) {
  const summarize = summaries[trigger.kind] as (value: ReminderTrigger) => string;

  return summarize(trigger);
}

/** 只有单一来源平台的提醒才显示该平台的图标。 */
export function reminderPlatform(trigger: ReminderTrigger) {
  if ('platform' in trigger) {
    return trigger.platform;
  }

  if (trigger.kind === 'entry') {
    const [first] = trigger.viewers;

    if (first && trigger.viewers.every(viewer => viewer.platform === first.platform)) {
      return first.platform;
    }
  }
}
