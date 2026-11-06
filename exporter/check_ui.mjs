// Headless check: every view, both themes, phone and desktop, plus embed mode.
// Usage: node exporter/check_ui.mjs <base-url> <screenshot-dir>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = process.argv[2];
const out = process.argv[3];
mkdirSync(out, { recursive: true });
const profile = join(tmpdir(), "sb-live-chrome-" + Date.now());
const port = 9333;
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch { /* chrome still starting */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(msg.params.entry.text + " " + (msg.params.entry.url || ""));
};
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");

const sizes = { desktop: [1366, 900, false], phone: [375, 760, true] };
const problems = [];
for (const [form, [width, height, mobile]] of Object.entries(sizes)) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  for (const theme of ["dark", "light"]) {
    for (const v of ["overview", "map", "model", "research", "about"]) {
      await send("Page.navigate", { url: `${base}/index.html?theme=${theme}&r=${Date.now()}#${v}` });
      await sleep(900);
      const facts = JSON.parse(await evaluate(`JSON.stringify({
        over: Math.max(document.documentElement.scrollWidth - ${width}, ...[...document.querySelectorAll('.card,.node,.lede,#theme')].map(e => Math.ceil(e.getBoundingClientRect().right - ${width}))),
        h1: (document.querySelector('h1')||{}).textContent,
        small: [...document.querySelectorAll('main *')].filter(e => e.childElementCount===0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length,
        italic: [...document.querySelectorAll('main *')].filter(e => getComputedStyle(e).fontStyle==='italic').length,
        fresh: document.getElementById('freshness').textContent
      })`));
      if (facts.over > 0) problems.push(`${form}/${theme}/${v}: scrolls sideways by ${facts.over}px`);
      if (facts.small) problems.push(`${form}/${theme}/${v}: ${facts.small} elements under 11px`);
      if (facts.italic) problems.push(`${form}/${theme}/${v}: italic text`);
      if (!facts.h1) problems.push(`${form}/${theme}/${v}: no heading`);
      if (theme === "dark" || v === "overview") {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(out, `${form}-${theme}-${v}.png`), Buffer.from(shot.data, "base64"));
      }
    }
  }
}
// Selecting a table must update the detail panel.
await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${base}/index.html#model` });
await sleep(900);
const picked = await evaluate(`(document.querySelector('[data-table="ext.observation"]').click(), document.querySelector('.model h2').textContent)`);
if (picked !== "ext.observation") problems.push("table selection did not update the panel: " + picked);
await send("Page.navigate", { url: `${base}/index.html?embed=1#overview` });
await sleep(900);
const embed = await evaluate(`getComputedStyle(document.querySelector('.brand')).display`);
if (embed !== "none") problems.push("embed mode still shows the brand block");
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(out, "embed.png"), Buffer.from(shot.data, "base64"));

const realErrors = errors.filter((e) => !/fonts\.g/.test(e));
console.log(JSON.stringify({ problems, errors: realErrors }, null, 1));
ws.close();
chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
process.exit(problems.length || realErrors.length ? 1 : 0);
