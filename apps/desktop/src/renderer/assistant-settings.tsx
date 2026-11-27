import type { LiveCapability, LivePlatformInfo } from '@herald/live';
import type { AssistantSettings } from '@herald/live-assistant/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

import { useRooms } from './live-status.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace, workspaceKey } from './workspace-context.ts';

const capabilitiesQuery = {
  queryKey: ['live-capabilities'],
  queryFn: () => rpc.live.capabilities(),
  staleTime: Infinity,
};

interface Availability {
  disabled: boolean;
  notice?: string;
}

function platformAvailability(
  platforms: readonly LivePlatformInfo[],
  feature: string,
  supported: (capabilities: LivePlatformInfo['capabilities']) => boolean,
): Availability {
  const unsupported = platforms.filter(({ capabilities }) => !supported(capabilities));
  const names = unsupported.map(({ label }) => label).join('、');

  return {
    disabled: unsupported.length === platforms.length,
    notice: names ? `${names}暂不支持${feature}。` : undefined,
  };
}

function capabilityAvailability(
  platforms: readonly LivePlatformInfo[],
  feature: string,
  ...required: LiveCapability[]
) {
  return platformAvailability(platforms, feature, capabilities =>
    required.every(capability => capabilities[capability]),
  );
}

function useAssistantSettings() {
  const client = useQueryClient();
  const { id: workspaceId } = useWorkspace();
  const queryKey = [...workspaceKey(workspaceId), 'assistant-settings'];
  const query = useQuery({ queryKey, queryFn: () => rpc.assistant.settings({ workspaceId }) });

  const save = useMutation({
    mutationFn: (input: Partial<AssistantSettings>) =>
      rpc.assistant.saveSettings({ workspaceId, settings: input }),
    onSuccess: saved => client.setQueryData(queryKey, saved),
  });

  return { query, save };
}

/** 失焦时提交的数字输入；非法值回退为当前值。 */
function NumberSetting({
  id,
  descriptionId,
  value,
  min,
  max,
  disabled,
  onCommit,
  step = 1,
}: {
  id: string;
  descriptionId?: string;
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
      aria-describedby={descriptionId}
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
  availability,
  children,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  availability?: Availability;
  children?: React.ReactNode;
}) {
  return (
    <Field orientation="horizontal" data-disabled={availability?.disabled}>
      <Switch
        id={id}
        checked={checked && !availability?.disabled}
        disabled={availability?.disabled}
        aria-describedby={`${id}-description`}
        onCheckedChange={onCheckedChange}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription id={`${id}-description`}>
          {description}
          {availability?.notice ? ` ${availability.notice}` : ''}
        </FieldDescription>
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
  notice,
  children,
}: {
  id: string;
  label: string;
  notice?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 pl-11">
      <div className="text-muted-foreground flex flex-col gap-1 text-sm">
        <label htmlFor={id}>{label}</label>
        {notice && <FieldDescription id={`${id}-capability`}>{notice}</FieldDescription>}
      </div>
      {children}
    </div>
  );
}

interface InteractionSettingsProps {
  settings: Settings;
  save: Save;
  platforms: readonly LivePlatformInfo[];
}

function GiftSettings({ settings: { gifts }, save, platforms }: InteractionSettingsProps) {
  const thanks = platformAvailability(
    platforms,
    '礼物答谢',
    caps => caps.gift || caps.superChat || caps.guard,
  );

  const gift = capabilityAvailability(platforms, '礼物事件', 'gift');
  const superChat = capabilityAvailability(platforms, '醒目留言', 'superChat');
  const guard = capabilityAvailability(platforms, '上舰事件', 'guard');

  return (
    <>
      <RuleRow
        id="rule-gifts"
        label="礼物答谢"
        description="礼物达到金额、收到醒目留言或上舰时，马上给出答谢话术，不受提醒间隔限制"
        availability={thanks}
        checked={gifts.enabled}
        onCheckedChange={enabled => save({ gifts: { ...gifts, enabled } })}
      />
      <SubField id="rule-gifts-min" label="礼物最低金额（元）" notice={gift.notice}>
        <NumberSetting
          key={gifts.minValue}
          id="rule-gifts-min"
          descriptionId={gift.notice ? 'rule-gifts-min-capability' : undefined}
          value={gifts.minValue}
          min={0}
          max={100_000}
          step={0.1}
          disabled={!gifts.enabled || gift.disabled}
          onCommit={minValue => save({ gifts: { ...gifts, minValue } })}
        />
      </SubField>
      <SubField id="rule-gifts-sc" label="醒目留言" notice={superChat.notice}>
        <Switch
          id="rule-gifts-sc"
          checked={gifts.superChat && !superChat.disabled}
          disabled={!gifts.enabled || superChat.disabled}
          aria-describedby={superChat.notice ? 'rule-gifts-sc-capability' : undefined}
          onCheckedChange={superChat => save({ gifts: { ...gifts, superChat } })}
        />
      </SubField>
      <SubField id="rule-gifts-guard" label="上舰 / 开通大航海" notice={guard.notice}>
        <Switch
          id="rule-gifts-guard"
          checked={gifts.guard && !guard.disabled}
          disabled={!gifts.enabled || guard.disabled}
          aria-describedby={guard.notice ? 'rule-gifts-guard-capability' : undefined}
          onCheckedChange={guard => save({ gifts: { ...gifts, guard } })}
        />
      </SubField>
    </>
  );
}

