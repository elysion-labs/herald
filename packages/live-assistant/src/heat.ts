import type { AssistantSettings, ReminderTrigger } from './settings.ts';

const minute = 60_000;

/** 每分钟弹幕量统计，用来发现热度突增或下滑。 */
export interface HeatState {
  counts: Map<number, number>;
  checkedMinute: number;
  lastAt: number;
}

export function createHeatState(): HeatState {
  return { counts: new Map(), checkedMinute: 0, lastAt: 0 };
}

export function resetHeat(heat: HeatState) {
  heat.counts.clear();
  heat.checkedMinute = 0;
  heat.lastAt = 0;
}

export function recordHeat(heat: HeatState, at: number) {
  const slot = Math.floor(at / minute);
  heat.counts.set(slot, (heat.counts.get(slot) ?? 0) + 1);
}

/** 清理窗口外的计数，返回刚结束那一分钟的弹幕量和之前若干分钟的平均值。 */
function minuteStats(heat: HeatState, last: number, windowMinutes: number) {
  for (const slot of heat.counts.keys()) {
    if (slot < last - windowMinutes) {
      heat.counts.delete(slot);
    }
  }

  let total = 0;

  for (let slot = last - windowMinutes; slot < last; slot += 1) {
    total += heat.counts.get(slot) ?? 0;
  }

  return {
    current: heat.counts.get(last) ?? 0,
    baseline: Math.round((total / windowMinutes) * 10) / 10,
  };
}

function heatDirection(current: number, baseline: number, config: AssistantSettings['heat']) {
  if (current >= baseline * config.spikeRatio) {
    return 'up';
  }

  return current <= baseline * config.dropRatio ? 'down' : undefined;
}

/** 比较刚结束的一分钟与之前若干分钟的平均弹幕量；每分钟最多判断一次。 */
export function heatTrigger(
  heat: HeatState,
  config: AssistantSettings['heat'],
  now: number,
): ReminderTrigger | undefined {
  const last = Math.floor(now / minute) - 1;

  if (!config.enabled || last <= heat.checkedMinute) {
    return undefined;
  }

  heat.checkedMinute = last;

  const { current, baseline } = minuteStats(heat, last, config.windowMinutes);

  if (baseline < config.minPerMinute || now - heat.lastAt < config.cooldownMinutes * minute) {
    return undefined;
  }

  const direction = heatDirection(current, baseline, config);

  if (!direction) {
    return undefined;
  }

  heat.lastAt = now;

  return { kind: 'heat', direction, current, baseline };
}
