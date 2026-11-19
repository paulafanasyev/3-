import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const BASE = process.env.KUPOL_BASE_URL || 'http://10.0.2.2:4173';
mkdirSync('artifacts', { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageErrors = [];
const audioResponses = new Set();

function adb(args, options = {}) {
  try {
    return execFileSync('adb', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      ...options,
    }).trim();
  } catch (error) {
    const details = [error.message, error.stderr?.toString(), error.stdout?.toString()].filter(Boolean).join('\n');
    throw new Error(`adb ${args.join(' ')} failed:\n${details}`);
  }
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

async function waitFor(fn, label, timeoutMs = 60_000, intervalMs = 300) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function dismissPixelLauncherAnr() {
  const nodes = chromeUiNodes();
  const dialog = nodes.find((entry) => /Pixel Launcher isn't responding/i.test(entry));
  if (!dialog) return false;

  console.log('Android emulator recovery: Pixel Launcher ANR detected');
  const close = nodes.find((entry) => entry.includes('resource-id="android:id/aerr_close"'));
  const wait = nodes.find((entry) => entry.includes('resource-id="android:id/aerr_wait"'));
  const action = close || wait;
  const bounds = action?.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (bounds) {
    const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
    const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
    adb(['shell', 'input', 'tap', String(x), String(y)]);
    console.log('Android emulator recovery: dismissed launcher ANR with ' + (close ? 'Close app' : 'Wait'));
  }
  adb(['shell', 'am', 'force-stop', 'com.google.android.apps.nexuslauncher']);
  return true;
}

function chromeUiNodes() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/kupol-chrome-ui.xml']);
  const xml = adb(['shell', 'cat', '/sdcard/kupol-chrome-ui.xml']);
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => match[0]);
}

function findChromeUiNode(pattern) {
  return chromeUiNodes().find((entry) => {
    const text = entry.match(/\btext="([^"]*)"/)?.[1] || '';
    const description = entry.match(/\bcontent-desc="([^"]*)"/)?.[1] || '';
    const resourceId = entry.match(/\bresource-id="([^"]*)"/)?.[1] || '';
    const visible = !/\bvisible-to-user="false"/.test(entry);
    return visible && pattern.test(text + ' ' + description + ' ' + resourceId);
  }) || null;
}

function tapChromeUiNode(node, label) {
  const bounds = node?.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) throw new Error('Chrome UI node has no parsable bounds (' + label + '): ' + (node || 'not found'));
  const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
  const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
  console.log('Chrome UI tap "' + label + '" at ' + x + ',' + y + ': ' + node);
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

async function findChromeSettingsNode(pattern, label, timeoutMs = 20_000) {
  let attempts = 0;
  let lastNodes = [];
  try {
    return await waitFor(() => {
      lastNodes = chromeUiNodes();
      const node = lastNodes.find((entry) => {
        const text = entry.match(/\btext="([^"]*)"/)?.[1] || '';
        const description = entry.match(/\bcontent-desc="([^"]*)"/)?.[1] || '';
        const resourceId = entry.match(/\bresource-id="([^"]*)"/)?.[1] || '';
        const visible = !/\bvisible-to-user="false"/.test(entry);
        return visible && pattern.test(text + ' ' + description + ' ' + resourceId);
      });
      attempts += 1;
      if (!node && attempts % 2 === 0) {
        adb(['shell', 'input', 'swipe', '540', '2050', '540', '700', '450']);
      }
      return node || null;
    }, label, timeoutMs, 400);
  } catch (error) {
    throw new Error(error.message + '\nChrome Settings UI while searching for "' + label + '":\n' + lastNodes.join('\n'));
  }
}

