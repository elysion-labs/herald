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
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import type { KubaiIconComponent } from 'kubai-icons-react';
import HomeIcon from 'kubai-icons-react/icons/home';
import Lightbulb from 'kubai-icons-react/icons/lightbulb';
import Messages from 'kubai-icons-react/icons/messages';
import MemoryIcon from 'kubai-icons-react/icons/notebook';
import SettingsIcon from 'kubai-icons-react/icons/sliders';
import SkillsIcon from 'kubai-icons-react/icons/sparkles';
import Tv from 'kubai-icons-react/icons/tv';
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  MessageSquareText,
  PanelLeft,
  PanelRight,
  Plus,
  Terminal,
  X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';

import { attachmentPattern } from '../shared/attachments.ts';
import { AgentCapabilitySettings, SystemPromptSettings } from './agent-settings.tsx';
import { LiveControl, StartLiveOverlay } from './assistant-mode.tsx';
import type { Conversation } from './assistant-mode.tsx';
import { AssistantSettingsPanel } from './assistant-settings.tsx';
import { BrowserPane } from './browser-pane.tsx';
import { AttachmentChip, ChatComposer } from './chat-composer.tsx';
import type { ComposerMessage } from './chat-composer.tsx';
import { ChatMarkdown } from './chat-markdown.tsx';
import { chatModelKey } from './chat-model-controls.tsx';
import { usageKey } from './context-usage.tsx';
import { DanmakuPanel } from './danmaku-panel.tsx';
import { kubaiMixed } from './kubai-colors.ts';
import { PlatformIcons, RoomIndicators, roomSummary, useRooms } from './live-status.tsx';
import { MemoryPage } from './memory-page.tsx';
import { ModelSettings } from './model-settings.tsx';
import { PlatformLoginDialog } from './platform-login-dialog.tsx';
import {
  platformAccountKey,
  PlatformSettings,
  WorkspaceRoomSettings,
} from './platform-settings.tsx';
import {
  ReminderFailureCard,
  ReminderItem,
  ReminderProvider,
  useLiveReminder,
} from './reminders.tsx';
import type { LiveReminder } from './reminders.tsx';
import { rpc } from './rpc.ts';
import {
  conversationsKey,
  useConversations,
  useWorkspace,
  WorkspaceContext,
  workspaceKey,
  workspaceListQuery,
} from './workspace-context.ts';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

import './style.css';

const activeWorkspaceKey = 'herald-active-workspace';
const activeChatKey = (id: string) => `herald-active-chat:${id}`;
type Conversations = Awaited<ReturnType<typeof rpc.conversations.list>>;
type LiveReplies =
  Awaited<ReturnType<typeof rpc.conversations.send>> extends AsyncIterable<infer Replies>
    ? Replies
    : never;

const skills = [
  { id: 'find-live-topic', label: '找直播话题', icon: Lightbulb, color: kubaiMixed.lightbulb },
  { id: 'find-trending-videos', label: '找热门视频', icon: Tv, color: kubaiMixed.tv },
] as const;

function preferredConversation(workspaceId: string, conversations?: Conversations) {
  const active = sessionStorage.getItem(activeChatKey(workspaceId));

  return (
    conversations?.find(item => item.id === active) ??
    conversations?.find(item => item.mode === 'assistant')
  );
}

/** 当前工作台显示的会话：/chat/$id 取路由参数，主页取上次打开的会话。 */
function useCurrentConversation() {
  const { id: workspaceId } = useWorkspace();
  const { data } = useConversations();

  const id = useLocation({
    select: ({ pathname }) => (pathname.startsWith('/chat/') ? pathname.slice(6) : undefined),
  });

  return id ? data?.find(item => item.id === id) : preferredConversation(workspaceId, data);
}

function useStoredFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);

    return stored === null ? initial : stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function useCreateConversation() {
  const { id: workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => rpc.conversations.create({ workspaceId }),
    async onSuccess(conversation) {
      await queryClient.invalidateQueries({ queryKey: conversationsKey(workspaceId) });

      if (localStorage.getItem(activeWorkspaceKey) === workspaceId) {
        await navigate({ to: '/chat/$id', params: { id: conversation.id } });
      }
    },
  });
}

