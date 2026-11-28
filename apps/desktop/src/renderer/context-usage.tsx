import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { InputGroupButton } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { rpc } from './rpc.ts';
import { useWorkspace, workspaceKey } from './workspace-context.ts';

type Usage = Awaited<ReturnType<typeof rpc.conversations.usage>>;

export const usageKey = (workspaceId: string, id: string) => [
  ...workspaceKey(workspaceId),
  'usage',
  id,
];

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const warnAt = 0.8;

/** 已用上下文占窗口的比例；没有数据或未知窗口时为 0。 */
function usageRatio(usage: Usage | undefined) {
  return usage?.contextWindow ? usage.contextTokens / usage.contextWindow : 0;
}

function Ring({ ratio }: { ratio: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg viewBox="0 0 18 18" className="size-3.5 -rotate-90" aria-hidden="true">
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2"
        className="stroke-muted-foreground/50"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(ratio, 1))}
        className={ratio >= warnAt ? 'stroke-warning' : 'stroke-muted-foreground'}
        style={{ transition: 'stroke-dashoffset 400ms var(--ease-out)' }}
      />
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium tabular-nums" title={value}>
        {value}
      </span>
    </div>
  );
}

function WindowUsage({ usage }: { usage: Usage }) {
  const ratio = usageRatio(usage);
  const percent = Math.round(ratio * 100);

  if (!usage.contextWindow) {
    return <p className="text-muted-foreground">已使用 0% · 暂无上下文数据</p>;
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between">
        <span className="text-muted-foreground">已使用 {percent}%</span>
        <span className="tabular-nums">
          {compact.format(usage.contextTokens)} / {compact.format(usage.contextWindow)}
        </span>
      </div>
      <div className="bg-border h-1.5 overflow-hidden rounded-full">
        <div
          className={ratio >= warnAt ? 'bg-warning h-full' : 'bg-foreground/70 h-full'}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="text-muted-foreground">接近上限时会自动压缩较早的对话</p>
    </div>
  );
}

function UsageDetails({ usage }: { usage?: Usage }) {
  if (!usage) {
    return <p className="text-muted-foreground">正在读取…</p>;
  }

  return (
    <>
      <WindowUsage usage={usage} />
      <div className="border-border grid gap-1 border-t pt-2">
        <Row
          label="Tokens"
          value={`${compact.format(usage.input)} ↑ · ${compact.format(usage.output)} ↓`}
        />
        <Row label="Cost" value={`$${usage.cost.toFixed(2)}`} />
        {usage.model && <Row label="模型" value={usage.model.name} />}
      </div>
    </>
  );
}

/** 发送按钮旁的上下文占用圆环，悬停查看窗口占用、累计 token 与费用。 */
export function ContextUsage({ id, side }: { id: string; side: 'top' | 'bottom' }) {
  const { id: workspaceId } = useWorkspace();

  const { data } = useQuery({
    queryKey: usageKey(workspaceId, id),
    queryFn: () => rpc.conversations.usage({ workspaceId, id }),
  });

  const ratio = usageRatio(data);
  const percent = Math.round(ratio * 100);
  const [reason, setReason] = useState<'hover' | 'click'>();

  // 悬停打开、点击也可切换；卡片与其他弹出层同一套样式。
  return (
    <Popover
      open={reason !== undefined}
      onOpenChange={open => setReason(open ? 'click' : undefined)}
    >
      <PopoverTrigger asChild>
        <InputGroupButton
          type="button"
          size="xs"
          className="composer-action tabular-nums"
          aria-label={`上下文已使用 ${percent}%`}
          onPointerEnter={event => {
            if (event.pointerType === 'mouse') {
              setReason(current => current ?? 'hover');
            }
          }}
          onPointerLeave={() => setReason(current => (current === 'hover' ? undefined : current))}
          onClick={event => {
            event.preventDefault();
            setReason(current => (current === 'click' ? undefined : 'click'));
          }}
        >
          <Ring ratio={ratio} />
          <span>{percent}%</span>
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={8}
        aria-label="上下文窗口"
        className="w-60 text-xs"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <div className="grid gap-2">
          <p className="text-sm font-medium">上下文窗口</p>
          <UsageDetails usage={data} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