async function enableChromeUsbWebDebugging() {
  // Navigate through Chrome's visible menu. Sending chrome:// URLs as Android
  // VIEW intents can leave the current page unchanged on Play Store builds.
  const menu = await findChromeSettingsNode(/com\.android\.chrome:id\/menu_button/, 'Chrome toolbar menu', 10_000);
  tapChromeUiNode(menu, 'Chrome menu');
  const settings = await findChromeSettingsNode(/\bSettings\b/i, 'Chrome menu > Settings', 10_000);
  tapChromeUiNode(settings, 'Settings');

  const developerTools = await findChromeSettingsNode(/developer tools/i, 'Chrome Settings > Developer tools');
  tapChromeUiNode(developerTools, 'Developer tools');

  const usbDebugging = await findChromeSettingsNode(/enable usb web debugging/i, 'Chrome Developer tools > Enable USB Web debugging');
  const checked = usbDebugging.match(/\bchecked="(true|false)"/)?.[1];
  if (checked !== 'true') {
    tapChromeUiNode(usbDebugging, 'Enable USB Web debugging');
    await sleep(1_000);
  } else {
    console.log('Chrome USB Web debugging was already enabled');
  }

  const related = chromeUiNodes().filter((entry) => /usb web debugging|checkable="true"|class="android\.widget\.Switch"/i.test(entry));
  console.log('Chrome USB debugging controls after tap:\n' + related.join('\n'));
  adb(['shell', 'am', 'force-stop', 'com.android.chrome']);
  const target = adb([
    'shell', 'am', 'start', '-W',
    '-a', 'android.intent.action.VIEW',
    '-d', BASE + '/kupol',
    '-p', 'com.android.chrome',
  ]);
  console.log('Chrome gameplay relaunch: ' + target.replace(/\s+/g, ' ').slice(0, 400));
}
async function tapChromeFirstRunButton(pattern, label, timeoutMs = 12_000) {
  let lastUi = '';
  let attempts = 0;
  try {
    return await waitFor(() => {
      attempts += 1;
      const nodes = chromeUiNodes();
      lastUi = nodes.join('\n');
      const node = nodes.find((entry) => {
        const text = entry.match(/\btext="([^"]*)"/)?.[1] || '';
        const description = entry.match(/\bcontent-desc="([^"]*)"/)?.[1] || '';
        const resourceId = entry.match(/\bresource-id="([^"]*)"/)?.[1] || '';
        const visible = !/\bvisible-to-user="false"/.test(entry);
        return visible && pattern.test(text + ' ' + description + ' ' + resourceId);
      });
      if (!node) return null;
      const bounds = node.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (!bounds) {
        console.log('Chrome first-run matched node has no parsable bounds: ' + node);
        return null;
      }
      const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
      const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
      console.log('Chrome first-run button matched: ' + node);
      console.log('Chrome first-run tap coordinates: ' + x + ',' + y);
      adb(['shell', 'input', 'tap', String(x), String(y)]);
      pass('Chrome first-run: ' + label);
      return true;
    }, label, timeoutMs, 500);
  } catch (error) {
    console.log('Chrome first-run diagnostic for "' + label + '": attempts=' + attempts + '; wait=' + error.message);
    console.log('Chrome first-run UI nodes at timeout:\n' + (lastUi || 'UI hierarchy empty/unavailable'));
    return false;
  }
}
async function checkLayout(page, label) {
  const result = await page.evaluate(() => {
    const selectors = ['.k-top', '.k-left', '.k-right', '.k-chron', '.k-end', '.k-zoom', '.k-nrange-trigger'];
    const elements = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const visible = elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      outside: visible.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: typeof element.className === 'string' ? element.className : element.tagName,
          left: rect.left,
          right: rect.right,
        };
      }).filter((rect) => rect.left < -1 || rect.right > innerWidth + 1),
    };
  });
  assert.ok(result.width > 250 && result.height > 250, `${label}: invalid browser viewport ${result.width}x${result.height}`);
  assert.ok(result.documentWidth <= result.width + 1, `${label}: horizontal document overflow ${JSON.stringify(result)}`);
  assert.equal(result.outside.length, 0, `${label}: HUD elements exceed screen ${JSON.stringify(result.outside)}`);
  pass(`${label}: Android viewport ${result.width}x${result.height}, no horizontal overflow`);
  return result;
}

async function countChangedPixels(before, after) {
  const options = { width: 180, height: 360, fit: 'fill' };
  const a = await sharp(before).resize(options).removeAlpha().raw().toBuffer();
  const b = await sharp(after).resize(options).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) changed += 1;
  }
  return changed;
}

