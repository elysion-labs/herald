import type { LivePlatform } from '@herald/live';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { platformLabels } from '../shared/platforms.ts';
import type { Conversation } from './assistant-mode.tsx';
import { useRooms } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace } from './workspace-context.ts';

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
  const label = `分析${platformLabels[platform]}主播信息`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem disabled={disabled} onSelect={() => onSelect(platform)}>
          <PlatformIcon platform={platform} size={16} />
          <span className="min-w-0 truncate">{label}</span>
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** 输入框里的快捷指令：一键分析主播资料并整理成通用记忆、总结当前直播。 */
export function QuickPrompts({
  conversation,
  disabled,
  side,
  onProblem,
  onSend,
}: {
  conversation?: Conversation;
  disabled: boolean;
  side: 'top' | 'bottom';
  onProblem: (message: string) => void;
  onSend: (text: string) => Promise<unknown>;
}) {
  const { id: workspaceId } = useWorkspace();
  const { data: rooms } = useRooms();

  const analyze = useMutation({
    async mutationFn(platform: LivePlatform) {
      const profile = await rpc.rooms.profile({ workspaceId, platform });

      if (!profile) {
        throw new Error(`${platformLabels[platform]}还没有绑定直播间`);
      }

      return profileText(profile);
    },
    onSuccess: message => void onSend(message).catch(() => undefined),
    onError: error => onProblem(error.message),
  });

  const targets = rooms?.map(room => room.platform) ?? [];

  const canSummarize =
    conversation?.mode === 'assistant' &&
    (targets.length > 0 || conversation.liveStartedAt !== null);

  const busy = disabled || analyze.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          type="button"
          variant="ghost"
          size="xs"
          className="composer-action"
          disabled={busy}
        >
          <Zap />
          快捷
          <ChevronDown data-icon="inline-end" />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52" side={side} align="start">
        <TooltipProvider delayDuration={520}>
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
            {canSummarize && (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => void onSend(summaryPrompt).catch(() => undefined)}
              >
                <Zap aria-hidden="true" />
                总结当前直播
              </DropdownMenuItem>
            )}
            {!targets.length && !canSummarize && (
              <DropdownMenuItem asChild>
                <Link to="/settings" search={{ section: 'rooms' }}>
                  绑定直播间以分析主播
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
