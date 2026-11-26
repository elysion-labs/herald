import type { AssistantSettings } from '@herald/live-assistant/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

import { rpc } from './rpc.ts';

const queryKey = ['assistant-settings'];

function useAssistantSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey, queryFn: () => rpc.assistant.settings() });

  const save = useMutation({
    mutationFn: (input: Partial<AssistantSettings>) => rpc.assistant.saveSettings(input),
    onSuccess: saved => client.setQueryData(queryKey, saved),
  });

  return { query, save };
}

/** 失焦时提交的数字输入；非法值回退为当前值。 */
function NumberSetting({
  id,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      className="w-24 text-right tabular-nums"
      min={min}
      max={max}
      disabled={disabled}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        const next = Number(draft);

        if (Number.isInteger(next) && next >= min && next <= max && next !== value) {
          onCommit(next);
        } else {
          setDraft(String(value));
        }
      }}
    />
  );
}

function RuleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <Field orientation="horizontal">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      {children}
    </Field>
  );
}

export function AssistantSettingsPanel() {
  const { query, save } = useAssistantSettings();
  const settings = query.data;

  if (!settings) {
    return (
      <p role={query.isError ? 'alert' : 'status'} className="text-muted-foreground text-sm">
        {query.error?.message ?? '正在加载…'}
      </p>
    );
  }

  const { silence, memoryViewers, keywords, periodic } = settings;

  return (
    <Card>
      <CardHeader>
        <CardTitle>直播助手</CardTitle>
        <CardDescription>
          只对侧栏顶部的平台助手会话生效：满足下列条件时，Herald 会结合新弹幕和记忆主动给出建议。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <RuleRow
          id="rule-silence"
          label="冷场提醒"
          description="直播间连续一段时间没有新弹幕时，给出接话或暖场的建议（秒）"
          checked={silence.enabled}
          onCheckedChange={enabled => save.mutate({ silence: { ...silence, enabled } })}
        >
          <NumberSetting
            key={silence.seconds}
            id="rule-silence-seconds"
            value={silence.seconds}
            min={30}
            max={1800}
            disabled={!silence.enabled}
            onCommit={seconds => save.mutate({ silence: { ...silence, seconds } })}
          />
        </RuleRow>
        <RuleRow
          id="rule-viewers"
          label="记忆观众发言"
          description="有记忆的观众发弹幕时，提醒主播并给出回应建议（同一观众 10 分钟一次）"
          checked={memoryViewers.enabled}
          onCheckedChange={enabled => save.mutate({ memoryViewers: { enabled } })}
        />
        <RuleRow
          id="rule-keywords"
          label="关注词"
          description="弹幕包含下列词语时提醒，用逗号分隔"
          checked={keywords.enabled}
          onCheckedChange={enabled => save.mutate({ keywords: { ...keywords, enabled } })}
        />
        <Input
          key={keywords.words.join(',')}
          aria-label="关注词"
          placeholder="例如：抽奖，上舰，下播"
          disabled={!keywords.enabled}
          defaultValue={keywords.words.join('，')}
          onBlur={event => {
            const words = [
              ...new Set(
                event.target.value
                  .split(/[,，、\s]+/)
                  .map(word => word.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 50);

            save.mutate({ keywords: { ...keywords, words } });
          }}
        />
        <RuleRow
          id="rule-periodic"
          label="定时分析"
          description="每隔一段时间总结弹幕关注点并给出建议，期间至少 3 条新弹幕才会分析（分钟）"
          checked={periodic.enabled}
          onCheckedChange={enabled => save.mutate({ periodic: { ...periodic, enabled } })}
        >
          <NumberSetting
            key={periodic.minutes}
            id="rule-periodic-minutes"
            value={periodic.minutes}
            min={1}
            max={60}
            disabled={!periodic.enabled}
            onCommit={minutes => save.mutate({ periodic: { ...periodic, minutes } })}
          />
        </RuleRow>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rule-cooldown">提醒间隔</FieldLabel>
            <FieldDescription>两次提醒之间至少间隔的秒数，避免打扰</FieldDescription>
          </FieldContent>
          <NumberSetting
            key={settings.cooldownSeconds}
            id="rule-cooldown"
            value={settings.cooldownSeconds}
            min={15}
            max={3600}
            onCommit={cooldownSeconds => save.mutate({ cooldownSeconds })}
          />
        </Field>
        {save.isError && (
          <p role="alert" className="text-destructive text-sm">
            {save.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
