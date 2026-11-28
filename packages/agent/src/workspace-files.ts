import { lstatSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

const fileTools = new Set(['read', 'write', 'edit', 'find', 'grep', 'ls']);

function contains(root: string, path: string) {
  const offset = relative(root, path);

  return offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

/** 新文件可能还不存在，使用最近的真实父目录判断符号链接指向哪里。 */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const parent = dirname(path);

    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT') ||
      parent === path
    ) {
      throw error;
    }

    const info = lstatSync(path, { throwIfNoEntry: false });

    if (info?.isSymbolicLink()) {
      throw error;
    }

    const actual = await canonical(parent);

    return resolve(actual, relative(parent, path));
  }
}

export function workspaceFiles(
  cwd: string,
  agentDir: string,
  bundled: readonly string[],
): ExtensionFactory {
  return pi => {
    pi.on('tool_call', async event => {
      if (!fileTools.has(event.toolName)) {
        return;
      }

      const raw = 'path' in event.input ? event.input.path : undefined;
      const name = typeof raw === 'string' ? raw : '.';
      const cleaned = name.replace(/^@/, '').replaceAll(/[\u00a0\u202f]/g, ' ');
      const path = await canonical(resolve(cwd, cleaned));
      const root = await canonical(cwd);

      if (contains(root, path)) {
        return { input: { ...event.input, path } };
      }

      if (event.toolName === 'read') {
        const global = await canonical(agentDir);
        const skills = await Promise.all(bundled.map(file => canonical(file)));

        if (contains(global, path) || skills.includes(path)) {
          return { input: { ...event.input, path } };
        }
      }

      return { block: true, reason: '文件不在当前工作区或共享技能目录内。' };
    });
  };
}
