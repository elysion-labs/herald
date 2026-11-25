import { defineConfig } from '@byc/vp-config';
import { configDefaults } from 'vite-plus/test/config';

export default defineConfig(
  { test: { exclude: [...configDefaults.exclude, 'vendor/**'] } },
  { stylistic: true },
);
