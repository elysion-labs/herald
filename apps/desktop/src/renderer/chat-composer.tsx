import { ORPCError } from '@orpc/client';
import { Link } from '@tanstack/react-router';
import { ArrowUp, CircleAlert, FileText, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';

import {
  isImageAttachment,
  isTextAttachment,
  maxAttachmentBytes,
  maxAttachments,
  maxTextAttachmentBytes,
} from '../shared/attachments.ts';
import type { Attachment } from '../shared/attachments.ts';
import type { Conversation } from './assistant-mode.tsx';
import { ChatModelControls } from './chat-model-controls.tsx';
import { ContextUsage } from './context-usage.tsx';
import { QuickPrompts } from './quick-prompts.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace } from './workspace-context.ts';

export interface ComposerMessage {
  text: string;
  attachments: Attachment[];
}

interface Draft {
  id: string;
  file: File;
  preview?: string;
}

function validate(file: File) {
  if (file.size > maxAttachmentBytes) {
    return `${file.name} 超过 10 MB`;
  }

  if (isImageAttachment(file.type)) {
    return undefined;
  }

  if (!isTextAttachment(file.name, file.type)) {
    return `暂不支持 ${file.name}：只能发送图片或文本类文件`;
  }

  return file.size > maxTextAttachmentBytes ? `${file.name} 超过 512 KB` : undefined;
}

function release(draft: Draft) {
  if (draft.preview) {
    URL.revokeObjectURL(draft.preview);
  }
}

async function encode(file: File): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return { name: file.name, mimeType: file.type || 'application/octet-stream', data: btoa(binary) };
}

