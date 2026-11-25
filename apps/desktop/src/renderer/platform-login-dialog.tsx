import type { LivePlatform } from '@herald/live';
import { createElement, useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { platformLabels, platformLogin, webPartition } from '../shared/platforms.ts';
import { dialogOrigin } from './dialog-origin.ts';

export function PlatformLoginDialog({
  platform,
  open,
  trigger,
  onClose,
  onExited,
}: {
  platform: LivePlatform;
  open: boolean;
  trigger: HTMLButtonElement;
  onClose: () => void;
  onExited: () => void;
}) {
  useEffect(() => {
    if (open) {
      return;
    }

    const exit = window.setTimeout(onExited, 260);

    return () => window.clearTimeout(exit);
  }, [onExited, open]);

  return (
    <Dialog
      open={open}
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="login-dialog grid h-[min(78dvh,760px)] w-[min(90vw,1000px)] max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-none"
        style={dialogOrigin(trigger)}
        onCloseAutoFocus={event => {
          event.preventDefault();
          trigger.focus({ preventScroll: true });
          onExited();
        }}
      >
        <DialogHeader>
          <DialogTitle>登录{platformLabels[platform]}</DialogTitle>
          <DialogDescription>请在官方页面完成登录</DialogDescription>
        </DialogHeader>
        {createElement('webview', {
          key: platform,
          className: 'login-webview',
          src: platformLogin[platform].url,
          partition: webPartition,
        })}
      </DialogContent>
    </Dialog>
  );
}
