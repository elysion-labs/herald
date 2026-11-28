import MarkdownRender from 'markstream-react';
import type { MouseEvent } from 'react';

import 'markstream-react/index.css';

import { rpc } from './rpc.ts';

/** 链接一律在工作台内置浏览器打开，避免 Electron 主窗口被导航走。 */
function openLink(event: MouseEvent<HTMLDivElement>) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const anchor = event.target.closest('a[href]');

  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }

  event.preventDefault();

  if (/^https?:$/.test(anchor.protocol)) {
    void rpc.browser.openTab(anchor.href);
  }
}

export function ChatMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="chat-markdown min-w-0" onClickCapture={openLink}>
      <MarkdownRender content={content} final={!streaming} isDark fade={false} />
    </div>
  );
}
