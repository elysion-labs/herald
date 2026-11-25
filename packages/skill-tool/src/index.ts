import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { defineTool, loadSkills } from '@earendil-works/pi-coding-agent';
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
