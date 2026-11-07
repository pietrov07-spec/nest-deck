// Arma la demo en vivo en demo-dist/ (la publica Vercel; ver vercel.json).
// Copia sin cambios la pantalla del Hub, el editor y la botonera de ejemplo; demo/sw.js hace el papel de la Mac.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'demo-dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

const copy = (from, to) => cpSync(join(root, from), join(out, to));
copy('demo/index.html', 'index.html');
copy('demo/sw.js', 'sw.js');
copy('public/index.html', 'hub.html');
copy('public/editor.html', 'editor.html');
copy('deck.example.json', 'deck.example.json');
copy('docs/img/hero.png', 'hero.png');
console.log('Demo lista en demo-dist/');
