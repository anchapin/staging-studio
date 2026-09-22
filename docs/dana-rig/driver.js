/**
 * UX-prototype browser driver (NOT part of the app).
 *
 * Owns a headless Playwright Chromium page and exposes it over a tiny
 * JSON HTTP relay on 127.0.0.1:39999 so a persona agent (running as a
 * separate process) can drive the StagingStudio UI like a human would:
 * snapshot the visible UI, click/fill/upload/paint, and screenshot.
 *
 * Protocol: POST /act  {"op": "...", ...args}  ->  {"ok": true, ...} | {"ok": false, "error": "..."}
 *
 * Ops:
 *   start {url?}            launch browser + page (default: app /login)
 *   goto {url}
 *   url                     current page URL
 *   snapshot                {url, title, text, interactives:[{id,tag,type,name,x,y,w,h}]}
 *   screenshot              {path}  (png under /tmp/uxshots)
 *   click {id}              click element tagged by snapshot (data-ux-id)
 *   clickText {text}        click first visible element containing text
 *   fill {id, text}         fill input/textarea
 *   type {id, text}         type char-by-char (for picky controlled inputs)
 *   press {id, key}         keyboard press on element (e.g. "Enter")
 *   check {id}              check a checkbox/switch
 *   select {id, value}      select dropdown option by value or label
 *   upload {clickId, path}  click (triggers file chooser), set files
 *   paint {id, strokes}     strokes: array of polylines, each polyline is
 *                           [[fx,fy],...] fractions of the element bbox;
 *                           mouse down/move/up per polyline
 *   bbox {id}               {x,y,width,height}
 *   wait {ms}
 *   waitForText {text, timeout?}
 *   waitForGone {text, timeout?}
 *   eval {code}             run `code` as async (page) => ... in Node; return JSON value
 *   close                   close the browser
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const PORT = 39999;
const HOST = process.env.UX_PROTO_RELAY_HOST || "127.0.0.1";
const APP_URL = process.env.UX_PROTO_APP_URL || "http://127.0.0.1:39901";
const SHOT_DIR = process.env.UX_PROTO_SHOT_DIR || "/tmp/uxshots";
// Extra Chromium flags, space-separated. Set "--no-sandbox" when running as
// root inside a container.
const CHROMIUM_ARGS = (process.env.UX_PROTO_CHROMIUM_ARGS || "")
  .split(" ")
  .filter(Boolean);

let browser = null;
let page = null;
let shotCount = 0;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  if (!browser || !browser.isConnected()) {
    const launchOpts = { headless: true, args: CHROMIUM_ARGS };
    try {
      browser = await chromium.launch(launchOpts);
    } catch (e) {
      // Fall back to the full Chromium build when the headless shell
      // is unavailable (e.g. flaky browser download). Override with
      // UX_PROTO_CHROME_PATH if your ms-playwright cache lives elsewhere.
      const fullChrome =
        process.env.UX_PROTO_CHROME_PATH ||
        (process.platform === "darwin"
          ? require("os").homedir() +
            "/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"
          : require("os").homedir() +
            "/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome");
      browser = await chromium.launch({ ...launchOpts, executablePath: fullChrome });
    }
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: false,
  });
  page = await context.newPage();
  page.on("console", (msg) => console.log("[browser console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.error("[browser pageerror]", err.message));
  page.setDefaultTimeout(15000);
  return page;
}

const SNAPSHOT_JS = `() => {
  document.querySelectorAll('[data-ux-id]').forEach((el) => el.removeAttribute('data-ux-id'));
  const els = Array.from(document.querySelectorAll(
    'button, a, input, textarea, select, canvas, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]'
  ));
  const out = [];
  let n = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width < 2 || r.height < 2) continue;
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    n += 1;
    const id = 'u' + n;
    el.setAttribute('data-ux-id', id);
    let name = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.type || '').trim();
      if (el.type === 'checkbox' || el.type === 'radio') {
        const lbl = el.closest('label');
        name = ((lbl && lbl.innerText) || name).trim();
      }
      if (el.value && el.type !== 'password' && el.type !== 'file') name += ' [value: ' + String(el.value).slice(0, 40) + ']';
    } else {
      name = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim();
    }
    name = name.replace(/\\s+/g, ' ').slice(0, 90);
    out.push({
      id, tag: el.tagName.toLowerCase(), type: el.type || '',
      role: el.getAttribute('role') || '',
      name, x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  const text = (document.body ? document.body.innerText : '').slice(0, 7000);
  return { text, interactives: out };
}`;

async function doOp(op, args) {
  switch (op) {
    case "start": {
      const p = await ensurePage();
      await p.goto(args.url || `${APP_URL}/login`, { waitUntil: "domcontentloaded" });
      return { url: p.url() };
    }
    case "goto": {
      const p = await ensurePage();
      await p.goto(args.url, { waitUntil: "domcontentloaded" });
      return { url: p.url() };
    }
    case "url": {
      const p = await ensurePage();
      return { url: p.url() };
    }
    case "snapshot": {
      const p = await ensurePage();
      const invoke = new Function(`"use strict"; return (${SNAPSHOT_JS})();`);
      const s = await p.evaluate(invoke);
      return { url: p.url(), title: await p.title(), ...s };
    }
    case "screenshot": {
      const p = await ensurePage();
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      shotCount += 1;
      const fp = path.join(SHOT_DIR, `shot-${String(shotCount).padStart(3, "0")}.png`);
      await p.screenshot({ path: fp });
      return { path: fp };
    }
    case "click": {
      const p = await ensurePage();
      await p.click(`[data-ux-id="${args.id}"]`, { timeout: args.timeout || 15000 });
      return {};
    }
    case "clickText": {
      const p = await ensurePage();
      const loc = p.getByText(args.text, { exact: !!args.exact }).first();
      await loc.waitFor({ state: "visible", timeout: args.timeout || 15000 });
      await loc.click();
      return {};
    }
    case "fill": {
      const p = await ensurePage();
      await p.fill(`[data-ux-id="${args.id}"]`, args.text, { timeout: args.timeout || 15000 });
      return {};
    }
    case "type": {
      const p = await ensurePage();
      const loc = p.locator(`[data-ux-id="${args.id}"]`);
      await loc.click();
      await loc.press("ControlOrMeta+a");
      await loc.press("Backspace");
      await loc.pressSequentially(args.text, { delay: 25 });
      return {};
    }
    case "press": {
      const p = await ensurePage();
      await p.locator(`[data-ux-id="${args.id}"]`).press(args.key);
      return {};
    }
    case "check": {
      const p = await ensurePage();
      await p.locator(`[data-ux-id="${args.id}"]`).check();
      return {};
    }
    case "select": {
      const p = await ensurePage();
      await p.locator(`[data-ux-id="${args.id}"]`).selectOption(args.value);
      return {};
    }
    case "upload": {
      const p = await ensurePage();
      const [chooser] = await Promise.all([
        p.waitForEvent("filechooser", { timeout: args.timeout || 15000 }),
        p.click(`[data-ux-id="${args.clickId}"]`),
      ]);
      await chooser.setFiles(args.path);
      return {};
    }
    case "paint": {
      const p = await ensurePage();
      const box = await p.locator(`[data-ux-id="${args.id}"]`).boundingBox();
      if (!box) throw new Error("no bounding box for " + args.id);
      for (const poly of args.strokes) {
        const pts = poly.map(([fx, fy]) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height }));
        await p.mouse.move(pts[0].x, pts[0].y);
        await p.mouse.down();
        for (const pt of pts.slice(1)) {
          await p.mouse.move(pt.x, pt.y, { steps: 8 });
        }
        await p.mouse.up();
        await p.waitForTimeout(150);
      }
      return { box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } };
    }
    case "bbox": {
      const p = await ensurePage();
      const box = await p.locator(`[data-ux-id="${args.id}"]`).boundingBox();
      return { box };
    }
    case "wait": {
      const p = await ensurePage();
      await p.waitForTimeout(args.ms || 1000);
      return {};
    }
    case "waitForText": {
      const p = await ensurePage();
      await p.getByText(args.text, { exact: false }).first().waitFor({ state: "visible", timeout: args.timeout || 30000 });
      return {};
    }
    case "waitForGone": {
      const p = await ensurePage();
      await p.getByText(args.text, { exact: false }).first().waitFor({ state: "detached", timeout: args.timeout || 30000 }).catch(() =>
        p.getByText(args.text, { exact: false }).first().waitFor({ state: "hidden", timeout: args.timeout || 30000 })
      );
      return {};
    }
    case "eval": {
      const p = await ensurePage();
      // `code` is the body of an async function executed IN THE PAGE.
      const fn = new Function(`"use strict"; return (async () => { ${args.code} })();`);
      const result = await p.evaluate(fn);
      return { result: JSON.parse(JSON.stringify(result ?? null)) };
    }
    case "close": {
      if (browser) await browser.close().catch(() => {});
      browser = null;
      page = null;
      return {};
    }
    default:
      throw new Error("unknown op: " + op);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/act") {
    return json(res, 404, { ok: false, error: "POST /act only" });
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { ok: false, error: "bad JSON" });
    }
    try {
      const out = await doOp(body.op, body);
      json(res, 200, { ok: true, ...out });
    } catch (e) {
      json(res, 200, { ok: false, error: String((e && e.message) || e).slice(0, 2000) });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[uxdrive] relay on http://${HOST}:${PORT}`);
});
