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
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import Lightbulb from 'kubai-icons-react/icons/lightbulb';
import Messages from 'kubai-icons-react/icons/messages';
import SkillsIcon from 'kubai-icons-react/icons/sparkles';
import Tv from 'kubai-icons-react/icons/tv';
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Plus,
  Terminal,
  X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
import { AssistantReminders, LiveControl, StartLiveOverlay } from './assistant-mode.tsx';
import type { Conversation } from './assistant-mode.tsx';
import { BrowserPane } from './browser-pane.tsx';
import { AttachmentChip, ChatComposer } from './chat-composer.tsx';
import type { ComposerMessage } from './chat-composer.tsx';
import { ChatMarkdown } from './chat-markdown.tsx';
import { chatModelKey } from './chat-model-controls.tsx';
import { usageKey } from './context-usage.tsx';
import { DanmakuPanel } from './danmaku-panel.tsx';
import { kubaiMixed } from './kubai-colors.ts';
import { PlatformIcons } from './live-status.tsx';
import { MemoryPage, memorySearch } from './memory-page.tsx';
import { desktopTab, NavigationRail } from './navigation-rail.tsx';
import type { DesktopTab } from './navigation-rail.tsx';
import { PlatformLoginDialog } from './platform-login-dialog.tsx';
import { platformAccountKey } from './platform-settings.tsx';
import {
  ReminderFailureCard,
  ReminderItem,
  ReminderProvider,
  useLiveReminder,
} from './reminders.tsx';
import type { LiveReminder } from './reminders.tsx';
import { rpc } from './rpc.ts';
import { filterSessions, SessionList, sessionSearch } from './session-list.tsx';
import { SettingsPage, settingsSearch } from './settings-page.tsx';
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
type LiveReplies =
  Awaited<ReturnType<typeof rpc.conversations.send>> extends AsyncIterable<infer Replies>
    ? Replies
    : never;

const skills = [
  { id: 'find-live-topic', label: '找直播话题', icon: Lightbulb, color: kubaiMixed.lightbulb },
  { id: 'find-trending-videos', label: '找热门视频', icon: Tv, color: kubaiMixed.tv },
] as const;

function useCurrentConversation() {
  const { data } = useConversations();
  const pathname = useLocation({ select: location => location.pathname });
  const tab = desktopTab(pathname);

  if (tab === '/live') {
    return data?.find(item => item.mode === 'assistant');
  }

  return data?.find(item => pathname === `/chat/${item.id}`);
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
        await navigate({ to: '/chat/$id', params: { id: conversation.id }, search: {} });
      }
    },
  });
}

interface Shell {
  danmakuOpen: boolean;
  setDanmakuOpen: (open: boolean) => void;
  openLogin: (platform: LivePlatform, trigger: HTMLButtonElement) => void;
}

const shellContext = createContext<Shell>({
  danmakuOpen: true,
  setDanmakuOpen: () => undefined,
  openLogin: () => undefined,
});

