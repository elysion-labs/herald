import { join } from 'node:path';

import { defaultSystemPrompt } from '@herald/agent';
import { eq } from 'drizzle-orm';
import { shell } from 'electron';

import { agentSettings, defaultAgentSettings } from '../shared/agent-settings.ts';
import type { AgentSettings } from '../shared/agent-settings.ts';
import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';

const agentKey = 'agent';

export function openAppSettings(db: Database, directory: string) {
  const { appSettings } = schema;
  const agentDir = join(directory, 'agent');

  function agent(): AgentSettings {
    const row = db.select().from(appSettings).where(eq(appSettings.key, agentKey)).get();
    const parsed = agentSettings.safeParse(row?.value);

    return parsed.success ? parsed.data : defaultAgentSettings;
  }

  return {
    agent,
    /** 设置页展示用：当前配置、默认提示词与 pi 资源目录。 */
    agentState: () => ({ ...agent(), defaultSystemPrompt, agentDir }),
    saveAgent(input: Partial<AgentSettings>) {
      const value = agentSettings.parse({ ...agent(), ...input });

      db.insert(appSettings)
        .values({ key: agentKey, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run();

      return value;
    },
    openAgentDir: () => shell.openPath(agentDir),
  };
}
