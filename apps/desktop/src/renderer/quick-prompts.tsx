import type { LivePlatform } from '@herald/live';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Zap } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroupButton } from '@/components/ui/input-group';

import { platformLabels, platforms } from '../shared/platforms.ts';
import type { Conversation } from './assistant-mode.tsx';
import { useRoom } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';

type Profile = NonNullable<Awaited<ReturnType<typeof rpc.rooms.profile>>>;

/** 把主播资料写进消息正文，agent 记录通用记忆时可以直接引用其中的原文作为证据。 */
function profileText(profile: Profile) {
  const rows = [
    ['平台', platformLabels[profile.platform]],
    ['主播', profile.streamer],
    ['主播 UID', profile.streamerId],
    ['直播间', profile.roomId],
    ['直播标题', profile.title],
    ['分区', profile.area],
    ['标签', profile.tags.join('、')],
    ['粉丝数', profile.followers?.toString()],
    ['简介', profile.description],
    ['当前状态', profile.live === 'live' ? '直播中' : '未开播'],
  ].filter(([, value]) => value);

  return [
    '请根据下面的直播间资料分析这位主播：身份定位、内容方向、直播风格和可能的观众群体。',
    '把稳定、长期有用的背景整理成几条通用记忆（memory_remember，不带 viewerId），引文直接摘自下面的资料，来源 ID 用本条消息的来源 ID。',
    '如果需要更多信息，可以用浏览器查看直播间或主播主页，但记忆只记录资料里能找到原文的内容。',
    '',
    '【直播间资料】',
    ...rows.map(([label, value]) => `${label}：${value}`),
  ].join('\n');
}

const summaryPrompt =
  '总结本场直播到目前为止的情况：用 query_danmaku 的 timeline 和 viewers 统计看弹幕走势与活跃观众，归纳观众在聊的话题、互动高点和冷场时段，再给我接下来 2~3 条具体建议。';

function ProfileItem({
  platform,
  disabled,
  onSelect,
}: {
  platform: LivePlatform;
  disabled: boolean;
  onSelect: (platform: LivePlatform) => void;
}) {
  const { data: room } = useRoom(platform);

  return (
    <DropdownMenuItem disabled={disabled || !room} onSelect={() => onSelect(platform)}>
      <PlatformIcon platform={platform} size={16} />
      分析{platformLabels[platform]}主播信息
      {!room && <span className="text-muted-foreground ml-auto text-xs">未绑定</span>}
    </DropdownMenuItem>
  );
}

/** 输入框里的快捷指令：一键分析主播资料并整理成通用记忆、总结当前直播。 */
export function QuickPrompts({
  conversation,
  disabled,
  onSend,
}: {
  conversation?: Conversation;
  disabled: boolean;
  onSend: (text: string) => Promise<unknown>;
}) {
  const analyze = useMutation({
    async mutationFn(platform: LivePlatform) {
      const profile = await rpc.rooms.profile(platform);

      if (!profile) {
        throw new Error(`${platformLabels[platform]}还没有绑定直播间`);
      }

      await onSend(profileText(profile));
    },
  });

  const assistant = conversation?.mode === 'assistant' ? conversation.platform : null;
  const targets = assistant ? [assistant] : platforms;
  const busy = disabled || analyze.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          title={analyze.error?.message ?? '快捷指令'}
        >
          <Zap />
          快捷
          <ChevronDown data-icon="inline-end" />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-dropdown" side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>快捷指令</DropdownMenuLabel>
          {targets.map(platform => (
            <ProfileItem
              key={platform}
              platform={platform}
              disabled={busy}
              onSelect={target => analyze.mutate(target)}
            />
          ))}
          {assistant && (
            <DropdownMenuItem disabled={busy} onSelect={() => void onSend(summaryPrompt)}>
              总结当前直播
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
