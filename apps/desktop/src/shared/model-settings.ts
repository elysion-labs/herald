import { z } from 'zod';

export const modelApis = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;

const modelId = z.string().trim().min(1).max(256);

const baseUrl = z.url({ protocol: /^https?$/ }).refine(value => {
  const url = new URL(value);

  return !url.username && !url.password && !url.search && !url.hash;
}, '请输入不含凭证、查询参数或片段的服务地址');

const modelLimits = {
  contextWindow: z.number().int().min(1024).max(10000000),
  maxTokens: z.number().int().min(1).max(1000000),
  reasoning: z.boolean(),
  images: z.boolean(),
};

const credential = {
  apiKey: z.string().trim().min(1).max(4096).optional(),
  clearKey: z.boolean().optional(),
};

const customModel = z
  .object({
    id: modelId,
    name: modelId,
    ...modelLimits,
  })
  .refine(model => model.maxTokens <= model.contextWindow, '最大输出不能超过上下文窗口');

export const customProvider = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z\d-]{0,63}$/),
  name: modelId,
  baseUrl,
  api: z.enum(modelApis),
  models: z
    .array(customModel)
    .max(200)
    .refine(
      models => new Set(models.map(model => model.id)).size === models.length,
      '模型 ID 不能重复',
    ),
});

export const customProviderInput = z.object({
  provider: customProvider,
  editing: z.boolean(),
  ...credential,
});

export const presetKeyInput = z.object({ provider: modelId, ...credential });

export const modelDiscovery = z.object({
  id: customProvider.shape.id,
  baseUrl,
  api: z.enum(modelApis),
  apiKey: credential.apiKey,
  clearKey: credential.clearKey,
});

export const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const chatModelChoice = z.object({
  provider: modelId,
  model: modelId,
  thinking: z.enum(thinkingLevels).optional(),
});

export type CustomProvider = z.infer<typeof customProvider>;

export type CustomModel = z.infer<typeof customModel>;

export type ChatModelChoice = z.infer<typeof chatModelChoice>;
