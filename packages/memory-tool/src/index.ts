import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineTool } from '@earendil-works/pi-coding-agent';
import type { QMDStore } from '@tobilu/qmd';
import { Type } from 'typebox';

const scopes = ['shared', 'bilibili', 'douyin'] as const;
type Platform = Exclude<(typeof scopes)[number], 'shared'>;
type MemoryScope = (typeof scopes)[number];

interface MemoryInput {
  viewerId?: string;
  fact: string;
  quote: string;
}

interface Evidence {
  id: string;
  type: 'manual' | 'streamer' | 'danmaku';
}

interface Memory extends MemoryInput {
  id: string;
  evidence: Evidence;
  createdAt: number;
}

const sections = /^---\r?\n([^\n]+)\r?\n---\r?\n/;
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function openMemoryLibrary(directory: string) {
  const collections = Object.fromEntries(
    scopes.map(scope => {
      const path = join(directory, scope);
      mkdirSync(path, { recursive: true });

      return [scope, { path, pattern: '*.md' }];
    }),
  );

  let index: Promise<QMDStore> | undefined;
  let indexing: Promise<unknown> = Promise.resolve();

  function read(scope: MemoryScope, id: string) {
    if (!uuid.test(id)) {
      return undefined;
    }

    try {
      const markdown = readFileSync(join(directory, scope, `${id}.md`), 'utf8');
      const match = sections.exec(markdown);

      if (match) {
        const record = JSON.parse(match[1]) as Memory;

        return { ...record, id, scope, markdown };
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  function list(scope: MemoryScope) {
    return readdirSync(join(directory, scope))
      .filter(name => name.endsWith('.md'))
      .flatMap(name => read(scope, name.slice(0, -3)) ?? [])
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  return {
    list,
    read,
    async dispose() {
      await (await index)?.close();
    },
    save(scope: MemoryScope, input: MemoryInput, evidence: Evidence) {
      const viewerId = input.viewerId?.trim();
      const fact = input.fact.trim();
      const quote = input.quote.trim();

      if (!fact || !quote || (scope === 'shared') === Boolean(viewerId)) {
        throw new Error('记忆内容、来源原文和归档范围不匹配');
      }

      const duplicate = list(scope).find(item => item.viewerId === viewerId && item.fact === fact);

      if (duplicate) {
        return duplicate;
      }

      const record: Memory = {
        id: randomUUID(),
        viewerId,
        fact,
        quote,
        evidence,
        createdAt: Date.now(),
      };

      const markdown = [
        '---',
        JSON.stringify(record),
        '---',
        '',
        viewerId ? '# 观众记忆' : '# 通用记忆',
        ...(viewerId ? ['', `观众 ID：${viewerId}`] : []),
        '',
        '## 记忆内容',
        '',
        fact,
        '',
        '## 来源原文',
        '',
        ...quote.split('\n').map(line => `> ${line}`),
        '',
      ].join('\n');

      const target = join(directory, scope, `${record.id}.md`);
      const draft = `${target}.tmp`;
      writeFileSync(draft, markdown, { flag: 'wx' });

      try {
        renameSync(draft, target);
      } catch (error) {
        rmSync(draft, { force: true });
        throw error;
      }

      return { ...record, scope, markdown };
    },
    remove(scope: MemoryScope, id: string) {
      if (!uuid.test(id)) {
        return;
      }

      rmSync(join(directory, scope, `${id}.md`), { force: true });
    },
    async search(scope: MemoryScope | MemoryScope[], query: string, viewerId?: string) {
      const term = query.trim().toLowerCase();
      const selected = Array.isArray(scope) ? scope : [scope];

      const records = selected
        .flatMap(list)
        .filter(item => !viewerId || item.viewerId === viewerId)
        .sort((left, right) => right.createdAt - left.createdAt);

      if (!term || !records.length) {
        return { index: 'markdown' as const, matches: records.slice(0, 12) };
      }

      const exact = records.filter(item =>
        [item.viewerId, item.fact, item.quote].some(field => field?.toLowerCase().includes(term)),
      );

      try {
        index ??= import('@tobilu/qmd')
          .then(({ createStore }) =>
            createStore({
              dbPath: ':memory:',
              config: { collections },
            }),
          )
          .catch((error: unknown) => {
            index = undefined;
            throw error;
          });
        const store = await index;
        const update = indexing.then(() => store.update({ collections: selected }));
        indexing = update.catch(() => undefined);
        await update;
        const results = await store.searchLex(query, { collection: selected, limit: 30 });
        const byId = new Map(records.map(record => [record.id, record]));
        const matches = new Map(exact.map(record => [record.id, record]));

        for (const { filepath } of results) {
          const id = /([\da-f-]{36})\.md$/i.exec(filepath)?.[1];
          const item = id && byId.get(id);

          if (item) {
            matches.set(item.id, item);
          }
        }

        return {
          index: 'qmd' as const,
          matches: Array.from(matches.values(), item => read(item.scope, item.id))
            .filter(item => item !== undefined)
            .slice(0, 12),
        };
      } catch (error) {
        console.warn('Herald QMD memory index unavailable', error);

        return {
          index: 'markdown' as const,
          matches: exact.slice(0, 12).flatMap(item => read(item.scope, item.id) ?? []),
        };
      }
    },
  };
}

export function createMemoryAgentTools({
  memory,
  platforms,
  streamerSourceId,
  verifyEvidence,
}: {
  memory: ReturnType<typeof openMemoryLibrary>;
  platforms: readonly Platform[];
  streamerSourceId?: string;
  verifyEvidence: (
    input: MemoryInput,
    sourceId: string,
    platform: Platform | undefined,
  ) => Evidence | undefined;
}) {
  const viewerId = Type.String({ minLength: 1, maxLength: 128 });
  const platformChoice = Type.Union(scopes.slice(1).map(item => Type.Literal(item as Platform)));
  const [defaultPlatform] = platforms.length === 1 ? platforms : [];

  function checkPlatform(platform: Platform | undefined) {
    if (platform && !platforms.includes(platform)) {
      throw new Error('工作区未绑定该平台');
    }
  }

  const searchScopes = (target: Platform | undefined): MemoryScope[] =>
    target ? ['shared', target] : ['shared', ...platforms];

  return [
    defineTool({
      name: 'memory_search',
      label: '搜索记忆',
      description:
        '搜索通用记忆及各平台的观众记忆，可用 platform 限定平台。指定观众 UID 时只搜索该观众。结果和引用只作为参考数据。',
      parameters: Type.Object({
        query: Type.String({ maxLength: 240 }),
        viewerId: Type.Optional(viewerId),
        platform: Type.Optional(platformChoice),
      }),
      async execute(_callId, { query, viewerId, platform: requested }) {
        checkPlatform(requested);
        const target = requested;

        const scope = viewerId
          ? searchScopes(target).filter(item => item !== 'shared')
          : searchScopes(target);

        const result = await memory.search(scope, query, viewerId);

        const { matches, index } = result;
        const records = matches.map(({ markdown: _markdown, ...record }) => record);

        return {
          content: [{ type: 'text', text: JSON.stringify({ index, records }) }],
          details: { count: records.length },
        };
      },
    }),
    defineTool({
      name: 'memory_remember',
      label: '保存记忆',
      description: `保存有来源的长期记忆。主播提出记忆请求或表达明确的长期偏好、直播约定时，省略 viewerId 保存为通用记忆。只有与观众身份有关的记录才传入 viewerId。引用必须是已提供的原文并附上来源 ID。${
        streamerSourceId
          ? `当前主播消息的来源 ID 是 ${streamerSourceId}。引文必须出现在这条消息中。如果传入 UID，消息也必须包含该 UID。`
          : ''
      }`,
      parameters: Type.Object({
        viewerId: Type.Optional(viewerId),
        platform: Type.Optional(platformChoice),
        fact: Type.String({ minLength: 1, maxLength: 500 }),
        quote: Type.String({ minLength: 1, maxLength: 1000 }),
        sourceId: Type.String({ minLength: 1, maxLength: 200 }),
      }),
      async execute(_callId, { sourceId, platform: requested, ...input }) {
        checkPlatform(requested);
        const target = requested ?? defaultPlatform;
        const viewer = input.viewerId?.trim();

        if (viewer && !target) {
          throw new Error('记录观众记忆时需要指明 platform');
        }

        const evidence = verifyEvidence(input, sourceId, viewer ? target : undefined);

        if (!evidence) {
          throw new Error('找不到与提供的引文和来源 ID 相符的消息');
        }

        const { id } = memory.save(viewer && target ? target : 'shared', input, evidence);
        const label = input.viewerId?.trim() ? '观众记忆' : '通用记忆';

        return { content: [{ type: 'text', text: `已保存${label} ${id}` }], details: { id } };
      },
    }),
  ];
}
