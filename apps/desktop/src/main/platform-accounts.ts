import type { LivePlatform } from '@herald/live';
import { session } from 'electron';
import type { Session } from 'electron';
import { z } from 'zod';

import { liveOrigins, webPartition } from '../shared/platforms.ts';

const biliNav = z.object({
  code: z.number(),
  data: z
    .object({ isLogin: z.boolean(), uname: z.string().optional(), mid: z.number().optional() })
    .optional(),
});

const accountId = z.union([z.string(), z.number()]);

const douyinAccount = z.object({
  message: z.string(),
  data: z.object({
    error_code: z.coerce.number().optional(),
    user_id_str: z.string().optional(),
    user_id: accountId.optional(),
    screen_name: z.string().optional(),
    nickname: z.string().optional(),
    username: z.string().optional(),
  }),
});

type Account =
  | { status: 'signed-out' | 'unavailable' }
  | { status: 'signed-in'; name: string | undefined; id: string | undefined };

function readBilibiliAccount(payload: unknown): Account {
  const { code, data } = biliNav.parse(payload);

  if (code === -101 || data?.isLogin === false) {
    return { status: 'signed-out' };
  }

  if (code !== 0 || !data?.isLogin) {
    return { status: 'unavailable' };
  }

  return { status: 'signed-in', name: data.uname, id: data.mid?.toString() };
}

function readDouyinAccount(payload: unknown): Account {
  const { message, data } = douyinAccount.parse(payload);

  if (data.error_code === 13) {
    return { status: 'signed-out' };
  }

  if (message !== 'success') {
    return { status: 'unavailable' };
  }

  const rawId = data.user_id_str ?? data.user_id;
  const id = typeof rawId === 'string' || Number.isSafeInteger(rawId) ? String(rawId) : undefined;

  const name = [data.screen_name, data.nickname, data.username].find(value =>
    Boolean(value?.trim()),
  );

  return { status: 'signed-in', id: id !== '0' ? id : undefined, name };
}

export async function getPlatformAccount(
  platform: LivePlatform,
  signal?: AbortSignal,
): Promise<Account> {
  const timeout = AbortSignal.timeout(8000);
  const cancel = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const browser = session.fromPartition(webPartition);

  const url =
    platform === 'bilibili'
      ? 'https://api.bilibili.com/x/web-interface/nav'
      : 'https://www.douyin.com/passport/account/info/v2/?aid=6383';

  try {
    const cookie = await cookieHeader(browser, url, cancel);

    const response = await browser.fetch(url, {
      credentials: 'omit',
      headers: cookie ? { Cookie: cookie } : undefined,
      redirect: 'error',
      cache: 'no-store',
      signal: cancel,
    });

    if (!response.ok) {
      return { status: 'unavailable' };
    }

    const payload: unknown = await response.json();

    return platform === 'bilibili' ? readBilibiliAccount(payload) : readDouyinAccount(payload);
  } catch {
    return { status: 'unavailable' };
  }
}

export async function readLiveCookies(platform: LivePlatform, signal: AbortSignal) {
  const cookie = await cookieHeader(
    session.fromPartition(webPartition),
    liveOrigins[platform],
    signal,
  );

  // B 站客户端会把非空 Cookie 当作已登录凭证，访客 Cookie 走匿名连接。
  if (platform === 'bilibili' && !/(?:^|;\s*)SESSDATA=[^;]+/.test(cookie ?? '')) {
    return null;
  }

  return cookie;
}

async function cookieHeader(browser: Session, url: string, signal: AbortSignal) {
  const cookies = await browser.cookies.get({ url });

  signal.throwIfAborted();

  return cookies.length ? cookies.map(({ name, value }) => `${name}=${value}`).join('; ') : null;
}
