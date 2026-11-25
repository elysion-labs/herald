import { randomUUID } from 'node:crypto';
import { EventEmitter, on } from 'node:events';
import { isIP } from 'node:net';

import type { BrowserContents } from '@herald/browser-tool';
import { nativeImage, session, WebContentsView } from 'electron';
import type { BrowserWindow, Rectangle, WebContents } from 'electron';

import { webPartition } from '../shared/platforms.ts';

function webUrl(input: string) {
  const url = URL.parse(input);

  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('请输入有效的 HTTP 或 HTTPS 网页地址。');
  }

  return url;
}

function agentUrl(input: string) {
  const url = webUrl(input);
  const host = url.hostname.replace(/\.$/, '');

  if (
    url.protocol !== 'https:' ||
    !host.includes('.') ||
    isIP(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    throw new TypeError('Agent 需要公开的 HTTPS 网页地址。');
  }

  return url.href;
}

function isWebUrl(input: string) {
  try {
    webUrl(input);

    return true;
  } catch {
    return false;
  }
}

async function captureScreenshot(contents: WebContents) {
  const devtools = contents.debugger;

  if (!devtools.isAttached()) {
    devtools.attach();
  }

  const reply: { data: string } = await devtools.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });

  const image = nativeImage.createFromBuffer(Buffer.from(reply.data, 'base64'));

  if (image.isEmpty()) {
    return null;
  }

  const { width, height } = image.getSize();
  const scale = Math.min(1, 1280 / width, 960 / height);

  const preview =
    scale === 1 ? image : image.resize({ width: Math.max(1, Math.floor(width * scale)) });

  return { mimeType: 'image/png' as const, data: preview.toPNG().toString('base64') };
}

