// Механизм «завала» в лабе, где дёргать конвейер можно напрямую.
// Все состояния имеют postProcess.length > 0 (наша стадия висит в коллекции,
// просто enabled=false), поэтому usePostProcess одинаков во всех замерах и
// любая разница — чисто от пути «пользовательская стадия включена».
// Пробные стадии — честные сквозные копирки с разными правками, чтобы увидеть,
// какое именно преобразование конвейер делает над фоном.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';

const port = Number(process.env.PORT || 5252);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex').slice(0, 12);

let vite = null;
const up = async () => { try { return (await fetch(`${base}/vol-lab.html`)).ok; } catch { return false; } };
if (!(await up())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 160; i += 1) { if (await up()) break; await sleep(500); }
}
const browser = await puppeteer.launch({
  userDataDir: 'D:/mt5/tmp-nuclear/pprofilecolor',
  headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 300)));
await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 1000 });

const info = await page.evaluate(() => window.lab({
  bomb: 'little_boy', city: 'London', fraction: 0.5,
  southM: 40000, camAltM: 12000, lookUpM: 6000, iso: '2026-06-21T19:15:00Z',
}));
console.log('lab', JSON.stringify(info));

const flags = await page.evaluate(() => {
  const s = window.__viewer.scene;
  return {
    hdr: s.highDynamicRange, hdrSupported: s.highDynamicRangeSupported,
    fxaa: s.postProcessStages.fxaa.enabled, bloom: s.postProcessStages.bloom.enabled,
    ao: s.postProcessStages.ambientOcclusion.enabled, fog: s.fog.enabled,
    tonemapper: String(s.postProcessStages.tonemapper), exposure: s.postProcessStages.exposure,
    length: s.postProcessStages.length, resolutionScale: window.__viewer.resolutionScale,
    dbw: s.canvas.width, dbh: s.canvas.height,
  };
});
console.log('flags', JSON.stringify(flags));

// Гасим нашу объёмную стадию: пусть висит в коллекции, но не исполняется.
await page.evaluate(() => { window.__stage.enabled = false; window.__stage.show = false; });

const HDR = 'uniform sampler2D colorTexture;\nin vec2 v_textureCoordinates;\nvoid main() {\n';
const PROBES = [
  ['base', null],
  ['copy', `${HDR}  out_FragColor = texture(colorTexture, v_textureCoordinates);\n}`],
  ['gammaup', `${HDR}  out_FragColor = vec4(pow(texture(colorTexture, v_textureCoordinates).rgb, vec3(0.4545454)), 1.0);\n}`],
  ['gammadn', `${HDR}  out_FragColor = vec4(pow(texture(colorTexture, v_textureCoordinates).rgb, vec3(2.2)), 1.0);\n}`],
  ['alpha1', `${HDR}  out_FragColor = vec4(texture(colorTexture, v_textureCoordinates).rgb, 1.0);\n}`],
];

await page.evaluate(() => {
  window.__mk = (src) => {
    const Cesium = window.__Cesium;
    const col = window.__viewer.scene.postProcessStages;
    for (let i = col.length - 1; i >= 0; i -= 1) {
      const s = col.get(i);
      if (s && String(s.name).indexOf('probe-') === 0) { col.remove(s); }
    }
    if (!src) return null;
    const st = new Cesium.PostProcessStage({ name: `probe-${Math.random()}`, fragmentShader: src });
    col.add(st);
    window.__probe = st;
    return st.name;
  };
  window.__clean = () => {
    const col = window.__viewer.scene.postProcessStages;
    for (let i = col.length - 1; i >= 0; i -= 1) {
      const s = col.get(i);
      if (s && String(s.name).indexOf('probe-') === 0) col.remove(s);
    }
    window.__probe = null;
    return col.length;
  };
});

for (const [name, src] of PROBES) {
  const mk = await page.evaluate((s) => (s ? window.__mk(s) : (window.__clean(), null)), src);
  await sleep(9000);
  const shot = await page.screenshot();
  const fs = await import('node:fs');
  fs.writeFileSync(`D:/mt5/tmp-nuclear/shots/color_${name}.png`, shot);
  console.log(`color_${name} md5=${md5(shot)} probe=${JSON.stringify(mk)}`);
}
console.log('COLOR TEST DONE');
await browser.close();
vite?.kill('SIGTERM');
