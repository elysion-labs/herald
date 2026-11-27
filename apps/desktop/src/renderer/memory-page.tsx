import { keepPreviousData, useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import Globe from 'kubai-icons-react/icons/globe';
import { ChevronRight, Plus, Quote, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { platformLabels, platforms } from '../shared/platforms.ts';
import { dialogOrigin } from './dialog-origin.ts';
import { kubaiMixed } from './kubai-colors.ts';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace, workspaceKey } from './workspace-context.ts';

const evidenceLabels = { manual: '手动录入', streamer: '主播提供', danmaku: '弹幕自述' };
const scopes = ['shared', ...platforms] as const;
const scopeLabels = { shared: '通用记忆', ...platformLabels };
const groupLabels = { shared: '通用', ...platformLabels };
type MemorySave = Omit<Parameters<typeof rpc.memory.save>[0], 'workspaceId'>;
type MemoryRemove = Omit<Parameters<typeof rpc.memory.remove>[0], 'workspaceId'>;
type MemoryRecord = Awaited<ReturnType<typeof rpc.memory.save>>;
type MemoryScope = MemorySave['scope'];

export function MemoryPage() {
  const { id: workspaceId } = useWorkspace();
  const [searchText, setSearchText] = useState('');
  const search = useDeferredValue(searchText.trim());
  const [selected, setSelected] = useState<{ scope: MemoryScope; id: string }>();
  const [collapsed, setCollapsed] = useState<MemoryScope[]>([]);

  const groups = useQueries({
    queries: scopes.map(scope => ({
      queryKey: [...workspaceKey(workspaceId), 'memory', scope, search],
      queryFn: async () =>
        search
          ? rpc.memory.search({ workspaceId, scope, query: search })
          : { matches: await rpc.memory.list({ workspaceId, scope }) },
      placeholderData: keepPreviousData,
    })),
  });

  const total = groups.reduce((sum, group) => sum + (group.data?.matches.length ?? 0), 0);

  const record = selected
    ? groups[scopes.indexOf(selected.scope)]?.data?.matches.find(item => item.id === selected.id)
    : undefined;

  return (
    <main className="surface-enter flex h-full min-h-0 w-full">
      <aside className="border-border flex w-80 shrink-0 flex-col border-r" aria-label="记忆列表">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
          <InputGroup className="h-8 flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索记忆"
              placeholder="搜索内容、原文或 UID"
              value={searchText}
              maxLength={240}
              onChange={event => setSearchText(event.target.value)}
            />
          </InputGroup>
          <CaptureDialog
            scope={selected?.scope ?? 'shared'}
            onSaved={saved => {
              setCollapsed(current => current.filter(item => item !== saved.scope));
              setSelected({ scope: saved.scope, id: saved.id });
              setSearchText('');
            }}
          />
        </div>
        <div className="memory-list grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-2 pb-2">
          {scopes.map((scope, index) => (
            <MemoryGroup
              key={scope}
              scope={scope}
              group={groups[index]}
              search={search}
              open={!collapsed.includes(scope)}
              selectedId={selected?.scope === scope ? selected.id : undefined}
              onOpenChange={next =>
                setCollapsed(current =>
                  next ? current.filter(item => item !== scope) : [...current, scope],
                )
              }
              onSelect={id => setSelected({ scope, id })}
            />
          ))}
        </div>
      </aside>
      <section className="memory-list flex min-w-0 flex-1 flex-col" aria-label="记忆详情">
        {record ? (
          <MemoryPreview key={record.id} record={record} onRemoved={() => setSelected(undefined)} />
        ) : (
          <p className="text-muted-foreground grid flex-1 place-items-center text-sm">
            {total ? '选择左侧记忆查看详情' : '暂无记忆'}
          </p>
        )}
      </section>
    </main>
  );
}

interface MemoryGroupQuery {
  data?: { matches: MemoryRecord[] };
  error: Error | null;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

function MemoryGroup({
  scope,
  group,
  search,
  open,
  selectedId,
  onOpenChange,
  onSelect,
}: {
  scope: MemoryScope;
  group?: MemoryGroupQuery;
  search: string;
  open: boolean;
  selectedId?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const records = group?.data?.matches ?? [];

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="memory-group-trigger">
        <ChevronRight className="memory-group-chevron" />
        <ScopeIcon scope={scope} />
        <span className="text-[13px] font-medium">{groupLabels[scope]}</span>
        <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">
          {group?.isSuccess ? records.length : ''}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="memory-group-content">
        <div className="grid gap-px pt-0.5 pb-1">
          <GroupStatus group={group} empty={!records.length} search={search} />
          {records.map(item => (
            <MemoryRow
              key={item.id}
              record={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupStatus({
  group,
  empty,
  search,
}: {
  group?: MemoryGroupQuery;
  empty: boolean;
  search: string;
}) {
  if (!group || group.isPending) {
    return (
      <p role="status" className="text-muted-foreground py-2 pl-9 text-xs">
        正在加载…
      </p>
    );
  }

  if (group.isError) {
    return (
      <p role="alert" className="text-destructive py-2 pl-9 text-xs">
        {group.error?.message}
      </p>
    );
  }

  return empty ? (
    <p className="text-muted-foreground py-2 pl-9 text-xs">{search ? '没有匹配' : '暂无记录'}</p>
  ) : null;
}

function MemoryRow({
  record,
  selected,
  onSelect,
}: {
  record: MemoryRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-selected={selected}
      aria-pressed={selected}
      className="memory-row hover:bg-secondary/60 data-[selected=true]:bg-secondary focus-visible:ring-ring grid min-w-0 gap-0.5 rounded-lg py-2 pr-2.5 pl-9 text-left transition-colors outline-none focus-visible:ring-1"
      onClick={onSelect}
    >
      <span className="line-clamp-2 text-[13px] leading-snug">{record.fact}</span>
      <span className="text-muted-foreground flex min-w-0 gap-1.5 text-[11px]">
        <span className="truncate">
          {record.viewerId ? `UID ${record.viewerId}` : evidenceLabels[record.evidence.type]}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">{shortDate(record.createdAt)}</span>
      </span>
    </button>
  );
}

function shortDate(timestamp: number) {
  const date = new Date(timestamp);

  return new Date().getFullYear() === date.getFullYear()
    ? date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : date.toLocaleDateString('zh-CN');
}

function ScopeIcon({ scope }: { scope: MemoryScope }) {
  return scope === 'shared' ? (
    <Globe size={16} color={kubaiMixed.globe} className="shrink-0" />
  ) : (
    <PlatformIcon platform={scope} size={16} />
  );
}

function ScopeSelect({
  value,
  onChange,
  id,
}: {
  value: MemoryScope;
  onChange: (scope: MemoryScope) => void;
  id?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={value => {
        const selected = scopes.find(scope => scope === value);

        if (selected) {
          onChange(selected);
        }
      }}
    >
      <SelectTrigger id={id} aria-label="归档范围">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          {scopes.map(scope => (
            <SelectItem value={scope} key={scope}>
              {scopeLabels[scope]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function CaptureDialog({
  scope,
  onSaved,
}: {
  scope: MemoryScope;
  onSaved: (record: MemoryRecord) => void;
}) {
  const client = useQueryClient();
  const { id: workspaceId } = useWorkspace();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<CSSProperties>();
  const [target, setTarget] = useState(scope);

  const save = useMutation({
    mutationFn: (input: MemorySave) => rpc.memory.save({ workspaceId, ...input }),
    async onSuccess(record) {
      setOpen(false);
      onSaved(record);
      await client.invalidateQueries({
        queryKey: [...workspaceKey(workspaceId), 'memory', record.scope],
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next) {
          setOrigin(dialogOrigin(trigger.current));
          setTarget(scope);
          save.reset();
        }

        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="手动录入记忆"
          title="手动录入"
        >
          <Plus />
        </Button>
      </DialogTrigger>
      <DialogContent className="login-dialog" style={origin}>
        <DialogHeader>
          <DialogTitle>手动录入记忆</DialogTitle>
          <DialogDescription>记录内容并附上来源原文。</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const viewerId = data.get('viewerId');
            const fact = data.get('fact');
            const quote = data.get('quote');

            if (typeof fact === 'string' && typeof quote === 'string') {
              save.mutate({
                scope: target,
                viewerId: typeof viewerId === 'string' ? viewerId : undefined,
                fact,
                quote,
              });
            }
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="memory-scope">归档范围</FieldLabel>
              <ScopeSelect id="memory-scope" value={target} onChange={setTarget} />
            </Field>
            {target !== 'shared' && (
              <Field>
                <FieldLabel htmlFor="memory-viewer">观众 UID</FieldLabel>
                <Input id="memory-viewer" name="viewerId" maxLength={128} required />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="memory-fact">记忆内容</FieldLabel>
              <Textarea id="memory-fact" name="fact" maxLength={500} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-quote">来源原文</FieldLabel>
              <Textarea id="memory-quote" name="quote" maxLength={1000} required />
            </Field>
            {save.isError && <FieldError>{save.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              保存记忆
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemoryPreview({ record, onRemoved }: { record: MemoryRecord; onRemoved: () => void }) {
  const client = useQueryClient();
  const { id: workspaceId } = useWorkspace();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const remove = useMutation({
    mutationFn: (input: MemoryRemove) => rpc.memory.remove({ workspaceId, ...input }),
    async onSuccess(_, input) {
      onRemoved();
      await client.invalidateQueries({
        queryKey: [...workspaceKey(workspaceId), 'memory', input.scope],
      });
    },
  });

  const created = new Date(record.createdAt);

  return (
    <>
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-5">
        <ScopeIcon scope={record.scope} />
        <span className="text-sm">{scopeLabels[record.scope]}</span>
        <div className="ml-auto flex items-center gap-1">
          {confirmRemove && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              取消
            </Button>
          )}
          <Button
            variant={confirmRemove ? 'destructive' : 'ghost'}
            size={confirmRemove ? 'sm' : 'icon-sm'}
            aria-label="删除记忆"
            title="删除记忆"
            disabled={remove.isPending}
            onClick={() => {
              if (confirmRemove) {
                remove.mutate({ scope: record.scope, id: record.id });
              } else {
                setConfirmRemove(true);
              }
            }}
          >
            <Trash2 />
            {confirmRemove && '确认删除'}
          </Button>
        </div>
      </div>
      <article className="memory-list min-h-0 flex-1 overflow-y-auto">
        <div className="surface-enter mx-auto grid max-w-2xl gap-8 px-8 py-10">
          <h2 className="text-xl leading-relaxed font-medium tracking-tight">{record.fact}</h2>
          {remove.isError && (
            <p role="alert" className="text-destructive text-sm">
              {remove.error.message}
            </p>
          )}
          <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">范围</dt>
            <dd>{scopeLabels[record.scope]}</dd>
            {record.viewerId && (
              <>
                <dt className="text-muted-foreground">观众 UID</dt>
                <dd className="tabular-nums">{record.viewerId}</dd>
              </>
            )}
            <dt className="text-muted-foreground">来源</dt>
            <dd>{evidenceLabels[record.evidence.type]}</dd>
            <dt className="text-muted-foreground">记录时间</dt>
            <dd className="tabular-nums">
              <time dateTime={created.toISOString()}>{created.toLocaleString('zh-CN')}</time>
            </dd>
          </dl>
          <figure className="grid gap-2">
            <figcaption className="text-muted-foreground text-xs">来源原文</figcaption>
            <blockquote className="bg-surface border-border relative rounded-xl border px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">
              <Quote className="text-muted-foreground/40 absolute top-3 right-3 size-4" />
              {record.quote}
            </blockquote>
          </figure>
        </div>
      </article>
    </>
  );
}
