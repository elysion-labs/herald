import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
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
import { rpc } from './rpc.ts';

const evidenceLabels = { manual: '手动录入', streamer: '主播提供', danmaku: '弹幕自述' };
const scopes = ['shared', ...platforms] as const;
const scopeLabels = { shared: '通用记忆', ...platformLabels };
type MemorySave = Parameters<typeof rpc.memory.save>[0];
type MemoryRemove = Parameters<typeof rpc.memory.remove>[0];
type MemoryRecord = Awaited<ReturnType<typeof rpc.memory.save>>;
type MemoryScope = MemorySave['scope'];

export function MemoryPage() {
  const [scope, setScope] = useState<MemoryScope>('shared');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>();

  const result = useQuery({
    queryKey: ['memory', scope, search],
    queryFn: async () =>
      search
        ? rpc.memory.search({ scope, query: search })
        : { matches: await rpc.memory.list(scope) },
  });

  const records = result.data?.matches ?? [];
  const selected = records.find(item => item.id === selectedId);

  return (
    <main className="page settings-page surface-enter">
      <div className="mx-auto max-w-3xl">
        <h1>记忆</h1>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            onSubmit={event => {
              event.preventDefault();
              setSearch(searchText.trim());
            }}
          >
            <ScopeSelect
              value={scope}
              onChange={value => {
                setScope(value);
                setSelectedId(undefined);
              }}
            />
            <Input
              aria-label="搜索记忆"
              className="min-w-32 flex-1"
              placeholder="搜索记忆"
              value={searchText}
              maxLength={240}
              onChange={event => setSearchText(event.target.value)}
            />
            <Button variant="outline" type="submit">
              搜索
            </Button>
          </form>
          <CaptureDialog
            scope={scope}
            onSaved={record => {
              setScope(record.scope);
              setSelectedId(record.id);
              setSearch('');
              setSearchText('');
            }}
          />
        </div>
        {result.isPending && (
          <p role="status" className="text-muted-foreground text-sm">
            正在加载记忆…
          </p>
        )}
        {result.isError && (
          <p role="alert" className="text-destructive text-sm">
            {result.error.message}
          </p>
        )}
        {result.isSuccess && !records.length && (
          <p className="text-muted-foreground text-sm">
            {search ? '没有匹配的记忆' : '还没有记录'}
          </p>
        )}
        <div className="grid gap-2">
          {records.map(record => (
            <Button
              key={record.id}
              variant={record.id === selectedId ? 'secondary' : 'outline'}
              className="h-auto w-full min-w-0 justify-start gap-2 px-3 py-2 text-left"
              aria-pressed={record.id === selectedId}
              onClick={() => setSelectedId(record.id)}
            >
              {record.viewerId && (
                <span className="text-muted-foreground truncate">{record.viewerId}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{record.fact}</span>
            </Button>
          ))}
        </div>
        {selected && (
          <MemoryPreview
            key={selected.id}
            record={selected}
            onRemoved={() => setSelectedId(undefined)}
          />
        )}
      </div>
    </main>
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
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<CSSProperties>();
  const [target, setTarget] = useState(scope);

  const save = useMutation({
    mutationFn: (input: MemorySave) => rpc.memory.save(input),
    async onSuccess(record) {
      setOpen(false);
      onSaved(record);
      await client.invalidateQueries({ queryKey: ['memory', record.scope] });
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
        <Button ref={trigger} variant="secondary">
          手动录入
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
  const [confirmRemove, setConfirmRemove] = useState(false);

  const remove = useMutation({
    mutationFn: (input: MemoryRemove) => rpc.memory.remove(input),
    async onSuccess(_, input) {
      onRemoved();
      await client.invalidateQueries({ queryKey: ['memory', input.scope] });
    },
  });

  return (
    <section className="border-border mt-4 rounded-xl border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {evidenceLabels[record.evidence.type]} · {new Date(record.createdAt).toLocaleString()}
        </p>
        <div className="flex gap-2">
          {confirmRemove && (
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              取消
            </Button>
          )}
          <Button
            variant={confirmRemove ? 'destructive' : 'ghost'}
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (confirmRemove) {
                remove.mutate({ scope: record.scope, id: record.id });
              } else {
                setConfirmRemove(true);
              }
            }}
          >
            {confirmRemove ? '确认删除' : '删除'}
          </Button>
        </div>
      </div>
      {remove.isError && (
        <p role="alert" className="text-destructive mb-2 text-sm">
          {remove.error.message}
        </p>
      )}
      <pre
        aria-label="记忆 Markdown"
        className="bg-muted/50 max-h-96 overflow-auto rounded-lg p-3 text-xs break-all whitespace-pre-wrap"
      >
        {record.markdown}
      </pre>
    </section>
  );
}
