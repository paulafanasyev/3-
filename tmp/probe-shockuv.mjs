// Замер величины UV-сдвига ударного фронта вживую: если смещение в кадре
// больше нескольких пикселей — конвертация пикселей в UV сломана.
import puppeteer from 'puppeteer';
const port = 5241, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 900000,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(`${base}/vol-lab.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.ready === true', { timeout: 420000, polling: 2000 });

const info = await page.evaluate(async () => {
  const r = window.lab({ fraction: 0.12, southM: 60000, camAltM: 4000, lookUpM: 1500, iso: '2026-06-21T19:15:00Z' });
  await new Promise((res) => setTimeout(res, 6000));
  const stage = window.__stage;
  const u = stage.uniforms;
  const cv = window.__viewer.scene.canvas;
  const dump = (v) => (v && typeof v.x === 'number' ? [v.x, v.y, v.z ?? null, v.w ?? null] : v);
  return {
    lab: { city: r.city?.name ?? r.city, bomb: r.bomb, yieldKt: r.yieldKt, age: r.age, boundR: r.bound },
    canvas: [cv.width, cv.height, cv.clientWidth, cv.clientHeight],
    u_shock: dump(u.u_shock), u_shock2: dump(u.u_shock2), u_shock3: dump(u.u_shock3),
    u_rayTan: dump(u.u_rayTan),
  };
});
console.log(JSON.stringify(info, null, 1));

// Визуализация сдвига: пиксель яркости = 1 пиксель смещения (масштаб 1280).
const patched = await page.evaluate(() => {
  const stage = window.__stage;
  const fs = stage.fragmentShader;
  const anchor = 'vec2 off = dir * dispPx * u_shock3.zw;';
  if (!fs.includes(anchor)) return 'ANCHOR MISSING';
  stage.fragmentShader = fs.replace(anchor, `${anchor}
        out_FragColor = vec4(vec3(min(1.0, length(off) * 1280.0)), 1.0);
        return;`);
  return 'patched';
});
console.log('shader:', patched);
await sleep(8000);
await page.screenshot({ path: 'D:/mt5/tmp-nuclear/shots/lab_shockuv.png' });
await browser.close();
