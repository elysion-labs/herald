import type { WebContents } from 'electron';

const pointerScript = String.raw`
  (point) => {
    const cursor = globalThis.__heraldPointer ??= (() => {
      const host = document.createElement('div');
      host.setAttribute('data-herald-agent-cursor', '');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none!important;transform:translate3d(50vw,50vh,0)';
      const shadow = host.attachShadow({ mode: 'closed' });
      const arrow = document.createElement('span');
      arrow.style.cssText = 'position:absolute;display:block;width:19px;height:23px;pointer-events:none;filter:drop-shadow(1px 1px 1px #000)';
      const shape = document.createElement('span');
      shape.style.cssText = 'display:block;width:100%;height:100%;background:#fff;clip-path:polygon(0 0,0 85%,29% 62%,45% 100%,66% 91%,50% 55%,87% 55%);pointer-events:none';
      arrow.append(shape);
      shadow.append(arrow);
      document.documentElement.append(host);
      return host;
    })();

    if (!cursor.isConnected) document.documentElement.append(cursor);
    if (point) cursor.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)';
  }
`;

export function showBrowserPointer(contents: WebContents, point?: { x: number; y: number }) {
  return contents.executeJavaScriptInIsolatedWorld(1002, [
    { code: `(${pointerScript})(${JSON.stringify(point ?? null)})` },
  ]);
}
