import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
        <CardDescription>
          Herald 的角色设定。pi 会在后面附上可用 skill 列表、APPEND_SYSTEM.md 与上下文文件。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data ? (
          <SystemPromptForm key={data.systemPrompt ?? '@default'} state={data} />
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
  const [draft, setDraft] = useState(state.systemPrompt ?? state.defaultSystemPrompt);
  const custom = state.systemPrompt !== null;
  const dirty = draft !== (state.systemPrompt ?? state.defaultSystemPrompt);
  let promptStatus = custom ? '已使用自定义提示词' : '使用默认提示词';

  if (save.isError) {
    promptStatus = save.error.message;
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={event => {
        event.preventDefault();
        const value = draft.trim();
        save.mutate({ systemPrompt: value && value !== state.defaultSystemPrompt ? value : null });
      }}
    >
      <Textarea
        aria-label="系统提示词"
        className="min-h-64 font-mono text-[13px] leading-relaxed"
        maxLength={8000}
        value={draft}
        onChange={event => setDraft(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!dirty || save.isPending}>
          保存
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={(!custom && !dirty) || save.isPending}
          onClick={() => {
            setDraft(state.defaultSystemPrompt);
            save.mutate({ systemPrompt: null });
          }}
        >
          <RotateCcw data-icon="inline-start" />
          恢复默认
        </Button>
        <span className="text-muted-foreground ml-auto text-xs" aria-live="polite">
          {promptStatus}
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
          <CardTitle>pi 资源目录</CardTitle>
          <CardDescription>
            结构与 ~/.pi/agent 相同，放入后在下一条消息生效：skills/、extensions/、mcp.json、
            settings.json、APPEND_SYSTEM.md。
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
  write: '允许 agent 新建或覆盖文件（pi write）',
  edit: '允许 agent 修改已有文件（pi edit）',
  exec: '允许 agent 执行 shell 命令（pi bash / powershell）',
};
