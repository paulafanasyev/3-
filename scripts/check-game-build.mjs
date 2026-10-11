#!/usr/bin/env node
// Проверка обязательных артефактов production-сборки «Купола».
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function hasKupolEntry(distDir, files) {
  const htmlCandidates = [join(distDir, 'index.html'), join(distDir, 'kupol', 'index.html')];
  const html = htmlCandidates.find((path) => existsSync(path) && statSync(path).isFile());
  if (!html) return { ok: false, detail: 'страница dist/index.html (маршрут /kupol) не найдена' };
  const htmlText = readFileSync(html, 'utf8');
  const gameScript = files
    .filter((path) => /\.(?:js|mjs)$/.test(path))
    .some((path) => /bootKupol|Купол|\/kupol/.test(readFileSync(path, 'utf8')));
  if (!gameScript && !/kupol|main\.js/i.test(htmlText)) {
    return { ok: false, detail: 'в собранном entry не найден запуск игры «Купол»' };
  }
  return { ok: true, detail: relative(distDir, html) };
}

/**
 * Проверяет production dist без запуска Vite.
 * @param {string} distDir - корень production-сборки.
 * @returns {{ok:boolean, errors:string[], checks:Record<string,boolean>}}
 */
export function checkGameBuild(distDir) {
  const root = resolve(distDir);
  const files = walk(root);
  const errors = [];
  const checks = {};

  const kupol = hasKupolEntry(root, files);
  checks.kupol = kupol.ok;
  if (!kupol.ok) errors.push(`«Купол»: ${kupol.detail}`);

  const naturalEarth = files.some((path) => (
    /(?:^|[\\/])cesium[\\/](?:[^\\/]+[\\/])*Assets[\\/]Textures[\\/]NaturalEarthII[\\/]/i.test(path)
  ));
  checks.naturalEarth = naturalEarth;
  if (!naturalEarth) errors.push('Cesium NaturalEarthII: не найдены Assets/Textures/NaturalEarthII в dist');

  const unitsIndex = join(root, 'game', 'units', 'forge', 'index.json');
  let unitFiles = [];
  let indexOk = false;
  try {
    const index = JSON.parse(readFileSync(unitsIndex, 'utf8'));
    const listed = Object.values(index).flatMap((era) => Array.isArray(era) ? era : []);
    unitFiles = listed.map((entry) => join(root, 'game', 'units', 'forge', entry.file?.replace(/^forge[\\/]/, '') || ''));
    indexOk = listed.length > 0 && unitFiles.every((path) => existsSync(path) && statSync(path).isFile());
  } catch {
    indexOk = false;
  }
  checks.units = indexOk;
  if (!indexOk) errors.push('юниты: game/units/forge/index.json или перечисленные GLB отсутствуют');

  const portraitDir = join(root, 'game', 'leaders');
  const portraits = existsSync(portraitDir)
    ? readdirSync(portraitDir).filter((name) => /\.(?:png|svg)$/i.test(name))
    : [];
  checks.portraits = portraits.length > 0;
  if (!checks.portraits) errors.push('портреты лидеров: в dist/game/leaders нет PNG/SVG');

  return { ok: errors.length === 0, errors, checks };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const result = checkGameBuild(process.argv[2] || join(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
  if (!result.ok) {
    for (const error of result.errors) console.error(`ПРОВЕРКА СБОРКИ: ${error}`);
    process.exitCode = 1;
  } else {
    console.log('ПРОВЕРКА СБОРКИ: артефакты «Купола» и Cesium на месте');
  }
}
