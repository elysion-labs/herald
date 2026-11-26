import { z } from 'zod';

const enabled = z.boolean();
const silenceSeconds = z.number().int().min(30).max(1800);
const periodicMinutes = z.number().int().min(1).max(60);
/** 新增字段带默认值，旧版本保存的设置仍能解析。 */
const viewerCooldownMinutes = z.number().int().min(1).max(240).default(10);
const periodicMinMessages = z.number().int().min(1).max(500).default(3);
const keyword = z.string().trim().min(1).max(32);
const keywordList = z.array(keyword).max(50);

/** 弹幕自动提醒：规则触发（冷场 / 有记忆的观众 / 关注词）+ 定时批量分析。 */
export const assistantSettings = z.object({
  silence: z.object({ enabled, seconds: silenceSeconds }),
  memoryViewers: z.object({ enabled, cooldownMinutes: viewerCooldownMinutes }),
  keywords: z.object({ enabled, words: keywordList }),
  periodic: z.object({ enabled, minutes: periodicMinutes, minMessages: periodicMinMessages }),
  /** 两次提醒之间的最短间隔。 */
  cooldownSeconds: z.number().int().min(15).max(3600),
});

export type AssistantSettings = z.infer<typeof assistantSettings>;

export const defaultAssistantSettings: AssistantSettings = {
  silence: { enabled: true, seconds: 120 },
  memoryViewers: { enabled: true, cooldownMinutes: 10 },
  keywords: { enabled: false, words: [] },
  periodic: { enabled: false, minutes: 5, minMessages: 3 },
  cooldownSeconds: 60,
};

export const reminderTrigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('silence'), seconds: z.number() }),
  z.object({
    kind: z.literal('viewer'),
    viewerId: z.string(),
    viewerName: z.string().nullable(),
    text: z.string(),
    facts: z.string().array(),
  }),
  z.object({
    kind: z.literal('keyword'),
    keyword: z.string(),
    viewerName: z.string().nullable(),
    text: z.string(),
  }),
  z.object({ kind: z.literal('periodic'), minutes: z.number(), count: z.number() }),
]);

export type ReminderTrigger = z.infer<typeof reminderTrigger>;

/** 聊天里提醒条目的一行摘要。 */
export function describeTrigger(trigger: ReminderTrigger) {
  switch (trigger.kind) {
    case 'silence': {
      return `冷场 ${trigger.seconds} 秒`;
    }

    case 'viewer': {
      return `${trigger.viewerName ?? trigger.viewerId} 发言：${trigger.text}`;
    }

    case 'keyword': {
      return `关注词「${trigger.keyword}」：${trigger.text}`;
    }

    case 'periodic': {
      return `近 ${trigger.minutes} 分钟 ${trigger.count} 条弹幕`;
    }
  }
}