interface Shell {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  browserOpen: boolean;
  setBrowserOpen: (open: boolean) => void;
  danmakuOpen: boolean;
  setDanmakuOpen: (open: boolean) => void;
  openLogin: (platform: LivePlatform, trigger: HTMLButtonElement) => void;
}

const shellContext = createContext<Shell>({
  sidebarOpen: true,
  setSidebarOpen: () => undefined,
  browserOpen: true,
  setBrowserOpen: () => undefined,
  danmakuOpen: false,
  setDanmakuOpen: () => undefined,
  openLogin: () => undefined,
});

function WorkspaceShell({ switcher }: { switcher: React.ReactNode }) {
  const client = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useStoredFlag('herald-sidebar-open', true);
  const [browserOpen, setBrowserOpen] = useStoredFlag('herald-browser-open', true);
  const [danmakuOpen, setDanmakuOpen] = useStoredFlag('herald-danmaku-open', false);

  const [login, setLogin] = useState<{
    platform: LivePlatform;
    trigger: HTMLButtonElement;
    open: boolean;
  }>();

  const shell: Shell = {
    sidebarOpen,
    setSidebarOpen,
    browserOpen,
    setBrowserOpen,
    danmakuOpen,
    setDanmakuOpen,
    openLogin: (platform, trigger) => setLogin({ platform, trigger, open: true }),
  };

  return (
    <shellContext.Provider value={shell}>
      <div className="desktop" data-sidebar={sidebarOpen}>
        <Sidebar switcher={switcher} />
        <div className="main">
          <Topbar />
          <div className="stage">
            <Outlet />
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
    </shellContext.Provider>
  );
}

