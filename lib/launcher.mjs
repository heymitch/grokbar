// Starts the app with keyboard hints. Talks to it over a private pipe
// (--remote-debugging-pipe), so no debug port is opened: only this process
// can reach the app. Injects hints.js into the app's own window (never into
// web pages it opens), checks the hints still find what the profile expects,
// and notifies on failure. Stays running as long as the app does.
//
//   launcher.mjs launch [args]  start the app (args pass through, e.g. links)
//   launcher.mjs check          print the check result from the running app
//   launcher.mjs restart        close the app cleanly and start it again
//   launcher.mjs preview        show the hints for 3 seconds
//   launcher.mjs inspect        list open panels and anything past the right edge

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, watchFile } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.HOME;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

const config = readJson(join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "grokbar/config.json")) || {};
const profile = readJson(join(ROOT, "profiles", `${config.profile || "grok-bot"}.json`));
if (!profile) {
  console.error(`grokbar: no profile "${config.profile}" in ${join(ROOT, "profiles")}`);
  process.exit(1);
}

const HINTS = readFileSync(join(ROOT, "lib/hints.js"), "utf8");
const SOCKET = join(process.env.XDG_RUNTIME_DIR || "/tmp", "grokbar.sock");
const STATE = join(HOME, ".local/state/grokbar");
// Rendered from themed/grokbar.css.tpl by Omarchy on every theme change.
const THEME_CSS = join(HOME, ".local/state/omarchy/current/theme/grokbar.css");

const hintConfig = { ui: profile.ui, singles: config.hints?.singles, prefixes: config.hints?.prefixes };
const themeCss = () => { try { return readFileSync(THEME_CSS, "utf8"); } catch { return ""; } };
const source = (css) =>
  `window.__grokbarConfig = ${JSON.stringify(hintConfig)};\n${HINTS}\n` +
  `;window.__grokbar && window.__grokbar.setTheme(${JSON.stringify(css)});`;

const version = () => {
  if (!profile.package) return "unknown";
  try { return execFileSync("pacman", ["-Q", profile.package], { encoding: "utf8" }).trim().split(" ")[1]; } catch { return "unknown"; }
};
const notify = (...args) => spawn("notify-send", ["-a", "grokbar", ...args], { stdio: "ignore" }).unref();

const [command = "launch", ...rest] = process.argv.slice(2);
if (["check", "restart", "preview", "inspect"].includes(command)) {
  const conn = net.connect(SOCKET);
  conn.on("error", () => { console.error(`${profile.name} isn't running through grokbar.`); process.exit(1); });
  conn.end(command);
  let out = "";
  conn.on("data", (d) => (out += d));
  conn.on("close", () => out && console.log(out));
} else {
  await launch(rest);
}

