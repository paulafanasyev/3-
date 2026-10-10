#!/usr/bin/env node
// Рендер портретов лидеров в PNG для всех настроений (нужен sharp).
//   node scripts/game-portraits.mjs  →  public/game/leaders/<нация>[-<настроение>].png и .svg
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { LEADER_FACES, LEADER_MOODS, renderLeaderSVG } from '../src/game/faces/leaderFaces.js';

const out = new URL('../public/game/leaders/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const id of Object.keys(LEADER_FACES)) {
  for (const mood of LEADER_MOODS) {
    const svg = renderLeaderSVG(id, { mood });
    const name = mood === 'neutral' ? id : `${id}-${mood}`;
    writeFileSync(new URL(`${name}.svg`, out), svg);
    await sharp(Buffer.from(svg), { density: 192 }).resize(480, 540).png().toFile(new URL(`${name}.png`, out).pathname);
  }
}
console.log('портреты готовы');

// заглушка для своей нации: тёмный силуэт в той же рамке
const custom = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 360"><rect width="320" height="360" fill="#2A2F38"/><path d="M31 360 Q45 310 101 281 Q126 273 139 276 L181 276 Q194 273 219 281 Q275 310 289 360Z" fill="#14171C"/><path d="M140 224 L140 286 L180 286 L180 224Z" fill="#14171C"/><ellipse cx="160" cy="160" rx="64" ry="104" fill="#14171C"/><text x="160" y="186" font-family="DejaVu Sans, sans-serif" font-size="72" fill="#5C6575" text-anchor="middle">?</text><rect x="3" y="3" width="314" height="354" fill="none" stroke="#A0A8B8" stroke-width="6"/></svg>`;
writeFileSync(new URL('custom.svg', out), custom);
await sharp(Buffer.from(custom), { density: 192 }).resize(480, 540).png().toFile(new URL('custom.png', out).pathname);
