// Разведка железа: чем реально рисует браузер на этой машине. Замер FPS имеет
// смысл только на настоящей видеокарте — swiftshader считает кадры процессором и
// даёт цифры, которые игрок никогда не увидит.
import puppeteer from 'puppeteer';

const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const variants = [
  { name: 'angle-d3d11', args: ['--use-gl=angle', '--use-angle=d3d11'] },
  { name: 'gl-none', args: [] },
  { name: 'swiftshader', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
];

for (const variant of variants) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chrome,
      userDataDir: `${process.env.KUPOL_QA_OUT || 'D:/mt5/tmp-nuclear'}/chrome-gpu-${variant.name}`,
      args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', ...variant.args],
    });
    const page = await browser.newPage();
    await page.goto('data:text/html,<canvas id=c></canvas>');
    const info = await page.evaluate(() => {
      const gl = document.getElementById('c').getContext('webgl2');
      if (!gl) return { ok: false };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        ok: true,
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        // сколько на самом деле кадров в секунду пропускает браузер
        raf: true,
      };
    });
    console.log(`${variant.name}: ${JSON.stringify(info)}`);
  } catch (error) {
    console.log(`${variant.name}: FAIL ${String(error.message).slice(0, 160)}`);
  } finally {
    if (browser) await browser.close();
  }
}
