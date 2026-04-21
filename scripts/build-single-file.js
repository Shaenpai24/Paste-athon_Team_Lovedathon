#!/usr/bin/env node
/**
 * Build ChainForge into one offline HTML file.
 *
 * The app already runs from index.html. This script creates a packaged copy
 * with CSS and JavaScript inlined so it can be shared as a single file.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const outDir = path.join(root, 'dist');
const outPath = path.join(outDir, 'chainforge.html');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function escapeClosingScript(source) {
  return source.replace(/<\/script>/gi, '<\\/script>');
}

let html = read('index.html');

html = html.replace(
  /<link rel="stylesheet" href="styles\/main\.css" \/>/,
  () => `<style>\n${read('styles/main.css')}\n</style>`
);

const scripts = [
  'src/Graph.js',
  'src/Kahn.js',
  'src/State.js',
  'src/Storage.js',
  'src/Extractor.js',
  'src/Exporter.js',
  'src/Resolver.js',
  'src/Canvas.js',
  'src/App.js',
];

for (const script of scripts) {
  const tag = `<script src="${script}"></script>`;
  html = html.replace(tag, () => `<script>\n${escapeClosingScript(read(script))}\n</script>`);
}

html = html.replace(
  '<span><a href="tests/test.html">Tests</a> · <a href="dist/chainforge.html">Single-file build</a></span>',
  '<span>Single-file offline build</span>'
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html);
const bytes = fs.statSync(outPath).size;
console.log(`Wrote ${path.relative(root, outPath)} (${bytes.toLocaleString()} bytes)`);
