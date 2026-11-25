import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { modelApis } from '../shared/model-settings.ts';
import type { CustomModel, CustomProvider } from '../shared/model-settings.ts';
import { rpc } from './rpc.ts';
import { SearchableSelect } from './searchable-select.tsx';

export const modelCatalogQuery = { queryKey: ['model-catalog'], queryFn: () => rpc.models.state() };
type Catalog = Awaited<ReturnType<typeof rpc.models.state>>;
type ConfiguredProvider = Catalog['custom'][number];
const newProvider = '@new';

const apiLabels: Record<CustomProvider['api'], string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
};

export function ModelSettings() {
  const catalog = useQuery(modelCatalogQuery);

  return (
    <Card aria-labelledby="model-settings-heading">
      <Tabs defaultValue="preset" className="gap-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle id="model-settings-heading">模型供应商</CardTitle>
          <TabsList>
            <TabsTrigger value="preset">内置模型供应商</TabsTrigger>
            <TabsTrigger value="custom">自定义模型 API</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent className="pt-4">
          {catalog.data ? (
            <ProviderSettings state={catalog.data} />
          ) : (
            <p
              role={catalog.isError ? 'alert' : 'status'}
              className="text-muted-foreground text-sm"
            >
              {catalog.isError ? catalog.error.message : '正在加载模型目录…'}
            </p>
          )}
        </CardContent>
      </Tabs>
    </Card>
  );
}

