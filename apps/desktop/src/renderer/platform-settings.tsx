import type { LivePlatform } from '@herald/live';
import { useQuery } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import { platformLabels, platforms } from '../shared/platforms.ts';
import { PlatformIcon } from './platform-icon.tsx';
import { RoomBinding } from './room-binding.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace } from './workspace-context.ts';

export const platformAccountKey = ['platform-account'];
type OpenLogin = (platform: LivePlatform, trigger: HTMLButtonElement) => void;

export function PlatformSettings({ openLogin }: { openLogin: OpenLogin }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>平台账号</CardTitle>
        <CardDescription>登录状态在所有工作区的浏览器与弹幕连接间共享。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <PlatformAccount platform="bilibili" openLogin={openLogin} />
        </div>
        <Separator />
        <div className="grid gap-2">
          <PlatformAccount platform="douyin" openLogin={openLogin} />
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkspaceRoomSettings() {
  const { name } = useWorkspace();

  return (
    <Card>
      <CardHeader>
        <CardTitle>直播间绑定</CardTitle>
        <CardDescription>当前工作区 · {name}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {platforms.map(platform => (
          <RoomBinding key={platform} platform={platform} />
        ))}
      </CardContent>
    </Card>
  );
}

function PlatformAccount({
  platform,
  openLogin,
}: {
  platform: LivePlatform;
  openLogin: OpenLogin;
}) {
  const query = useQuery({
    queryKey: [...platformAccountKey, platform],
    queryFn: ({ signal }) => rpc.platforms.account(platform, { signal }),
    refetchInterval: 30000,
  });

  const account = query.data;
  const signedIn = account?.status === 'signed-in';
  const label = platformLabels[platform];
  let detail = '正在检查登录状态…';

  if (signedIn) {
    detail =
      [account.name, account.id && `UID ${account.id}`].filter(Boolean).join(' · ') || '已登录';
  } else if (account?.status === 'signed-out') {
    detail = '未登录';
  } else if (query.isError || account?.status === 'unavailable') {
    detail = '暂时无法验证账号';
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar size="lg">
        <AvatarFallback>
          <PlatformIcon platform={platform} size={22} />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground truncate text-sm" title={detail} aria-live="polite">
          {detail}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`刷新${label}账号`}
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        <RotateCw />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={event => openLogin(platform, event.currentTarget)}
      >
        {signedIn ? '管理登录' : '登录'}
      </Button>
    </div>
  );
}
