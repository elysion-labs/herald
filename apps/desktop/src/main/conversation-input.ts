import { ORPCError } from '@orpc/server';

import {
  attachmentBlock,
  isImageAttachment,
  isTextAttachment,
  maxTextAttachmentBytes,
} from '../shared/attachments.ts';
import type { Attachment } from '../shared/attachments.ts';

/** agent 未命名会话时的兜底标题：去掉技能命令后的首条消息，或第一个附件名。 */
function fallbackTitle(text: string, attachments: readonly Attachment[]) {
  const body = text.replace(/^(?:\/skill:\S+\s*)+/, '');

  return (body || attachments[0]?.name || text).slice(0, 60);
}

/** 图片交给模型原生识别；文本类文件以原文拼进消息；其他类型明确拒绝。 */
export function prepareConversationInput(text: string, attachments: readonly Attachment[]) {
  const images: { type: 'image'; data: string; mimeType: string }[] = [];
  const blocks: string[] = [];

  for (const file of attachments) {
    if (isImageAttachment(file.mimeType)) {
      images.push({ type: 'image', data: file.data, mimeType: file.mimeType });
      continue;
    }

    const buffer = Buffer.from(file.data, 'base64');

    if (!isTextAttachment(file.name, file.mimeType)) {
      throw new ORPCError('BAD_REQUEST', { message: `暂不支持这个文件类型：${file.name}` });
    }

    if (buffer.byteLength > maxTextAttachmentBytes) {
      throw new ORPCError('BAD_REQUEST', { message: `文本文件超过 512 KB：${file.name}` });
    }

    blocks.push(attachmentBlock(file.name, buffer.toString('utf8')));
  }

  return {
    text: [text, ...blocks].filter(Boolean).join('\n\n'),
    images,
    streamerText: text,
    fallbackTitle: fallbackTitle(text, attachments),
  };
}
