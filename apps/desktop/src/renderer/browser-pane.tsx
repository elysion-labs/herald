import type { BrowserTab } from '@herald/browser-tool';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import Globe from 'kubai-icons-react/icons/globe';
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  RotateCw,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { useBrowserWindow } from './browser-window-layout.ts';
import { kubaiMixed } from './kubai-colors.ts';
import { rpc } from './rpc.ts';

interface BrowserState {
  activeId: string | null;
  tabs: BrowserTab[];
  open: boolean;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  pointerInside: boolean;
}

const emptyBrowser: BrowserState = {
  activeId: null,
  tabs: [],
  open: false,
  url: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  pointerInside: false,
};

interface AddressDraft {
  id: string | null;
  text: string;
}

function tabLabel(tab: BrowserTab | undefined, fallback: string) {
  return [tab?.title, tab?.url].find(Boolean) ?? fallback;
}

interface DisplayTab {
  tab: BrowserTab;
  phase?: 'entering' | 'closing';
}

function reconcileTabs(previous: DisplayTab[], tabs: BrowserTab[]): DisplayTab[] {
  const remaining = new Map(tabs.map(tab => [tab.id, tab]));

  const ordered = previous.map(({ tab }) => {
    const current = remaining.get(tab.id);
    remaining.delete(tab.id);

    return current ? { tab: current } : ({ tab, phase: 'closing' } as const);
  });

  return [...ordered, ...[...remaining.values()].map(tab => ({ tab, phase: 'entering' }) as const)];
}