/** 输入框：文本、附件（选择 / 粘贴 / 拖放）与模型选择。 */
export function ChatComposer({
  id,
  input,
  busy,
  locked,
  centered,
  sendError,
  onDismissError,
  onSend,
  conversation,
}: {
  id: string;
  conversation?: Conversation;
  input: RefObject<HTMLTextAreaElement | null>;
  /** 正在发送：输入只读、附件不可改。 */
  busy: boolean;
  /** 发送或切换模型中：禁止提交。 */
  locked: boolean;
  centered: boolean;
  sendError: Error | null;
  onDismissError: () => void;
  onSend: (message: ComposerMessage) => Promise<unknown>;
}) {
  const { id: workspaceId } = useWorkspace();
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [problem, setProblem] = useState<string>();
  const typingReported = useRef(0);

  /** 助手会话里主播正在输入时，告诉调度器先暂存非紧急提醒（最多每 3 秒一次）。 */
  function reportTyping() {
    const now = Date.now();

    if (conversation?.mode === 'assistant' && now - typingReported.current > 3000) {
      typingReported.current = now;
      void rpc.assistant.typing({ workspaceId, id }).catch(() => undefined);
    }
  }

  const canSend = Boolean(text.trim() || drafts.length) && !locked;
  const popupSide = centered ? 'bottom' : 'top';

  const latest = useRef(drafts);

  useEffect(() => {
    latest.current = drafts;
  }, [drafts]);

  // 卸载时回收仍在使用的预览图。
  useEffect(() => () => latest.current.forEach(release), []);

  function remove(id: string) {
    const draft = drafts.find(item => item.id === id);

    if (draft) {
      release(draft);
      setDrafts(drafts.filter(item => item !== draft));
    }
  }

  function add(files: Iterable<File>) {
    const accepted: Draft[] = [];
    let message: string | undefined;

    for (const file of files) {
      const error = validate(file);

      if (error) {
        message = error;
        continue;
      }

      accepted.push({
        id: crypto.randomUUID(),
        file,
        preview: isImageAttachment(file.type) ? URL.createObjectURL(file) : undefined,
      });
    }

    const next = [...drafts, ...accepted];

    if (next.length > maxAttachments) {
      message = `最多添加 ${maxAttachments} 个附件`;
      next.slice(maxAttachments).forEach(release);
    }

    setDrafts(next.slice(0, maxAttachments));
    setProblem(message);
    input.current?.focus();
  }

  async function submit() {
    if (!canSend) {
      return;
    }

    setProblem(undefined);

    const attachments = await Promise.all(drafts.map(draft => encode(draft.file))).catch(() => {
      setProblem('读取附件失败，请移除附件后重新添加。');
    });

    if (!attachments) {
      return;
    }

    try {
      await onSend({ text: text.trim(), attachments });
      setText('');
      drafts.forEach(release);
      setDrafts([]);
    } catch {
      // 错误由调用方展示，保留草稿方便重试。
    }
  }

  function paste(event: ClipboardEvent) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      add(event.clipboardData.files);
    }
  }

  function drop(event: DragEvent) {
    if (event.dataTransfer.files.length && !busy) {
      event.preventDefault();
      add(event.dataTransfer.files);
    }
  }

  return (
    <form
      className="pointer-events-auto mx-auto w-full max-w-3xl px-6 pb-5"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
      onDragOver={event => event.preventDefault()}
      onDrop={drop}
    >
      {sendError && (
        <ComposerNotice
          message={sendError.message}
          modelSettings={sendError instanceof ORPCError && sendError.code === 'PRECONDITION_FAILED'}
          onDismiss={onDismissError}
        />
      )}
      {problem && <ComposerNotice message={problem} onDismiss={() => setProblem(undefined)} />}
      <InputGroup className="composer-box bg-surface has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        {drafts.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 pb-0">
            {drafts.map(draft => (
              <AttachmentChip
                key={draft.id}
                name={draft.file.name}
                preview={draft.preview}
                onRemove={busy ? undefined : () => remove(draft.id)}
              />
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          className="min-h-14"
          ref={input}
          aria-label="消息"
          placeholder="给 Herald 发消息…"
          value={text}
          readOnly={busy}
          onChange={event => {
            setText(event.target.value);
            reportTyping();
          }}
          onPaste={paste}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="flex-wrap gap-1 pt-1">
          <InputGroupButton
            type="button"
            variant="outline"
            size="icon-xs"
            className="rounded-full"
            aria-label="添加附件"
            title="添加图片或文本文件"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <Plus />
          </InputGroupButton>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={event => {
              add(event.target.files ?? []);
              event.target.value = '';
            }}
          />
          <QuickPrompts
            conversation={conversation}
            disabled={locked}
            side={popupSide}
            onProblem={setProblem}
            onSend={message => onSend({ text: message, attachments: [] })}
          />
          <ChatModelControls id={id} disabled={busy} side={popupSide} />
          <div className="ml-auto flex items-center gap-1">
            <ContextUsage id={id} side={popupSide} />
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="rounded-full"
              aria-label="发送"
              title="Enter 发送 · Shift + Enter 换行"
              disabled={!canSend}
            >
              <ArrowUp />
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function ComposerNotice({
  message,
  modelSettings,
  onDismiss,
}: {
  message: string;
  modelSettings?: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="composer-notice">
      <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
      <p role="alert" className="min-w-0 flex-1 wrap-anywhere">
        {message}
      </p>
      {modelSettings && (
        <Link
          to="/settings"
          search={{ section: 'models' }}
          className="shrink-0 underline underline-offset-3"
        >
          去设置
        </Link>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-md"
        aria-label="关闭提示"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}

export function AttachmentChip({
  name,
  preview,
  onRemove,
}: {
  name: string;
  preview?: string;
  onRemove?: () => void;
}) {
  return (
    <span className="attachment-chip bg-secondary text-foreground/90 inline-flex h-8 max-w-56 min-w-0 items-center gap-1.5 rounded-lg pr-1 pl-1 text-xs">
      {preview ? (
        <img src={preview} alt="" className="size-6 shrink-0 rounded object-cover" />
      ) : (
        <FileText className="text-muted-foreground mx-1 size-3.5 shrink-0" />
      )}
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
      {onRemove ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:bg-background/60 grid size-5 shrink-0 place-items-center rounded-md transition-colors"
          aria-label={`移除 ${name}`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}
