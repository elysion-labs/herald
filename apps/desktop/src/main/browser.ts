import { randomUUID } from 'node:crypto';
import { EventEmitter, on } from 'node:events';
import { isIP } from 'node:net';

import type { BrowserContents, BrowserInteraction } from '@herald/browser-tool';
import { nativeImage, screen, session, WebContentsView } from 'electron';
import type { BrowserWindow, Rectangle, WebContents } from 'electron';

import { browserViewport } from '../shared/browser-preview.ts';
import { webPartition } from '../shared/platforms.ts';
import { showBrowserPointer } from './browser-pointer.ts';

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

function connectDebugger(contents: WebContents) {
  const devtools = contents.debugger;

  if (!devtools.isAttached()) {
    devtools.attach();
  }

  return devtools;
}

async function captureScreenshot(contents: WebContents) {
  const devtools = connectDebugger(contents);

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
  /** agent 自己打开的标签页，运行结束后由调用方关闭。 */
  const agentTabs = new Set<string>();
  const favicons = new Map<string, string>();
  const scales = new WeakMap<WebContentsView, number>();
  let activeId: string | null = null;
  let bounds: Rectangle | undefined;
  let pointerInside = false;
  let pointerTimer: ReturnType<typeof setInterval> | undefined;

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
      pointerInside,
    };
  }

  function changed() {
    events.emit('change');
  }

  function setPointerInside(next: boolean) {
    if (next !== pointerInside) {
      pointerInside = next;
      changed();
    }
  }

  function checkPointer() {
    const view = lookup();

    if (!window.isFocused() || !view?.getVisible()) {
      setPointerInside(false);

      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const origin = window.getContentBounds();
    const frame = view.getBounds();
    const x = cursor.x - origin.x - frame.x;
    const y = cursor.y - origin.y - frame.y;
    setPointerInside(x >= 0 && y >= 0 && x < frame.width && y < frame.height);
  }

  function trackPointer(enabled: boolean) {
    if (enabled) {
      // 原生视图的位置可能在鼠标静止时改变，移入和移出事件无法覆盖这种情况。
      pointerTimer ??= setInterval(checkPointer, 80);
      checkPointer();

      return;
    }

    clearInterval(pointerTimer);
    pointerTimer = undefined;
    setPointerInside(false);
  }

  function fitView(view: WebContentsView, frame: Rectangle) {
    view.setBounds(frame);

    // 空白标签页还没有可应用模拟参数的网页渲染视图。
    if (!isWebUrl(view.webContents.getURL())) {
      return;
    }

    const scale = Math.min(
      frame.width / browserViewport.width,
      frame.height / browserViewport.height,
    );

    if (scales.get(view) === scale) {
      return;
    }

    // 保持网页的 CSS 视口固定，只缩放嵌入视图的输出与交互坐标。
    view.webContents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: browserViewport,
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      viewSize: browserViewport,
      scale,
    });
    scales.set(view, scale);
  }

  function syncBounds() {
    if (window.isDestroyed()) {
      return;
    }

    const [width, height] = window.getContentSize();
    const area = bounds;
    const visible = area && area.x < width && area.y < height;

    if (!visible) {
      setPointerInside(false);
    }

    for (const [id, view] of tabs) {
      const hasPage = isWebUrl(view.webContents.getURL()) || view.webContents.isLoading();
      view.setVisible(Boolean(visible && id === activeId && hasPage));

      if (id === activeId && area && visible) {
        fitView(view, {
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
    setPointerInside(false);
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
    agentTabs.delete(id);
    favicons.delete(id);

    if (activeId === id) {
      activeId = ids[index + 1] ?? ids[index - 1] ?? null;
      setPointerInside(false);
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
    view.setBorderRadius(9);
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
    contents.on('dom-ready', () => {
      if (isWebUrl(contents.getURL())) {
        void showBrowserPointer(contents).catch(() => undefined);
      }
    });
    contents.on('did-stop-loading', pageChanged);
    contents.on('did-navigate', () => {
      favicons.delete(id);
      scales.delete(view);
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

  function interactionTarget(tabId?: string) {
    const id = tabId ?? activeId;
    const view = id ? lookup(id) : undefined;

    if (!id || !view || !isWebUrl(view.webContents.getURL())) {
      throw new Error('请选择已经打开的网页。');
    }

    select(id);

    return { id, view, contents: view.webContents };
  }

  async function interact(input: BrowserInteraction, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { id, view, contents } = interactionTarget(input.tabId);
    const { width, height } = view.getBounds();

    if (width < 1 || height < 1) {
      throw new Error('网页预览尚未取得尺寸，请先打开浏览器页或画中画。');
    }

    const url = contents.getURL();
    const devtools = connectDebugger(contents);

    const metrics: { cssVisualViewport: { clientWidth: number; clientHeight: number } } =
      await devtools.sendCommand('Page.getLayoutMetrics');

    const viewport = metrics.cssVisualViewport;

    const point = {
      x: input.x * Math.max(0, viewport.clientWidth - 1),
      y: input.y * Math.max(0, viewport.clientHeight - 1),
    };

    const scale = scales.get(view) ?? 1;

    if (input.action === 'click') {
      await showBrowserPointer(contents, point).catch(() => undefined);
    }

    const currentBounds = view.getBounds();
    const isCurrentPage = !contents.isDestroyed() && contents.getURL() === url;
    const hasSameSize = currentBounds.width === width && currentBounds.height === height;

    if (activeId !== id || !isCurrentPage || !hasSameSize) {
      throw new Error('网页或预览大小已变化，请重新截图后再操作。');
    }

    signal?.throwIfAborted();
    await dispatchBrowserAction(devtools, input, { x: point.x * scale, y: point.y * scale });
  }

  const webContents: BrowserContents = {
    list,
    async open(url) {
      const id = await openTab(agentUrl(url));
      agentTabs.add(id);

      return id;
    },
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
    interact,
    close,
  };

  window.on('resize', syncBounds);
  window.on('blur', () => setPointerInside(false));
  window.on('closed', () => {
    trackPointer(false);

    for (const id of tabs.keys()) {
      close(id);
    }

    browserSession.off('will-download', rejectDownload);
  });

  return {
    webContents,
    /** 当前由 agent 打开且仍未关闭的标签页。 */
    agentTabs: () => new Set(agentTabs),
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
    setBounds(next: Rectangle | undefined, pictureInPicture: boolean) {
      bounds = next;
      syncBounds();
      trackPointer(Boolean(next && pictureInPicture));
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

async function dispatchBrowserAction(
  devtools: WebContents['debugger'],
  input: BrowserInteraction,
  point: { x: number; y: number },
) {
  if (input.action === 'scroll') {
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...point,
      deltaX: input.deltaX,
      deltaY: input.deltaY,
    });

    return;
  }

  const click = { ...point, button: 'left', clickCount: 1 };
  await devtools.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...click,
    buttons: 1,
  });
  await devtools.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...click,
    buttons: 0,
  });
}
