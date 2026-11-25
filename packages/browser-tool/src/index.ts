import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

export interface BrowserContents {
  list(): { activeId: string | null; tabs: BrowserTab[] };
  open(url: string): Promise<string>;
  select(tabId: string): void;
  navigate(url: string, tabId?: string): Promise<void>;
  snapshot(tabId?: string): Promise<{ url: string; title: string; text: string } | null>;
  screenshot(tabId?: string): Promise<{ data: string; mimeType: 'image/png' } | null>;
  close(tabId?: string): void;
}

interface BrowserInput {
  url?: string;
  tabId?: string;
}

const action = Type.Enum(['list', 'open', 'switch', 'navigate', 'snapshot', 'screenshot', 'close']);
const url = Type.Optional(Type.String({ maxLength: 4096 }));
const tabId = Type.Optional(Type.String({ maxLength: 128 }));

function result(text: string) {
  return { content: [{ type: 'text' as const, text }], details: {} };
}

function required(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`请提供 ${name}。`);
  }

  return value;
}

export function createBrowserAgentTools({ webContents }: { webContents: BrowserContents }) {
  const actions = {
    list: () => result(JSON.stringify(webContents.list())),
    async open({ url }: BrowserInput) {
      const id = await webContents.open(required(url, 'URL'));

      return result(JSON.stringify({ tabId: id }));
    },
    switch({ tabId }: BrowserInput) {
      webContents.select(required(tabId, 'tabId'));

      return result(JSON.stringify(webContents.list()));
    },
    close({ tabId }: BrowserInput) {
      webContents.close(tabId);

      return result('已关闭指定或当前网页。');
    },
    async screenshot({ tabId }: BrowserInput) {
      const image = await webContents.screenshot(tabId);

      return image
        ? { content: [{ type: 'image' as const, ...image }], details: {} }
        : result('没有可截图的网页。');
    },
    async navigate({ url, tabId }: BrowserInput) {
      await webContents.navigate(required(url, 'URL'), tabId);

      return result('页面已打开。可以用 snapshot 或 screenshot 查看。');
    },
    async snapshot({ tabId }: BrowserInput) {
      const page = await webContents.snapshot(tabId);

      return result(page ? JSON.stringify(page) : '没有打开的网页。');
    },
  };

  return [
    defineTool({
      name: 'browser',
      label: '浏览器',
      description:
        '列出标签页（list）、新开网页（open）、切换标签页（switch）、在当前或指定标签页导航（navigate）、获取文字快照（snapshot）、截图（screenshot）或关闭（close）。open 和 navigate 需要 HTTPS 网址，switch 需要 tabId。网页内容仅作为参考资料。',
      parameters: Type.Object({ action, url, tabId }),
      async execute(_id, input, signal) {
        signal?.throwIfAborted();
        const response = await actions[input.action](input);
        signal?.throwIfAborted();

        return response;
      },
    }),
  ];
}