function EntrySettings({ settings: { entry }, save, platforms }: InteractionSettingsProps) {
  const entryEvent = capabilityAvailability(platforms, '进场事件', 'entry');
  const viewerProfile = capabilityAvailability(platforms, '观众主页', 'viewerProfile');
  const entryGuard = capabilityAvailability(platforms, '进场大航海条件', 'entry', 'guard');
  const badge = capabilityAvailability(platforms, '进场粉丝牌等级条件', 'entry', 'badgeLevel');
  const pay = capabilityAvailability(platforms, '进场荣耀 / 财富等级条件', 'entry', 'payLevel');

  return (
    <>
      <RuleRow
        id="rule-entry"
        label="进场分析"
        description={`满足任一条件的观众进场时，结合记忆、弹幕和可用的主页资料判断是否值得互动。同一观众每场一次。${viewerProfile.notice ?? ''}`}
        availability={entryEvent}
        checked={entry.enabled}
        onCheckedChange={enabled => save({ entry: { ...entry, enabled } })}
      />
      <SubField id="rule-entry-memory" label="有记忆的观众">
        <Switch
          id="rule-entry-memory"
          checked={entry.withMemory && !entryEvent.disabled}
          disabled={!entry.enabled || entryEvent.disabled}
          onCheckedChange={withMemory => save({ entry: { ...entry, withMemory } })}
        />
      </SubField>
      <SubField id="rule-entry-guard" label="大航海成员" notice={entryGuard.notice}>
        <Switch
          id="rule-entry-guard"
          checked={entry.guard && !entryGuard.disabled}
          disabled={!entry.enabled || entryGuard.disabled}
          aria-describedby={entryGuard.notice ? 'rule-entry-guard-capability' : undefined}
          onCheckedChange={guard => save({ entry: { ...entry, guard } })}
        />
      </SubField>
      <SubField
        id="rule-entry-badge"
        label="粉丝牌 / 粉丝团等级不低于（0 关闭）"
        notice={badge.notice}
      >
        <NumberSetting
          key={entry.minBadgeLevel}
          id="rule-entry-badge"
          descriptionId={badge.notice ? 'rule-entry-badge-capability' : undefined}
          value={entry.minBadgeLevel}
          min={0}
          max={40}
          disabled={!entry.enabled || badge.disabled}
          onCommit={minBadgeLevel => save({ entry: { ...entry, minBadgeLevel } })}
        />
      </SubField>
      <SubField id="rule-entry-pay" label="荣耀 / 财富等级不低于（0 关闭）" notice={pay.notice}>
        <NumberSetting
          key={entry.minPayLevel}
          id="rule-entry-pay"
          descriptionId={pay.notice ? 'rule-entry-pay-capability' : undefined}
          value={entry.minPayLevel}
          min={0}
          max={80}
          disabled={!entry.enabled || pay.disabled}
          onCommit={minPayLevel => save({ entry: { ...entry, minPayLevel } })}
        />
      </SubField>
    </>
  );
}

function HeatSettings({
  settings,
  save,
  availability,
}: {
  settings: Settings;
  save: Save;
  availability: Availability;
}) {
  const { heat } = settings;
  const update = (input: Partial<Settings['heat']>) => save({ heat: { ...heat, ...input } });
  const disabled = !heat.enabled || availability.disabled;

  return (
    <>
      <RuleRow
        id="rule-heat"
        label="热度变化"
        description="刚结束的一分钟弹幕量相对之前平均值突增或下滑时，提醒顺势展开或提前换话题"
        availability={availability}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          onCommit={cooldownMinutes => update({ cooldownMinutes })}
        />
      </SubField>
    </>
  );
}

export function AssistantSettingsPanel() {
  const { query, save } = useAssistantSettings();
  const capabilities = useQuery(capabilitiesQuery);
  const rooms = useRooms();
  const settings = query.data;

  const platforms = capabilities.data?.filter(platform =>
    rooms.data?.some(room => room.platform === platform.id),
  );

  const error = query.error ?? capabilities.error ?? rooms.error;

  if (!settings || !platforms || !rooms.data) {
    return (
      <p role={error ? 'alert' : 'status'} className="text-muted-foreground text-sm">
        {error?.message ?? '正在加载…'}
      </p>
    );
  }

  return (
    <AssistantSettingsCard
      settings={settings}
      save={save.mutate}
      platforms={platforms}
      error={save.error}
    />
  );
}

