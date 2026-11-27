import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { defaultAssistantSettings } from '@herald/live-assistant/settings';
import { ORPCError } from '@orpc/server';
import { asc, eq } from 'drizzle-orm';

import { openAppSettings } from './app-settings.ts';
import { openDatabase, schema } from './db/index.ts';
import { openModelSettings } from './model-settings.ts';
import { openWorkspace } from './workspace.ts';

const removedDirectory = /^([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.removed$/i;

function cleanupDirectory(path: string) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    console.warn('工作区文件清理失败，下次启动会重试', path, error);
  }
}

/** 如果上次在移动目录后退出，根据数据库记录继续删除或恢复工作区。 */
function recoverDirectories(root: string, existing: ReadonlySet<string>) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const id = removedDirectory.exec(entry.name)?.[1];

    if (!id || !entry.isDirectory()) {
      continue;
    }

    const path = join(root, entry.name);

    if (existing.has(id)) {
      renameSync(path, join(root, id));
    } else {
      cleanupDirectory(path);
    }
  }
}

export function openWorkspaces(directory: string) {
  const agentDir = join(directory, 'agent');
  const workspaceRoot = join(directory, 'workspaces');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const db = openDatabase(directory);
  const models = openModelSettings(db, directory);
  const settings = openAppSettings(db, directory);
  const { workspaces, danmaku } = schema;
  const instances = new Map<string, ReturnType<typeof openWorkspace>>();
  const workspaceDirectory = (id: string) => join(workspaceRoot, id);
  const identity = { id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt };

  const list = () =>
    db
      .select(identity)
      .from(workspaces)
      .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
      .all();

  function attach(id: string) {
    const instance = build(id);
    register(instance);
  }

  function build(id: string) {
    return openWorkspace({
      db,
      id,
      directory: workspaceDirectory(id),
      agentDir,
      settings,
      models,
    });
  }

  function register(instance: ReturnType<typeof openWorkspace>) {
    instances.set(instance.id, instance);
    instance.rooms.start();
  }

  function create(name: string) {
    const row = { id: randomUUID(), name, createdAt: Date.now() };

    const instance = db.transaction(() => {
      db.insert(workspaces)
        .values({ ...row, assistant: defaultAssistantSettings })
        .run();

      return build(row.id);
    });

    register(instance);

    return row;
  }

  function get(id: string) {
    const instance = instances.get(id);

    if (!instance) {
      throw new ORPCError('NOT_FOUND', { message: '找不到工作区' });
    }

    return instance;
  }

  const existing = list();
  const ids = new Set(existing.map(row => row.id));
  recoverDirectories(workspaceRoot, ids);

  if (!existing.length) {
    create('默认工作区');
  }

  for (const { id } of existing) {
    attach(id);
  }

  return {
    list,
    get,
    create,
    models,
    settings,
    rename(id: string, name: string) {
      get(id);

      return db
        .update(workspaces)
        .set({ name })
        .where(eq(workspaces.id, id))
        .returning(identity)
        .get();
    },
    remove(id: string) {
      const instance = get(id);

      if (instance.isBusy()) {
        throw new ORPCError('CONFLICT', { message: '工作区仍有会话运行，请稍后再删除' });
      }

      const path = workspaceDirectory(id);
      const removedPath = `${path}.removed`;
      renameSync(path, removedPath);

      try {
        instance.danmaku.flush();
        db.transaction(() => {
          db.delete(danmaku).where(eq(danmaku.workspaceId, id)).run();
          db.delete(workspaces).where(eq(workspaces.id, id)).run();
        });
      } catch (error) {
        renameSync(removedPath, path);
        throw error;
      }

      instances.delete(id);
      instance.dispose();

      if (!instances.size) {
        create('默认工作区');
      }

      cleanupDirectory(removedPath);

      return list();
    },
    dispose() {
      for (const instance of instances.values()) {
        instance.dispose();
      }

      instances.clear();
      db.$client.close();
    },
  };
}
