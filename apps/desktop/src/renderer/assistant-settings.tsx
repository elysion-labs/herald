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
  step = 1,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
  /** 小于 1 时允许小数。 */
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));

  return (
    <Input
      id={id}
      type="number"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      step={step}
      className="w-24 text-right tabular-nums"
      min={min}
      max={max}
      disabled={disabled}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        const next = Number(draft);

        const valid = Number.isFinite(next) && (step < 1 || Number.isInteger(next));

        if (valid && next >= min && next <= max && next !== value) {
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

type Settings = AssistantSettings;
type Save = (input: Partial<Settings>) => void;

/** 规则下面的子项：开关或数字，缩进对齐在规则说明之下。 */
function SubField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 pl-11">
      <label htmlFor={id} className="text-muted-foreground text-sm">
        {label}
      </label>
      {children}
    </div>
  );
}

function InteractionSettings({ settings, save }: { settings: Settings; save: Save }) {
  const { gifts, entry, welcome } = settings;

  return (
    <>
      <RuleRow
        id="rule-gifts"
        label="礼物答谢"
        description="礼物达到金额（元）、醒目留言或上舰时，马上给出答谢话术，不受提醒间隔限制"
        checked={gifts.enabled}
        onCheckedChange={enabled => save({ gifts: { ...gifts, enabled } })}
      >
        <NumberSetting
          key={gifts.minValue}
          id="rule-gifts-min"
          value={gifts.minValue}
          min={0}
          max={100_000}
          step={0.1}
          disabled={!gifts.enabled}
          onCommit={minValue => save({ gifts: { ...gifts, minValue } })}
        />
      </RuleRow>
      <SubField id="rule-gifts-sc" label="醒目留言">
        <Switch
          id="rule-gifts-sc"
          checked={gifts.superChat}
          disabled={!gifts.enabled}
          onCheckedChange={superChat => save({ gifts: { ...gifts, superChat } })}
        />
      </SubField>
      <SubField id="rule-gifts-guard" label="上舰 / 开通大航海">
        <Switch
          id="rule-gifts-guard"
          checked={gifts.guard}
          disabled={!gifts.enabled}
          onCheckedChange={guard => save({ gifts: { ...gifts, guard } })}
        />
      </SubField>
      <RuleRow
        id="rule-entry"
        label="进场分析"
        description="满足任一条件的观众进场时，结合记忆和主页资料判断是否值得互动；同一观众每场一次"
        checked={entry.enabled}
        onCheckedChange={enabled => save({ entry: { ...entry, enabled } })}
      />
      <SubField id="rule-entry-memory" label="有记忆的观众">
        <Switch
          id="rule-entry-memory"
          checked={entry.withMemory}
          disabled={!entry.enabled}
          onCheckedChange={withMemory => save({ entry: { ...entry, withMemory } })}
        />
      </SubField>
      <SubField id="rule-entry-guard" label="大航海成员（B 站）">
        <Switch
          id="rule-entry-guard"
          checked={entry.guard}
          disabled={!entry.enabled}
          onCheckedChange={guard => save({ entry: { ...entry, guard } })}
        />
      </SubField>
      <SubField id="rule-entry-badge" label="粉丝牌 / 粉丝团等级不低于（0 关闭）">
        <NumberSetting
          key={entry.minBadgeLevel}
          id="rule-entry-badge"
          value={entry.minBadgeLevel}
          min={0}
          max={40}
          disabled={!entry.enabled}
          onCommit={minBadgeLevel => save({ entry: { ...entry, minBadgeLevel } })}
        />
      </SubField>
      <SubField id="rule-entry-pay" label="抖音财富等级不低于（0 关闭）">
        <NumberSetting
          key={entry.minPayLevel}
          id="rule-entry-pay"
          value={entry.minPayLevel}
          min={0}
          max={80}
          disabled={!entry.enabled}
          onCommit={minPayLevel => save({ entry: { ...entry, minPayLevel } })}
        />
      </SubField>
      <RuleRow
        id="rule-welcome"
        label="新观众欢迎"
        description="之前没有弹幕和记忆的观众第一次发言时，给出欢迎并接住话题的回应"
        checked={welcome.enabled}
        onCheckedChange={enabled => save({ welcome: { enabled } })}
      />
    </>
  );
}

