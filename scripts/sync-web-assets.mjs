import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public/web', { recursive: true });
mkdirSync('public/domain', { recursive: true });
for (const file of ['connected.js', 'connected.css', 'solvepad.js', 'solvepad.css', 'pdf-pages.js', 'note-render.js', 'styles.css']) copyFileSync(`web/${file}`, `public/web/${file}`);
copyFileSync('domain/core.mjs', 'public/domain/core.mjs');
mkdirSync('public/vendor/pdfjs', { recursive: true });
mkdirSync('public/vendor/katex', { recursive: true });
for (const file of ['pdf.mjs','pdf.worker.mjs']) copyFileSync(`node_modules/pdfjs-dist/build/${file}`,`public/vendor/pdfjs/${file}`);
copyFileSync('node_modules/katex/dist/katex.mjs','public/vendor/katex/katex.mjs');
