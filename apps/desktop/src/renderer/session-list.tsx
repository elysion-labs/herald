import { Link, useNavigate } from '@tanstack/react-router';
import Messages from 'kubai-icons-react/icons/messages';
import { ChevronRight, ListFilter, Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

import type { Conversation } from './assistant-mode.tsx';
import { kubaiMixed } from './kubai-colors.ts';
import { PlatformIcons } from './live-status.tsx';
import { useReminderCards } from './reminders.tsx';

export function sessionSearch(search: Record<string, unknown>): { filter?: 'live' } {
  return { filter: search.filter === 'live' ? 'live' : undefined };
}

type SessionSearch = ReturnType<typeof sessionSearch>;

export function filterSessions(
  conversations: Conversation[] | undefined,
  { filter }: SessionSearch,
) {
  return conversations?.filter(item => item.mode === 'chat' && (!filter || item.liveStartedAt));
}

function sessionGroups(conversations: Conversation[]) {
  const date = new Date();
  const today = date.setHours(0, 0, 0, 0);
  const yesterday = date.setDate(date.getDate() - 1);

  const groups: Record<'直播场次' | '今天' | '昨天' | '更早', Conversation[]> = {
    直播场次: [],
    今天: [],
    昨天: [],
    更早: [],
  };

  const sorted = conversations.toSorted(
    (a, b) => (b.liveStartedAt ?? b.createdAt) - (a.liveStartedAt ?? a.createdAt),
  );

  for (const item of sorted) {
    if (item.liveStartedAt) {
      groups.直播场次.push(item);
      continue;
    }

    if (item.createdAt >= today) {
      groups.今天.push(item);
    } else if (item.createdAt >= yesterday) {
      groups.昨天.push(item);
    } else {
      groups.更早.push(item);
    }
  }

  return Object.entries(groups).filter(([, items]) => items.length > 0);
}

export function SessionList({
  conversations,
  search,
  error,
  create,
  creating,
}: {
  conversations?: Conversation[];
  search: SessionSearch;
  error?: Error | null;
  create: () => void;
  creating: boolean;
}) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const query = text.trim().toLocaleLowerCase();
  const matches = conversations?.filter(item => item.title.toLocaleLowerCase().includes(query));

  return (
    <aside id="workspace-list" className="secondary-pane" aria-label="会话列表">
      <div className="secondary-heading">
        <h2>会话</h2>
        <SessionFilter search={search} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="secondary-icon-button"
          aria-label="搜索会话"
          aria-expanded={searching}
          onClick={() => {
            setSearching(!searching);

            if (searching) {
              setText('');
            }
          }}
        >
          <Search />
        </Button>
      </div>
      {searching && (
        <InputGroup className="secondary-search h-8 rounded-lg">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={text}
            autoFocus
            onChange={event => setText(event.target.value)}
          />
        </InputGroup>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="secondary-primary-action"
        disabled={creating}
        onClick={create}
      >
        <Plus data-icon="inline-start" />
        新建会话
      </Button>
      {error && matches && (
        <p role="alert" className="text-destructive px-3 pb-2 text-xs">
          {error.message}
        </p>
      )}
      <div className="session-list min-h-0 flex-1 overflow-y-auto px-2">
        <SessionListContent matches={matches} query={query} search={search} error={error} />
      </div>
    </aside>
  );
}

function SessionFilter({ search }: { search: SessionSearch }) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="secondary-icon-button"
          data-filtered={Boolean(search.filter)}
          aria-label="筛选会话"
        >
          <ListFilter />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={search.filter ?? 'all'}
          onValueChange={value => {
            void navigate({
              to: '/chat',
              search: { filter: value === 'live' ? 'live' : undefined },
            });
          }}
        >
          <DropdownMenuRadioItem value="all">全部</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="live">直播</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionListContent({
  matches,
  error,
  query,
  search,
}: {
  matches?: Conversation[];
  error?: Error | null;
  query: string;
  search: SessionSearch;
}) {
  if (!matches) {
    return (
      <p role={error ? 'alert' : 'status'} className="text-muted-foreground px-2 py-4 text-xs">
        {error?.message ?? '正在读取会话…'}
      </p>
    );
  }

  if (matches.length === 0) {
    const empty = search.filter ? '暂无往期直播' : '还没有会话';

    return (
      <Empty className="gap-2 rounded-none px-4 py-8">
        <EmptyHeader className="gap-2">
          <EmptyMedia className="mb-0">
            <Messages size={20} color={kubaiMixed.empty} aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription className="text-xs">
            {query ? '没有匹配的会话' : empty}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return sessionGroups(matches).map(([label, items]) => (
    <Collapsible defaultOpen key={label}>
      <CollapsibleTrigger className="disclosure-trigger session-group-trigger">
        {label}
        <ChevronRight aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="disclosure-content grid gap-px pb-2">
        {items.map(item => (
          <SessionRow key={item.id} conversation={item} search={search} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  ));
}

function SessionRow({
  conversation,
  search,
}: {
  conversation: Conversation;
  search: SessionSearch;
}) {
  const { cards } = useReminderCards(conversation.id);
  const pending = cards.some(card => card.done && !card.verdict);

  return (
    <Link
      to="/chat/$id"
      params={{ id: conversation.id }}
      search={search}
      activeOptions={{ exact: true }}
      className="nav-item session-link"
      activeProps={{ 'data-current': true }}
    >
      <PlatformIcons platforms={conversation.livePlatforms} size={13} />
      <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
      {pending && <span className="session-reminder-dot" role="img" aria-label="有待处理提醒" />}
    </Link>
  );
}
