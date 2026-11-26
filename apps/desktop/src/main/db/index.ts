import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { app } from 'electron';

import * as schema from './schema.ts';

/** 打开 Herald 数据库并执行 drizzle-kit 生成的迁移。 */
export function openDatabase(directory: string) {
  const client = new DatabaseSync(join(directory, 'herald.sqlite'));
  const db = drizzle({ client, schema });

  /*
   * 迁移在事务中执行，事务里的 PRAGMA foreign_keys=OFF 不生效；
   * 迁移完成后再开启外键，避免重建表时级联删除子表数据。
   */
  migrate(db, { migrationsFolder: join(app.getAppPath(), 'drizzle') });
  client.exec('PRAGMA foreign_keys = ON');

  return db;
}

export type Database = ReturnType<typeof openDatabase>;

export { schema };
