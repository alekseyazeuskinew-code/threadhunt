// Сборка расширения через esbuild: бандлит TS + workspace-импорты (@threadhunt/shared).
// background/popup — ESM, content-script — IIFE (MV3 content-scripts не модули).
import esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist/src', { recursive: true });

const common = { bundle: true, target: 'chrome110', logLevel: 'info' };

const builds = [
  { entryPoints: { 'src/background': 'src/background.ts' }, outdir: 'dist', format: 'esm', ...common },
  { entryPoints: { popup: 'src/popup.ts' }, outdir: 'dist', format: 'esm', ...common },
  { entryPoints: { 'src/content': 'src/content.ts' }, outdir: 'dist', format: 'iife', ...common },
  { entryPoints: { 'src/pair': 'src/pair.ts' }, outdir: 'dist', format: 'iife', ...common },
];

function copyStatic() {
  cpSync('manifest.json', 'dist/manifest.json');
  cpSync('popup.html', 'dist/popup.html');
  cpSync('icons', 'dist/icons', { recursive: true });
}

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context(b);
    await ctx.watch();
  }
  copyStatic();
  console.log('👀 watch: dist/ обновляется');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
  console.log('✅ Собрано в dist/ — загрузи как unpacked в chrome://extensions');
}
