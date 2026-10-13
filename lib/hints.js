// Keyboard hints, injected into the app's own window by launcher.mjs.
//   Alt+F      letters on everything clickable; type them to click, Esc cancels
//   Alt+N      new chat
//   Alt+/      search
//   Alt+I      message box
//   Alt+1..9   bots in sidebar order
// The launcher sets window.__grokbarConfig first: the app profile's ui
// selectors and the hint letters. Targets are found by standard roles and
// aria-labels, so app updates rarely break them.
(() => {
  if (window.__grokbar) return;

  const config = window.__grokbarConfig || {};
  const ui = config.ui || {};
  const SINGLES = [...(config.singles || "asdfghjklewruiotypnmcb")];
  const PREFIXES = [...(config.prefixes || "qzxv")];
  const LETTERS = [...SINGLES, ...PREFIXES];
  const SKIP = ui.skip ? new RegExp(ui.skip) : null;
  const STORE = "grokbar-codes";
  const STORE_LIMIT = 400;

  const CLICKABLE = 'a[href],button,input,textarea,select,[role=button],[role=option],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=link],[role=checkbox],[role=switch],[role=textbox],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  const CONTROL = "a,button,input,textarea,select,[role=button],[role=option],[role=menuitem],[role=tab],[role=textbox],[contenteditable=true]";

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.pointerEvents === "none" || el.closest("[inert],[aria-hidden=true]")) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !hit || el.contains(hit) || hit.contains(el);
  };
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.placeholder || "").trim();
  const isTyping = (el) => el.matches("input,textarea,select,[role=textbox],[contenteditable=true]");
  const inConversation = (el) => !!(ui.conversation && el.closest(ui.conversation));
  const byTop = (a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  };

  function targets() {
    const found = [...document.querySelectorAll(CLICKABLE)].filter(
      (el) => !el.disabled && !(SKIP && SKIP.test(label(el))) && visible(el),
    );
    // In the conversation only real controls get hints, not message bubbles.
    // Elsewhere a focusable container loses its hint to the buttons inside it.
    return found
      .filter((el) => {
        if (el.matches(CONTROL)) return true;
        if (inConversation(el)) return false;
        return !found.some((other) => other !== el && el.contains(other));
      })
      .sort(byTop);
  }

  // ---- stable codes ----
  // Each item keeps the code it first got (remembered across restarts),
  // preferring the first letter of its name. Single letters never start a
  // two-letter code: those begin with a letter from PREFIXES.

  // The item's name: its aria-label without a status suffix ("Agency Bot,
  // Working" -> "Agency Bot"), else the first line of its text.
  const nameOf = (el) => {
    const aria = (el.getAttribute("aria-label") || "").replace(/, .*$/, "").trim();
    return (aria || (el.innerText || el.placeholder || "").trim().split("\n")[0]).slice(0, 60);
  };

  // Answer choices on a bot's question ("A", "B", ... badges) get 1, 2, ...
  const choiceIndex = (el) => {
    if (!inConversation(el)) return -1;
    const first = (el.innerText || "").trim().split("\n")[0].trim();
    return /^[A-I]$/.test(first) ? first.charCodeAt(0) - 64 : -1;
  };

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
  }
  function saveStore(store) {
    const entries = Object.entries(store).sort((a, b) => b[1].seen - a[1].seen).slice(0, STORE_LIMIT);
    try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(entries))); } catch {}
  }

  function codes(els) {
    const store = loadStore();
    const count = {};
    const keys = els.map((el) => {
      const name = nameOf(el) || el.tagName;
      count[name] = (count[name] || 0) + 1;
      return count[name] > 1 ? `${name}#${count[name]}` : name;
    });
    // Conversation items come and go: they get a letter from their name but
    // don't keep it.
    const keep = els.map((el) => !inConversation(el));
    // Codes remembered for items not on screen right now stay free for them.
    const here = new Set(keys);
    const reserved = new Set(Object.entries(store).filter(([k]) => !here.has(k)).map(([, v]) => v.code));
    const used = new Set();
    const free = (c) => !used.has(c) && !reserved.has(c);
    const doubles = PREFIXES.flatMap((p) => LETTERS.map((c) => p + c));
    const out = new Array(els.length);

    els.forEach((el, i) => {
      const n = choiceIndex(el);
      if (n > 0 && !used.has(String(n))) { out[i] = String(n); used.add(out[i]); }
    });
    keys.forEach((key, i) => {
      if (out[i]) return;
      const code = store[key]?.code;
      const valid = code && (SINGLES.includes(code) || doubles.includes(code));
      if (valid && !used.has(code)) { out[i] = code; used.add(code); }
    });
    keys.forEach((key, i) => {
      if (out[i]) return;
      const name = key.replace(/#\d+$/, "").toLowerCase();
      const initials = name.split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]);
      out[i] =
        [...initials, ...name].find((c) => SINGLES.includes(c) && free(c)) ||
        SINGLES.find(free) ||
        doubles.find(free) ||
        doubles.find((c) => !used.has(c));
      used.add(out[i]);
    });

    const now = Date.now();
    keys.forEach((key, i) => { if (keep[i]) store[key] = { code: out[i], seen: now }; });
    saveStore(store);
    return out;
  }

  // ---- clicking ----
  function focusEnd(el) {
    el.focus();
    if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (typeof el.value === "string") {
      el.setSelectionRange?.(el.value.length, el.value.length);
    }
  }

  function activate(el) {
    if (isTyping(el)) return focusEnd(el);
    const r = el.getBoundingClientRect();
    // Real click through the launcher: some buttons (settings, new windows)
    // only respond to clicks the app trusts as coming from the user.
    if (typeof window.__grokbarClick === "function") {
      window.__grokbarClick(JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
      return;
    }
    const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 }));
    el.click();
  }

  // ---- hint overlay ----
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none";
  const root = host.attachShadow({ mode: "closed" });
  // Colors come from the Omarchy theme (setTheme); these are fallbacks.
  root.innerHTML = `<style>
    :host{--hint-bg:#7aa2f7;--hint-fg:#1a1b26;--hint-border:#414868;--hint-typed:#565f89;--hint-font:ui-monospace,monospace}
    .h{position:absolute;font:700 12px/1 var(--hint-font);padding:3px 5px;border-radius:3px;
       background:var(--hint-bg);color:var(--hint-fg);border:1px solid var(--hint-border);
       box-shadow:0 1px 4px rgba(0,0,0,.45);text-transform:uppercase;letter-spacing:.5px}
    .h b{color:var(--hint-typed);font-weight:700}
  </style><style id="theme"></style><div id="layer"></div>`;
  const layer = root.getElementById("layer");
  const themeStyle = root.getElementById("theme");
  const mount = () => document.documentElement.contains(host) || document.documentElement.appendChild(host);

  let hints = null;
  let typed = "";

  function showHints() {
    mount();
    const els = targets();
    const cs = codes(els);
    hints = els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const tag = document.createElement("div");
      tag.className = "h";
      tag.style.left = `${Math.max(0, Math.min(innerWidth - 24, r.left + 2))}px`;
      tag.style.top = `${Math.max(0, Math.min(innerHeight - 18, r.top + 2))}px`;
      layer.appendChild(tag);
      return { el, code: cs[i], tag };
    });
    typed = "";
    render();
    host.style.display = "block";
  }

  function hideHints() {
    hints = null;
    typed = "";
    layer.replaceChildren();
    host.style.display = "none";
  }

  function render() {
    for (const h of hints) {
      const match = h.code.startsWith(typed);
      h.tag.style.display = match ? "block" : "none";
      if (match) h.tag.innerHTML = `<b>${typed}</b>${h.code.slice(typed.length)}`;
    }
  }

  function typeHint(key) {
    typed += key;
    const exact = hints.find((h) => h.code === typed);
    if (exact) {
      hideHints();
      activate(exact.el);
      return;
    }
    if (!hints.some((h) => h.code.startsWith(typed))) return hideHints();
    render();
  }

  // ---- direct keys ----
  const byLabel = (text) => text && [...document.querySelectorAll("[aria-label]")].find((el) => el.getAttribute("aria-label") === text && visible(el));
  const bots = () => {
    const list = ui.botList && document.querySelector(ui.botList);
    return list ? [...list.querySelectorAll(ui.botItems || "button")].filter(visible).sort(byTop) : [];
  };
  const prompt = () => byLabel(ui.prompt) || (ui.promptFallback && document.querySelector(ui.promptFallback));

  function openSearch() {
    const button = byLabel(ui.search);
    if (!button) return;
    activate(button);
    setTimeout(() => {
      const input = ui.searchInput && document.querySelector(ui.searchInput);
      if (input) focusEnd(input);
    }, 200);
  }

  const DIRECT = {
    f: showHints,
    n: () => { const b = byLabel(ui.newChat); if (b) activate(b); },
    "/": openSearch,
    i: () => { const p = prompt(); if (p) focusEnd(p); },
  };

  window.addEventListener("keydown", (e) => {
    if (hints) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return hideHints();
      if (e.key === "Backspace") { typed = typed.slice(0, -1); return render(); }
      const k = e.key.toLowerCase();
      if (k.length === 1 && (LETTERS.includes(k) || /[1-9]/.test(k))) typeHint(k);
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    let action = DIRECT[k];
    if (!action && /^[1-9]$/.test(k)) action = () => { const b = bots()[Number(k) - 1]; if (b) activate(b); };
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }, true);

  // Hints go stale if the window resizes or scrolls under them.
  addEventListener("resize", () => hints && hideHints());
  addEventListener("scroll", () => hints && hideHints(), true);
  addEventListener("blur", () => hints && hideHints());

  // ---- width ----
  // Side panels (conversation details, the computer view) open past the
  // window's right edge. Report their total width so the launcher can widen
  // the window to the left, and shrink it again when they close.
  const panelWidth = () => !ui.sidePanels ? 0 : [...document.querySelectorAll(ui.sidePanels)]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 40 && r.height > 40 && s.display !== "none" && s.visibility !== "hidden";
    })
    .reduce((sum, el) => sum + Math.round(el.getBoundingClientRect().width), 0);
  let reported = -1;
  let pending = null;
  const reportWidth = () => {
    pending = null;
    const extra = panelWidth();
    if (extra === reported || typeof window.__grokbarResize !== "function") return;
    reported = extra;
    window.__grokbarResize(String(extra));
  };
  new MutationObserver(() => { pending ??= setTimeout(reportWidth, 120); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-state", "aria-hidden"] });

  window.__grokbar = {
    setTheme: (css) => { themeStyle.textContent = css; },
    preview: () => { showHints(); setTimeout(() => hints && hideHints(), 3000); },
    // For writing profiles: what's open and what spills past the right edge.
    inspect: () => ({
      width: innerWidth,
      panelWidth: panelWidth(),
      panels: [...document.querySelectorAll("aside,[role=dialog],[role=complementary],section,main")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 80 && r.height > 80)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}${el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""} x=${Math.round(r.left)}..${Math.round(r.right)}`),
      spill: [...document.querySelectorAll("body *")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.width > 100 && r.height > 100 && r.right > innerWidth + 2)
        .filter(({ el }, i, all) => !all.some((o) => o.el !== el && o.el.contains(el)))
        .slice(0, 8)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}${el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""} x=${Math.round(r.left)}..${Math.round(r.right)}`),
    }),
    check: () => ({
      bots: bots().length,
      newChat: !!byLabel(ui.newChat),
      search: !!byLabel(ui.search),
      prompt: !!prompt(),
      clickable: targets().length,
    }),
  };
})();