let browser;
let page;
try {
  const sdk = adb(['shell', 'getprop', 'ro.build.version.sdk']);
  assert.ok(Number(sdk) >= 35, `Android API 35 or later required, got ${sdk}`);
  pass(`Android emulator booted (API ${sdk})`);

  const chromePackage = adb(['shell', 'pm', 'path', 'com.android.chrome'], { encoding: 'utf8' });
  assert.match(chromePackage, /package:/, 'Google Chrome must be installed in the Google Play emulator image');
  pass('Google Chrome package is installed');

  adb(['shell', 'wm', 'size', '1080x2400']);
  adb(['shell', 'wm', 'density', '480']);
  adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  adb(['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
  // Chrome exposes the localabstract DevTools socket only after its process is
  // started. Enable the emulator's developer settings, launch the target tab,
  // wait for that socket, and only then create the host-side ADB forward.
  adb(['shell', 'settings', 'put', 'global', 'development_settings_enabled', '1']);
  adb(['shell', 'settings', 'put', 'global', 'adb_enabled', '1']);
  adb(['shell', 'am', 'force-stop', 'com.android.chrome']);
  const launch = adb(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `${BASE}/kupol`, '-p', 'com.android.chrome']);
  console.log(`Chrome launch result: ${launch.replace(/\s+/g, ' ').slice(0, 500)}`);

  // Pixel Launcher can ANR on a cold Google Play AVD while Chrome starts.
  // The launcher is not needed for browser QA; dismiss its system ANR dialog
  // and stop the launcher process so it cannot block Chrome's first-run UI.
  dismissPixelLauncherAnr();

  // Complete the browser's one-time native welcome/sign-in flow. On a fresh
  // Google Play emulator image it blocks the deep-link URL and DevTools socket.
  // Continue without adding a Google account.
  // Chrome Play Store images may land directly on the welcome page where
  // "Use without an account" is the primary dismissal action (there is no
  // "Accept & continue" button on that screen). Handle both variants and any
  // subsequent sync prompt before waiting for the DevTools socket.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const activity = adb(['shell', 'dumpsys', 'activity', 'activities']);
    if (!/FirstRunActivity/.test(activity)) break;

    const skipped = await tapChromeFirstRunButton(
      /use without an account|no thanks|negative_button|skip|not now|signin_fre_dismiss_button/i,
      'Use without an account / skip sign-in',
      4_000,
    );
    if (skipped) {
      await sleep(750);
      continue;
    }

    const accepted = await tapChromeFirstRunButton(
      /terms_accept|accept.*continue|accept.*terms/i,
      'Accept & continue',
      4_000,
    );
    if (accepted) {
      await sleep(750);
      continue;
    }

    break;
  }

  // Android system USB debugging does not enable Chrome CDP on production Play Store builds.
  // Enable Chrome's own USB Web debugging setting, restart Chrome, then attach Puppeteer.
  await enableChromeUsbWebDebugging();

  await waitFor(() => {
    const activity = adb(['shell', 'dumpsys', 'activity', 'activities']);
    const ps = adb(['shell', 'ps', '-A']);
    const sockets = adb(['shell', 'sh', '-c', "cat /proc/net/unix | grep -i devtools_remote || true"]);
    if (!/FirstRunActivity/.test(activity) && ps.includes('com.android.chrome') && sockets.includes('devtools_remote')) {
      pass('Chrome USB Web debugging enabled; DevTools socket available');
      console.log('Chrome activity ready; DevTools socket: ' + sockets.replace(/\s+/g, ' ').slice(0, 500));
      return sockets;
    }
    return null;
  }, 'Chrome Android DevTools socket after first-run setup', 60_000, 1_000).catch((error) => {
    const ps = adb(['shell', 'ps', '-A']).split('\n').filter((line) => /com\.android\.chrome|org\.chromium/i.test(line)).slice(-12).join('\n');
    const sockets = adb(['shell', 'sh', '-c', "cat /proc/net/unix | grep -i devtools_remote || true"]);
    const activity = adb(['shell', 'dumpsys', 'activity', 'activities']).split('Hist #')[0].slice(0, 1_000);
    const ui = chromeUiNodes().slice(0, 30).join('\n');
    const logcat = adb(['logcat', '-d', '-t', '500']).split('\n').filter((line) => /chrom(e|ium)|devtools|crash|fatal/i.test(line)).slice(-40).join('\n');
    throw new Error(error.message + '\nChrome processes=\n' + (ps || 'none') + '\nDevTools sockets=' + (sockets || 'none') + '\nActivity snapshot=\n' + activity + '\nChrome UI=\n' + ui + '\nChrome logcat=\n' + logcat);
  });

  try { adb(['forward', '--remove', 'tcp:9222']); } catch { /* no previous forward */ }
  adb(['forward', 'tcp:9222', 'localabstract:chrome_devtools_remote']);
  console.log(`ADB forwards: ${adb(['forward', '--list'])}`);

  await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:9222/json/version');
    return response.ok ? response.json() : null;
  }, 'Chrome remote debugging endpoint', 30_000);

  browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  page = pages.find((candidate) => candidate.url().includes('/kupol')) || pages[0] || await browser.newPage();
  await page.goto('about:blank');
  await page.evaluateOnNewDocument(() => {
    const NativeAudio = window.Audio;
    Object.defineProperty(window, '__KUPOL_AUDIO_EVENTS__', { value: [], configurable: true });
    function TrackedAudio(source) {
      const audio = new NativeAudio(source);
      const nativePlay = audio.play.bind(audio);
      audio.play = (...args) => {
        const event = { src: audio.src, fulfilled: false, error: null };
        window.__KUPOL_AUDIO_EVENTS__.push(event);
        const result = nativePlay(...args);
        if (result && typeof result.then === 'function') {
          result.then(() => { event.fulfilled = true; }, (error) => { event.error = String(error?.message || error); });
        } else {
          event.fulfilled = true;
        }
        return result;
      };
      return audio;
    }
    TrackedAudio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(TrackedAudio, NativeAudio);
    window.Audio = TrackedAudio;
  });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/audio/nuclear/')) {
      audioResponses.add(`${response.url().split('/').pop()}:${response.status()}`);
    }
  });

  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'production health endpoint must return HTTP 200');
  assert.equal((await health.json()).ok, true, 'production health endpoint payload');
  await page.goto(`${BASE}/kupol`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.cesium-widget canvas', { timeout: 120_000 });
  await page.waitForSelector('.k-nrange-trigger', { timeout: 120_000 });
  await page.waitForSelector('.k-start .k-nations button[data-id]', { timeout: 120_000 });
  pass('production /kupol loaded in Android Chrome and Cesium canvas mounted');
  const portrait = await checkLayout(page, 'portrait/touch');

  await page.tap('.k-start .k-nations button[data-id]');
  await page.waitForSelector('.k-start', { hidden: true, timeout: 45_000 });
  await waitFor(
    () => page.evaluate(() => Number.isFinite(window.__kupol?.state?.turn)),
    'game session over WebSocket',
    45_000,
  );
  pass('touch selection starts a playable game session');

  await page.tap('.k-nrange-trigger');
  await page.waitForSelector('.k-nrange-panel:not([hidden])', { timeout: 30_000 });
  await page.tap('#k-nrange-city-query');
  await page.type('#k-nrange-city-query', 'Hanoi', { delay: 65 });
  await page.waitForFunction(() => {
    const select = document.querySelector('#k-nrange-city-results');
    return select && [...select.options].some((option) => option.textContent.startsWith('Hanoi ·'));
  }, { timeout: 30_000 });
  const hanoi = await page.$eval('#k-nrange-city-results', (select) => (
    [...select.options].find((option) => option.textContent.startsWith('Hanoi ·'))?.value ?? null
  ));
  assert.ok(hanoi, 'offline populated-place catalogue must contain Hanoi');
  await page.select('#k-nrange-city-results', hanoi);
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Выбран город: Hanoi'));
  await page.waitForFunction(() => {
    const probe = window.__KUPOL_QA__?.snapshot();
    return probe?.target?.name === 'Hanoi' && probe?.camera?.aimDot > 0.97
      && probe?.camera?.height > 0 && probe.camera.height < 1_000_000;
  }, { timeout: 45_000 });
  pass('Hanoi selection moves the real Cesium camera to city scale');

  await page.keyboard.press('Escape');
  const beforeBlast = await page.screenshot({ type: 'png' });
  await page.tap('[data-test]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Испытание выполнено'), { timeout: 90_000 });
  await page.waitForFunction(() => {
    const probe = window.__KUPOL_QA__?.snapshot();
    return probe?.lastTestResult?.ok === true && probe.damageEntities > 0 && probe.nuclearLive === true;
  }, { timeout: 45_000 });
  const probe = await page.evaluate(() => window.__KUPOL_QA__.snapshot());
  assert.ok(probe.damageEntities > 0, 'Cesium damage entities were generated');
  assert.equal(probe.nuclearLive, true, 'nuclear volumetric effect is active');
  const afterBlast = await page.screenshot({ type: 'png' });
  const changedPixels = await countChangedPixels(beforeBlast, afterBlast);
  assert.ok(changedPixels >= 80, `Android rendered scene must visibly change after the strike; got ${changedPixels} changed samples`);
  pass(`Android WebGL rendered nuclear effect; ${probe.damageEntities} damage entities, ${changedPixels} changed pixel samples`);

  await waitFor(() => page.evaluate(() => {
    const events = window.__KUPOL_AUDIO_EVENTS__ || [];
    return events.some((event) => event.src.endsWith('/trinity-front.ogg') && event.fulfilled)
      && events.some((event) => event.src.endsWith('/trinity-tail.ogg') && event.fulfilled);
  }), 'front and tail audio playback promises', 30_000);
  assert.ok([...audioResponses].some((value) => /^trinity-front\.ogg:(200|206)$/.test(value)), 'front audio HTTP request succeeds');
  assert.ok([...audioResponses].some((value) => /^trinity-tail\.ogg:(200|206)$/.test(value)), 'tail audio HTTP request succeeds');
  pass('Android Chrome resolves both front and tail audio playback promises');

  await page.tap('[data-reset]');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('очищены'));
  await page.tap('.k-nrange-close');
  pass('touch reset clears test effects and panel closes');

  // Rotate the actual Android virtual display, not just a desktop browser viewport.
  adb(['shell', 'settings', 'put', 'system', 'user_rotation', '1']);
  adb(['shell', 'wm', 'size', '2400x1080']);
  await waitFor(async () => {
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return dimensions.width > dimensions.height ? dimensions : null;
  }, 'Android landscape rotation', 30_000);
  const landscape = await checkLayout(page, 'landscape/touch');
  assert.ok(landscape.width > landscape.height, 'emulator must really be in landscape orientation');
  await page.screenshot({ path: 'artifacts/kupol-android-landscape.png', type: 'png' });
  pass('Android emulator rotated to landscape and HUD remains inside the screen');

  // Restore portrait, then reload to verify the server-backed session resumes.
  adb(['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
  adb(['shell', 'wm', 'size', '1080x2400']);
  await waitFor(async () => {
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return dimensions.height > dimensions.width ? dimensions : null;
  }, 'Android portrait restoration', 30_000);
  const turnBeforeReload = await page.evaluate(() => window.__kupol?.state?.turn ?? null);
  assert.ok(Number.isFinite(turnBeforeReload), 'game turn exists before reload');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.cesium-widget canvas', { timeout: 120_000 });
  await waitFor(() => page.evaluate(() => (
    !!window.__kupol && Number.isFinite(window.__kupol.state?.turn) && !document.querySelector('.k-start')
  )), 'game session restored after Android Chrome reload', 60_000);
  const turnAfterReload = await page.evaluate(() => window.__kupol.state.turn);
  assert.equal(turnAfterReload, turnBeforeReload, 'game session turn must survive browser reload');
  pass(`Android browser reload restored the same session at turn ${turnAfterReload}`);

  assert.equal(pageErrors.length, 0, `Android page has no uncaught JavaScript errors: ${pageErrors.join('; ')}`);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/kupol-android-portrait.png', type: 'png' });
  writeFileSync('artifacts/kupol-android-device.txt', [
    `Android API: ${sdk}`,
    `Portrait viewport: ${portrait.width}x${portrait.height}`,
    `Landscape viewport: ${landscape.width}x${landscape.height}`,
    `Turn after reload: ${turnAfterReload}`,
    `Damage entities: ${probe.damageEntities}`,
    `Changed pixel samples: ${changedPixels}`,
    `Audio responses: ${[...audioResponses].join(', ')}`,
  ].join('\n'));
  writeFileSync('artifacts/kupol-android-screen.png', execFileSync('adb', ['exec-out', 'screencap', '-p']));
  pass('Android screenshots and emulator evidence saved');
  console.log('ANDROID EMULATOR SMOKE PASS');
} catch (error) {
  console.error(`ANDROID EMULATOR SMOKE FAIL: ${error.stack || error}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.disconnect().catch(() => {});
}
