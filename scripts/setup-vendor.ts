import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vendorDirectory = fileURLToPath(new URL('../vendor/', import.meta.url));

interface VendorDependency {
  name: string;
  url: string;
  revision: string;
}

const dependencies: VendorDependency[] = [
  {
    name: 'blive-ws',
    url: 'https://github.com/elysion-labs/blive-ws.git',
    revision: 'b23c094bdf4d51ec5b2d9f64b02873a0a826d78c',
  },
  {
    name: 'dylive-ws',
    url: 'https://github.com/elysion-labs/dylive-ws.git',
    revision: 'c3ef4a3028f17f2d0d0842a8e9d50f52a5d6d884',
  },
];

function run(command: string, args: string[], cwd: string, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.error) {
    throw new Error(`无法运行 ${command}，请确认它已安装并在 PATH 中`, { cause: result.error });
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败`);
  }

  return result.stdout?.trim();
}

function setup({ name, url, revision }: VendorDependency) {
  const directory = join(vendorDirectory, name);

  if (!existsSync(directory)) {
    run('git', ['clone', '--', url, directory], vendorDirectory);
  }

  if (!existsSync(join(directory, '.git'))) {
    throw new Error(`vendor/${name} 已存在，但缺少 Git 仓库信息`);
  }

  const origin = run('git', ['remote', 'get-url', 'origin'], directory, true);

  if (origin?.replace(/\.git$/, '') !== url.replace(/\.git$/, '')) {
    throw new Error(`vendor/${name} 的 origin 与预期不符`);
  }

  const current = run('git', ['rev-parse', 'HEAD'], directory, true);

  if (current !== revision) {
    if (run('git', ['status', '--porcelain'], directory, true)) {
      throw new Error(`vendor/${name} 有本地改动，请先保存，再切换到 ${revision}`);
    }

    run('git', ['fetch', 'origin', revision], directory);
    run('git', ['switch', '--detach', revision], directory);
  }

  console.log(`构建 vendor/${name}`);
  run('vp', ['install', '--frozen-lockfile'], directory);
  run('vp', ['run', 'build'], directory);
}

try {
  mkdirSync(vendorDirectory, { recursive: true });

  for (const dependency of dependencies) {
    setup(dependency);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
