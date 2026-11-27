import { bilibiliAdapter } from './bilibili.ts';
import { douyinAdapter } from './douyin.ts';

export type LivePlatform = 'bilibili' | 'douyin';

/** 观众身份信息，用于判断是否值得互动。 */
export interface LiveViewer {
  id: string | null;
  name: string | null;
  /** B 站粉丝牌 / 抖音粉丝团灯牌。 */
  badge: { name: string; level: number } | null;
  /** B 站大航海：1 总督、2 提督、3 舰长。 */
  guardLevel: number | null;
  /** 抖音财富等级。 */
  payLevel: number | null;
}

export interface LiveChatMessage {
  platform: LivePlatform;
  roomId: string;
  sourceId: string | null;
  deduplicationKey: string | null;
  authorId: string | null;
  authorName: string | null;
  viewer: LiveViewer;
  text: string;
  receivedAt: number;
}

interface ActivityBase {
  platform: LivePlatform;
  roomId: string;
  key: string | null;
  viewer: LiveViewer;
  receivedAt: number;
}

/** 弹幕以外的互动：礼物、醒目留言、上舰、进场、关注。金额统一为人民币元。 */
export type LiveActivity = ActivityBase &
  (
    | { kind: 'gift'; giftName: string; count: number; value: number | null }
    | { kind: 'superChat'; text: string; value: number }
    | { kind: 'guard'; guardName: string; value: number }
    | { kind: 'entry' }
    | { kind: 'follow' }
  );

export interface LiveChatOptions {
  roomId: string;
  readCookie?: (signal: AbortSignal) => Promise<string | null>;
  onMessage: (message: LiveChatMessage) => void;
  onActivity?: (activity: LiveActivity) => void;
  onError: (error: Error) => void;
}

/** 直播间是否在播；unknown 表示暂时无法判断。 */
export type LiveStatus = 'live' | 'offline' | 'unknown';

/** 主播与直播间的公开资料，用于让 agent 了解当前绑定的直播间。 */
export interface RoomProfile {
  platform: LivePlatform;
  roomId: string;
  streamer: string | null;
  streamerId: string | null;
  title: string | null;
  area: string | null;
  tags: string[];
  followers: number | null;
  description: string | null;
  live: LiveStatus;
}

/** 观众的公开主页资料。 */
export interface ViewerProfile {
  name: string | null;
  sign: string | null;
  level: number | null;
  followers: number | null;
  official: string | null;
}

export type ActivityDetail = LiveActivity extends infer Item
  ? Item extends ActivityBase
    ? Omit<Item, keyof ActivityBase>
    : never
  : never;

export type LiveCapability =
  | 'danmaku'
  | 'entry'
  | 'gift'
  | 'superChat'
  | 'guard'
  | 'viewerProfile'
  | 'roomProfile'
  | 'badgeLevel'
  | 'payLevel'
  | 'welcome';

export interface LivePlatformInfo {
  id: LivePlatform;
  label: string;
  capabilities: Readonly<Record<LiveCapability, boolean>>;
}

export interface LiveChat {
  start: () => Promise<void>;
  state: () =>
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'stopped'
    | 'failed'
    | 'disposed';
  dispose: () => Promise<void>;
}

export interface RoomProfileOptions {
  cookie?: string | null;
  signal?: AbortSignal;
}

export interface LivePlatformAdapter extends LivePlatformInfo {
  createChat: (options: LiveChatOptions) => LiveChat;
  fetchRoomProfile: (roomId: string, options?: RoomProfileOptions) => Promise<RoomProfile>;
  fetchViewerProfile?: (
    viewerId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<ViewerProfile | null>;
}

export const adapters: Readonly<Record<LivePlatform, LivePlatformAdapter>> = {
  bilibili: bilibiliAdapter,
  douyin: douyinAdapter,
};

/** 这组平台中有任一平台支持该能力。 */
export function supports(platforms: readonly LivePlatform[], capability: LiveCapability) {
  return platforms.some(platform => adapters[platform].capabilities[capability]);
}
