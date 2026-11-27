import { z } from 'zod';

/** pi 内置的高风险工具：写文件、编辑文件、执行命令（bash / powershell）。 */
export const builtinTools = ['write', 'edit', 'exec'] as const;

export const builtinToolLabels: Record<(typeof builtinTools)[number], string> = {
  write: '写入文件',
  edit: '编辑文件',
  exec: '执行命令',
};

export const agentSettings = z.object({
  systemPromptExtra: z.string().max(8000),
  builtinTools: z.object({ write: z.boolean(), edit: z.boolean(), exec: z.boolean() }),
});

export type AgentSettings = z.infer<typeof agentSettings>;

export const defaultAgentSettings: AgentSettings = {
  systemPromptExtra: '',
  builtinTools: { write: false, edit: false, exec: false },
};
