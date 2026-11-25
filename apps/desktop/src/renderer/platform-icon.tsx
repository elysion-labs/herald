import type { LivePlatform } from '@herald/live';

const icons = {
  bilibili: new URL('./assets/bilibili.ico', import.meta.url).href,
  douyin: new URL('./assets/douyin.png', import.meta.url).href,
};

export function PlatformIcon({ platform, size = 14 }: { platform: LivePlatform; size?: number }) {
  return (
    <img
      src={icons[platform]}
      width={size}
      height={size}
      alt=""
      className="shrink-0 object-contain"
    />
  );
}
