// Класс дефекта, из-за которого 25 тестов падали только на Windows (CI 2026-11-16):
// тест читал исходник как текст и искал в нём литеральные переводы строк, а
// core.autocrlf=true кладёт в рабочее дерево CRLF. Мера становилась
// платформозависимой молча — на Linux всё зелёное, на Windows «X is missing».
// Чтение текста обязан давать readSourceText; этот тест не даёт вернуться к сырому.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceText } from '../scripts/readSourceText.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawRead = new RegExp('read' + 'File(?:Sync)?\\(', 'g');
const utf8Arg = new RegExp("['\"]" + 'utf-?8' + "['\"]");

function collectTestFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, acc);
    else if (entry.name.endsWith('.test.mjs')) acc.push(full);
  }
  return acc;
}

function argumentsOf(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return '';
}

test('unit tests read text only through the LF-normalizing helper', () => {
  const offenders = [];
  for (const file of collectTestFiles(here)) {
    const text = readSourceText(file);
    for (const match of text.matchAll(rawRead)) {
      const args = argumentsOf(text, match.index + match[0].length - 1);
      if (!utf8Arg.test(args)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${path.relative(here, file)}:${line}`);
    }
  }
  assert.deepEqual(offenders, [], `сырое текстовое чтение меряет CRLF рабочего дерева: ${offenders.join(', ')}`);
});

test('the helper leaves no carriage return in text it returns', () => {
  const throughHelper = readSourceText(path.join(here, '..', 'index.html'));
  assert.ok(!throughHelper.includes('\r'), 'readSourceText обязан снимать \\r и на CRLF, и на LF-машине');
  assert.ok(throughHelper.includes('<'), 'текст при этом остаётся текстом');
});
