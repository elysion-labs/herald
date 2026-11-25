import type { CSSProperties } from 'react';

export function dialogOrigin(trigger: HTMLElement | null): CSSProperties | undefined {
  if (!trigger) {
    return undefined;
  }

  const { left, top, width, height } = trigger.getBoundingClientRect();

  return {
    '--login-origin-x': `${left + width / 2}px`,
    '--login-origin-y': `${top + height / 2}px`,
  } as CSSProperties;
}
