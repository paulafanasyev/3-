// Быстрая проверка GLSL объёмного прохода без загрузки игры.
// Cesium подставляет в шейдер свои czm_-символы, поэтому перед компиляцией
// добавляем минимальный прелюд с их заглушками: этого хватает, чтобы
// компиратор WebGL сказал «синтаксис/типы» вместо шестиминутного захода в
// SwiftShader. Заодно ловит обратные кавычки внутри шаблонной строки JS.
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const file = process.env.SRC || 'src/game/client/nuclearVolumetrics.js';
const src = readFileSync(file, 'utf8');
const start = src.indexOf('const FS = /* glsl */ `');
if (start < 0) { console.log('GLSLCHECK FS не найден'); process.exit(1); }
const bodyFrom = src.indexOf('\n', start) + 1;
const bodyTo = src.indexOf('\n`;', bodyFrom);
if (bodyTo < 0) { console.log('GLSLCHECK FS не закрыт — внутри есть обратная кавычка'); process.exit(1); }
const fs = src.slice(bodyFrom, bodyTo);
const backticks = (fs.match(/`/g) || []).length;

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 czm_inverseProjection;
uniform vec4 czm_currentFrustum;
uniform vec3 czm_sunDirectionWC;
out vec4 out_FragColor;
float czm_readDepth(sampler2D depthTexture, vec2 uv) { return texture(depthTexture, uv).r; }
vec4 czm_unpackDepth(vec4 v) { return v; }
vec3 czm_linearToEyeZ(float z) { return vec3(z); }
`;

const chrome = await puppeteer.launch({
  userDataDir: process.env.PPDIR || `D:/mt5/tmp-nuclear/pprofile-glsl-${process.pid}`,
  headless: 'new',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await chrome.newPage();
const res = await page.evaluate((shader) => {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  const gl = c.getContext('webgl2');
  if (!gl) return { err: 'no webgl2' };
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(sh, shader);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS) === true;
  const log = gl.getShaderInfoLog(sh) || '';
  gl.deleteShader(sh);
  return { ok, log: log.slice(0, 4000) };
}, PRELUDE + fs);
await chrome.close();

const lines = fs.split('\n').length;
console.log(`GLSLCHECK строк=${lines} backticks=${backticks} ok=${res.ok === true}`);
console.log(res.err || res.log || '(пустой лог)');
