import type { LivePlatform } from '@herald/live';
import { LoaderCircle } from 'lucide-react';
import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
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
        <PlatformLoginView key={platform} platform={platform} />
      </DialogContent>
    </Dialog>
  );
}

function PlatformLoginView({ platform }: { platform: LivePlatform }) {
  const view = useRef<Electron.WebviewTag>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useLayoutEffect(() => {
    const node = view.current;

    if (!node) {
      return;
    }

    const timeout = window.setTimeout(() => setStatus('error'), 15000);

    const ready = () => {
      clearTimeout(timeout);
      setStatus('ready');
    };

    const failed = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        clearTimeout(timeout);
        setStatus('error');
      }
    };

    node.addEventListener('did-finish-load', ready);
    node.addEventListener('did-fail-load', failed);

    return () => {
      clearTimeout(timeout);
      node.removeEventListener('did-finish-load', ready);
      node.removeEventListener('did-fail-load', failed);
    };
  }, [attempt]);

  return (
    <div className="login-webview-frame" data-platform={platform}>
      {createElement('webview', {
        key: attempt,
        ref: view,
        className: 'login-webview',
        src: platformLogin[platform].url,
        partition: webPartition,
      })}
      {status !== 'ready' && (
        <div className="bg-popover text-muted-foreground absolute inset-0 grid place-content-center justify-items-center gap-2 text-sm">
          {status === 'loading' ? (
            <p role="status" className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              正在打开官方登录页…
            </p>
          ) : (
            <>
              <p role="alert">无法打开官方登录页，请检查网络连接。</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatus('loading');
                  setAttempt(current => current + 1);
                }}
              >
                重新加载
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
