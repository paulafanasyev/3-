#!/usr/bin/env node
// The Russian i18n bot sometimes translates words inside code identifiers
// (ROCKET_MISSION_* -> ROCKET_МИССИЯ_*), which breaks imports and tests.
// This restores the Latin identifiers. Only UPPER_SNAKE tokens that contain an
// underscore and a known Cyrillic word are rewritten; UI strings are untouched.
//   node scripts/repair-i18n-identifiers.mjs          rewrite files in place
//   node scripts/repair-i18n-identifiers.mjs --check  exit 1 if anything is broken
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const IDENTIFIER_WORDS = Object.freeze({
  'МИССИЯ': 'MISSION',
  'МИССИИ': 'MISSION',
  'ОРБИТА': 'ORBIT',
  'СТУПЕНЬ': 'STAGE',
  'ФОКУС': 'FOCUS',
  'ПОВТОР': 'REPLAY',
  'ЗАПУСК': 'LAUNCH',
  'СПУТНИК': 'SATELLITE',
  'ТРАЕКТОРИЯ': 'TRAJECTORY',
});

const TOKEN = /(?<![\p{L}\p{N}_$])[\p{Lu}\p{N}_]+(?![\p{L}\p{N}_$])/gu;
const CYRILLIC = /[\u0400-\u04FF]/;
const CYRILLIC_WORD = /[\u0400-\u04FF]+/g;

/** Repair one source text. Returns the new text plus what changed and what was left. */
export function repairIdentifiers(source) {
  const fixed = new Map();
  const unknown = new Set();
  const text = source.replace(TOKEN, (token) => {
    if (!token.includes('_') || !CYRILLIC.test(token)) return token;
    let ok = true;
    const next = token.replace(CYRILLIC_WORD, (word) => {
      const latin = IDENTIFIER_WORDS[word];
      if (!latin) ok = false;
      return latin || word;
    });
    if (!ok) { unknown.add(token); return token; }
    fixed.set(token, next);
    return next;
  });
  return { text, fixed: [...fixed], unknown: [...unknown] };
}

function sourceFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (/\.(m?js)$/.test(entry.name)) out.push(abs);
    }
  };
  for (const top of ['src', 'server', 'scripts']) if (existsSync(path.join(root, top))) visit(path.join(root, top));
  return out.sort();
}

/** Scan the repository; with write=true, rewrite broken files. */
export function repairRepository(root = process.cwd(), { write = true } = {}) {
  const changed = [];
  const unknown = [];
  for (const file of sourceFiles(root)) {
    if (file.endsWith('repair-i18n-identifiers.mjs') || file.endsWith('i18nIdentifiers.test.mjs')) continue;
    const source = readFileSync(file, 'utf8');
    const result = repairIdentifiers(source);
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (result.unknown.length) unknown.push({ file: rel, tokens: result.unknown });
    if (result.text !== source) {
      changed.push({ file: rel, fixed: result.fixed });
      if (write) writeFileSync(file, result.text);
    }
  }
  return { changed, unknown };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const check = process.argv.includes('--check');
  const { changed, unknown } = repairRepository(process.cwd(), { write: !check });
  for (const c of changed) console.log(`${check ? 'broken' : 'fixed'}: ${c.file} (${c.fixed.map(([a, b]) => `${a}->${b}`).join(', ')})`);
  for (const u of unknown) console.log(`unknown Cyrillic identifiers in ${u.file}: ${u.tokens.join(', ')}`);
  if (!changed.length && !unknown.length) console.log('identifiers ok');
  if (check && (changed.length || unknown.length)) process.exitCode = 1;
}