function HeatSettings({ settings, save }: { settings: Settings; save: Save }) {
  const { heat } = settings;
  const update = (input: Partial<Settings['heat']>) => save({ heat: { ...heat, ...input } });

  return (
    <>
      <RuleRow
        id="rule-heat"
        label="热度变化"
        description="刚结束的一分钟弹幕量相对之前平均值突增或下滑时，提醒顺势展开或提前换话题"
        checked={heat.enabled}
        onCheckedChange={enabled => update({ enabled })}
      />
      <SubField id="rule-heat-window" label="对比之前的分钟数">
        <NumberSetting
          key={heat.windowMinutes}
          id="rule-heat-window"
          value={heat.windowMinutes}
          min={3}
          max={30}
          disabled={!heat.enabled}
          onCommit={windowMinutes => update({ windowMinutes })}
        />
      </SubField>
      <SubField id="rule-heat-spike" label="突增倍数">
        <NumberSetting
          key={heat.spikeRatio}
          id="rule-heat-spike"
          value={heat.spikeRatio}
          min={1.2}
          max={10}
          step={0.1}
          disabled={!heat.enabled}
          onCommit={spikeRatio => update({ spikeRatio })}
        />
      </SubField>
      <SubField id="rule-heat-drop" label="下滑比例">
        <NumberSetting
          key={heat.dropRatio}
          id="rule-heat-drop"
          value={heat.dropRatio}
          min={0}
          max={0.9}
          step={0.05}
          disabled={!heat.enabled}
          onCommit={dropRatio => update({ dropRatio })}
        />
      </SubField>
      <SubField id="rule-heat-min" label="平均每分钟至少多少条才判断">
        <NumberSetting
          key={heat.minPerMinute}
          id="rule-heat-min"
          value={heat.minPerMinute}
          min={1}
          max={1000}
          disabled={!heat.enabled}
          onCommit={minPerMinute => update({ minPerMinute })}
        />
      </SubField>
      <SubField id="rule-heat-cooldown" label="两次热度提醒的间隔（分钟）">
        <NumberSetting
          key={heat.cooldownMinutes}
          id="rule-heat-cooldown"
          value={heat.cooldownMinutes}
          min={1}
          max={60}
          disabled={!heat.enabled}
          onCommit={cooldownMinutes => update({ cooldownMinutes })}
        />
      </SubField>
    </>
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

  const { silence, memoryViewers, keywords, periodic, liveStart, liveEnd } = settings;

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
          id="rule-live-start"
          label="开播话题推荐"
          description="点击「开播」后结合记忆、待办、历史场次和平台热门，推荐本场可以聊的话题"
          checked={liveStart.enabled}
          onCheckedChange={enabled => save.mutate({ liveStart: { enabled } })}
        />
        <RuleRow
          id="rule-live-end"
          label="下播复盘"
          description="点击「下播」后总结本场弹幕走势、活跃观众、亮点和待办，并给下一场建议；之后本场转为普通会话"
          checked={liveEnd.enabled}
          onCheckedChange={enabled => save.mutate({ liveEnd: { enabled } })}
        />
        <InteractionSettings settings={settings} save={input => save.mutate(input)} />
        <HeatSettings settings={settings} save={input => save.mutate(input)} />
        <RuleRow
          id="rule-silence"
          label="冷场提醒"
          description="直播中连续一段时间没有新弹幕时，给出接话或暖场的建议；未开播时不提醒（秒）"
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
          description="有记忆的观众发弹幕时，提醒主播并给出回应建议（同一观众的提醒间隔，分钟）"
          checked={memoryViewers.enabled}
          onCheckedChange={enabled => save.mutate({ memoryViewers: { ...memoryViewers, enabled } })}
        >
          <NumberSetting
            key={memoryViewers.cooldownMinutes}
            id="rule-viewers-cooldown"
            value={memoryViewers.cooldownMinutes}
            min={1}
            max={240}
            disabled={!memoryViewers.enabled}
            onCommit={cooldownMinutes =>
              save.mutate({ memoryViewers: { ...memoryViewers, cooldownMinutes } })
            }
          />
        </RuleRow>
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
          description="每隔一段时间总结弹幕关注点并给出建议（分钟）"
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
            <FieldLabel htmlFor="rule-periodic-min">定时分析的最少弹幕数</FieldLabel>
            <FieldDescription>一个周期内新弹幕少于这个数时跳过分析</FieldDescription>
          </FieldContent>
          <NumberSetting
            key={periodic.minMessages}
            id="rule-periodic-min"
            value={periodic.minMessages}
            min={1}
            max={500}
            disabled={!periodic.enabled}
            onCommit={minMessages => save.mutate({ periodic: { ...periodic, minMessages } })}
          />
        </Field>
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
