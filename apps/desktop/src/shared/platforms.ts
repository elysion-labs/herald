import type { LivePlatform } from '@herald/live';

export const platforms = ['bilibili', 'douyin'] as const satisfies readonly LivePlatform[];

export const webPartition = 'persist:herald-web';

export const liveOrigins: Record<LivePlatform, string> = {
  bilibili: 'https://live.bilibili.com',
  douyin: 'https://live.douyin.com',
};

export const platformLabels: Record<LivePlatform, string> = {
  bilibili: '哔哩哔哩',
  douyin: '抖音',
};

export const platformLogin: Record<LivePlatform, { url: string; domain: string }> = {
  bilibili: {
    url: 'https://passport.bilibili.com/login',
    domain: 'bilibili.com',
  },
  douyin: {
    url: 'https://www.douyin.com/',
    domain: 'douyin.com',
  },
};

export const rpcPortMessage = 'herald:rpc-port';
