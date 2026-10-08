import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public/web', { recursive: true });
mkdirSync('public/domain', { recursive: true });
for (const file of ['connected.js', 'connected.css', 'styles.css']) copyFileSync(`web/${file}`, `public/web/${file}`);
copyFileSync('domain/core.mjs', 'public/domain/core.mjs');
