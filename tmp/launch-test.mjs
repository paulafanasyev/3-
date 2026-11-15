import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const udd = 'D:/mt5/kupol-verify/tmp/chrome-profile';
mkdirSync(udd, { recursive: true });
for (const hl of ['new', true]) {
  try {
    const b = await puppeteer.launch({
      headless: hl, executablePath: exe, userDataDir: udd, dumpio: false,
      args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','--disable-dev-shm-usage','--hide-scrollbars'],
    });
    const p = await b.newPage();
    await p.setContent('<canvas id=c></canvas>');
    const webgl = await p.evaluate(() => { const c=document.getElementById('c'); const g=c.getContext('webgl')||c.getContext('experimental-webgl'); return g? g.getParameter(g.VERSION): 'NO WEBGL'; });
    console.log(`headless=${hl} OK version=${await b.version()} webgl=${webgl}`);
    await b.close();
  } catch (e) { console.log(`headless=${hl} FAIL: ${e.message}`); }
}