export function createWorkspaceBrowser(window: BrowserWindow) {
  const browserSession = session.fromPartition(webPartition);
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const rejectDownload = (event: Electron.Event) => event.preventDefault();
  browserSession.on('will-download', rejectDownload);

  const events = new EventEmitter();
  const tabs = new Map<string, WebContentsView>();
  const favicons = new Map<string, string>();
  let activeId: string | null = null;
  let bounds: Rectangle | undefined;

  function lookup(id?: string) {
    if (id !== undefined) {
      const view = tabs.get(id);

      if (!view) {
        throw new Error('网页标签页不存在。');
      }

      return view;
    }

    return activeId ? tabs.get(activeId) : undefined;
  }

  function list() {
    return {
      activeId,
      tabs: [...tabs].map(([id, { webContents }]) => ({
        id,
        url: webContents.getURL(),
        title: webContents.getTitle(),
        favicon: favicons.get(id),
      })),
    };
  }

  function state() {
    const contents = lookup()?.webContents;

    return {
      ...list(),
      url: contents?.getURL() ?? '',
      loading: contents?.isLoading() ?? false,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
      open: Boolean(contents),
    };
  }

  function changed() {
    events.emit('change');
  }

  function syncBounds() {
    if (window.isDestroyed()) {
      return;
    }

    const [width, height] = window.getContentSize();
    const area = bounds;
    const visible = area && area.x < width && area.y < height;

    for (const [id, view] of tabs) {
      const hasPage = isWebUrl(view.webContents.getURL()) || view.webContents.isLoading();
      view.setVisible(Boolean(visible && id === activeId && hasPage));

      if (area && visible) {
        view.setBounds({
          ...area,
          width: Math.min(area.width, width - area.x),
          height: Math.min(area.height, height - area.y),
        });
      }
    }
  }

  function select(id: string) {
    if (id === activeId) {
      return;
    }

    lookup(id);
    activeId = id;
    syncBounds();
    changed();
  }

  function close(requestedId?: string) {
    const id = requestedId ?? activeId;

    if (!id) {
      return;
    }

    const view = lookup(id);
    const ids = [...tabs.keys()];
    const index = ids.indexOf(id);
    tabs.delete(id);
    favicons.delete(id);

    if (activeId === id) {
      activeId = ids[index + 1] ?? ids[index - 1] ?? null;
    }

    if (view && !window.isDestroyed()) {
      window.contentView.removeChildView(view);
    }

    view?.webContents.close();
    syncBounds();
    changed();
  }

  function createTab() {
    const id = randomUUID();

    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    view.setVisible(false);
    window.contentView.addChildView(view);
    tabs.set(id, view);

    const contents = view.webContents;
    contents.on('will-frame-navigate', event => {
      if (event.isMainFrame && !isWebUrl(event.url)) {
        event.preventDefault();
      }
    });
    contents.on('will-redirect', event => {
      if (event.isMainFrame && !isWebUrl(event.url)) {
        event.preventDefault();
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) {
        void openTab(url).catch(() => undefined);
      }

      return { action: 'deny' };
    });

    const pageChanged = () => {
      syncBounds();
      changed();
    };

    contents.on('did-start-loading', pageChanged);
    contents.on('did-stop-loading', pageChanged);
    contents.on('did-navigate', () => {
      favicons.delete(id);
      pageChanged();
    });
    contents.on('did-navigate-in-page', changed);
    contents.on('page-title-updated', changed);
    contents.on('page-favicon-updated', (_event, icons) => {
      const icon = icons.find(isWebUrl);

      if (icon) {
        favicons.set(id, icon);
        changed();
      }
    });
    select(id);

    return { id, view };
  }

  async function openTab(input?: string) {
    const url = input ? webUrl(input) : undefined;
    const { id, view } = createTab();

    if (url) {
      await view.webContents.loadURL(url.href);
    }

    return id;
  }

  async function navigate(input: string, id?: string) {
    const url = webUrl(input);
    const view = lookup(id) ?? createTab().view;
    await view.webContents.loadURL(url.href);
  }

  const webContents: BrowserContents = {
    list,
    open: url => openTab(agentUrl(url)),
    select,
    navigate: (url, id) => navigate(agentUrl(url), id),
    async snapshot(id) {
      const contents = lookup(id)?.webContents;

      if (!contents || !isWebUrl(contents.getURL())) {
        return null;
      }

      const text: unknown = await contents.executeJavaScriptInIsolatedWorld(1001, [
        {
          code: `(() => {
          const body = (document.body?.innerText ?? '').slice(0, 10000);
          const links = Array.from(document.links).slice(0, 40).map(
            link => (link.innerText || link.getAttribute('aria-label') || '').trim().slice(0, 100) + ' ' + link.href.slice(0, 300)
          ).join('\\n');
          return body + '\\n\\n' + links;
        })()`,
        },
      ]);

      return {
        url: contents.getURL(),
        title: contents.getTitle(),
        text: typeof text === 'string' ? text.slice(0, 16000) : '',
      };
    },
    async screenshot(id = activeId ?? undefined) {
      const contents = lookup(id)?.webContents;

      if (!id || !contents || !bounds || !isWebUrl(contents.getURL())) {
        return null;
      }

      const previous = activeId;

      select(id);

      try {
        return await captureScreenshot(contents);
      } finally {
        if (previous && activeId === id && previous !== id && tabs.has(previous)) {
          select(previous);
        }
      }
    },
    close,
  };

  window.on('resize', syncBounds);
  window.on('closed', () => {
    for (const id of tabs.keys()) {
      close(id);
    }

    browserSession.off('will-download', rejectDownload);
  });

  return {
    webContents,
    navigate,
    openTab,
    select,
    close,
    async *watch(signal?: AbortSignal) {
      const updates = on(events, 'change', { signal });

      try {
        yield state();

        for await (const _ of updates) {
          yield state();
        }
      } finally {
        await updates.return?.();
      }
    },
    setBounds(next: Rectangle | undefined) {
      bounds = next;
      syncBounds();
    },
    back() {
      const history = lookup()?.webContents.navigationHistory;

      if (history?.canGoBack()) {
        history.goBack();
      }
    },
    forward() {
      const history = lookup()?.webContents.navigationHistory;

      if (history?.canGoForward()) {
        history.goForward();
      }
    },
    reload() {
      lookup()?.webContents.reload();
    },
  };
}
