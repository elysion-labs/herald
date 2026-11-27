import type { LiveActivity, LiveViewer } from '@herald/live';

import type { AssistantSettings, ReminderTrigger } from './settings.ts';

const guardNames: Record<number, string> = { 1: '总督', 2: '提督', 3: '舰长' };

/** 观众身份的一行描述，例如「舰长 · 粉丝牌 鲨鱼 21 级」。 */
export function identityOf(viewer: LiveViewer) {
  const parts = [
    viewer.guardLevel ? guardNames[viewer.guardLevel] : undefined,
    viewer.badge ? `粉丝牌 ${viewer.badge.name} ${viewer.badge.level} 级` : undefined,
    viewer.payLevel ? `财富 ${viewer.payLevel} 级` : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(' · ') : '普通观众';
}

function giftItem(activity: LiveActivity, gifts: AssistantSettings['gifts']) {
  if (activity.kind === 'gift') {
    return (activity.value ?? 0) >= gifts.minValue
      ? `送出 ${activity.giftName} ×${activity.count}`
      : undefined;
  }

  if (activity.kind === 'superChat') {
    return gifts.superChat ? `醒目留言：「${activity.text}」` : undefined;
  }

  return activity.kind === 'guard' && gifts.guard ? `开通${activity.guardName}` : undefined;
}

/** 礼物、醒目留言、上舰的答谢提醒；未达到条件时返回 undefined。 */
export function giftTrigger(
  activity: LiveActivity,
  gifts: AssistantSettings['gifts'],
): ReminderTrigger | undefined {
  const item = gifts.enabled ? giftItem(activity, gifts) : undefined;

  if (!item) {
    return undefined;
  }

  return {
    kind: 'gift',
    platform: activity.platform,
    viewerId: activity.viewer.id,
    viewerName: activity.viewer.name,
    item,
    value: 'value' in activity ? activity.value : null,
  };
}

/** 进场观众是否满足任意一项分析条件。 */
export function entryQualifies(
  viewer: LiveViewer,
  hasMemory: boolean,
  entry: AssistantSettings['entry'],
) {
  return (
    (entry.withMemory && hasMemory) ||
    (entry.guard && Boolean(viewer.guardLevel)) ||
    (entry.minBadgeLevel > 0 && (viewer.badge?.level ?? 0) >= entry.minBadgeLevel) ||
    (entry.minPayLevel > 0 && (viewer.payLevel ?? 0) >= entry.minPayLevel)
  );
}
