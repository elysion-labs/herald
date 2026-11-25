import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { stripFrontmatter } from '@earendil-works/pi-coding-agent';
import type { Skill } from '@earendil-works/pi-coding-agent';

const bundledSkills = [
  'find-live-topic',
  'find-trending-videos',
  'lookup-viewer-profile',
  'remember-viewer',
] as const;

/** Herald 自带 skill 的 SKILL.md 路径，交给 pi 的 DefaultResourceLoader 一起发现。 */
export function bundledSkillPaths(enabled: readonly string[] = bundledSkills) {
  return bundledSkills
    .filter(name => enabled.includes(name))
    .map(name => fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)));
}

type LiveSkill = Pick<Skill, 'name' | 'filePath' | 'baseDir'>;
const skillCommand = /^\/skill:(\S+)(?:\s+|$)/;

/**
 * 展开消息开头连续的 `/skill:名称` 命令。pi 自身只展开第一个，这里按相同格式逐个展开，
 * 展开后的文本不再以 `/skill:` 开头，pi 会原样发送。
 */
export async function expandSkillCommands(text: string, skills: readonly LiveSkill[]) {
  const blocks: string[] = [];
  let rest = text;

  for (let match = skillCommand.exec(rest); match; match = skillCommand.exec(rest)) {
    const skill = skills.find(item => item.name === match?.[1]);

    if (!skill) {
      break;
    }

    const body = stripFrontmatter(await readFile(skill.filePath, 'utf8')).trim();

    blocks.push(
      `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`,
    );
    rest = rest.slice(match[0].length);
  }

  return blocks.length ? [...blocks, rest.trim()].filter(Boolean).join('\n\n') : text;
}