function WorkspaceShell({ switcher }: { switcher: React.ReactNode }) {
  const client = useQueryClient();
  const tab = useLocation({ select: location => desktopTab(location.pathname) });
  const hasList = tab === '/chat' || tab === '/memory' || tab === '/settings';
  const [listOpen, setListOpen] = useStoredFlag('herald-list-open', true);
  const [browserOpen, setBrowserOpen] = useStoredFlag('herald-browser-open', false);
  const [danmakuOpen, setDanmakuOpen] = useStoredFlag('herald-live-danmaku-open', true);

  const [login, setLogin] = useState<{
    platform: LivePlatform;
    trigger: HTMLButtonElement;
    open: boolean;
  }>();

  const shell: Shell = {
    danmakuOpen,
    setDanmakuOpen,
    openLogin: (platform, trigger) => setLogin({ platform, trigger, open: true }),
  };

  const isLive = tab === '/live';
  let togglePanel = hasList ? () => setListOpen(!listOpen) : undefined;

  if (isLive) {
    togglePanel = () => setDanmakuOpen(!danmakuOpen);
  }

  return (
    <shellContext.Provider value={shell}>
      <div className="desktop">
        <Topbar
          tab={tab}
          panelOpen={isLive ? danmakuOpen : hasList && listOpen}
          onTogglePanel={togglePanel}
        />
        <div className="desktop-body">
          <NavigationRail switcher={switcher} current={tab} />
          <div className="stage" data-list={hasList && listOpen}>
            <Outlet />
            <div className="workspace-browser-layer">
              <BrowserPane
                open={browserOpen}
                full={tab === '/browser'}
                onOpenChange={setBrowserOpen}
              />
            </div>
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
  const history = useHistoryPosition();

  return (
    <div className="window-nav">
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-lg"
        aria-label="后退页面"
        disabled={!history.canBack}
        onClick={history.back}
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-lg"
        aria-label="前进页面"
        disabled={!history.canForward}
        onClick={history.forward}
      >
        <ArrowRight />
      </Button>
    </div>
  );
}

const pageTitles: Record<DesktopTab, string> = {
  '/live': '直播',
  '/chat': '会话',
  '/browser': '浏览器',
  '/memory': '记忆',
  '/settings': '设置',
};

function Topbar({
  tab,
  panelOpen,
  onTogglePanel,
}: {
  tab: DesktopTab;
  panelOpen: boolean;
  onTogglePanel?: () => void;
}) {
  const live = tab === '/live';
  const panel = live ? '实时弹幕' : '第二栏';
  const action = panelOpen ? '收起' : '展开';

  return (
    <header className="topbar drag">
      <div className="window-rail-control">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground rounded-lg"
          aria-label={`${action}${panel}`}
          aria-controls={live ? 'live-danmaku' : 'workspace-list'}
          aria-expanded={panelOpen}
          disabled={!onTogglePanel}
          onClick={onTogglePanel}
        >
          {live ? <PanelRight /> : <PanelLeft />}
        </Button>
      </div>
      <WindowNav />
      <ConversationTitle tab={tab} />
    </header>
  );
}

function ConversationTitle({ tab }: { tab: DesktopTab }) {
  const conversation = useCurrentConversation();

  if (!conversation) {
    return <h1 className="text-sm font-medium">{pageTitles[tab]}</h1>;
  }

  return (
    <div key={conversation.id} className="topbar-title flex min-w-0 items-center gap-2.5">
      {conversation.mode === 'chat' && (
        <PlatformIcons platforms={conversation.livePlatforms} size={16} />
      )}
      <h1 className="truncate text-sm font-medium">{conversation.title}</h1>
      {conversation.mode === 'assistant' && <LiveControl conversation={conversation} />}
    </div>
  );
}

function LivePage() {
  const { danmakuOpen, setDanmakuOpen } = useContext(shellContext);
  const query = useConversations();
  const conversation = query.data?.find(item => item.mode === 'assistant');

  if (!conversation) {
    return (
      <main className="route-content page">
        <p role={query.error ? 'alert' : 'status'} className="text-muted-foreground text-sm">
          {query.error?.message ?? '正在读取直播助手…'}
        </p>
      </main>
    );
  }

  return (
    <div className="route-content live-page">
      <ResizablePanelGroup className="h-full" orientation="horizontal" id="herald-live">
        <ResizablePanel id="conversation" minSize="300px">
          <ConversationBody conversation={conversation} />
        </ResizablePanel>
        {danmakuOpen && (
          <>
            <ResizableHandle className="workbench-divider" aria-label="调整实时弹幕宽度" />
            <ResizablePanel id="danmaku" defaultSize="260px" minSize="220px" maxSize="40%">
              <DanmakuPanel
                key={conversation.id}
                conversationId={conversation.id}
                onClose={() => setDanmakuOpen(false)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function ConversationBody({ conversation }: { conversation: Conversation }) {
  return (
    <main className="flex h-full min-w-0 flex-col" aria-label="会话内容">
      <ReminderFailureCard
        conversationId={conversation.id}
        isAssistant={conversation.mode === 'assistant'}
      />
      {conversation.mode === 'chat' && conversation.liveStartedAt && (
        <div className="mx-auto w-full max-w-3xl">
          <AssistantReminders conversationId={conversation.id} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <ChatSession key={conversation.id} id={conversation.id} />
      </div>
    </main>
  );
}

function ChatLayout() {
  const query = useConversations();
  const search = chatLayoutRoute.useSearch();
  const create = useCreateConversation();

  return (
    <>
      <SessionList
        conversations={filterSessions(query.data, search)}
        search={search}
        error={create.error ?? query.error}
        create={() => create.mutate()}
        creating={create.isPending}
      />
      <div className="route-content">
        <Outlet />
      </div>
    </>
  );
}

function ChatHome() {
  const { id: workspaceId } = useWorkspace();
  const query = useConversations();
  const search = chatLayoutRoute.useSearch();
  const chats = filterSessions(query.data, search);
  const stored = sessionStorage.getItem(activeChatKey(workspaceId));
  const selected = chats?.find(item => item.id === stored) ?? chats?.[0];

  if (selected) {
    return <Navigate to="/chat/$id" params={{ id: selected.id }} search={search} replace />;
  }

  if (!query.isSuccess) {
    return (
      <p role={query.error ? 'alert' : 'status'} className="text-muted-foreground p-6 text-sm">
        {query.error?.message ?? '正在读取会话…'}
      </p>
    );
  }

  return <EmptySessions archivedOnly={search.filter === 'live'} />;
}

function EmptySessions({ archivedOnly }: { archivedOnly: boolean }) {
  const create = useCreateConversation();

  return (
    <Empty className="surface-enter h-full">
      <EmptyHeader>
        <EmptyMedia>
          <Messages size={32} color={kubaiMixed.empty} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>
          {archivedOnly ? '暂无往期直播' : '开始一段对话'}
        </EmptyTitle>
        <EmptyDescription>
          {archivedOnly ? '下播后，本场会话会归档到这里。' : '新建会话，向 Herald 提问。'}
        </EmptyDescription>
      </EmptyHeader>
      {!archivedOnly && (
        <EmptyContent>
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            <Plus data-icon="inline-start" />
            新建会话
          </Button>
        </EmptyContent>
      )}
      {create.error && (
        <p role="alert" className="error">
          {create.error.message}
        </p>
      )}
    </Empty>
  );
}

function Chat() {
  const { id } = chatRoute.useParams();
  const { id: workspaceId } = useWorkspace();
  const search = chatLayoutRoute.useSearch();
  const query = useConversations();
  const conversation = query.data?.find(item => item.id === id);
  const isChat = conversation?.mode === 'chat';

  useEffect(() => {
    if (isChat) {
      sessionStorage.setItem(activeChatKey(workspaceId), id);
    }
  }, [isChat, id, workspaceId]);

  if (!query.isSuccess) {
    return (
      <p role={query.error ? 'alert' : 'status'} className="text-muted-foreground p-6 text-sm">
        {query.error?.message ?? '正在读取会话…'}
      </p>
    );
  }

  if (!conversation) {
    return <Navigate to="/chat" search={search} replace />;
  }

  return isChat ? (
    <ConversationBody conversation={conversation} />
  ) : (
    <Navigate to="/live" replace />
  );
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

function useStartLiveOverlay(conversation?: Conversation) {
  const [preparing, setPreparing] = useState(false);

  const visible =
    conversation?.mode === 'assistant' && conversation.liveStartedAt === null && !preparing;

  return { visible, dismiss: () => setPreparing(true) };
}

function useComposerPlacement(
  body: React.RefObject<HTMLDivElement | null>,
  composer: React.RefObject<HTMLDivElement | null>,
  centered: boolean,
) {
  useLayoutEffect(() => {
    const viewport = body.current;
    const overlay = composer.current;

    if (!viewport || !overlay) {
      return;
    }

    const stage = viewport.closest<HTMLElement>('.stage');

    const update = () => {
      const bounds = overlay.getBoundingClientRect();
      const clearance = `${Math.ceil(bounds.height) + 12}px`;

      viewport.style.setProperty('--composer-clearance', centered ? '0px' : clearance);

      if (centered && stage) {
        const bottom = Math.ceil(bounds.bottom - stage.getBoundingClientRect().top);
        stage.style.setProperty('--conversation-float-top', `${bottom + 12}px`);
      } else {
        stage?.style.setProperty('--conversation-composer-clearance', clearance);
      }
    };

    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(overlay);
    update();

    return () => {
      observer.disconnect();
      stage?.style.removeProperty('--conversation-float-top');
      stage?.style.removeProperty('--conversation-composer-clearance');
    };
  }, [body, composer, centered]);
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
  const startOverlay = useStartLiveOverlay(conversation);

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

  const centered =
    !startOverlay.visible && history.data?.length === 0 && !send.isPending && !reminder;

  useComposerPlacement(chatBody, composer, centered);

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
        {startOverlay.visible && <StartLiveOverlay onDismiss={startOverlay.dismiss} />}
        <div
          ref={composer}
          className="chat-composer"
          data-centered={centered}
          inert={startOverlay.visible}
        >
          {centered && <h2 className="chat-welcome">今天想聊点什么？</h2>}
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

function SettingsRoutePage() {
  const { openLogin } = useContext(shellContext);
  const { section } = settingsRoute.useSearch();

  return <SettingsPage section={section} openLogin={openLogin} />;
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
      void navigate({ to: '/chat', search: {}, replace: true });
    } else if (pathname === '/memory') {
      void navigate({ to: '/memory', search: {}, replace: true });
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

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/live" replace />,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: LivePage,
});

const chatLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatLayout,
  validateSearch: sessionSearch,
});

const sessionsRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '/',
  component: ChatHome,
});

const chatRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '$id',
  component: Chat,
});

const browserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browser',
  component: () => null,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: settingsSearch,
  component: SettingsRoutePage,
});

function MemoryRoutePage() {
  const { scope, id } = memoryRoute.useSearch();
  const navigate = memoryRoute.useNavigate();

  return (
    <MemoryPage
      selected={scope && id ? { scope, id } : undefined}
      onSelect={selection => void navigate({ search: selection ?? {} })}
    />
  );
}

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  validateSearch: memorySearch,
  component: MemoryRoutePage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    liveRoute,
    chatLayoutRoute.addChildren([sessionsRoute, chatRoute]),
    browserRoute,
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

const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', darkScheme.matches);
applyTheme();
darkScheme.addEventListener('change', applyTheme);

createRoot(root).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