function ProviderSettings({ state }: { state: Catalog }) {
  const [editing, setEditing] = useState(state.custom[0]?.id ?? newProvider);
  const selected = state.custom.find(item => item.id === editing);

  return (
    <>
      <TabsContent value="preset">
        <PresetKeys providers={state.providers.filter(item => !item.isCustom)} />
      </TabsContent>
      <TabsContent value="custom" className="grid gap-4">
        {state.custom.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="自定义供应商">
            {state.custom.map(item => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={item.id === editing ? 'secondary' : 'ghost'}
                aria-pressed={item.id === editing}
                onClick={() => setEditing(item.id)}
              >
                {item.name}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={editing === newProvider ? 'secondary' : 'ghost'}
              aria-pressed={editing === newProvider}
              onClick={() => setEditing(newProvider)}
            >
              <Plus data-icon="inline-start" />
              新建
            </Button>
          </div>
        )}
        <CustomProviderForm key={editing} existing={selected} onCreated={setEditing} />
      </TabsContent>
    </>
  );
}

function PresetKeys({ providers }: { providers: Catalog['providers'] }) {
  const client = useQueryClient();
  const [providerId, setProviderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const provider = providers.find(item => item.id === providerId);

  const save = useMutation({
    mutationFn: (clearKey: boolean) =>
      rpc.models.saveKey({
        provider: providerId,
        apiKey: clearKey ? undefined : apiKey.trim(),
        clearKey,
      }),
    async onSuccess() {
      setApiKey('');
      await client.invalidateQueries({ queryKey: modelCatalogQuery.queryKey });
    },
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        save.mutate(false);
      }}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="model-provider">供应商</FieldLabel>
          <SearchableSelect
            id="model-provider"
            value={providerId}
            searchPlaceholder="搜索供应商"
            emptyText="没有匹配的供应商"
            options={providers.map(item => ({
              value: item.id,
              label: item.name || item.id,
              keywords: [item.id],
            }))}
            onChange={id => {
              setProviderId(id);
              setApiKey('');
              save.reset();
            }}
          />
        </Field>
        {provider && (
          <Field>
            <FieldLabel htmlFor="preset-api-key">API Key</FieldLabel>
            <Input
              id="preset-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
            />
            {(provider.hasSavedKey || provider.hasPiAuth) && (
              <FieldDescription>已有可用凭证。</FieldDescription>
            )}
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!providerId || !apiKey.trim() || save.isPending}>
            保存凭证
          </Button>
          {provider?.hasSavedKey && (
            <Button
              variant="ghost"
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate(true)}
            >
              清除本地密钥
            </Button>
          )}
          {save.isSuccess && (
            <p role="status" className="text-muted-foreground text-sm">
              已保存
            </p>
          )}
        </div>
        {save.isError && <FieldError>{save.error.message}</FieldError>}
      </FieldGroup>
    </form>
  );
}

const defaultModel = {
  id: '',
  name: '',
  contextWindow: 32768,
  maxTokens: 4096,
  reasoning: false,
  images: false,
};

type ModelDraft = CustomModel & { key: string };
type ProviderFields = Omit<CustomProvider, 'models'>;

function CustomProviderForm({
  existing,
  onCreated,
}: {
  existing?: ConfiguredProvider;
  onCreated: (id: string) => void;
}) {
  const client = useQueryClient();

  const [fields, setFields] = useState<ProviderFields>(
    () => existing ?? { id: '', name: '', baseUrl: '', api: 'openai-completions' },
  );

  const [models, setModels] = useState<ModelDraft[]>(
    () => existing?.models.map(model => ({ ...model, key: crypto.randomUUID() })) ?? [],
  );

  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const savedKey = Boolean(existing?.hasSavedKey && existing.baseUrl === fields.baseUrl);
  const credentials = { apiKey: apiKey.trim() || undefined, clearKey };

  const save = useMutation({
    mutationFn: () =>
      rpc.models.saveCustom({
        editing: Boolean(existing),
        provider: {
          ...fields,
          models: models.map(({ key: _key, ...model }) => ({
            ...model,
            name: model.name.trim() || model.id.trim(),
          })),
        },
        ...credentials,
      }),
    async onSuccess() {
      setApiKey('');
      setClearKey(false);
      await client.invalidateQueries({ queryKey: modelCatalogQuery.queryKey });
      onCreated(fields.id);
    },
  });

  const discover = useMutation({
    mutationFn: () => rpc.models.discover({ ...fields, ...credentials }),
    onSuccess: found =>
      setModels(previous => {
        const byId = new Map(previous.map(item => [item.id, item]));

        for (const model of found) {
          if (!byId.has(model.id)) {
            byId.set(model.id, { ...defaultModel, ...model, key: crypto.randomUUID() });
          }
        }

        return Array.from(byId.values());
      }),
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <FieldGroup className="gap-4">
        <ProviderFormFields
          fields={fields}
          existing={Boolean(existing)}
          onChange={value => {
            if (fields.baseUrl !== value.baseUrl) {
              setApiKey('');
              setClearKey(false);
            }

            setFields(value);
          }}
        />
        <Field>
          <FieldLabel htmlFor="custom-api-key">API Key</FieldLabel>
          <Input
            id="custom-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={event => {
              setApiKey(event.target.value);
              setClearKey(false);
            }}
          />
          {savedKey && (
            <FieldLabel>
              <input
                type="checkbox"
                checked={clearKey}
                onChange={event => {
                  setClearKey(event.target.checked);
                  setApiKey('');
                }}
              />
              清除已保存的密钥
            </FieldLabel>
          )}
        </Field>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">模型目录</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!fields.id || !URL.canParse(fields.baseUrl) || discover.isPending}
            onClick={() => discover.mutate()}
          >
            {discover.isPending ? '正在获取…' : '获取可用模型'}
          </Button>
        </div>
        {models.length === 0 && (
          <p className="text-muted-foreground text-sm">添加模型后即可在聊天输入框选择。</p>
        )}
        {models.map(model => (
          <CatalogModelRow
            key={model.key}
            model={model}
            onChange={next =>
              setModels(all => all.map(item => (item.key === next.key ? next : item)))
            }
            onRemove={() => setModels(all => all.filter(item => item.key !== model.key))}
          />
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setModels(all => [...all, { ...defaultModel, key: crypto.randomUUID() }])
            }
          >
            <Plus data-icon="inline-start" />
            添加模型
          </Button>
        </div>
        <FieldError>{(save.error ?? discover.error)?.message}</FieldError>
        <ProviderSaveFooter
          existing={Boolean(existing)}
          pending={save.isPending}
          saved={save.isSuccess}
        />
      </FieldGroup>
    </form>
  );
}

function ProviderSaveFooter({
  existing,
  pending,
  saved,
}: {
  existing: boolean;
  pending: boolean;
  saved: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {saved && (
        <span role="status" className="text-muted-foreground text-sm">
          已保存
        </span>
      )}
      <Button type="submit" disabled={pending}>
        {existing ? '保存供应商' : '创建供应商'}
      </Button>
    </div>
  );
}

function ProviderFormFields({
  fields,
  existing,
  onChange,
}: {
  fields: ProviderFields;
  existing: boolean;
  onChange: (fields: ProviderFields) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="provider-id">Provider ID</FieldLabel>
          <Input
            id="provider-id"
            required
            pattern="[a-z][a-z0-9\-]{0,63}"
            placeholder="acme-gateway"
            value={fields.id}
            disabled={existing}
            onChange={event => onChange({ ...fields, id: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="provider-name">显示名称</FieldLabel>
          <Input
            id="provider-name"
            required
            value={fields.name}
            onChange={event => onChange({ ...fields, name: event.target.value })}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="model-url">API 地址</FieldLabel>
        <Input
          id="model-url"
          required
          type="url"
          placeholder="https://example.com/v1"
          value={fields.baseUrl}
          onChange={event => onChange({ ...fields, baseUrl: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="model-api">API 协议</FieldLabel>
        <Select
          value={fields.api}
          onValueChange={value => {
            const api = modelApis.find(item => item === value);

            if (api) {
              onChange({ ...fields, api });
            }
          }}
        >
          <SelectTrigger id="model-api" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              {modelApis.map(api => (
                <SelectItem key={api} value={api}>
                  {apiLabels[api]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

function CatalogModelRow({
  model,
  onChange,
  onRemove,
}: {
  model: ModelDraft;
  onChange: (model: ModelDraft) => void;
  onRemove: () => void;
}) {
  return (
    <Collapsible className="border-border grid gap-3 rounded-xl border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="模型 ID"
          className="min-w-24 flex-1"
          required
          placeholder="模型 ID"
          value={model.id}
          onChange={event => onChange({ ...model, id: event.target.value })}
        />
        <Input
          aria-label="模型显示名称"
          className="min-w-24 flex-1"
          placeholder="显示名称"
          value={model.name}
          onChange={event => onChange({ ...model, name: event.target.value })}
        />
        <CollapsibleTrigger asChild>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="模型能力">
            <Settings2 />
          </Button>
        </CollapsibleTrigger>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="移除模型"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor={`context-${model.key}`}>上下文窗口</FieldLabel>
            <Input
              id={`context-${model.key}`}
              type="number"
              min={1024}
              value={model.contextWindow}
              onChange={event => onChange({ ...model, contextWindow: Number(event.target.value) })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`output-${model.key}`}>最大输出</FieldLabel>
            <Input
              id={`output-${model.key}`}
              type="number"
              min={1}
              value={model.maxTokens}
              onChange={event => onChange({ ...model, maxTokens: Number(event.target.value) })}
            />
          </Field>
          <FieldLabel>
            <input
              type="checkbox"
              checked={model.reasoning}
              onChange={event => onChange({ ...model, reasoning: event.target.checked })}
            />
            支持推理
          </FieldLabel>
          <FieldLabel>
            <input
              type="checkbox"
              checked={model.images}
              onChange={event => onChange({ ...model, images: event.target.checked })}
            />
            支持图片
          </FieldLabel>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