function AssistantSettingsCard({
  settings,
  save,
  platforms,
  error,
}: InteractionSettingsProps & { error: Error | null }) {
  const { name } = useWorkspace();
  const { silence, memoryViewers, keywords, periodic, liveStart, liveEnd, welcome } = settings;
  const danmaku = capabilityAvailability(platforms, '弹幕', 'danmaku');
  const welcomeEvent = capabilityAvailability(platforms, '新观众欢迎', 'danmaku', 'welcome');
  const interactionProps = { settings, save, platforms };

  return (
    <Card>
      <CardHeader>
        <CardTitle>直播助手</CardTitle>
        <CardDescription>当前工作区 · {name}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {!platforms.length && (
          <p className="text-muted-foreground text-sm">绑定直播间后可以配置对应的提醒。</p>
        )}
        <RuleRow
          id="rule-live-start"
          label="开播话题推荐"
          description="点击「开播」后结合记忆、待办、历史场次和平台热门，推荐本场可以聊的话题"
          availability={danmaku}
          checked={liveStart.enabled}
          onCheckedChange={enabled => save({ liveStart: { enabled } })}
        />
        <RuleRow
          id="rule-live-end"
          label="下播复盘"
          description="点击「下播」后总结本场弹幕走势、活跃观众、亮点和待办，并给下一场建议；之后本场转为普通会话"
          availability={danmaku}
          checked={liveEnd.enabled}
          onCheckedChange={enabled => save({ liveEnd: { enabled } })}
        />
        <GiftSettings {...interactionProps} />
        <EntrySettings {...interactionProps} />
        <RuleRow
          id="rule-welcome"
          label="新观众欢迎"
          description="之前没有弹幕和记忆的观众第一次发言时，给出欢迎并接住话题的回应"
          availability={welcomeEvent}
          checked={welcome.enabled}
          onCheckedChange={enabled => save({ welcome: { enabled } })}
        />
        <HeatSettings settings={settings} save={save} availability={danmaku} />
        <RuleRow
          id="rule-silence"
          label="冷场提醒"
          description="直播中连续一段时间没有新弹幕时，给出接话或暖场的建议；未开播时不提醒（秒）"
          availability={danmaku}
          checked={silence.enabled}
          onCheckedChange={enabled => save({ silence: { ...silence, enabled } })}
        >
          <NumberSetting
            key={silence.seconds}
            id="rule-silence-seconds"
            value={silence.seconds}
            min={30}
            max={1800}
            disabled={!silence.enabled || danmaku.disabled}
            onCommit={seconds => save({ silence: { ...silence, seconds } })}
          />
        </RuleRow>
        <RuleRow
          id="rule-viewers"
          label="记忆观众发言"
          description="有记忆的观众发弹幕时，提醒主播并给出回应建议（同一观众的提醒间隔，分钟）"
          availability={danmaku}
          checked={memoryViewers.enabled}
          onCheckedChange={enabled => save({ memoryViewers: { ...memoryViewers, enabled } })}
        >
          <NumberSetting
            key={memoryViewers.cooldownMinutes}
            id="rule-viewers-cooldown"
            value={memoryViewers.cooldownMinutes}
            min={1}
            max={240}
            disabled={!memoryViewers.enabled || danmaku.disabled}
            onCommit={cooldownMinutes =>
              save({ memoryViewers: { ...memoryViewers, cooldownMinutes } })
            }
          />
        </RuleRow>
        <RuleRow
          id="rule-keywords"
          label="关注词"
          description="弹幕包含下列词语时提醒，用逗号分隔"
          availability={danmaku}
          checked={keywords.enabled}
          onCheckedChange={enabled => save({ keywords: { ...keywords, enabled } })}
        />
        <Input
          key={keywords.words.join(',')}
          aria-label="关注词"
          placeholder="例如：抽奖，上舰，下播"
          disabled={!keywords.enabled || danmaku.disabled}
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

            save({ keywords: { ...keywords, words } });
          }}
        />
        <RuleRow
          id="rule-periodic"
          label="定时分析"
          description="每隔一段时间总结弹幕关注点并给出建议（分钟）"
          availability={danmaku}
          checked={periodic.enabled}
          onCheckedChange={enabled => save({ periodic: { ...periodic, enabled } })}
        >
          <NumberSetting
            key={periodic.minutes}
            id="rule-periodic-minutes"
            value={periodic.minutes}
            min={1}
            max={60}
            disabled={!periodic.enabled || danmaku.disabled}
            onCommit={minutes => save({ periodic: { ...periodic, minutes } })}
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
            disabled={!periodic.enabled || danmaku.disabled}
            onCommit={minMessages => save({ periodic: { ...periodic, minMessages } })}
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
            disabled={danmaku.disabled}
            onCommit={cooldownSeconds => save({ cooldownSeconds })}
          />
        </Field>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
