import type { LivePlatform } from '@herald/live';
import {
  QueryClient,
  QueryClientProvider,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import Folder from 'kubai-icons-react/icons/folder';
import HomeIcon from 'kubai-icons-react/icons/home';
import MemoryIcon from 'kubai-icons-react/icons/notebook';
import SettingsIcon from 'kubai-icons-react/icons/sliders';
import {
  ArrowUp,
  ChevronDown,
  CircleCheck,
  CircleX,
  LoaderCircle,
  MessageCircle,
  Plus,
  Terminal,
} from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDefaultLayout } from 'react-resizable-panels';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { Message, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';

import { platformLabels, platforms } from '../shared/platforms.ts';
import { BrowserPane } from './browser-pane.tsx';
import { chatModelKey, ChatModelControls } from './chat-model-controls.tsx';
import { kubaiMixed } from './kubai-colors.ts';
import { MemoryPage } from './memory-page.tsx';
import { ModelSettings } from './model-settings.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { PlatformLoginDialog } from './platform-login-dialog.tsx';
import { platformAccountKey, PlatformSettings } from './platform-settings.tsx';
import { rpc } from './rpc.ts';

import './style.css';

const conversationsQuery = { queryKey: ['conversations'], queryFn: () => rpc.conversations.list() };
const activeChatKey = 'herald-active-chat';
type Conversations = Awaited<ReturnType<typeof rpc.conversations.list>>;
type LiveReplies =
  Awaited<ReturnType<typeof rpc.conversations.send>> extends AsyncIterable<infer Replies>
    ? Replies
    : never;

function preferredConversation(conversations?: Conversations) {
  const active = sessionStorage.getItem(activeChatKey);

  return conversations?.find(item => item.id === active) ?? conversations?.[0];
}

const platformContext = createContext<(platform: LivePlatform, trigger: HTMLButtonElement) => void>(
  () => undefined,
);

function Workspace() {
  const client = useQueryClient();

  const [login, setLogin] = useState<{
    platform: LivePlatform;
    trigger: HTMLButtonElement;
    open: boolean;
  }>();

  const pathname = useLocation({ select: location => location.pathname });
  const homeActive = pathname === '/' || pathname.startsWith('/chat/');

  return (
    <div className="desktop">
      <header className="titlebar">
        <span className="wordmark">Herald</span>
      </header>
      <div className="workbench">
        <nav className="sidebar-rail" aria-label="页面">
          <Button asChild size="icon-lg" variant="ghost" className="rail-link size-10 rounded-lg">
            <Link
              to="/"
              aria-label="主页"
              title="主页"
              data-current={homeActive}
              aria-current={homeActive ? 'page' : undefined}
            >
              <HomeIcon
                className="size-[22px]"
                color={kubaiMixed.home}
                trigger="parent"
                aria-hidden="true"
              />
            </Link>
          </Button>
          <Button asChild size="icon-lg" variant="ghost" className="rail-link size-10 rounded-lg">
            <Link to="/memory" aria-label="记忆" title="记忆" data-current={pathname === '/memory'}>
              <MemoryIcon
                className="size-[22px]"
                color={kubaiMixed.notebook}
                trigger="parent"
                aria-hidden="true"
              />
            </Link>
          </Button>
          <Button asChild size="icon-lg" variant="ghost" className="rail-link size-10 rounded-lg">
            <Link
              to="/settings"
              aria-label="设置"
              title="设置"
              data-current={pathname === '/settings'}
            >
              <SettingsIcon
                className="size-[22px]"
                color={kubaiMixed.sliders}
                trigger="parent"
                aria-hidden="true"
              />
            </Link>
          </Button>
        </nav>
        <div className="min-h-0 min-w-0 flex-1">
          <platformContext.Provider
            value={(platform, trigger) => setLogin({ platform, trigger, open: true })}
          >
            <Outlet />
          </platformContext.Provider>
        </div>
      </div>
      {login && (
        <PlatformLoginDialog
          platform={login.platform}
          open={login.open}
          trigger={login.trigger}
          onClose={() => {
            setLogin({ ...login, open: false });
            void client.invalidateQueries({ queryKey: [...platformAccountKey, login.platform] });
          }}
          onExited={() => setLogin(undefined)}
        />
      )}
    </div>
  );
}

function HomeLayout() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'herald-home-workbench',
    storage: sessionStorage,
    onlySaveAfterUserInteractions: true,
  });

  return (
    <ResizablePanelGroup
      className="h-full"
      orientation="horizontal"
      id="herald-home-workbench"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id="sessions" defaultSize="17%" minSize="160px" maxSize="32%">
        <SessionSidebar />
      </ResizablePanel>
      <ResizableHandle className="workbench-divider" aria-label="调整会话侧栏宽度" />
      <ResizablePanel id="conversation" defaultSize="53%" minSize="320px">
        <main className="center">
          <Outlet />
        </main>
      </ResizablePanel>
      <ResizableHandle className="workbench-divider" aria-label="调整网页预览宽度" />
      <ResizablePanel id="browser" defaultSize="30%" minSize="295px" maxSize="57%">
        <BrowserPane />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function SessionSidebar() {
  const { data: conversations } = useQuery(conversationsQuery);
  const current = preferredConversation(conversations);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation({ select: location => location.pathname });

  const create = useMutation({
    mutationFn: (platform: LivePlatform) => rpc.conversations.create(platform),
    async onSuccess(conversation) {
      await queryClient.invalidateQueries(conversationsQuery);
      await navigate({ to: '/chat/$id', params: { id: conversation.id } });
    },
  });

  return (
    <aside className="sidebar" aria-label="直播会话">
      <div className="sidebar-body">
        <div className="sidebar-top">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="w-full justify-start"
                variant="outline"
                size="lg"
                disabled={create.isPending}
              >
                <Plus data-icon="inline-start" /> 新建会话{' '}
                <ChevronDown className="ml-auto" data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="workspace-dropdown"
              side="bottom"
              align="start"
              sideOffset={6}
            >
              <DropdownMenuGroup>
                {platforms.map(item => (
                  <DropdownMenuItem key={item} onSelect={() => create.mutate(item)}>
                    <PlatformIcon platform={item} size={16} /> {platformLabels[item]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {create.isError && (
            <p role="alert" className="error">
              {create.error.message}
            </p>
          )}
        </div>
        <div className="sidebar-list">
          <h2>会话</h2>
          {conversations?.map(item => (
            <Link
              className="conversation-link"
              aria-label={`${item.title} · ${platformLabels[item.platform]}`}
              data-selected={pathname === '/' && item.id === current?.id}
              key={item.id}
              to="/chat/$id"
              params={{ id: item.id }}
            >
              <PlatformIcon platform={item.platform} />
              <span className="truncate">{item.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Home() {
  const { data: conversations, error, isPending } = useQuery(conversationsQuery);
  const current = preferredConversation(conversations);

  if (current) {
    return <ChatSession key={current.id} id={current.id} />;
  }

  const emptyTitle = isPending ? '正在读取会话' : '开始直播会话';

  return (
    <Empty className="surface-enter">
      <EmptyHeader>
        <EmptyMedia>
          <Folder size={38} color={kubaiMixed.folder} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={1}>
          {error ? '无法读取会话' : emptyTitle}
        </EmptyTitle>
        {(!isPending || error) && (
          <EmptyDescription>{error?.message ?? '从左侧新建会话并选择直播平台'}</EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  );
}

function Chat() {
  const { id } = chatRoute.useParams();

  useEffect(() => {
    sessionStorage.setItem(activeChatKey, id);
  }, [id]);

  return <ChatSession key={id} id={id} />;
}

function ChatTurn({
  role,
  text,
  traces = [],
}: {
  role: 'user' | 'assistant';
  text: string;
  traces?: Awaited<ReturnType<typeof rpc.conversations.history>>[number]['traces'];
}) {
  const person = role === 'user';

  return (
    <Message className="mx-auto w-full max-w-3xl px-5 pb-5" align={person ? 'end' : 'start'}>
      <MessageContent>
        {traces.length > 0 && (
          <Trace>
            {traces.map((trace, index) => {
              const ToolIcon = trace.kind === 'tool' && trace.failed ? CircleX : Terminal;

              return (
                <TraceCollapsible key={index}>
                  <TraceCollapsibleTrigger>
                    <TraceLine>
                      <TraceIcon>
                        {trace.kind === 'thinking' ? <CircleCheck /> : <ToolIcon />}
                      </TraceIcon>
                      <TraceTitle>{trace.kind === 'thinking' ? '思考' : trace.name}</TraceTitle>
                    </TraceLine>
                  </TraceCollapsibleTrigger>
                  <TraceCollapsibleContent className="whitespace-pre-wrap">
                    {trace.kind === 'thinking' ? trace.text : trace.input}
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              );
            })}
          </Trace>
        )}
        {text && (
          <Bubble align={person ? 'end' : 'start'} variant={person ? 'muted' : 'ghost'}>
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        )}
      </MessageContent>
    </Message>
  );
}

function ChatHeader({
  conversation,
}: {
  conversation?: Awaited<ReturnType<typeof rpc.conversations.list>>[number];
}) {
  return (
    <div className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {conversation && <PlatformIcon platform={conversation.platform} size={16} />}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-sm font-medium" title={conversation?.title}>
            {conversation?.title ?? '新会话'}
          </h1>
        </div>
      </div>
    </div>
  );
}

function ChatTranscript({
  messages,
  error,
  pending,
  replies,
}: {
  messages?: Awaited<ReturnType<typeof rpc.conversations.history>>;
  error?: string;
  pending?: string;
  replies: LiveReplies;
}) {
  const isSending = pending !== undefined;
  const hasMessages = Boolean(messages?.length) || isSending;

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport className="chat-message-viewport" data-has-messages={hasMessages}>
          <MessageScrollerContent aria-busy={isSending} className="chat-message-content gap-0">
            {messages?.length === 0 && !isSending && (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageCircle aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle role="heading" aria-level={1}>
                    想聊些什么？
                  </EmptyTitle>
                  <EmptyDescription>问 Herald 怎么接话，或者聊点什么</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {messages?.map(message => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === 'user'}
              >
                <ChatTurn {...message} />
              </MessageScrollerItem>
            ))}
            {isSending && (
              <MessageScrollerItem messageId="pending" scrollAnchor>
                <ChatTurn role="user" text={pending ?? ''} />
                {replies.length === 0 && (
                  <Trace className="mx-auto max-w-3xl px-5 pb-5">
                    <TraceLine status="running">
                      <TraceIcon>
                        <LoaderCircle className="animate-spin" />
                      </TraceIcon>
                      <TraceTitle>处理中</TraceTitle>
                    </TraceLine>
                  </Trace>
                )}
              </MessageScrollerItem>
            )}
            {isSending &&
              replies.map((reply, index) => (
                <MessageScrollerItem messageId={`reply-${index}`} key={index}>
                  <ChatTurn role="assistant" {...reply} />
                </MessageScrollerItem>
              ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="chat-scroll-button" aria-label="滚到最新消息" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function ChatSession({ id }: { id: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const chatBody = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [replies, setReplies] = useState<LiveReplies>([]);
  const savingModel = useIsMutating({ mutationKey: chatModelKey(id) }) > 0;
  const { data: conversations } = useQuery(conversationsQuery);
  const conversation = conversations?.find(item => item.id === id);
  const queryClient = useQueryClient();
  const historyQuery = { queryKey: ['history', id], queryFn: () => rpc.conversations.history(id) };
  const history = useQuery({ ...historyQuery, refetchOnWindowFocus: false });

  const send = useMutation({
    async mutationFn(message: string) {
      setReplies([]);
      const stream = await rpc.conversations.send({ id, text: message });

      for await (const updates of stream) {
        setReplies(updates);
      }
    },
    onSuccess() {
      setText('');
      input.current?.focus();
    },
    async onSettled() {
      await Promise.all([
        queryClient.invalidateQueries(historyQuery),
        queryClient.invalidateQueries(conversationsQuery),
      ]);
    },
  });

  useLayoutEffect(() => {
    const viewport = chatBody.current;
    const overlay = composer.current;

    if (!viewport || !overlay) {
      return;
    }

    const update = () => {
      viewport.style.setProperty(
        '--composer-clearance',
        `${Math.ceil(overlay.getBoundingClientRect().height) + 12}px`,
      );
    };

    const observer = new ResizeObserver(update);
    observer.observe(overlay);
    update();

    return () => observer.disconnect();
  }, []);

  const composerLocked = send.isPending || savingModel;

  function submit() {
    if (text.trim() && !composerLocked) {
      send.mutate(text.trim());
    }
  }

  return (
    <section className="chat surface-enter">
      <ChatHeader conversation={conversation} />
      <div ref={chatBody} className="chat-body">
        <ChatTranscript
          messages={history.data}
          error={history.error?.message}
          pending={send.isPending ? send.variables : undefined}
          replies={replies}
        />
        <div ref={composer} className="chat-composer">
          <form
            className="pointer-events-auto mx-auto w-full max-w-3xl px-5 pb-5"
            onSubmit={event => {
              event.preventDefault();
              submit();
            }}
          >
            {send.isError && (
              <p role="alert" className="error">
                {send.error.message}
              </p>
            )}
            <InputGroup className="bg-popover shadow-lg">
              <InputGroupTextarea
                className="min-h-14"
                ref={input}
                aria-label="消息"
                placeholder="给 Herald 发消息…"
                value={text}
                readOnly={send.isPending}
                onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <InputGroupAddon align="block-end" className="flex-wrap pt-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <InputGroupButton
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label="添加技能"
                      disabled={send.isPending}
                    >
                      <Plus />
                    </InputGroupButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="workspace-dropdown" align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() => setText(draft => `/skill:find-live-topic ${draft}`)}
                      >
                        找直播话题
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setText(draft => `/skill:find-trending-videos ${draft}`)}
                      >
                        找热门视频
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ChatModelControls id={id} disabled={send.isPending} />
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label="发送"
                  disabled={!text.trim() || composerLocked}
                >
                  <ArrowUp />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>
      </div>
    </section>
  );
}

function SettingsPage() {
  const selectPlatform = useContext(platformContext);

  return (
    <main className="page settings-page surface-enter">
      <div className="mx-auto max-w-5xl">
        <h1>设置</h1>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <PlatformSettings openLogin={selectPlatform} />
          <ModelSettings />
        </div>
      </div>
    </main>
  );
}

const rootRoute = createRootRoute({ component: Workspace });

const homeLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'home',
  component: HomeLayout,
});

const sessionsRoute = createRoute({
  getParentRoute: () => homeLayoutRoute,
  path: '/',
  component: Home,
});

const chatRoute = createRoute({
  getParentRoute: () => homeLayoutRoute,
  path: '/chat/$id',
  component: Chat,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  component: MemoryPage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeLayoutRoute.addChildren([sessionsRoute, chatRoute]),
    settingsRoute,
    memoryRoute,
  ]),
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing application root');
}

createRoot(root).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
