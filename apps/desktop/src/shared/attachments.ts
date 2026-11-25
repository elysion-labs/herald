import { z } from 'zod';

export const maxAttachments = 8;

export const maxAttachmentBytes = 10 * 1024 * 1024;

/** 文本类附件会以原文拼进消息，限制大小避免撑爆上下文。 */
export const maxTextAttachmentBytes = 512 * 1024;

export const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

const textExtensions =
  /\.(?:txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|xml|html?|css|[cm]?[jt]sx?|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|ps1|sql|srt|vtt|lrc)$/i;

export function isImageAttachment(mimeType: string) {
  return (imageTypes as readonly string[]).includes(mimeType);
}

export function isTextAttachment(name: string, mimeType: string) {
  return (
    mimeType.startsWith('text/') || mimeType === 'application/json' || textExtensions.test(name)
  );
}

export const attachment = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().max(255),
  /** base64 编码的文件内容。 */
  data: z.string().max(Math.ceil((maxAttachmentBytes * 4) / 3) + 4),
});

export type Attachment = z.infer<typeof attachment>;

/** 用户消息中文本附件的包裹格式，渲染时据此折叠成文件标记。 */
export function attachmentBlock(name: string, content: string) {
  return `<attachment name="${name.replaceAll('"', "'")}">\n${content}\n</attachment>`;
}

export const attachmentPattern = /\n*<attachment name="([^"]*)">\n[\s\S]*?\n<\/attachment>/g;
