import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { app } from 'electron';

import * as schema from './schema.ts';

/** 打开 Herald 数据库并执行 drizzle-kit 生成的迁移。 */
export function openDatabase(directory: string) {
  const client = new DatabaseSync(join(directory, 'herald.sqlite'));
  client.exec('PRAGMA foreign_keys = ON');

  const db = drizzle({ client, schema });
  migrate(db, { migrationsFolder: join(app.getAppPath(), 'drizzle') });

  return db;
}

export type Database = ReturnType<typeof openDatabase>;

export { schema };
