import type { LivePlatform } from '@herald/live';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Badge } from '@/components/ui/badge';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

import { platformLabels } from '../shared/platforms.ts';
import { dialogOrigin } from './dialog-origin.ts';
import { roomsKey, statusLabels, StatusDot, useRooms } from './live-status.tsx';
import type { Room } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { conversationsKey, useWorkspace } from './workspace-context.ts';

export function RoomBinding({ platform }: { platform: LivePlatform }) {
  const client = useQueryClient();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<CSSProperties>();
  const { id: workspaceId } = useWorkspace();
  const { data: rooms, error, isPending } = useRooms();
  const data = rooms?.find(room => room.platform === platform);
  const name = platformLabels[platform];

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next) {
          setOrigin(dialogOrigin(trigger.current));
        }

        setOpen(next);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PlatformIcon platform={platform} size={18} />
        <div className="mr-auto min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {data ? `直播间 ${data.roomId}` : (error?.message ?? '未绑定直播间')}
          </p>
        </div>
        {data && <RoomStatus room={data} />}
        <DialogTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="sm"
            aria-label={`管理${name}直播间`}
            disabled={isPending}
          >
            {data ? '管理' : '绑定'}
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="login-dialog" style={origin}>
        <DialogHeader>
          <DialogTitle>{name}直播间</DialogTitle>
          <DialogDescription>绑定仅对当前工作区生效。直播结束后可以更换或解绑。</DialogDescription>
        </DialogHeader>
        <RoomForm
          key={data?.roomId ?? 'unbound'}
          platform={platform}
          room={data}
          onSaved={() => {
            setOpen(false);
            void client.invalidateQueries({ queryKey: roomsKey(workspaceId) });
            void client.invalidateQueries({ queryKey: conversationsKey(workspaceId) });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RoomStatus({ room }: { room: NonNullable<Room> }) {
  return (
    <Badge variant={room.state === 'failed' ? 'outline' : 'secondary'}>
      <StatusDot room={room} />
      {statusLabels[room.state]}
    </Badge>
  );
}

function RoomForm({
  platform,
  room,
  onSaved,
}: {
  platform: LivePlatform;
  room?: Room;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { id: workspaceId } = useWorkspace();
  const [value, setValue] = useState(room?.roomId ?? '');

  const save = useMutation({
    mutationFn: (room: string | null) =>
      room === null
        ? rpc.workspaces.unbindRoom({ workspaceId, platform })
        : rpc.workspaces.bindRoom({ workspaceId, platform, room }),
    onSuccess: onSaved,
  });

  const connect = useMutation({
    mutationFn: () => rpc.rooms.reconnect({ workspaceId, platform }),
    onSuccess: () => client.invalidateQueries({ queryKey: roomsKey(workspaceId) }),
  });

  const website = useMutation({
    mutationFn: async (url: string) => {
      await navigate({ to: '/' });
      await rpc.browser.openTab(url);
    },
  });

  const error = save.error ?? connect.error ?? website.error;

  return (
    <form
      className="grid gap-5"
      onSubmit={event => {
        event.preventDefault();
        save.mutate(value.trim());
      }}
    >
      <FieldGroup className="gap-4">
        <Field data-invalid={save.isError}>
          <FieldLabel htmlFor="live-room-input">直播间</FieldLabel>
          <Input
            id="live-room-input"
            aria-invalid={save.isError}
            autoComplete="off"
            required
            maxLength={512}
            placeholder="例如 52030"
            value={value}
            onChange={event => setValue(event.target.value)}
          />
          <FieldDescription>输入房间号或官方直播间链接。</FieldDescription>
          {error && <FieldError>{error.message}</FieldError>}
        </Field>
        {room && (
          <>
            <Separator />
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <RoomStatus room={room} />
                <span className="text-muted-foreground mr-auto text-xs">
                  已收 {room.received} 条
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="重新连接弹幕"
                  disabled={connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  <RotateCw />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="在主页浏览器打开直播间"
                  disabled={website.isPending}
                  onClick={() => website.mutate(room.url)}
                >
                  <ArrowUpRight />
                </Button>
              </div>
              {room.error && (
                <p role="status" className="text-muted-foreground text-sm">
                  {room.error}
                </p>
              )}
            </div>
          </>
        )}
      </FieldGroup>
      <DialogFooter className={room ? 'sm:justify-between' : undefined}>
        {room && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            解除绑定
          </Button>
        )}
        <Button type="submit" size="sm" disabled={save.isPending || !value.trim()}>
          {room ? '保存房间' : '绑定直播间'}
        </Button>
      </DialogFooter>
    </form>
  );
}