function BrowserTabList({
  tabs,
  activeId,
  select,
  close,
}: {
  tabs: BrowserTab[];
  activeId: string | null;
  select: (id: string) => void;
  close: (id: string) => void;
}) {
  const scrollArea = useRef<HTMLDivElement>(null);

  const [display, setDisplay] = useState(() => ({
    source: tabs,
    items: tabs.map<DisplayTab>(tab => ({ tab })),
  }));

  if (display.source !== tabs) {
    setDisplay({ source: tabs, items: reconcileTabs(display.items, tabs) });
  }

  useLayoutEffect(() => {
    const area = scrollArea.current;

    if (!area) {
      return;
    }

    const active = area.querySelector<HTMLElement>('[data-active="true"]');

    const reveal = () => {
      if (!active) {
        return;
      }

      const { left, right } = active.getBoundingClientRect();
      const viewport = area.getBoundingClientRect();

      if (left < viewport.left) {
        area.scrollLeft += left - viewport.left;
      } else if (right > viewport.right) {
        area.scrollLeft += right - viewport.right;
      }
    };

    const observer = new ResizeObserver(reveal);
    observer.observe(area);

    if (active) {
      observer.observe(active);
      reveal();
    }

    function scrollTabs(event: WheelEvent) {
      if (!area || !event.deltaY || event.deltaX || event.ctrlKey) {
        return;
      }

      if (area.scrollWidth > area.clientWidth) {
        event.preventDefault();

        // 用户滚动后，停止跟随标签的进入动画，直到下一次激活标签。
        if (active) {
          observer.unobserve(active);
        }

        const units = [1, 16, area.clientWidth];
        area.scrollLeft += event.deltaY * (units[event.deltaMode] ?? 1);
      }
    }

    area.addEventListener('wheel', scrollTabs, { passive: false });

    return () => {
      observer.disconnect();
      area.removeEventListener('wheel', scrollTabs);
    };
  }, [activeId]);

  return (
    <TooltipProvider delayDuration={380}>
      <Tabs className="min-w-0 flex-1" value={activeId ?? ''} onValueChange={select}>
        <div ref={scrollArea} className="browser-tabs-scroll">
          <TabsList variant="line" className="browser-tabs-list" aria-label="网页标签页">
            {display.items.map(({ tab, phase }) => {
              const title = tabLabel(tab, '新标签页');
              const closing = phase === 'closing';

              return (
                <div
                  className="browser-tab"
                  key={tab.id}
                  data-active={tab.id === activeId}
                  data-phase={phase}
                  inert={closing}
                  onAnimationEnd={event => {
                    if (closing && event.target === event.currentTarget) {
                      setDisplay(current => ({
                        ...current,
                        items: current.items.filter(item => item.tab.id !== tab.id),
                      }));
                    }
                  }}
                  onAuxClick={event => {
                    if (event.button === 1) {
                      event.preventDefault();
                      close(tab.id);
                    }
                  }}
                >
                  <Tooltip disableHoverableContent>
                    <TooltipTrigger asChild>
                      <TabsTrigger
                        className="browser-tab-trigger"
                        value={tab.id}
                        aria-label={title}
                        aria-controls="browser-viewport"
                        disabled={closing}
                      >
                        {tab.favicon ? (
                          <img
                            className="browser-tab-icon"
                            src={tab.favicon}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Globe
                            className="browser-tab-icon"
                            color={kubaiMixed.globe}
                            aria-hidden="true"
                          />
                        )}
                        <span className="browser-tab-title truncate">{title}</span>
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4} className="break-all">
                      {title}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="browser-tab-close"
                    aria-label={`关闭标签页：${title}`}
                    onClick={() => close(tab.id)}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </TabsList>
        </div>
      </Tabs>
    </TooltipProvider>
  );
}

function useBrowserState(onTabOpened: () => void) {
  const [state, setState] = useState(emptyBrowser);
  const tabOpened = useRef(onTabOpened);

  useEffect(() => {
    tabOpened.current = onTabOpened;
  }, [onTabOpened]);

  useEffect(() => {
    const controller = new AbortController();

    async function watch() {
      try {
        const updates = await rpc.browser.watch(undefined, { signal: controller.signal });
        let tabCount: number | undefined;

        for await (const update of updates) {
          if (tabCount !== undefined && update.tabs.length > tabCount) {
            tabOpened.current?.();
          }

          tabCount = update.tabs.length;
          setState(update);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('浏览器状态连接失败', error);
        }
      }
    }

    void watch();

    return () => controller.abort();
  }, []);

  return state;
}

type BrowserLayout = ReturnType<typeof useBrowserWindow>;

function useNativeBounds(
  surface: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  { x, y, width, height }: BrowserLayout['frame'],
  full: boolean,
) {
  const lastBounds = useRef('');

  useLayoutEffect(() => {
    const node = surface.current;

    if (!enabled || !node) {
      if (lastBounds.current) {
        lastBounds.current = '';
        void rpc.browser.setBounds(null);
      }

      return;
    }

    const sync = () => {
      const { x, y, width, height } = node.getBoundingClientRect();

      const hasPortal = document.querySelector(
        '[data-slot="dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"]',
      );

      const frame =
        width >= 1 && height >= 1 && !hasPortal
          ? {
              x: Math.round(x),
              y: Math.round(y),
              width: Math.floor(width),
              height: Math.floor(height),
            }
          : null;

      const bounds = frame ? { frame, pictureInPicture: !full } : null;
      const key = bounds ? JSON.stringify(bounds) : '';

      if (key !== lastBounds.current) {
        lastBounds.current = key;
        void rpc.browser.setBounds(bounds);
      }
    };

    const observer = new ResizeObserver(sync);
    const portals = new MutationObserver(sync);
    observer.observe(node);
    const layer = node.closest('.workspace-browser-layer');

    if (layer) {
      observer.observe(layer);
    }

    portals.observe(document.body, { childList: true });
    window.addEventListener('resize', sync);
    sync();

    return () => {
      observer.disconnect();
      portals.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [enabled, surface, x, y, width, height, full]);

  useLayoutEffect(
    () => () => {
      void rpc.browser.setBounds(null);
    },
    [],
  );
}

export function BrowserPane({
  open,
  full,
  onOpenChange,
}: {
  open: boolean;
  full: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const layout = useBrowserWindow();
  const surface = useRef<HTMLDivElement>(null);
  const wasFull = useRef(full);

  const state = useBrowserState(() => {
    if (full) {
      return;
    }

    if (layout.mode === 'capsule') {
      layout.setMode('pip');
    }

    onOpenChange(true);
  });

  const { frame, mode, moving } = layout;
  const visible = !full && open && state.tabs.length > 0 && frame.width > 0 && frame.height > 0;
  const currentTab = state.tabs.find(tab => tab.id === state.activeId);

  useEffect(() => {
    const leaving = wasFull.current && !full;
    wasFull.current = full;

    if (leaving && state.url) {
      onOpenChange(true);
    }
  }, [full, onOpenChange, state.url]);

  useNativeBounds(surface, full || (visible && mode === 'pip'), frame, full);

  return (
    <>
      {full && <FullBrowser state={state} surface={surface} />}
      <div ref={layout.areaRef} className="browser-float-area">
        {visible && (
          <aside
            className="browser-float"
            aria-label="网页浏览器"
            data-mode={mode}
            data-moving={moving}
            data-pointer-inside={state.pointerInside}
            style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
          >
            <BrowserFrame
              layout={layout}
              state={state}
              surface={surface}
              title={tabLabel(currentTab, '新标签页')}
              favicon={currentTab?.favicon}
              onClose={() => onOpenChange(false)}
            />
          </aside>
        )}
      </div>
    </>
  );
}

function BrowserTitle({
  layout,
  state,
  title,
  favicon,
  onClose,
}: {
  layout: BrowserLayout;
  state: BrowserState;
  title: string;
  favicon?: string;
  onClose: () => void;
}) {
  const { mode, setMode } = layout;

  return (
    <div className="browser-title">
      <span
        className="browser-drag"
        onPointerDown={event => layout.begin(event, 'move')}
        {...layout.pointerEvents}
      >
        <GripVertical className="size-3.5 shrink-0" aria-hidden="true" />
        {favicon && <img src={favicon} alt="" referrerPolicy="no-referrer" className="size-3.5" />}
        <span className="truncate">{title}</span>
      </span>
      {mode === 'pip' && <PictureInPictureActions state={state} />}
      <BrowserModeButton mode={mode} setMode={setMode} />
      {mode === 'pip' && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="收起为胶囊"
          onClick={() => setMode('capsule')}
        >
          <Minus />
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" aria-label="关闭浏览器浮窗" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}

function PictureInPictureActions({ state }: { state: BrowserState }) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="后退"
        disabled={!state.canGoBack}
        onClick={() => void rpc.browser.back()}
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="刷新"
        disabled={!state.url}
        onClick={() => void rpc.browser.reload()}
      >
        {state.loading ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
      </Button>
    </>
  );
}

function BrowserModeButton({ mode, setMode }: Pick<BrowserLayout, 'mode' | 'setMode'>) {
  if (mode === 'pip') {
    return (
      <Button asChild variant="ghost" size="icon-xs" aria-label="打开浏览器页">
        <Link to="/browser">
          <Maximize2 />
        </Link>
      </Button>
    );
  }

  return (
    <Button variant="ghost" size="icon-xs" aria-label="恢复画中画" onClick={() => setMode('pip')}>
      <Maximize2 />
    </Button>
  );
}

function FullBrowser({
  state,
  surface,
}: {
  state: BrowserState;
  surface: RefObject<HTMLDivElement | null>;
}) {
  return (
    <main className="browser-full" aria-label="浏览器">
      <div className="browser-full-controls">
        <BrowserControls state={state} />
      </div>
      <div className="browser-full-area">
        <div
          className="browser-full-surface"
          id="browser-viewport"
          ref={surface}
          aria-label="当前网页"
        >
          {!state.url && (
            <Empty className="h-full p-5">
              <EmptyHeader>
                <EmptyMedia>
                  <Globe size={32} color={kubaiMixed.empty} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle className="text-sm">打开网页</EmptyTitle>
                <EmptyDescription className="text-xs">
                  输入网址，或让 Herald 打开网页。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </main>
  );
}

function BrowserFrame({
  layout,
  state,
  surface,
  title,
  favicon,
  onClose,
}: {
  layout: BrowserLayout;
  state: BrowserState;
  surface: RefObject<HTMLDivElement | null>;
  title: string;
  favicon?: string;
  onClose: () => void;
}) {
  const { mode } = layout;

  const heading = (
    <BrowserTitle layout={layout} state={state} title={title} favicon={favicon} onClose={onClose} />
  );

  if (mode === 'capsule') {
    return heading;
  }

  return (
    <>
      <div className="browser-chrome">{heading}</div>
      <div
        className="browser-surface"
        id="browser-viewport"
        role="tabpanel"
        aria-label="当前网页"
        ref={surface}
      >
        {!state.url && (
          <Empty className="gap-2 p-3">
            <EmptyHeader className="gap-1">
              <EmptyMedia className="mb-0">
                <Globe size={26} color={kubaiMixed.globe} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-sm">新标签页</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
        <span
          key={corner}
          className="browser-resize-grip"
          data-corner={corner}
          aria-hidden="true"
          onPointerDown={event => layout.begin(event, corner)}
          {...layout.pointerEvents}
        />
      ))}
    </>
  );
}

function BrowserControls({ state }: { state: BrowserState }) {
  const addressInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AddressDraft>();
  const tabId = state.activeId;
  const address = draft?.id === tabId ? draft.text : state.url;

  const navigation = useMutation({
    mutationFn: ({ url, tabId }: { url: string; tabId?: string; draft?: AddressDraft }) =>
      rpc.browser.navigate({ url, tabId }),
    onSuccess(_result, submitted) {
      setDraft(current => (current === submitted.draft ? undefined : current));
    },
  });

  return (
    <>
      <div className="browser-tab-strip">
        <BrowserTabList
          tabs={state.tabs}
          activeId={tabId}
          select={id => {
            setDraft(undefined);
            navigation.reset();
            void rpc.browser.selectTab(id);
          }}
          close={id => {
            setDraft(undefined);
            navigation.reset();
            void rpc.browser.close(id);
          }}
        />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="新建网页标签页"
          onClick={async () => {
            navigation.reset();
            setDraft(undefined);
            await rpc.browser.openTab();
            addressInput.current?.focus();
          }}
        >
          <Plus />
        </Button>
      </div>
      <div className="browser-toolbar">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="后退"
          disabled={!state.canGoBack}
          onClick={() => void rpc.browser.back()}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="前进"
          disabled={!state.canGoForward}
          onClick={() => void rpc.browser.forward()}
        >
          <ArrowRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="刷新"
          disabled={!state.open}
          onClick={() => void rpc.browser.reload()}
        >
          {state.loading ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={event => {
            event.preventDefault();
            const input = (addressInput.current?.value ?? address).trim();

            if (input) {
              addressInput.current?.blur();
              navigation.mutate({
                url: input.includes('://') ? input : `https://${input}`,
                tabId: tabId ?? undefined,
                draft,
              });
            }
          }}
        >
          <Input
            ref={addressInput}
            className="h-7 rounded-md px-2.5 text-xs"
            aria-label="网页地址"
            aria-invalid={navigation.isError}
            aria-describedby={navigation.isError ? 'browser-address-error' : undefined}
            placeholder="输入网页地址"
            value={address}
            onChange={event => {
              setDraft({ id: tabId, text: event.target.value });

              if (navigation.isError) {
                navigation.reset();
              }
            }}
            onFocus={event => event.target.select()}
          />
        </form>
      </div>
      {navigation.isError && (
        <div className="browser-error">
          <p id="browser-address-error" role="alert" className="min-w-0 wrap-anywhere">
            {navigation.error.message}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="rounded-md underline underline-offset-3"
            onClick={() => addressInput.current?.focus()}
          >
            修改网址
          </Button>
        </div>
      )}
    </>
  );
}
