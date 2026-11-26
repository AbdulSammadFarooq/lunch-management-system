/* Lunch Book — installable app (PWA) support.
 *  1. Registers the service worker (offline + instant start) and offers a refresh when a new version is ready.
 *  2. Shows an "Install app" sheet on phones:
 *       Android (Chrome, Edge, Samsung): one-tap install via the browser's install prompt
 *       iPhone / iPad (Safari):          step-by-step "Share → Add to Home Screen" (iOS has no install API)
 *       In-app browsers (WhatsApp…):     asks to open the page in the real browser first
 *  3. Never nags: hidden once installed, "Not now" snoozes it for a few days. The phone icon in the
 *     top bar always reopens it.
 */
(() => {
  const SNOOZE_KEY = "lunchbook-install-snooze";
  const SNOOZE_DAYS = 3;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPad = isIOS && !/iphone|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const inAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|\bwv\b/i.test(ua);
  const iosNotSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  const sheet = document.getElementById("installSheet");
  const button = document.getElementById("installBtn");
  let deferredPrompt = null;
  let reloading = false;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  const snoozed = () => Number(store.get(SNOOZE_KEY) || 0) > Date.now();
  const snooze = () => store.set(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
  const say = (msg, opts) => (typeof window.toast === "function" ? window.toast(msg, opts) : null);
  const ic = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

  if (isStandalone()) document.documentElement.classList.add("standalone");

  /* ---------- service worker ---------- */
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && secure) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("sw.js");
        const offerUpdate = (worker) => {
          say("A new version of Lunch Book is ready", {
            action: () => { reloading = true; worker.postMessage("skipWaiting"); },
            actionLabel: "Refresh",
            ms: 10000
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
          });
        });
        // check for a new version whenever the app comes back to the foreground
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      } catch (error) {
        console.warn("Service worker not registered:", error);
      }
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) location.reload();
    });
    // app files changed on the server (new push) → offer a refresh, once
    let offered = false;
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "app-updated" || offered) return;
      offered = true;
      say("Lunch Book was updated", { action: () => location.reload(), actionLabel: "Refresh", ms: 10000 });
    });
  }

  /* ---------- online / offline ---------- */
  window.addEventListener("offline", () => say("You're offline. Showing the last saved numbers.", { bad: true, ms: 4000 }));
  window.addEventListener("online", () => say("Back online"));

  /* ---------- install sheet ---------- */
  function platformMode() {
    if (inAppBrowser) return "inapp";
    if (isIOS) return "ios"; // iOS has no install prompt; always show the Share steps
    if (deferredPrompt) return "prompt";
    if (isAndroid) return "android";
    return "desktop";
  }

  function stepsFor(mode) {
    if (mode === "ios") {
      return [
        [`share`, iosNotSafari ? `Tap the <b>Share</b> button ${ic("share")} (in the address bar)` : `Tap the <b>Share</b> button ${ic("share")} ${isIPad ? "at the top" : "at the bottom of Safari"}`],
        [`addbox`, `Scroll down and tap <b>Add to Home Screen</b> ${ic("addbox")}`],
        [`check`, `Tap <b>Add</b>. Lunch Book appears on your home screen`]
      ];
    }
    if (mode === "android") {
      return [
        [`dots`, `Tap the browser menu ${ic("dots")} (top right)`],
        [`phone`, `Tap <b>Install app</b> or <b>Add to Home screen</b>`],
        [`check`, `Confirm. The icon appears on your home screen`]
      ];
    }
    if (mode === "inapp") {
      return [
        [`dots`, `Tap the menu ${ic("dots")} of this in-app browser`],
        [`share`, `Choose <b>Open in ${isIOS ? "Safari" : "Chrome"}</b> (or "Open in browser")`],
        [`phone`, `Then tap the phone icon at the top to install`]
      ];
    }
    return [
      [`phone`, `Click the install icon in the address bar, or the browser menu → <b>Install Lunch Book</b>`]
    ];
  }

  function render(mode) {
    const steps = mode === "prompt" ? [] : stepsFor(mode);
    sheet.className = `install ${mode === "ios" && !isIPad && !iosNotSafari ? "point-down" : ""}`;
    sheet.innerHTML = `
      <button class="icon-btn sm install-close" type="button" data-install="close" aria-label="Close">${ic("x")}</button>
      <div class="install-head">
        <img src="icons/icon-192.png" alt="" width="56" height="56">
        <div>
          <h3 id="installTitle">Install Lunch Book</h3>
          <p>Add it to your home screen and open it like a normal app.</p>
        </div>
      </div>
      <div class="install-perks"><span>${ic("spark")} Opens instantly</span><span>${ic("check")} Works offline</span><span>${ic("phone")} No app store</span></div>
      ${steps.length ? `<ol class="install-steps">${steps.map(([, html], i) => `<li style="--i:${i}"><span class="n">${i + 1}</span><span>${html}</span></li>`).join("")}</ol>` : ""}
      <div class="install-actions">
        <button class="btn ghost" type="button" data-install="later">Not now</button>
        ${mode === "prompt" ? `<button class="btn primary" type="button" data-install="go">${ic("download")} Install</button>` : `<button class="btn primary" type="button" data-install="close">Got it</button>`}
      </div>
      ${mode === "ios" && !isIPad && !iosNotSafari ? `<span class="install-arrow" aria-hidden="true">${ic("chev")}</span>` : ""}`;
  }

  function open(force = false) {
    if (isStandalone()) return;
    if (!force && snoozed()) return;
    const mode = platformMode();
    if (!force && mode === "desktop") return; // on computers only the top-bar button offers it
    render(mode);
    sheet.hidden = false;
    sheet.classList.remove("closing");
  }
  function close(remember) {
    if (sheet.hidden) return;
    if (remember) snooze();
    sheet.classList.add("closing");
    setTimeout(() => { sheet.hidden = true; sheet.classList.remove("closing"); }, 260);
  }

  function refreshButton() {
    button.hidden = isStandalone() || !(deferredPrompt || isIOS || isAndroid);
  }

  sheet.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-install]")?.dataset.install;
    if (!action) return;
    if (action === "later") return close(true);
    if (action === "close") return close(true);
    if (action === "go" && deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      close(false);
      promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome !== "accepted") snooze();
      refreshButton();
    }
  });
  button.addEventListener("click", () => (sheet.hidden ? open(true) : close(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); });

  // Android / desktop Chromium: the browser says the app can be installed
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshButton();
    if (!sheet.hidden) render(platformMode());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    close(false);
    refreshButton();
    say("Installed! Open Lunch Book from your home screen.");
  });

  refreshButton();
  // Offer it once the page has settled. Android waits a little longer for the browser's install prompt.
  if (!isStandalone() && !snoozed() && (isIOS || isAndroid)) {
    setTimeout(() => open(false), isAndroid ? 3500 : 2500);
  }
})();
