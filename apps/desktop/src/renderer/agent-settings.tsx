import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Eraser, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { builtinToolLabels, builtinTools } from '../shared/agent-settings.ts';
import type { AgentSettings } from '../shared/agent-settings.ts';
import { rpc } from './rpc.ts';

export const agentSettingsQuery = {
  queryKey: ['agent-settings'],
  queryFn: () => rpc.settings.agent(),
};

type AgentState = Awaited<ReturnType<typeof rpc.settings.agent>>;

function useSaveAgent() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<AgentSettings>) => rpc.settings.saveAgent(input),
    onSuccess(saved) {
      client.setQueryData<AgentState>(agentSettingsQuery.queryKey, current =>
        current ? { ...current, ...saved } : current,
      );
    },
  });
}

export function SystemPromptSettings() {
  const { data, error } = useQuery(agentSettingsQuery);

  return (
    <Card>
      <CardHeader>
        <CardTitle>系统提示词</CardTitle>
        <CardDescription>Herald 始终使用内置提示词。你可以追加适合自己直播的要求。</CardDescription>
      </CardHeader>
      <CardContent>
        {data ? (
          <SystemPromptForm key={data.systemPromptExtra} state={data} />
        ) : (
          <p role={error ? 'alert' : 'status'} className="text-muted-foreground text-sm">
            {error?.message ?? '正在加载…'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SystemPromptForm({ state }: { state: AgentState }) {
  const save = useSaveAgent();
  const [draft, setDraft] = useState(state.systemPromptExtra);
  const value = draft.trim();
  const dirty = value !== state.systemPromptExtra;

  return (
    <form
      className="grid gap-3"
      onSubmit={event => {
        event.preventDefault();

        if (dirty && !save.isPending) {
          save.mutate({ systemPromptExtra: value });
        }
      }}
    >
      <Collapsible>
        <CollapsibleTrigger className="disclosure-trigger group/trigger">
          <ChevronRight aria-hidden="true" />
          <span>内置提示词</span>
          <span className="text-muted-foreground text-xs">只读</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="disclosure-content">
          <Textarea
            readOnly
            aria-label="内置提示词（只读）"
            className="text-muted-foreground mt-2 max-h-64 min-h-32 overflow-auto leading-relaxed"
            value={state.defaultSystemPrompt}
          />
        </CollapsibleContent>
      </Collapsible>
      <Field>
        <FieldLabel htmlFor="system-prompt-extra">扩展提示词</FieldLabel>
        <Textarea
          id="system-prompt-extra"
          className="min-h-32"
          placeholder="补充直播风格、称呼习惯或需要避开的内容"
          maxLength={8000}
          value={draft}
          disabled={save.isPending}
          onChange={event => setDraft(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!dirty || save.isPending}>
          保存
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={(!draft && !state.systemPromptExtra) || save.isPending}
          onClick={() => {
            setDraft('');

            if (state.systemPromptExtra) {
              save.mutate({ systemPromptExtra: '' });
            }
          }}
        >
          <Eraser data-icon="inline-start" />
          清空
        </Button>
        <span className="text-muted-foreground ml-auto text-xs" aria-live="polite">
          {save.error?.message}
        </span>
      </div>
    </form>
  );
}

export function AgentCapabilitySettings() {
  const { data, error } = useQuery(agentSettingsQuery);
  const save = useSaveAgent();

  if (!data) {
    return (
      <p role={error ? 'alert' : 'status'} className="text-muted-foreground text-sm">
        {error?.message ?? '正在加载…'}
      </p>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>内置工具</CardTitle>
          <CardDescription>
            这些工具能修改本机文件或执行命令，默认关闭。开启后对之后发送的消息生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {builtinTools.map(tool => (
            <Field key={tool} orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`builtin-${tool}`}>{builtinToolLabels[tool]}</FieldLabel>
                <FieldDescription>{toolHints[tool]}</FieldDescription>
              </FieldContent>
              <Switch
                id={`builtin-${tool}`}
                checked={data.builtinTools[tool]}
                disabled={save.isPending}
                onCheckedChange={checked =>
                  save.mutate({ builtinTools: { ...data.builtinTools, [tool]: checked } })
                }
              />
            </Field>
          ))}
          {save.isError && (
            <p role="alert" className="text-destructive text-sm">
              {save.error.message}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Agent 资源目录</CardTitle>
          <CardDescription>
            可添加技能（skills/）、扩展（extensions/）、MCP 配置（mcp.json）、运行设置
            （settings.json）和附加提示词（APPEND_SYSTEM.md）。变更在下一条消息生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-xs">
            {data.agentDir}
          </code>
          <Button type="button" variant="outline" onClick={() => void rpc.settings.openAgentDir()}>
            <FolderOpen data-icon="inline-start" />
            打开目录
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

const toolHints: Record<(typeof builtinTools)[number], string> = {
  write: '允许 Agent 新建或覆盖文件',
  edit: '允许 Agent 修改已有文件',
  exec: '允许 Agent 执行终端命令',
};
