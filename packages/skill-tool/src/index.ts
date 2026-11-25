import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { defineTool, loadSkills, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const bundledSkills = [
  'find-live-topic',
  'find-trending-videos',
  'lookup-viewer-profile',
  'remember-viewer',
] as const;

export function loadLiveSkills(
  cwd: string,
  agentDir: string,
  enabled: readonly string[] = bundledSkills,
) {
  const skillPaths = bundledSkills
    .filter(name => enabled.includes(name))
    .map(name => fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)));

  return loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false });
}

type LiveSkill = ReturnType<typeof loadLiveSkills>['skills'][number];
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

export function createSkillAgentTools({
  skills,
}: {
  skills: ReturnType<typeof loadLiveSkills>['skills'];
}) {
  const selectableSkills = skills.filter(skill => !skill.disableModelInvocation);

  return [
    defineTool({
      name: 'load_skill',
      label: '加载 Skill',
      description: `按名称加载 Herald 的工作流程。${selectableSkills
        .map(skill => `${skill.name}: ${skill.description}`)
        .join(' ')}`,
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }) }),
      async execute(_callId, { name }, signal) {
        const skill = selectableSkills.find(item => item.name === name);

        if (!skill) {
          throw new Error('Skill is unavailable');
        }

        const markdown = await readFile(skill.filePath, { encoding: 'utf8', signal });

        return { content: [{ type: 'text', text: markdown }], details: { name } };
      },
    }),
  ];
}
