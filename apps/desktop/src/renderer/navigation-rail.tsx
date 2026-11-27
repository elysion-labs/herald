import { Link } from '@tanstack/react-router';
import Globe from 'kubai-icons-react/icons/globe';
import Messages from 'kubai-icons-react/icons/messages';
import Notebook from 'kubai-icons-react/icons/notebook';
import RadioTower from 'kubai-icons-react/icons/radio-tower';
import Sliders from 'kubai-icons-react/icons/sliders';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { kubaiMixed } from './kubai-colors.ts';
import { useReminderCards } from './reminders.tsx';
import { useConversations } from './workspace-context.ts';

const tabs = [
  { path: '/live', label: '直播', icon: RadioTower, color: kubaiMixed.tv },
  { path: '/chat', label: '会话', icon: Messages, color: kubaiMixed.messages },
  { path: '/browser', label: '浏览器', icon: Globe, color: kubaiMixed.globe },
  { path: '/memory', label: '记忆', icon: Notebook, color: kubaiMixed.notebook },
  { path: '/settings', label: '设置', icon: Sliders, color: kubaiMixed.sliders },
] as const;

export type DesktopTab = (typeof tabs)[number]['path'];

export function desktopTab(pathname: string): DesktopTab {
  const firstSegment = pathname.split('/')[1];

  return tabs.find(tab => tab.path === `/${firstSegment}`)?.path ?? '/live';
}

function LiveBadge() {
  const { data } = useConversations();
  const session = data?.find(item => item.mode === 'assistant');
  const { cards } = useReminderCards(session?.id);
  const pending = cards.filter(card => card.done && !card.verdict).length;

  return (
    <>
      {session?.liveStartedAt && (
        <span className={pending ? 'sr-only' : 'rail-live-dot'} role="img" aria-label="直播中" />
      )}
      {pending > 0 && (
        <span
          className="rail-reminder-count"
          data-counted={pending > 1}
          role="img"
          aria-label={`${pending} 条未处理提醒`}
        >
          {pending > 1 && Math.min(pending, 9)}
          {pending > 9 && '+'}
        </span>
      )}
    </>
  );
}

export function NavigationRail({
  switcher,
  current,
}: {
  switcher: ReactNode;
  current: DesktopTab;
}) {
  const rail = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = rail.current;
    const highlight = indicator.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');

    if (!nav || !highlight || !selected) {
      return;
    }

    const position = () => {
      highlight.style.translate = `0 ${selected.offsetTop}px`;
    };

    const observer = new ResizeObserver(position);
    observer.observe(nav);
    position();

    return () => observer.disconnect();
  }, [current]);

  return (
    <TooltipProvider delayDuration={300}>
      <nav ref={rail} className="navigation-rail" aria-label="主导航">
        <span ref={indicator} className="rail-indicator" aria-hidden="true" />
        <div className="rail-workspace">{switcher}</div>
        <Separator className="rail-separator" />
        {tabs.map(({ path, label, icon: Icon, color }) => (
          <Tooltip key={path}>
            <TooltipTrigger asChild>
              <Link
                to={path}
                className="rail-link"
                data-current={path === current}
                data-settings={path === '/settings'}
                aria-current={path === current ? 'page' : undefined}
              >
                <Icon size={21} color={color} trigger="parent" aria-hidden="true" />
                <span className="sr-only">{label}</span>
                {path === '/live' && <LiveBadge />}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  );
}
