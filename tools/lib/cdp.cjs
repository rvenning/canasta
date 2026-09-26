// Minimal DevTools-protocol driver for headless Edge (no dependencies; Node
// 24's global WebSocket and fetch). Used by tools/shots.js and tools/e2e.js.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ width = 390, height = 844, dpr = 2 } = {}) {
  if (!EDGE) throw new Error("Edge not found");
  // A fresh profile and an OS-chosen port every run: killing the Edge
  // launcher does not stop the browser, so a fixed port can silently hand a
  // new run the previous run's browser — and its saved players.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-cdp-"));
  const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=user-gesture-required", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  let target, port;
  for (let i = 0; i < 80 && !target; i++) {
    await wait(200);
    try {
      port = port || +fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0];
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("no DevTools target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map(), logs = [];
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") logs.push("console.error " + d.params.args.map((a) => a.value || a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const close = async () => {
    try {
      const bws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
      await new Promise((r) => bws.addEventListener("open", r, { once: true }));
      bws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    } catch {}
    ws.close(); proc.kill(); await wait(800);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  return { send, evaluate, close, logs };
}

module.exports = { launch, wait };
