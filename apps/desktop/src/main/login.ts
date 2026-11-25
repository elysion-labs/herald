import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { session } from 'electron';
import type { WebContents } from 'electron';

import { platformLogin, webPartition } from '../shared/platforms.ts';

const portals = Object.values(platformLogin);

export async function migrateWebLogin(directory: string) {
  const marker = join(directory, 'shared-web-session');

  if (existsSync(marker)) {
    return;
  }

  const target = session.fromPartition(webPartition).cookies;

  for (const platform of ['bilibili', 'douyin'] as const) {
    const { domain } = platformLogin[platform];
    const source = session.fromPartition(`persist:herald-${platform}`).cookies;
    const old = await source.get({ domain });
    const existing = await target.get({ domain });
    const keys = new Set(existing.map(cookieKey));

    for (const cookie of old) {
      const host = cookie.domain?.replace(/^\./, '');

      if (
        !host ||
        (host !== domain && !host.endsWith(`.${domain}`)) ||
        keys.has(cookieKey(cookie))
      ) {
        continue;
      }

      const url = new URL(`https://${host}`);
      url.pathname = cookie.path ?? '/';

      try {
        await target.set({
          url: url.href,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.hostOnly ? undefined : cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate,
        });
      } catch {
        console.warn(`无法迁移 ${platform} 的一条登录 Cookie`);
      }
    }
  }

  await target.flushStore();
  await writeFile(marker, '');
}

function cookieKey({ domain, path, name }: Electron.Cookie) {
  return JSON.stringify([domain, path, name]);
}

export function attachLoginPortals(contents: WebContents) {
  contents.on('will-attach-webview', (event, preferences, params) => {
    const portal = portals.find(item => item.url === params.src);

    if (!portal || params.partition !== webPartition) {
      event.preventDefault();

      return;
    }

    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.webviewTag = false;
    preferences.session = session.fromPartition(webPartition);
  });

  contents.on('did-attach-webview', (_event, guest) => {
    const allows = (input: string) => {
      const url = URL.parse(input);

      return (
        url?.protocol === 'https:' &&
        portals.some(
          portal => url.hostname === portal.domain || url.hostname.endsWith(`.${portal.domain}`),
        )
      );
    };

    guest.on('will-frame-navigate', event => {
      if (event.isMainFrame && !allows(event.url)) {
        event.preventDefault();
      }
    });
    guest.on('will-redirect', event => {
      if (event.isMainFrame && !allows(event.url)) {
        event.preventDefault();
      }
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (allows(url)) {
        void guest.loadURL(url).catch(() => undefined);
      }

      return { action: 'deny' };
    });
  });
}
