// Чем реально рисует Chrome на этой машине: SwiftShader (эмуляция на CPU) или
// настоящий GPU. От ответа зависит, считать ли 50-секундный кадр приговором
// шейдеру или только нашему прибору.
import puppeteer from 'puppeteer';

const runs = [
  { name: 'без флагов GL', args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  { name: 'unsafe-swiftshader', args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'] },
];
for (const r of runs) {
  const chrome = await puppeteer.launch({
    userDataDir: `D:/mt5/tmp-nuclear/pprofile-gpu-${process.pid}`,
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: r.args,
  });
  const page = await chrome.newPage();
  const info = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { err: 'нет WebGL' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ver: gl.getParameter(gl.VERSION),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  });
  console.log(r.name, JSON.stringify(info));
  await chrome.close();
}
