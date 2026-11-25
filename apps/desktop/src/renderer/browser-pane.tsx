import type { BrowserTab } from '@herald/browser-tool';
import { useMutation } from '@tanstack/react-query';
import Globe from 'kubai-icons-react/icons/globe';
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
}

const emptyBrowser: BrowserState = {
  activeId: null,
  tabs: [],
  open: false,
  url: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

interface AddressDraft {
  id: string | null;
  text: string;
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
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  return (
    <TooltipProvider delayDuration={380}>
      <Tabs className="min-w-0 flex-1" value={activeId ?? ''} onValueChange={select}>
        {tabs.length > 0 && (
          <div className="browser-tabs-scroll">
            <TabsList
              ref={list}
              variant="line"
              className="browser-tabs-list"
              aria-label="网页标签页"
            >
              {tabs.map(tab => {
                const title = tab.title || tab.url || '新标签页';

                return (
                  <div
                    className="browser-tab"
                    key={tab.id}
                    data-active={tab.id === activeId}
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
        )}
      </Tabs>
    </TooltipProvider>
  );
}

export function BrowserPane() {
  const surface = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState(emptyBrowser);
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

  useEffect(() => {
    const controller = new AbortController();

    async function watch() {
      try {
        const updates = await rpc.browser.watch(undefined, { signal: controller.signal });

        for await (const update of updates) {
          setState(update);

          if (!update.open) {
            setDraft(undefined);
          }
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

  useEffect(() => {
    const node = surface.current;

    if (!node) {
      void rpc.browser.setBounds(null);

      return;
    }

    const resize = () => {
      const { x, y, width, height } = node.getBoundingClientRect();

      const bounds =
        width >= 1 && height >= 1
          ? {
              x: Math.round(x),
              y: Math.round(y),
              width: Math.floor(width),
              height: Math.floor(height),
            }
          : null;

      void rpc.browser.setBounds(bounds);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(node);
    window.addEventListener('resize', resize);
    resize();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      void rpc.browser.setBounds(null);
    };
  }, []);

  return (
    <aside className="browser" aria-label="网页浏览器">
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
            navigation.reset();
            void rpc.browser.close(id);
          }}
        />
        <Button
          size="icon-sm"
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
      <div className="pane-header browser-toolbar">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="后退"
          disabled={!state.canGoBack}
          onClick={() => void rpc.browser.back()}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="前进"
          disabled={!state.canGoForward}
          onClick={() => void rpc.browser.forward()}
        >
          <ArrowRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
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
            aria-label="网页地址"
            placeholder="输入网页地址"
            value={address}
            onChange={event => setDraft({ id: tabId, text: event.target.value })}
            onFocus={event => event.target.select()}
          />
        </form>
      </div>
      {navigation.isError && (
        <p role="alert" className="browser-error">
          {navigation.error.message}
        </p>
      )}
      <div
        className="browser-surface"
        id="browser-viewport"
        role="tabpanel"
        aria-label="当前网页"
        ref={surface}
      >
        <Empty className="surface-enter">
          <EmptyHeader>
            <EmptyMedia>
              <Globe size={38} color={kubaiMixed.globe} aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>
              网页预览
            </EmptyTitle>
            <EmptyDescription>输入网址，或在聊天中让 Herald 打开网页</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </aside>
  );
}
