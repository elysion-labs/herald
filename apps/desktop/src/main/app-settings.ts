import { join } from 'node:path';

import { defaultSystemPrompt } from '@herald/agent';
import { eq } from 'drizzle-orm';
import { shell } from 'electron';
import type { z } from 'zod';

import { agentSettings, defaultAgentSettings } from '../shared/agent-settings.ts';
import type { AgentSettings } from '../shared/agent-settings.ts';
import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';

export function openAppSettings(db: Database, directory: string) {
  const { appSettings } = schema;
  const agentDir = join(directory, 'agent');

  /** 一组设置对应一行键值；读取失败或缺失时回退默认值。 */
  function entry<T extends object>(key: string, shape: z.ZodType<T>, fallback: T) {
    return {
      read(): T {
        const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
        const parsed = shape.safeParse(row?.value);

        return parsed.success ? parsed.data : fallback;
      },
      save(input: Partial<T>): T {
        const value = shape.parse({ ...this.read(), ...input });

        db.insert(appSettings)
          .values({ key, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } })
          .run();

        return value;
      },
    };
  }

  const agent = entry<AgentSettings>('agent', agentSettings, defaultAgentSettings);

  return {
    agent: () => agent.read(),
    /** 设置页展示用：当前配置、默认提示词与 pi 资源目录。 */
    agentState: () => ({ ...agent.read(), defaultSystemPrompt, agentDir }),
    saveAgent: (input: Partial<AgentSettings>) => agent.save(input),
    openAgentDir: () => shell.openPath(agentDir),
  };
}
