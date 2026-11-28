import type { LiveActivity, LivePlatform, LiveViewer } from '@herald/live';

import type { AssistantSettings, ReminderTrigger } from './settings.ts';

const guardNames: Record<number, string> = { 1: '总督', 2: '提督', 3: '舰长' };

/** 观众身份的一行描述，例如「舰长 · 粉丝牌 鲨鱼 21 级」。 */
export function identityOf(viewer: LiveViewer, platform: LivePlatform) {
  const levelName = platform === 'bilibili' ? '荣耀等级' : '财富等级';

  const parts = [
    viewer.guardLevel ? guardNames[viewer.guardLevel] : undefined,
    viewer.badge ? `粉丝牌 ${viewer.badge.name} ${viewer.badge.level} 级` : undefined,
    viewer.payLevel ? `${levelName} ${viewer.payLevel} 级` : undefined,
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

/** 取观众满足的最高优先级条件，等级类条件再按等级排序。 */
export function entryPriority(
  viewer: LiveViewer,
  hasMemory: boolean,
  entry: AssistantSettings['entry'],
): readonly [tier: number, level: number] | undefined {
  if (entry.withMemory && hasMemory) {
    return [4, 0];
  }

  if (entry.guard && viewer.guardLevel) {
    return [3, 0];
  }

  const payLevel = viewer.payLevel ?? 0;

  if (entry.minPayLevel > 0 && payLevel >= entry.minPayLevel) {
    return [2, payLevel];
  }

  const badgeLevel = viewer.badge?.level ?? 0;

  if (entry.minBadgeLevel > 0 && badgeLevel >= entry.minBadgeLevel) {
    return [1, badgeLevel];
  }
}
