export const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** 取字符串字段，空值和非字符串都返回 null。 */
export function field(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

export async function getJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);

  return (await response.json()) as { data?: Record<string, unknown> };
}

export function parseRoomId(roomId: string) {
  const room = roomId.trim();

  if (!/^[1-9]\d*$/.test(room)) {
    throw new TypeError('Expected a numeric live room ID');
  }

  return room;
}