async function launch(args) {
  const app = spawn(profile.command, ["--remote-debugging-pipe", ...args], {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  const toApp = app.stdio[3];
  const fromApp = app.stdio[4];
  toApp.on("error", () => {});
  fromApp.on("error", () => {});

  let id = 0;
  const waiting = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    toApp.write(JSON.stringify({ id: n, method, params, ...(sessionId && { sessionId }) }) + "\0");
  });

  let mainSession = null;
  let startScript = null;
  let currentCss = themeCss();
  const attached = new Set();

  // Attach to the app's own window once it has loaded its page.
  async function maybeAttach({ targetId, type, url }) {
    if (type !== "page" || !url.includes(profile.page) || attached.has(targetId)) return;
    attached.add(targetId);
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Runtime.addBinding", { name: "__grokbarClick" }, sessionId);
    await send("Runtime.addBinding", { name: "__grokbarResize" }, sessionId);
    await send("Runtime.addBinding", { name: "__grokbarAnchor" }, sessionId);
    startScript = (await send("Page.addScriptToEvaluateOnNewDocument", { source: source(currentCss) }, sessionId)).identifier;
    await send("Runtime.evaluate", { expression: source(currentCss) }, sessionId);
    mainSession = sessionId;
    setTimeout(() => smokeTest(), 8000);
  }
  // Side panels opened or closed: remember the extra width and refit the window.
  function fit(payload) {
    const extra = Math.max(0, Math.min(4000, parseInt(payload, 10) || 0));
    mkdirSync(STATE, { recursive: true });
    writeFileSync(join(STATE, "extra-width"), String(extra));
    spawn(join(ROOT, "bin/grokbar"), ["fit"], { stdio: "ignore", detached: true }).unref();
  }

  // A hint asked for a click: send a real mouse click at that spot.
  async function click(sessionId, payload) {
    let x, y;
    try { ({ x, y } = JSON.parse(payload)); } catch { return; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const at = { x, y, button: "left", clickCount: 1 };
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at }, sessionId);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at }, sessionId);
  }
  const handlers = {
    "Runtime.bindingCalled": async ({ name, payload }, sessionId) => {
      if (sessionId !== mainSession) return;
      if (name === "__grokbarClick") await click(sessionId, payload);
      if (name === "__grokbarResize") fit(payload);
      if (name === "__grokbarAnchor") spawn(join(ROOT, "bin/grokbar"), ["anchor"], { stdio: "ignore", detached: true }).unref();
    },
    "Target.targetCreated": ({ targetInfo }) => maybeAttach(targetInfo),
    "Target.targetInfoChanged": ({ targetInfo }) => maybeAttach(targetInfo),
    async "Target.detachedFromTarget"({ sessionId, targetId }) {
      if (sessionId === mainSession) mainSession = null;
      attached.delete(targetId);
    },
  };

  let buffer = "";
  fromApp.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\0")) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id && waiting.has(message.id)) {
        const { resolve, reject } = waiting.get(message.id);
        waiting.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (handlers[message.method]) {
        Promise.resolve(handlers[message.method](message.params, message.sessionId)).catch(() => {});
      }
    }
  });

  const evaluate = (expression) => send("Runtime.evaluate", { expression, returnByValue: true }, mainSession);

  // The startup check skips the helper; it can take a while to come up and
  // has its own minute-by-minute watch.
  async function check({ helper = true } = {}) {
    if (!mainSession) return { ok: false, error: "app window not attached" };
    const result = await evaluate("JSON.stringify(window.__grokbar ? window.__grokbar.check() : null)");
    const found = JSON.parse(result.result.value || "null");
    if (!found) return { ok: false, error: "hints not loaded" };
    const missing = [
      helper && profile.helper && !helperRunning() && profile.helper.label,
      profile.ui.botList && found.bots < 1 && "bots in the sidebar",
      profile.ui.newChat && !found.newChat && "New chat",
      profile.ui.search && !found.search && "Search",
      profile.ui.prompt && !found.prompt && "message box",
      found.clickable < 5 && "clickable items",
    ].filter(Boolean);
    return { ok: missing.length === 0, version: version(), missing, ...found };
  }

  // The app's helper process (for Grok Bot, the one that keeps this computer
  // reachable) can die while chat keeps working. Check every minute; after
  // two misses in a row, offer a restart, which brings it back.
  const helperRunning = () => {
    try { execFileSync("pgrep", ["-u", String(process.getuid()), "-f", profile.helper.process], { stdio: "ignore" }); return true; } catch { return false; }
  };
  let helperMisses = 0;
  let helperWarned = false;
  if (profile.helper) {
    setInterval(() => {
      if (helperRunning()) { helperMisses = 0; helperWarned = false; return; }
      if (++helperMisses < 2 || helperWarned) return;
      helperWarned = true;
      const ask = spawn("notify-send", ["-a", "grokbar", "-u", "critical", "-A", "restart=Restart now", "-w",
        `${profile.name}: ${profile.helper.label} is down`,
        `Chat still works, but ${profile.name} can't reach this computer. Restarting the app reconnects it.`]);
      let answer = "";
      ask.stdout.on("data", (d) => (answer += d));
      ask.on("close", () => {
        if (answer.trim() !== "restart") return;
        restarting = true;
        send("Browser.close").catch(() => {});
      });
    }, 60000);
  }

  // The shown window is pinned, and Hyprland draws pinned windows above
  // fullscreen ones, including Omarchy's screensaver. Slide it up whenever a
  // window goes fullscreen, the screensaver opens, or a monitor disconnects.
  // If the drop-down gets tiled, put it back.
  const hyprEvents = () => {
    const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE;
    if (!sig) return;
    const events = net.connect(join(process.env.XDG_RUNTIME_DIR || "/tmp", "hypr", sig, ".socket2.sock"));
    let buffer = "";
    events.on("data", (d) => {
      const lines = (buffer + d).split("\n");
      buffer = lines.pop();
      if (lines.some((l) => l === "fullscreen>>1" || l.startsWith("monitorremoved>>") || /^openwindow>>[^,]*,[^,]*,org\.omarchy\.screensaver,/.test(l)))
        spawn(join(ROOT, "bin/grokbar"), ["hide"], { stdio: "ignore", detached: true }).unref();
      // Tiled windows lose their pin and fill the workspace; grokbar checks it's ours.
      for (const l of lines) {
        const tiled = /^changefloatingmode>>([0-9a-f]+),0$/.exec(l);
        if (tiled) spawn(join(ROOT, "bin/grokbar"), ["refloat", tiled[1]], { stdio: "ignore", detached: true }).unref();
      }
    });
    events.on("error", () => {});
    events.on("close", () => setTimeout(hyprEvents, 5000));
  };
  hyprEvents();

  async function smokeTest() {
    const result = await check({ helper: false }).catch((error) => ({ ok: false, error: error.message }));
    mkdirSync(STATE, { recursive: true });
    writeFileSync(join(STATE, "last-check.json"), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
    if (!result.ok) {
      notify("-u", "critical", "grokbar keyboard hints need a fix",
        `${profile.name} ${result.version || version()}: can't find ${(result.missing?.length ? result.missing : [result.error]).join(", ")}.`);
      return;
    }
    let last = "";
    try { last = readFileSync(join(STATE, "last-ok-version"), "utf8").trim(); } catch {}
    if (last && last !== result.version) notify("grokbar keyboard hints still work", `Checked on ${profile.name} ${result.version}.`);
    writeFileSync(join(STATE, "last-ok-version"), result.version);
  }

  // Control socket: only fixed commands, readable by this user only.
  let restarting = false;
  rmSync(SOCKET, { force: true });
  const control = net.createServer({ allowHalfOpen: true }, (conn) => {
    let request = "";
    conn.on("data", (d) => (request += d));
    conn.on("end", async () => {
      if (request === "check") {
        conn.end(JSON.stringify(await check().catch((e) => ({ ok: false, error: e.message })), null, 2));
      } else if (request === "inspect" && mainSession) {
        const result = await evaluate("JSON.stringify(window.__grokbar ? window.__grokbar.inspect() : null)").catch(() => null);
        conn.end(JSON.stringify(JSON.parse(result?.result?.value || "null"), null, 2));
      } else if (request === "preview" && mainSession) {
        await evaluate("window.__grokbar && window.__grokbar.preview()").catch(() => {});
        conn.end("showing hints for 3 seconds");
      } else if (request === "restart") {
        restarting = true;
        conn.end(`restarting ${profile.name}`);
        send("Browser.close").catch(() => {});
      } else {
        conn.end();
      }
    });
  });
  control.listen(SOCKET, () => chmodSync(SOCKET, 0o600));

  app.on("exit", () => {
    control.close();
    rmSync(SOCKET, { force: true });
    // Start the next launcher only after this one has let go of the app and socket.
    if (restarting) spawn(process.execPath, [fileURLToPath(import.meta.url), "launch"], { detached: true, stdio: "ignore" }).unref();
    process.exit(0);
  });

  // Theme switches replace the theme folder; poll the rendered file and
  // restyle the hints live, including after the page reloads.
  watchFile(THEME_CSS, { interval: 2000 }, async () => {
    const css = themeCss();
    if (!css || css === currentCss || !mainSession) return;
    currentCss = css;
    const session = mainSession;
    if (startScript) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: startScript }, session).catch(() => {});
    startScript = (await send("Page.addScriptToEvaluateOnNewDocument", { source: source(css) }, session).catch(() => ({}))).identifier;
    await send("Runtime.evaluate", { expression: `window.__grokbar && window.__grokbar.setTheme(${JSON.stringify(css)})` }, session).catch(() => {});
  });

  // Stopping the launcher closes the app cleanly. A plain kill can make it crash.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => {
      send("Browser.close").catch(() => {});
      setTimeout(() => process.exit(0), 10000);
    });
  }

  await send("Target.setDiscoverTargets", { discover: true }).catch(() => {});
}
