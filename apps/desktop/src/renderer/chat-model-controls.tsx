import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroupButton } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { ChatModelChoice } from '../shared/model-settings.ts';
import { modelCatalogQuery } from './model-settings.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace, workspaceKey } from './workspace-context.ts';

const levels = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
};

export function chatModelKey(workspaceId: string, id: string) {
  return [...workspaceKey(workspaceId), 'chat-model-choice', id];
}

export function ChatModelControls({ id, disabled }: { id: string; disabled: boolean }) {
  const client = useQueryClient();
  const catalog = useQuery(modelCatalogQuery);
  const { id: workspaceId } = useWorkspace();
  const queryKey = chatModelKey(workspaceId, id);

  const choice = useQuery({
    queryKey,
    queryFn: async () => (await rpc.models.choice({ workspaceId, id })) ?? null,
  });

  const [open, setOpen] = useState(false);
  const current = choice.data ?? catalog.data?.defaultChoice;
  const { providers, label, thinking } = modelPickerState(catalog.data?.providers, current);

  const save = useMutation({
    mutationKey: queryKey,
    mutationFn: (next: ChatModelChoice) => rpc.models.select({ workspaceId, id, choice: next }),
    onSuccess(next) {
      client.setQueryData(queryKey, next);
      setOpen(false);
    },
  });

  const locked = disabled || save.isPending;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <InputGroupButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked}
            aria-label="选择模型"
          >
            <span className="max-w-28 truncate">{label}</span>
            <ChevronDown data-icon="inline-end" />
          </InputGroupButton>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 p-0">
          <ModelPicker
            providers={providers}
            current={current}
            disabled={save.isPending}
            onSelect={next => save.mutate(next)}
            onManage={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <ThinkingControl
        current={choice.data}
        model={current}
        available={thinking}
        disabled={locked}
        onSelect={next => save.mutate(next)}
      />
      {save.isError && (
        <span role="alert" className="text-destructive text-xs" title={save.error.message}>
          切换失败
        </span>
      )}
    </>
  );
}

type ProviderList = Awaited<ReturnType<typeof rpc.models.state>>['providers'];

function modelPickerState(catalog: ProviderList | undefined, choice: ChatModelChoice | undefined) {
  const providers = (catalog ?? []).filter(
    item => item.isCustom || item.hasPiAuth || item.hasSavedKey,
  );

  const provider = providers.find(item => item.id === choice?.provider);
  const model = provider?.models.find(item => item.id === choice?.model);

  return {
    providers,
    label: model?.name ?? choice?.model ?? '选择模型',
    thinking: model?.thinking ?? [],
  };
}

/** shadcn Model Selector：按供应商分组、可搜索，右上角齿轮进入模型设置。 */
function ModelPicker({
  providers,
  current,
  disabled,
  onSelect,
  onManage,
}: {
  providers: ProviderList;
  current?: ChatModelChoice;
  disabled: boolean;
  onSelect: (choice: ChatModelChoice) => void;
  onManage: () => void;
}) {
  return (
    <Command className="rounded-xl p-0">
      <div className="flex items-center gap-1 pr-1.5">
        <div className="min-w-0 flex-1">
          <CommandInput placeholder="搜索模型" />
        </div>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Link
            to="/settings"
            search={{ section: 'models' }}
            aria-label="管理模型供应商"
            title="管理模型供应商"
            onClick={onManage}
          >
            <Settings2 />
          </Link>
        </Button>
      </div>
      <CommandList className="max-h-80">
        <CommandEmpty>
          {providers.length ? '没有匹配的模型' : '还没有可用的模型供应商'}
        </CommandEmpty>
        {providers.map(provider => (
          <CommandGroup key={provider.id} heading={provider.name || provider.id}>
            {provider.models.map(model => (
              <CommandItem
                key={model.id}
                value={`${provider.id}/${model.id}`}
                keywords={[model.name, model.id, provider.name, provider.id]}
                disabled={disabled}
                data-checked={current?.provider === provider.id && current.model === model.id}
                onSelect={() => onSelect({ provider: provider.id, model: model.id })}
              >
                <span className="truncate">{model.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

function ThinkingControl({
  current,
  model,
  available,
  disabled,
  onSelect,
}: {
  current?: ChatModelChoice | null;
  model?: ChatModelChoice;
  available: NonNullable<ChatModelChoice['thinking']>[];
  disabled: boolean;
  onSelect: (next: ChatModelChoice) => void;
}) {
  const reasoning = available.some(level => level !== 'off');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label="思考等级"
          disabled={disabled || !reasoning}
          title={reasoning ? '思考等级' : '当前模型未提供思考等级'}
        >
          思考 {current?.thinking ? levels[current.thinking] : '自动'}
          <ChevronDown data-icon="inline-end" />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              if (model) {
                onSelect({ ...model, thinking: undefined });
              }
            }}
          >
            自动
          </DropdownMenuItem>
          {available.map(level => (
            <DropdownMenuItem
              key={level}
              onSelect={() => {
                if (model) {
                  onSelect({ ...model, thinking: level });
                }
              }}
            >
              {levels[level]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
