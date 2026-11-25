import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { getSupportedThinkingLevels, ModelRuntime } from '@herald/agent';
import { ORPCError } from '@orpc/server';
import { safeStorage } from 'electron';
import { z } from 'zod';

import { chatModelChoice, customProvider, modelSelection } from '../shared/model-settings.ts';
import type {
  ChatModelChoice,
  CustomProvider,
  customProviderInput,
  modelDiscovery,
  presetKeyInput,
} from '../shared/model-settings.ts';

const legacyCustomId = 'herald-custom';

const listingItem = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  display_name: z.string().optional(),
  displayName: z.string().optional(),
});

const listing = z.object({
  data: z.array(listingItem).optional(),
  models: z.array(listingItem).optional(),
});

function normalizedUrl(baseUrl: string) {
  return new URL(baseUrl).href.replace(/\/+$/, '');
}

function customKey({ id, baseUrl }: Pick<CustomProvider, 'id' | 'baseUrl'>) {
  if (id === legacyCustomId) {
    return `custom:${new URL(baseUrl).href}`;
  }

  return `custom:${id}:${normalizedUrl(baseUrl)}`;
}

export function openModelSettings(database: DatabaseSync, directory: string) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_selection (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS model_keys (id TEXT PRIMARY KEY, value BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS custom_model_providers (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_models (
      id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      value TEXT NOT NULL
    );
  `);

  const readLegacy = database.prepare('SELECT value FROM model_selection WHERE id = 1');
  const readKey = database.prepare('SELECT value FROM model_keys WHERE id = ?');
  const writeKey = database.prepare('INSERT OR REPLACE INTO model_keys VALUES (?, ?)');
  const deleteKey = database.prepare('DELETE FROM model_keys WHERE id = ?');
  const readProviders = database.prepare('SELECT value FROM custom_model_providers ORDER BY id');
  const readProvider = database.prepare('SELECT value FROM custom_model_providers WHERE id = ?');

  const writeProvider = database.prepare(
    'INSERT OR REPLACE INTO custom_model_providers VALUES (?, ?)',
  );

  const readChoice = database.prepare('SELECT value FROM conversation_models WHERE id = ?');
  const writeChoice = database.prepare('INSERT OR REPLACE INTO conversation_models VALUES (?, ?)');
  const legacyRow = readLegacy.get();

  const legacy = legacyRow
    ? modelSelection.safeParse(JSON.parse(legacyRow.value as string)).data
    : undefined;

  if (legacy?.kind === 'custom' && !readProvider.get(legacyCustomId)) {
    const { api, baseUrl, model, contextWindow, maxTokens, reasoning, images } = legacy;

    const config: CustomProvider = {
      id: legacyCustomId,
      name: 'Herald 自定义',
      api,
      baseUrl,
      models: [{ id: model, name: model, contextWindow, maxTokens, reasoning, images }],
    };

    writeProvider.run(config.id, JSON.stringify(config));
  }

  const createRuntime = () =>
    ModelRuntime.create({
      authPath: join(directory, 'auth.json'),
      modelsPath: join(directory, 'models.json'),
    });

  function configuredProviders() {
    return readProviders.all().map(row => customProvider.parse(JSON.parse(row.value as string)));
  }

  async function loadRuntime() {
    const runtime = await createRuntime();
    const custom = configuredProviders();

    for (const provider of custom) {
      if (provider.models.length) {
        register(runtime, provider);
      }
    }

    return { runtime, custom };
  }

  function resolvedKeyId(provider: string, configured: CustomProvider[]) {
    const match = configured.find(item => item.id === provider);

    return match ? customKey(match) : provider;
  }

  function defaultChoice(runtime: ModelRuntime, custom: CustomProvider[]) {
    if (legacy) {
      const provider = legacy.kind === 'preset' ? legacy.provider : legacyCustomId;

      if (
        runtime.getModel(provider, legacy.model) &&
        (Boolean(readKey.get(resolvedKeyId(provider, custom))) ||
          runtime.hasConfiguredAuth(provider))
      ) {
        return { provider, model: legacy.model };
      }
    }

    const ready = runtime
      .getProviders()
      .find(
        provider =>
          runtime.getModels(provider.id).length &&
          (Boolean(readKey.get(resolvedKeyId(provider.id, custom))) ||
            runtime.hasConfiguredAuth(provider.id)),
      );

    const first = ready && runtime.getModels(ready.id)[0];

    return first && { provider: first.provider, model: first.id };
  }

  function choice(id: string) {
    const row = readChoice.get(id);

    return row ? chatModelChoice.parse(JSON.parse(row.value as string)) : undefined;
  }

  async function decrypt(id: string) {
    const key = readKey.get(id);

    if (!key) {
      return undefined;
    }

    const { result } = await safeStorage.decryptStringAsync(Buffer.from(key.value as Uint8Array));

    return result;
  }

  function storeKey(id: string, encrypted: Buffer | undefined, clearKey?: boolean) {
    if (encrypted) {
      writeKey.run(id, encrypted);
    } else if (clearKey) {
      deleteKey.run(id);
    }
  }

  return {
    async state() {
      const { runtime, custom } = await loadRuntime();

      const providers = runtime.getProviders().flatMap(provider => {
        const models = runtime.getModels(provider.id).map(model => ({
          id: model.id,
          name: model.name,
          thinking: getSupportedThinkingLevels(model),
        }));

        if (!models.length) {
          return [];
        }

        return [
          {
            id: provider.id,
            name: provider.name,
            models,
            hasSavedKey: Boolean(readKey.get(resolvedKeyId(provider.id, custom))),
            hasPiAuth: runtime.hasConfiguredAuth(provider.id),
            isCustom: custom.some(item => item.id === provider.id),
          },
        ];
      });

      return {
        defaultChoice: defaultChoice(runtime, custom),
        providers,
        custom: custom.map(provider => ({
          ...provider,
          hasSavedKey: Boolean(readKey.get(customKey(provider))),
        })),
      };
    },
    choice,
    async saveChoice(id: string, preference: ChatModelChoice) {
      const { runtime } = await loadRuntime();
      const model = runtime.getModel(preference.provider, preference.model);

      if (!model) {
        throw new ORPCError('BAD_REQUEST', { message: '所选模型不存在' });
      }

      if (preference.thinking && !getSupportedThinkingLevels(model).includes(preference.thinking)) {
        throw new ORPCError('BAD_REQUEST', { message: '所选模型不支持这个思考等级' });
      }

      writeChoice.run(id, JSON.stringify(preference));

      return preference;
    },
    async saveKey(input: z.infer<typeof presetKeyInput>) {
      const runtime = await createRuntime();

      if (!runtime.getProvider(input.provider)) {
        throw new ORPCError('BAD_REQUEST', { message: 'Pi 模型目录中没有该供应商' });
      }

      storeKey(input.provider, await encrypt(input.apiKey), input.clearKey);
    },
    async saveCustom({ provider, editing, apiKey, clearKey }: z.infer<typeof customProviderInput>) {
      const runtime = await createRuntime();

      if (runtime.getProvider(provider.id)) {
        throw new ORPCError('BAD_REQUEST', { message: 'Provider ID 已被 Pi 供应商使用' });
      }

      if (provider.models.length) {
        register(runtime, provider);
      }

      const encrypted = await encrypt(apiKey);

      if (!editing && readProvider.get(provider.id)) {
        throw new ORPCError('CONFLICT', { message: '该 Provider ID 已存在' });
      }

      database.exec('BEGIN');

      try {
        writeProvider.run(provider.id, JSON.stringify(provider));
        storeKey(customKey(provider), encrypted, clearKey);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async discover(input: z.infer<typeof modelDiscovery>) {
      const key = input.apiKey ?? (input.clearKey ? undefined : await decrypt(customKey(input)));

      return discoverModels(input, key);
    },
    async current(id: string) {
      const { runtime: modelRuntime, custom } = await loadRuntime();
      const explicit = choice(id);
      const preference = explicit ?? defaultChoice(modelRuntime, custom);

      if (!preference) {
        return { modelRuntime, model: undefined, thinking: undefined };
      }

      const model = modelRuntime.getModel(preference.provider, preference.model);

      if (!model) {
        throw new ORPCError('BAD_REQUEST', { message: '所选模型已移除，请在输入框重新选择' });
      }

      const key = await decrypt(resolvedKeyId(preference.provider, custom));

      if (key) {
        await modelRuntime.setRuntimeApiKey(preference.provider, key);
      }

      return { modelRuntime, model, thinking: explicit?.thinking };
    },
  };
}

function register(runtime: ModelRuntime, provider: CustomProvider) {
  runtime.registerProvider(provider.id, {
    name: provider.name,
    baseUrl: normalizedUrl(provider.baseUrl),
    api: provider.api,
    apiKey: 'herald-local',
    models: provider.models.map(model => ({
      id: model.id,
      name: model.name,
      input: model.images ? ['text', 'image'] : ['text'],
      reasoning: model.reasoning,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  });
}

async function encrypt(key?: string) {
  if (!key) {
    return undefined;
  }

  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new ORPCError('PRECONDITION_FAILED', { message: '系统密钥加密服务不可用' });
  }

  return safeStorage.encryptStringAsync(key);
}

const discoveryProtocols = {
  'openai-completions': { path: '', header: 'Authorization', prefix: 'Bearer ' },
  'openai-responses': { path: '', header: 'Authorization', prefix: 'Bearer ' },
  'anthropic-messages': { path: '/v1', header: 'x-api-key', prefix: '' },
  'google-generative-ai': { path: '/v1beta', header: 'x-goog-api-key', prefix: '' },
};

async function discoverModels(input: z.infer<typeof modelDiscovery>, key?: string) {
  const url = new URL(input.baseUrl);
  const headers = new Headers({ Accept: 'application/json' });
  const protocol = discoveryProtocols[input.api];

  if (input.api === 'anthropic-messages') {
    headers.set('anthropic-version', '2023-06-01');
  }

  if (key) {
    headers.set(protocol.header, `${protocol.prefix}${key}`);
  }

  const path = url.pathname === '/' ? protocol.path : url.pathname.replace(/\/+$/, '');
  url.pathname = `${path}/models`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  }).catch(() => undefined);

  if (!response?.ok) {
    throw new ORPCError('BAD_GATEWAY', { message: '无法读取供应商模型目录，可以手动添加模型' });
  }

  const result = listing.safeParse(await response.json().catch(() => undefined));
  const models = result.data?.data ?? result.data?.models;

  if (!models) {
    throw new ORPCError('BAD_GATEWAY', { message: '供应商没有返回可读取的模型目录' });
  }

  return models.slice(0, 200).flatMap(model => {
    const id = model.id ?? model.name?.replace(/^models\//, '');

    return id ? [{ id, name: model.display_name ?? model.displayName ?? id }] : [];
  });
}
