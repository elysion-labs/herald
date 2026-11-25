import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { InputGroupButton } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { ChatModelChoice } from '../shared/model-settings.ts';
import { modelCatalogQuery } from './model-settings.tsx';
import { rpc } from './rpc.ts';

const levels = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
};

export function chatModelKey(id: string) {
  return ['chat-model-choice', id];
}

export function ChatModelControls({ id, disabled }: { id: string; disabled: boolean }) {
  const client = useQueryClient();
  const catalog = useQuery(modelCatalogQuery);
  const queryKey = chatModelKey(id);
  const choice = useQuery({ queryKey, queryFn: async () => (await rpc.models.choice(id)) ?? null });
  const [open, setOpen] = useState(false);
  const current = choice.data ?? catalog.data?.defaultChoice;
  const { providers, label, thinking } = modelPickerState(catalog.data?.providers, current);

  const save = useMutation({
    mutationKey: queryKey,
    mutationFn: (next: ChatModelChoice) => rpc.models.select({ id, choice: next }),
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
        <PopoverContent side="top" align="start" className="w-64">
          <ModelPicker
            providers={providers}
            current={current}
            disabled={save.isPending}
            onSelect={next => save.mutate(next)}
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

function ModelPicker({
  providers,
  current,
  disabled,
  onSelect,
}: {
  providers: ProviderList;
  current?: ChatModelChoice;
  disabled: boolean;
  onSelect: (choice: ChatModelChoice) => void;
}) {
  const [providerId, setProviderId] = useState(current?.provider);
  const [filter, setFilter] = useState('');
  const provider = providers.find(item => item.id === providerId);
  const term = filter.trim().toLocaleLowerCase();

  const models = provider?.models.filter(model =>
    [model.name, model.id].some(value => value.toLocaleLowerCase().includes(term)),
  );

  return (
    <div className="grid gap-2">
      {provider ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{provider.name || provider.id}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="切换供应商"
              onClick={() => {
                setProviderId(undefined);
                setFilter('');
              }}
            >
              供应商
            </Button>
          </div>
          <Input
            aria-label="筛选模型"
            placeholder="筛选模型"
            value={filter}
            onChange={event => setFilter(event.target.value)}
          />
          <div className="grid max-h-64 gap-0.5 overflow-y-auto">
            {models?.map(model => (
              <Button
                key={model.id}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={disabled}
                onClick={() => onSelect({ provider: provider.id, model: model.id })}
              >
                <span className="truncate">{model.name}</span>
              </Button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid max-h-64 gap-0.5 overflow-y-auto">
          {providers.map(item => (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => setProviderId(item.id)}
            >
              <span className="truncate">{item.name || item.id}</span>
            </Button>
          ))}
        </div>
      )}
      <Button asChild variant="outline" size="sm">
        <Link to="/settings">管理模型供应商</Link>
      </Button>
    </div>
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