function Sidebar({ switcher }: { switcher: React.ReactNode }) {
  const { sidebarOpen } = useContext(shellContext);
  const { data: conversations } = useConversations();
  const current = useCurrentConversation();
  const pathname = useLocation({ select: location => location.pathname });
  const assistant = conversations?.find(item => item.mode === 'assistant');
  const homeActive = pathname === '/' || pathname.startsWith('/chat/');

  return (
    <aside className="sidebar" data-collapsed={!sidebarOpen} inert={!sidebarOpen} aria-label="导航">
      <div className="sidebar-inner">
        <div className="sidebar-head drag">
          <WindowNav />
        </div>
        <div className="mb-3 px-1">{switcher}</div>
        <nav className="grid gap-px" aria-label="页面">
          <NavItem
            to="/"
            label="工作台"
            icon={HomeIcon}
            color={kubaiMixed.home}
            current={homeActive}
          />
          <NavItem
            to="/memory"
            label="记忆"
            icon={MemoryIcon}
            color={kubaiMixed.notebook}
            current={pathname === '/memory'}
          />
          <NavItem
            to="/settings"
            label="设置"
            icon={SettingsIcon}
            color={kubaiMixed.sliders}
            current={pathname === '/settings'}
          />
        </nav>
        {assistant && (
          <div className="live-rooms">
            <AssistantItem
              conversation={assistant}
              current={homeActive ? current?.id : undefined}
            />
          </div>
        )}
        <div className="nav-section">
          <h2>会话</h2>
          <NewConversationButton />
        </div>
        <div className="session-list grid content-start gap-px">
          {conversations
            ?.filter(item => item.mode === 'chat')
            .map(item => {
              const selected = homeActive && item.id === current?.id;

              return (
                <Link
                  className="nav-item session-link"
                  aria-label={item.title}
                  data-current={selected}
                  aria-current={selected ? 'page' : undefined}
                  key={item.id}
                  to="/chat/$id"
                  params={{ id: item.id }}
                >
                  <PlatformIcons platforms={item.livePlatforms} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <time className="session-time" dateTime={new Date(item.createdAt).toISOString()}>
                    {shortTime(item.createdAt)}
                  </time>
                </Link>
              );
            })}
          {conversations?.every(item => item.mode !== 'chat') && (
            <p className="text-muted-foreground px-2 py-1 text-xs">还没有会话</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function shortTime(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date().toDateString() === date.toDateString();

  return today
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function NavItem({
  to,
  label,
  icon: Icon,
  color,
  current,
}: {
  to: '/' | '/memory' | '/settings';
  label: string;
  icon: KubaiIconComponent;
  color: string;
  current: boolean;
}) {
  return (
    <Link
      to={to}
      className="nav-item"
      data-current={current}
      aria-current={current ? 'page' : undefined}
    >
      <Icon size={17} color={color} trigger="parent" />
      {label}
    </Link>
  );
}

function NewConversationButton() {
  const create = useCreateConversation();

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground -mr-1"
        aria-label="新建会话"
        title="新建会话"
        disabled={create.isPending}
        onClick={() => create.mutate()}
      >
        <Plus />
      </Button>
      {create.isError && (
        <p role="alert" className="error absolute top-full right-0 left-0">
          {create.error.message}
        </p>
      )}
    </>
  );
}

/** 工作区的助手会话，附带已绑定的房间状态。 */
function AssistantItem({
  conversation,
  current,
}: {
  conversation: Conversation;
  current?: string;
}) {
  const { data: rooms } = useRooms();
  const selected = conversation.id === current;
  const live = conversation.liveStartedAt ? '直播中 · ' : '';
  const detail = rooms?.length ? `${live}${rooms.length} 个直播间` : '未绑定直播间';
  const status = rooms?.map(roomSummary).join('；');

  return (
    <Link
      to="/chat/$id"
      params={{ id: conversation.id }}
      className="live-room"
      data-current={selected}
      aria-current={selected ? 'page' : undefined}
      aria-label={`直播助手，${detail}`}
      title={status}
    >
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-[13px]">直播助手</span>
        <span className="text-muted-foreground truncate text-[11px] tabular-nums">{detail}</span>
      </span>
      <RoomIndicators rooms={rooms} compact />
    </Link>
  );
}

/** 跟踪 hash 历史的当前位置与可前进的上限，用于启用 / 禁用前进后退。 */
function useHistoryPosition() {
  const router = useRouter();

  const [position, setPosition] = useState(() => {
    const index = router.history.location.state.__TSR_index;

    return { index, top: index };
  });

  useEffect(
    () =>
      router.history.subscribe(({ location, action }) => {
        const index = location.state.__TSR_index;

        setPosition(previous => ({
          index,
          top: action.type === 'PUSH' ? index : Math.max(previous.top, index),
        }));
      }),
    [router],
  );

  return {
    canBack: position.index > 0,
    canForward: position.index < position.top,
    back: () => router.history.back(),
    forward: () => router.history.forward(),
  };
}

function WindowNav() {
  const { sidebarOpen, setSidebarOpen } = useContext(shellContext);
  const history = useHistoryPosition();

  return (
    <div className="window-nav">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="后退"
        title="后退"
        disabled={!history.canBack}
        onClick={history.back}
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="前进"
        title="前进"
        disabled={!history.canForward}
        onClick={history.forward}
      >
        <ArrowRight />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <PanelLeft />
      </Button>
    </div>
  );
}

function Topbar() {
  const { sidebarOpen, browserOpen, setBrowserOpen, danmakuOpen, setDanmakuOpen } =
    useContext(shellContext);

  const isAssistant = useCurrentConversation()?.mode === 'assistant';

  const pathname = useLocation({ select: location => location.pathname });
  const titles: Record<string, string> = { '/memory': '记忆', '/settings': '设置' };
  const pageTitle = titles[pathname];

  return (
    <header className="topbar drag">
      {!sidebarOpen && <WindowNav />}
      {pageTitle ? (
        <h1 key={pathname} className="topbar-title text-sm font-medium">
          {pageTitle}
        </h1>
      ) : (
        <>
          <ConversationTitle />
          <span className="ml-auto" />
          {isAssistant && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
              aria-pressed={danmakuOpen}
              aria-label={danmakuOpen ? '隐藏实时弹幕' : '显示实时弹幕'}
              title={danmakuOpen ? '隐藏实时弹幕' : '显示实时弹幕'}
              onClick={() => setDanmakuOpen(!danmakuOpen)}
            >
              <MessageSquareText />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-pressed={browserOpen}
            aria-label={browserOpen ? '收起网页预览' : '展开网页预览'}
            title={browserOpen ? '收起网页预览' : '展开网页预览'}
            onClick={() => setBrowserOpen(!browserOpen)}
          >
            <PanelRight />
          </Button>
        </>
      )}
    </header>
  );
}

function ConversationTitle() {
  const conversation = useCurrentConversation();

  if (!conversation) {
    return <h1 className="text-sm font-medium">工作台</h1>;
  }

  return (
    <div key={conversation.id} className="topbar-title flex min-w-0 items-center gap-2.5">
      {conversation.mode === 'chat' && (
        <PlatformIcons platforms={conversation.livePlatforms} size={16} />
      )}
      <h1 className="truncate text-sm font-medium" title={conversation.title}>
        {conversation.title}
      </h1>
      {conversation.mode === 'assistant' && <LiveControl conversation={conversation} />}
    </div>
  );
}

function HomeLayout() {
  const { browserOpen, setBrowserOpen, danmakuOpen, setDanmakuOpen } = useContext(shellContext);
  const conversation = useCurrentConversation();
  const showDanmaku = danmakuOpen && conversation?.mode === 'assistant';
  const browser = usePanelRef();

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'herald-workbench',
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });

  const workbench = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = browser.current;
    const node = workbench.current;

    if (!panel || !node || browserOpen !== panel.isCollapsed()) {
      return;
    }

    // 仅按钮触发的折叠 / 展开带过渡；拖拽时不加，避免分隔条跟手迟滞。
    node.dataset.animating = 'true';

    if (browserOpen) {
      panel.expand();
    } else {
      panel.collapse();
    }

    const timer = setTimeout(() => delete node.dataset.animating, 280);

    return () => clearTimeout(timer);
  }, [browser, browserOpen]);

  return (
    <div ref={workbench} className="workbench h-full min-w-0 flex-1">
      <ResizablePanelGroup
        className="h-full"
        orientation="horizontal"
        id="herald-workbench"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel id="conversation" defaultSize="60%" minSize="360px">
          <main className="flex h-full min-w-0 flex-col">
            <ReminderFailureCard
              conversationId={conversation?.id}
              isAssistant={conversation?.mode === 'assistant'}
            />
            <div className="relative min-h-0 flex-1">
              <Outlet />
            </div>
          </main>
        </ResizablePanel>
        {showDanmaku && conversation && (
          <>
            <ResizableHandle className="workbench-divider" aria-label="调整实时弹幕宽度" />
            <ResizablePanel id="danmaku" defaultSize="22%" minSize="240px" maxSize="40%">
              <DanmakuPanel
                key={conversation.id}
                conversationId={conversation.id}
                onClose={() => setDanmakuOpen(false)}
              />
            </ResizablePanel>
          </>
        )}
        <ResizableHandle className="workbench-divider" aria-label="调整网页预览宽度" />
        <ResizablePanel
          id="browser"
          panelRef={browser}
          defaultSize="40%"
          minSize="320px"
          maxSize="65%"
          collapsible
          collapsedSize={0}
          onResize={(size, _id, previous) => {
            // 挂载时的首次回调和按钮触发的过渡帧都不代表用户意图，忽略；只同步拖拽导致的折叠 / 展开。
            if (previous && !workbench.current?.dataset.animating) {
              setBrowserOpen(size.inPixels > 0);
            }
          }}
        >
          <BrowserPane onTabOpened={() => setBrowserOpen(true)} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function Home() {
  const { id: workspaceId } = useWorkspace();
  const { data: conversations, error, isPending } = useConversations();
  const current = preferredConversation(workspaceId, conversations);
  const create = useCreateConversation();

  if (current) {
    return <ChatSession key={current.id} id={current.id} />;
  }

  let emptyTitle = '开始一场直播会话';

  if (error) {
    emptyTitle = '无法读取会话';
  } else if (isPending) {
    emptyTitle = '正在读取会话';
  }

  return (
    <Empty className="surface-enter h-full">
      <EmptyHeader>
        <EmptyMedia>
          <Messages size={40} color={kubaiMixed.messages} />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>
          {emptyTitle}
        </EmptyTitle>
        {(!isPending || error) && (
          <EmptyDescription>
            {error?.message ?? '在工作区绑定直播间，即可让 Herald 结合弹幕陪你接话、找话题。'}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {!isPending && !error && (
        <EmptyContent className="flex-row justify-center">
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            <Plus data-icon="inline-start" />
            新建会话
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

function Chat() {
  const { id } = chatRoute.useParams();
  const { id: workspaceId } = useWorkspace();
  const query = useConversations();
  const exists = query.data?.some(item => item.id === id);

  useEffect(() => {
    if (exists) {
      sessionStorage.setItem(activeChatKey(workspaceId), id);
    }
  }, [exists, id, workspaceId]);

  if (!query.isSuccess) {
    return (
      <p role={query.isError ? 'alert' : 'status'} className="text-muted-foreground p-6 text-sm">
        {query.error?.message ?? '正在读取会话…'}
      </p>
    );
  }

  return exists ? <ChatSession key={id} id={id} /> : <Navigate to="/" replace />;
}

const skillById = new Map<string, (typeof skills)[number]>(skills.map(item => [item.id, item]));
const expandedSkill = /^<skill name="([^"]+)"[^>]*>[\s\S]*?\n<\/skill>(?:\n\n|$)/;
const commandSkill = /^\/skill:(\S+)(?:\s+|$)/;

/**
 * pi 会把 `/skill:名称 正文` 展开成 `<skill name="…" location="…">…</skill>\n\n正文` 存进历史；
 * 发送中的消息仍是原始命令。两种形式都只保留技能名与用户正文。
 */
function parseSkillMessage(text: string) {
  const names: string[] = [];
  let body = text;

  for (
    let match = expandedSkill.exec(body) ?? commandSkill.exec(body);
    match;
    match = expandedSkill.exec(body) ?? commandSkill.exec(body)
  ) {
    names.push(match[1]);
    body = body.slice(match[0].length);
  }

  return { skills: names, body };
}

function SkillTag({ skill, onRemove }: { skill: string; onRemove?: () => void }) {
  const info = skillById.get(skill);
  const Icon = info?.icon;

  return (
    <span className="skill-tag bg-secondary text-foreground/90 inline-flex h-6 w-fit items-center gap-1 rounded-full pr-1 pl-1.5 text-xs">
      {Icon ? <Icon size={14} color={info.color} /> : <SkillsIcon size={14} />}
      {info?.label ?? skill}
      {onRemove ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:bg-background/60 grid size-4 place-items-center rounded-full transition-colors"
          aria-label="移除技能"
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

function UserText({ text, images, files }: { text: string; images: string[]; files: string[] }) {
  const { skills: used, body: withFiles } = parseSkillMessage(text);
  const attached = [...files, ...[...withFiles.matchAll(attachmentPattern)].map(match => match[1])];
  const body = withFiles.replace(attachmentPattern, '').trim();

  return (
    <div className="flex flex-col items-end gap-1.5">
      {used.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {used.map(skill => (
            <SkillTag key={skill} skill={skill} />
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((source, index) => (
            <img
              key={index}
              src={source}
              alt=""
              className="border-border max-h-40 max-w-60 rounded-xl border object-cover"
            />
          ))}
        </div>
      )}
      {attached.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {attached.map((name, index) => (
            <AttachmentChip key={`${name}-${index}`} name={name} />
          ))}
        </div>
      )}
      {body && (
        <Bubble align="end" variant="muted">
          <BubbleContent className="leading-relaxed whitespace-pre-wrap">{body}</BubbleContent>
        </Bubble>
      )}
    </div>
  );
}

function ChatTurn({
  role,
  text,
  traces = [],
  streaming = false,
  images = [],
  files = [],
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  images?: string[];
  files?: string[];
  traces?: Awaited<ReturnType<typeof rpc.conversations.history>>[number]['traces'];
}) {
  const person = role === 'user';

  return (
    <Message className="mx-auto w-full max-w-3xl px-6 pb-6" align={person ? 'end' : 'start'}>
      <MessageContent>
        {traces.length > 0 && (
          <Trace>
            {traces.map((trace, index) => (
              <TraceCollapsible key={index}>
                <TraceCollapsibleTrigger>
                  <TraceLine>
                    <TraceIcon>
                      <TraceKindIcon trace={trace} />
                    </TraceIcon>
                    <TraceTitle>{trace.kind === 'thinking' ? '思考' : trace.name}</TraceTitle>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent className="whitespace-pre-wrap">
                  {trace.kind === 'thinking' ? trace.text : trace.input}
                </TraceCollapsibleContent>
              </TraceCollapsible>
            ))}
          </Trace>
        )}
        {person && <UserText text={text} images={images} files={files} />}
        {text && !person && <ChatMarkdown content={text} streaming={streaming} />}
      </MessageContent>
    </Message>
  );
}

type ChatTrace = Awaited<ReturnType<typeof rpc.conversations.history>>[number]['traces'][number];

function TraceKindIcon({ trace }: { trace: ChatTrace }) {
  if (trace.kind === 'thinking') {
    return <CircleCheck />;
  }

  if (trace.failed) {
    return <CircleX />;
  }

  return <Terminal />;
}

type HistoryMessage = Awaited<ReturnType<typeof rpc.conversations.history>>[number];

function HistoryItem({ message }: { message: HistoryMessage }) {
  if (message.role === 'reminder') {
    return message.trigger ? <ReminderItem trigger={message.trigger} /> : null;
  }

  return <ChatTurn {...message} role={message.role} />;
}

function LiveReminderItem({ reminder }: { reminder: LiveReminder }) {
  return (
    <>
      <ReminderItem trigger={reminder.trigger} live={reminder.turns.length === 0} />
      {reminder.turns.map((turn, index) => (
        <ChatTurn
          key={index}
          role="assistant"
          {...turn}
          streaming={index === reminder.turns.length - 1}
        />
      ))}
    </>
  );
}

function PendingTurn({ message }: { message?: ComposerMessage }) {
  const attachments = message?.attachments ?? [];

  return (
    <ChatTurn
      role="user"
      text={message?.text ?? ''}
      images={attachments.flatMap(file =>
        file.mimeType.startsWith('image/') ? [`data:${file.mimeType};base64,${file.data}`] : [],
      )}
      files={attachments.flatMap(file => (file.mimeType.startsWith('image/') ? [] : [file.name]))}
    />
  );
}

function ChatTranscript({
  messages,
  error,
  pending,
  replies,
  reminder,
}: {
  messages?: Awaited<ReturnType<typeof rpc.conversations.history>>;
  error?: string;
  pending?: ComposerMessage;
  replies: LiveReplies;
  reminder?: LiveReminder;
}) {
  const isSending = pending !== undefined;
  const hasMessages = Boolean(messages?.length) || isSending;

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport className="chat-message-viewport" data-has-messages={hasMessages}>
          <MessageScrollerContent aria-busy={isSending} className="chat-message-content gap-0">
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
                <HistoryItem message={message} />
              </MessageScrollerItem>
            ))}
            {reminder && (
              <MessageScrollerItem messageId="reminder">
                <LiveReminderItem reminder={reminder} />
              </MessageScrollerItem>
            )}
            {isSending && (
              <MessageScrollerItem messageId="pending" scrollAnchor>
                <PendingTurn message={pending} />
                {replies.length === 0 && (
                  <Trace className="mx-auto max-w-3xl px-6 pb-6">
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
                  <ChatTurn role="assistant" {...reply} streaming={index === replies.length - 1} />
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
  const { id: workspaceId } = useWorkspace();
  const input = useRef<HTMLTextAreaElement>(null);
  const chatBody = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const [replies, setReplies] = useState<LiveReplies>([]);
  const savingModel = useIsMutating({ mutationKey: chatModelKey(workspaceId, id) }) > 0;
  const queryClient = useQueryClient();

  const historyQuery = {
    queryKey: [...workspaceKey(workspaceId), 'history', id],
    queryFn: () => rpc.conversations.history({ workspaceId, id }),
  };

  const history = useQuery({ ...historyQuery, refetchOnWindowFocus: false });
  const conversation = useConversations().data?.find(item => item.id === id);
  /** 未开播时主播选择先在会话里准备，暂时收起开播遮罩。 */
  const [preparing, setPreparing] = useState(false);

  const reminder = useLiveReminder(id);

  const send = useMutation({
    async mutationFn(message: ComposerMessage) {
      setReplies([]);
      const stream = await rpc.conversations.send({ workspaceId, id, ...message });

      for await (const updates of stream) {
        setReplies(updates);
      }
    },
    onSuccess() {
      input.current?.focus();
    },
    async onSettled() {
      await Promise.all([
        queryClient.invalidateQueries(historyQuery),
        queryClient.invalidateQueries({ queryKey: usageKey(workspaceId, id) }),
        queryClient.invalidateQueries({ queryKey: conversationsKey(workspaceId) }),
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

  return (
    <section className="chat surface-enter" aria-label="对话">
      <div ref={chatBody} className="chat-body">
        <ChatTranscript
          messages={history.data}
          error={history.error?.message}
          pending={send.isPending ? send.variables : undefined}
          replies={replies}
          reminder={reminder}
        />
        <StartLiveOverlay
          conversation={conversation}
          hidden={preparing}
          onDismiss={() => setPreparing(true)}
        />
        {history.data?.length === 0 && !send.isPending && (
          <div className="chat-empty">
            <p className="text-foreground/80 text-sm">还没有消息</p>
            <p className="text-muted-foreground text-xs">直接提问，也可以添加图片或文本文件</p>
          </div>
        )}
        <div ref={composer} className="chat-composer">
          {send.isError && (
            <p role="alert" className="error pointer-events-auto mx-auto max-w-3xl px-6">
              {send.error.message}
            </p>
          )}
          <ChatComposer
            id={id}
            conversation={conversation}
            input={input}
            busy={send.isPending}
            locked={send.isPending || savingModel}
            onSend={message => send.mutateAsync(message)}
          />
        </div>
      </div>
    </section>
  );
}

function SettingsPage() {
  const { openLogin } = useContext(shellContext);

  return (
    <main className="page surface-enter">
      <Tabs defaultValue="general" className="mx-auto max-w-3xl gap-5">
        <TabsList>
          <TabsTrigger value="general">直播与模型</TabsTrigger>
          <TabsTrigger value="assistant">直播助手</TabsTrigger>
          <TabsTrigger value="prompt">系统提示词</TabsTrigger>
          <TabsTrigger value="agent">Agent 能力</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="settings-stack grid gap-6">
          <WorkspaceRoomSettings />
          <PlatformSettings openLogin={openLogin} />
          <ModelSettings />
        </TabsContent>
        <TabsContent value="assistant" className="settings-stack grid gap-6">
          <AssistantSettingsPanel />
        </TabsContent>
        <TabsContent value="prompt" className="settings-stack grid gap-6">
          <SystemPromptSettings />
        </TabsContent>
        <TabsContent value="agent" className="settings-stack grid gap-6">
          <AgentCapabilitySettings />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function WorkspaceRoot() {
  const query = useQuery(workspaceListQuery);
  const [selected, setSelected] = useState(() => localStorage.getItem(activeWorkspaceKey));
  const navigate = useNavigate();
  const pathname = useLocation({ select: location => location.pathname });
  const active = query.data?.find(item => item.id === selected) ?? query.data?.[0];

  useEffect(() => {
    if (active) {
      localStorage.setItem(activeWorkspaceKey, active.id);
    }
  }, [active]);

  if (!active || !query.data) {
    return (
      <main className="grid h-full place-items-center gap-3">
        <div className="grid justify-items-center gap-3">
          <p role={query.error ? 'alert' : 'status'} className="text-muted-foreground text-sm">
            {query.error?.message ?? '正在读取工作区…'}
          </p>
          {query.isError && (
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch();
              }}
            >
              重试
            </Button>
          )}
        </div>
      </main>
    );
  }

  function select(id: string) {
    localStorage.setItem(activeWorkspaceKey, id);
    setSelected(id);

    if (pathname.startsWith('/chat/')) {
      void navigate({ to: '/', replace: true });
    }
  }

  const switcher = (
    <WorkspaceSwitcher workspace={active} workspaces={query.data} onSelect={select} />
  );

  return (
    <WorkspaceContext value={active}>
      <ReminderProvider key={active.id}>
        <WorkspaceShell switcher={switcher} />
      </ReminderProvider>
    </WorkspaceContext>
  );
}

const rootRoute = createRootRoute({ component: WorkspaceRoot });

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
