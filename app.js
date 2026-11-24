/* Lunch Book — single page app. Works read-only anywhere (GitHub Pages);
   editing turns on automatically when opened from `npm start` on this computer. */
const L = window.LunchLedger;
const $ = (id) => document.getElementById(id);
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  ledger: null,
  view: null,
  canSave: false,
  tab: "overview",
  filters: { q: "", type: "all", person: "all", month: "all" },
  dayLimit: 14,
  form: null,
  editingUid: null,
  saving: false
};

const TYPE_META = {
  meal: { label: "Meal", icon: "meal", tone: "tone-accent", help: "Someone paid for food. Split it equally, or type each person's share." },
  pot: { label: "Pot money", icon: "pot", tone: "tone-info", help: "People hand cash to the pot holder. Each giver goes up; the holder goes down because they now hold the cash." },
  transfer: { label: "Transfer", icon: "transfer", tone: "tone-violet", help: "Cash moved from one person to another. Not counted as food." },
  tax: { label: "Tax", icon: "tax", tone: "tone-warn", help: "An extra charge taken off the wallets you choose. Not food." },
  tip: { label: "Tip", icon: "tip", tone: "tone-good", help: "A tip taken off the wallets you choose. Not food." }
};
const DEFAULT_TITLE = { meal: "Lunch", pot: "Funding", transfer: "Exchange", tax: "Tax", tip: "Tip" };
const GENERIC = new Set(["muhammad", "mohammad", "abdul", "syed", "m"]);

/* ============ helpers ============ */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name, cls = "ic") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const money = (v, signed = false) => L.formatMoney(v, state.view?.currency || "Rs.", signed);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const person = (k) => state.view?.byKey.get(k) || state.ledger.people.find((p) => p.id === k);
const fullName = (k) => person(k)?.name || k;
function shortName(k) {
  const words = String(fullName(k)).split(/\s+/);
  return words.find((w) => !GENERIC.has(w.toLowerCase())) || words[0];
}
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const HUES = [14, 205, 152, 268, 334, 38, 182, 96, 300, 228, 0, 120];
function hue(k) {
  const idx = state.ledger.people.findIndex((p) => p.id === k);
  if (idx >= 0) return HUES[idx % HUES.length];
  let h = 0;
  for (const c of String(k)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function avatar(k, size = "") {
  const p = person(k);
  return `<span class="avatar ${size} ${p && p.active === false ? "off" : ""}" style="--h:${hue(k)}" title="${esc(fullName(k))}">${esc(initials(fullName(k)))}</span>`;
}
function fmtDate(iso, opts = { day: "numeric", month: "short" }) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", opts);
}
function relDay(iso) {
  const today = L.todayISO();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === today) return "Today";
  if (iso === L.todayISO(y)) return "Yesterday";
  return fmtDate(iso, { weekday: "long" });
}
function plural(n, one, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }
const activePeople = () => state.ledger.people.filter((p) => p.active !== false);

/** Amount fields accept simple maths like "500+220" or "1560/5". */
function evalAmount(str) {
  const s = String(str ?? "").replace(/,/g, "").trim();
  if (!s) return NaN;
  if (!/^[\d+\-*/().\s]+$/.test(s)) return NaN;
  try {
    const v = Function(`"use strict";return (${s})`)();
    return Number.isFinite(v) ? L.round2(v) : NaN;
  } catch { return NaN; }
}

function countAttr(value, { signed = false, abs = false } = {}) {
  return `data-count="${value}" ${signed ? 'data-signed="1"' : ""} ${abs ? 'data-abs="1"' : ""}`;
}
function animateCounts(root) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = Number(el.dataset.count) || 0;
    const signed = el.dataset.signed === "1";
    const abs = el.dataset.abs === "1";
    const plain = el.dataset.plain === "1";
    const fmt = (v) => (plain ? Math.round(v).toLocaleString("en-PK") : money(abs ? Math.abs(v) : v, signed));
    if (REDUCED) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const dur = 1000;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((items) => items.forEach((it) => { if (it.isIntersecting) { it.target.classList.add("in"); revealObserver.unobserve(it.target); } }), { threshold: 0.08 })
  : null;
function reveal(root) {
  root.querySelectorAll(".reveal").forEach((el) => (revealObserver ? revealObserver.observe(el) : el.classList.add("in")));
}

function toast(message, { bad = false, action = null, actionLabel = "Undo", ms = 3200 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${bad ? "bad" : ""}`;
  el.innerHTML = `${icon(bad ? "x" : "check")}<span>${esc(message)}</span>${action ? `<button type="button">${esc(actionLabel)}</button>` : ""}`;
  $("toasts").appendChild(el);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); };
  if (action) el.querySelector("button").addEventListener("click", () => { close(); action(); });
  setTimeout(close, action ? Math.max(ms, 6000) : ms);
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============ data ============ */
async function getJSON(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
async function loadLedger() {
  const book = await getJSON("data/book.json");
  const docs = await Promise.all((book.months || []).map((m) => getJSON(`data/months/${m}.json`)));
  return L.assemble(book, docs);
}
async function detectSave() {
  try {
    const res = await fetch("api/ping", { cache: "no-store" });
    return res.ok && (await res.json()).canSave === true;
  } catch { return false; }
}
function recompute() { state.view = L.compute(state.ledger); }
const cloneLedger = () => JSON.parse(JSON.stringify(state.ledger));
const nextSeq = (ledger) => ledger.entries.reduce((m, e) => Math.max(m, e.seq || 0), 0) + 1;
let uidCounter = 0;
const newUid = () => `n${Date.now().toString(36)}${uidCounter++}`;

async function persist(next, message, undoLedger) {
  const checked = L.validate(next);
  if (!checked.ok) { toast(checked.errors[0], { bad: true, ms: 5000 }); return false; }
  state.saving = true;
  try {
    const res = await fetch("api/book", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked.ledger) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
    state.ledger = checked.ledger;
    recompute();
    render();
    if (message) toast(message, undoLedger ? { action: () => persist(undoLedger, "Restored") } : {});
    return true;
  } catch (error) {
    toast(error.message.includes("fetch") ? "Can't reach the local server. Is `npm start` running?" : error.message, { bad: true, ms: 6000 });
    return false;
  } finally {
    state.saving = false;
  }
}

/* ============ entry description ============ */
function describe(e) {
  const ef = L.effectOf(e);
  const meta = TYPE_META[e.type];
  let line = "";
  let amount = ef.total;
  let small = "";
  if (e.type === "meal") {
    const payers = Object.keys(e.paidBy);
    const n = ef.shares.size;
    line = `Paid by ${payers.map(shortName).join(" & ")} · ${plural(n, "person", "people")}`;
    small = e.shares ? "custom split" : `${money(ef.paidTotal / (n || 1))} each`;
  } else if (e.type === "pot") {
    line = `${plural(ef.paid.size, "person", "people")} put in · held by ${shortName(e.heldBy)}`;
    small = "into the pot";
  } else if (e.type === "transfer") {
    line = `${shortName(e.from)} gave ${shortName(e.to)}`;
    small = "cash hand-over";
  } else {
    line = `${plural(ef.shares.size, "person", "people")} charged`;
    small = meta.label.toLowerCase();
  }
  return { ef, meta, line, amount, small };
}

function potTag(e) {
  const holder = state.view.holder;
  const ef = L.effectOf(e);
  const f = L.potFlow(ef, holder);
  if (e.type === "pot") return e.heldBy === holder ? `<span class="tag in">into pot</span>` : "";
  if (e.type === "transfer") return f.potChange > 0 ? `<span class="tag in">into pot</span>` : f.potChange < 0 ? `<span class="tag pot">from pot</span>` : `<span class="tag out">outside pot</span>`;
  if (e.type !== "meal") return "";
  if (f.fromPot > 0.004 && f.outside > 0.004) return `<span class="tag pot">pot + outside</span>`;
  if (f.outside > 0.004) return `<span class="tag out">outside pot</span>`;
  if (f.fromPot > 0.004) return `<span class="tag pot">from pot</span>`;
  return `<span class="tag in">own pocket</span>`;
}

function changeChips(ef) {
  return [...ef.changes.entries()]
    .filter(([k, v]) => Math.abs(v) > 0.004 || ef.shares.has(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div class="change">${avatar(k, "sm")}<span class="nm">${esc(shortName(k))}${ef.paid.get(k) ? ` <span class="faint">paid ${money(ef.paid.get(k))}</span>` : ""}</span><b class="${v > 0 ? "good" : v < 0 ? "bad" : "faint"}">${money(v, true)}</b></div>`)
    .join("");
}

function entryCard(e, i = 0) {
  const d = describe(e);
  const warn = L.warningsFor(e);
  const zeroShares = e.type === "meal" && e.shares ? Object.entries(e.shares).filter(([, v]) => !v).map(([k]) => shortName(k)) : [];
  return `
  <article class="entry" data-uid="${esc(e.uid)}" style="--i:${Math.min(i, 12)}">
    <div class="entry-main" data-toggle>
      <span class="type-icon ${d.meta.tone}">${icon(d.meta.icon)}</span>
      <div class="entry-title"><strong>${esc(e.title)}${potTag(e)}</strong><small>${esc(d.line)}</small></div>
      <div class="entry-amt">${money(d.amount)}<small>${esc(d.small)}</small></div>
      ${state.canSave ? `<div class="entry-actions">
        <button class="icon-btn sm" type="button" data-act="edit" title="Edit">${icon("edit")}</button>
        <button class="icon-btn sm" type="button" data-act="dup" title="Duplicate for today">${icon("copy")}</button>
        <button class="icon-btn sm danger" type="button" data-act="del" title="Delete">${icon("trash")}</button>
      </div>` : ""}
    </div>
    <div class="entry-detail"><div><div class="detail-inner">
      <div class="changes">${changeChips(d.ef)}</div>
      ${zeroShares.length ? `<p class="note">Joined but paid nothing: ${esc(zeroShares.join(", "))}</p>` : ""}
      ${e.note ? `<p class="note">📝 ${esc(e.note)}</p>` : ""}
      ${warn.map((w) => `<p class="warn-line">${esc(w)}</p>`).join("")}
    </div></div></div>
  </article>`;
}

/* ============ render: shell ============ */
function render() {
  const v = state.view;
  $("brandSub").textContent = v.overall.lastDate ? `Last entry ${fmtDate(v.overall.lastDate, { day: "numeric", month: "short", year: "numeric" })}` : "Office lunch ledger";
  const pill = $("modePill");
  pill.hidden = false;
  pill.className = `pill mode ${state.canSave ? "edit" : ""}`;
  pill.innerHTML = state.canSave ? "Editing on" : `${icon("lock", "ic")} View only`;
  pill.querySelector?.(".ic")?.setAttribute("style", "width:13px;height:13px");
  $("addBtn").hidden = !state.canSave;
  $("fab").hidden = !state.canSave;

  for (const t of ["overview", "activity", "people", "months"]) $(`view-${t}`).hidden = t !== state.tab;
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === state.tab));
  positionInk();

  const target = $(`view-${state.tab}`);
  ({ overview: renderOverview, activity: renderActivity, people: renderPeople, months: renderMonths })[state.tab](target);
  animateCounts(target);
  reveal(target);
}

function positionInk() {
  const a = document.querySelector("#tabs a.active");
  const ink = $("tabInk");
  if (!a) return;
  ink.style.width = `${a.offsetWidth}px`;
  ink.style.transform = `translateX(${a.offsetLeft}px)`;
}

function setTab(tab) {
  if (!["overview", "activity", "people", "months"].includes(tab)) tab = "overview";
  const changed = tab !== state.tab;
  state.tab = tab;
  render();
  if (changed) window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
}

/* ============ render: overview ============ */
function renderOverview(root) {
  const v = state.view;
  const c = v.current;
  const over = c.potLeft < -L.EPS;
  const start = c.potCarried + c.potIn;
  const used = start > 0 ? c.potOut / start : c.potOut > 0 ? 1 : 0;
  const R = 80;
  const len = 2 * Math.PI * R;
  const off = len * (1 - clamp(used, 0, 1));
  const holderShort = shortName(v.holder);

  const headline = over
    ? `Pot is short by <span ${countAttr(-c.potLeft)}>${money(-c.potLeft)}</span>`
    : `<span ${countAttr(c.potLeft)}>${money(c.potLeft)}</span> left in the pot`;
  const sub = over
    ? `${holderShort} has paid more from the pot than was collected. Time to collect pot money.`
    : `This is the cash ${holderShort} is holding for the group.${c.daysLeft ? ` About ${money(c.dailyRoom)} a day for the ${plural(c.daysLeft, "day")} left.` : ""}`;

  root.innerHTML = `
    <div class="stack">
      <section class="hero ${over ? "over" : ""} reveal">
        <div class="ring" style="--len:${len};--off:${off}">
          <svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="${R}"/><circle class="bar" cx="100" cy="100" r="${R}"/></svg>
          <div class="ring-center"><small>Spent</small><strong>${Math.round(used * 100)}%</strong><span>of ${money(start)}</span></div>
        </div>
        <div class="hero-copy">
          <h2>${esc(c.label)} pot <span class="hero-chip">held by ${esc(v.holderName)}</span></h2>
          <p class="headline">${headline}</p>
          <p class="sub">${sub}</p>
          <div class="hero-stats">
            <div class="hero-stat"><small>From last month</small><strong ${countAttr(c.potCarried, { signed: true })}>${money(c.potCarried, true)}</strong></div>
            <div class="hero-stat"><small>+ Collected</small><strong ${countAttr(c.potIn)}>${money(c.potIn)}</strong></div>
            <div class="hero-stat"><small>− Paid from pot</small><strong ${countAttr(c.potOut)}>${money(c.potOut)}</strong></div>
            <div class="hero-stat"><small>= Left</small><strong ${countAttr(c.potLeft)}>${money(c.potLeft)}</strong></div>
          </div>
          <div class="hero-actions">
            ${state.canSave ? `<button class="btn" type="button" data-open-form="meal">${icon("plus")} Add expense</button><button class="btn ghost" type="button" data-open-form="pot">${icon("pot")} Pot money</button>` : ""}
            <button class="btn ghost" type="button" data-open-month="${c.key}">Month details ${icon("chev")}</button>
          </div>
        </div>
      </section>

      ${sourcesCard(c)}

      <div class="grid four">
        ${tile("Food this month", c.food, `pot + outside, ${plural(c.entryCount, "entry", "entries")}`, "meal", "tone-accent", 0)}
        ${tile("Lunch days", null, `out of ${c.dayOfMonth} days so far`, "calendar", "tone-info", 1, c.dayCount)}
        ${tile("Pot pace", c.pace, "paid from the pot per day", "spark", "tone-violet", 2)}
        ${tile("All-time food", v.overall.food, `${plural(v.overall.meals, "meal")} since ${fmtDate(v.overall.firstDate, { month: "short", year: "numeric" })}`, "pot", "tone-good", 3)}
      </div>

      <div class="grid two">
        <section class="card reveal">
          <div class="card-head">
            <div><h3>Wallets</h3><p>Tap a name to see how it was worked out</p></div>
            <div class="legend"><span><i style="background:var(--good)"></i>Gets back</span><span><i style="background:var(--bad)"></i>Owes</span></div>
          </div>
          ${walletList()}
        </section>
        <div class="stack">
          <section class="card reveal" style="--i:1">
            <div class="card-head"><div><h3>Food this month</h3><p>Each person's share of meals</p></div></div>
            ${foodBars(c.foodBy)}
          </section>
          <section class="card reveal" style="--i:2">
            <div class="card-head"><div><h3>Daily spend</h3><p>${esc(c.label)}</p></div></div>
            ${dailyColumns()}
          </section>
        </div>
      </div>

      <div class="grid two">
        <section class="card reveal">
          <div class="card-head"><div><h3>Latest</h3><p>Most recent entries</p></div><a class="link" href="#activity">See all ${icon("chev")}</a></div>
          <div class="entries">${[...v.effects].reverse().slice(0, 6).map((ef, i) => entryCard(ef.entry, i)).join("") || emptyState("No entries yet")}</div>
        </section>
        <section class="card reveal" style="--i:1">
          <div class="card-head"><div><h3>If everything was settled today</h3><p>Fewest hand-overs that would clear every wallet, including returning the leftover pot cash</p></div></div>
          ${settleList()}
        </section>
      </div>
      <p class="foot-note">${state.canSave ? "Saving writes to <code>data/</code>. Commit &amp; push when everyone should see it." : "This page is read-only. Numbers update when the book is pushed."}</p>
    </div>`;
}

function tile(label, value, small, ic, tone, i, plainNumber) {
  const val = plainNumber !== undefined
    ? `<strong data-count="${plainNumber}" data-plain="1">${plainNumber}</strong>`
    : `<strong ${countAttr(value)}>${money(value)}</strong>`;
  return `<div class="card tile reveal" style="--i:${i}"><div class="tile-top"><span class="tile-icon ${tone}">${icon(ic)}</span>${esc(label)}</div>${val}<small>${esc(small)}</small></div>`;
}

/** Where this month's food money came from: pot / outside the pot / holder's own pocket. */
function sourcesCard(m, inDrawer = false) {
  const v = state.view;
  const holder = shortName(v.holder);
  const parts = [
    { label: `From the pot`, sub: `${holder} paid with the pot money`, val: m.mealFromPot, cls: "seg-pot" },
    { label: `Outside the pot`, sub: m.outsideBy.size ? [...m.outsideBy].sort((a, b) => b[1] - a[1]).map(([k, val]) => `${shortName(k)} ${money(val)}`).join(" · ") : "Nobody paid separately", val: m.outside, cls: "seg-out" },
    { label: `${holder}'s own food`, sub: `${holder}'s own share, paid personally (not from the pot)`, val: m.holderSelf, cls: "seg-self" }
  ];
  const total = parts.reduce((s, p) => s + p.val, 0);
  const bar = total > 0 ? parts.filter((p) => p.val > 0).map((p, i) => `<i class="${p.cls}" style="--w:${(p.val / total) * 100}%;--i:${i}" title="${esc(p.label)}: ${money(p.val)}"></i>`).join("") : "";
  return `
  <section class="${inDrawer ? "" : "card reveal"} sources">
    <div class="card-head"><div><h3>Where ${inDrawer ? "the" : "this month's"} food money came from</h3><p>Pot and outside payments are kept apart. Together they make the total.</p></div>
      <div class="sources-total"><small>Total food</small><strong ${countAttr(total)}>${money(total)}</strong></div></div>
    <div class="stackbar">${bar}</div>
    <div class="sources-grid">${parts.map((p) => `
      <div class="source"><span class="dot ${p.cls}"></span><div><strong>${esc(p.label)}</strong><small>${esc(p.sub)}</small></div><b>${money(p.val)}</b></div>`).join("")}</div>
    ${m.outside > 0 ? `<p class="note">Money paid outside the pot is added to that person's wallet, so they get it back (or owe less). It never changes what's in the pot.</p>` : ""}
  </section>`;
}

function emptyState(text) { return `<div class="empty">${icon("logo")}<p>${esc(text)}</p></div>`; }

/** The pot holder's wallet mixes two things: pot cash they keep for the group, and their own balance.
    Wallets show only the personal part; the pot cash is shown separately. */
const personalBalance = (k) => (k === state.view.holder ? state.view.holderPersonal : state.view.balances.get(k) || 0);

function walletRows() {
  const v = state.view;
  return v.people
    .map((p) => ({ p, bal: personalBalance(p.id) }))
    .filter((r) => r.p.active !== false || Math.abs(r.bal) > L.EPS)
    .sort((a, b) => a.bal - b.bal);
}

function walletList() {
  const v = state.view;
  const rows = walletRows();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.bal)));
  return `<div class="wallets">${rows.map((r, i) => {
    const food = v.current.foodBy.get(r.p.id) || 0;
    const usual = v.averageFood.get(r.p.id) || 0;
    const note = r.p.id === v.holder
      ? `also holds ${money(v.potCash)} pot cash`
      : [food > L.EPS ? `ate ${money(food)} this month` : "", usual > L.EPS && !v.averageIsCurrentOnly ? `usually ${money(usual)}/month` : ""].filter(Boolean).join(" · ");
    const status = r.bal > L.EPS ? ["good", "gets back"] : r.bal < -L.EPS ? ["bad", "owes"] : ["faint", "settled"];
    const w = (Math.abs(r.bal) / max) * 50;
    return `<button class="wallet" type="button" data-person="${esc(r.p.id)}">
      ${avatar(r.p.id)}
      <span class="who"><strong>${esc(r.p.name)}</strong><small>${esc(note || "—")}</small></span>
      <span class="diverge" style="--i:${i}"><i class="${r.bal >= 0 ? "pos" : "neg"}" style="--w:${w}%"></i></span>
      <span class="amt ${status[0]}"><span ${countAttr(r.bal, { abs: true })}>${money(Math.abs(r.bal))}</span><small>${status[1]}</small></span>
    </button>`;
  }).join("")}</div>`;
}

function foodBars(map) {
  const rows = [...map.entries()].filter(([, v]) => v > L.EPS).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return emptyState("No meals yet this month");
  const max = rows[0][1];
  return `<div class="hbars">${rows.map(([k, val], i) => `
    <div class="hbar"><span class="name">${esc(shortName(k))}</span><span class="track"><span class="fill" style="--w:${(val / max) * 100}%;--i:${i}"></span></span><span class="val">${money(val)}</span></div>`).join("")}</div>`;
}

function dailyColumns() {
  const v = state.view;
  const c = v.current;
  const byDay = new Map();
  for (const ef of v.effects) {
    if (ef.entry.type === "meal" && L.monthKey(ef.entry.date) === c.key) byDay.set(ef.entry.date, (byDay.get(ef.entry.date) || 0) + ef.shareTotal);
  }
  const max = Math.max(1, ...byDay.values());
  const cols = [];
  for (let d = 1; d <= c.daysInMonth; d++) {
    const iso = `${c.key}-${String(d).padStart(2, "0")}`;
    const val = byDay.get(iso) || 0;
    const h = val ? Math.max(4, (val / max) * 100) : 0;
    cols.push(`<div class="col" style="--h:${h}%;--i:${d}">${val ? `<span class="tip">${fmtDate(iso)} · ${money(val)}</span>` : ""}<span class="stick" style="${val ? "" : "opacity:.15;height:3px"}"></span><small>${d % 5 === 1 || d === c.daysInMonth ? d : "&nbsp;"}</small></div>`);
  }
  return `<div class="cols">${cols.join("")}</div>`;
}

function settleList() {
  const v = state.view;
  const plan = L.settlePlan(v.balances, v.people);
  if (!plan.length) return emptyState("Everyone is settled 🎉");
  return `<div class="settle-list">${plan.map((p) => `
    <div class="settle">${avatar(p.from, "sm")}<span>${esc(shortName(p.from))}</span><span class="arrow">${icon("chev")}</span>${avatar(p.to, "sm")}<span>${esc(shortName(p.to))}</span>
      <b>${money(p.amount)}</b>
      ${state.canSave ? `<button class="btn small ghost" type="button" data-record-settle="${esc(p.from)}|${esc(p.to)}|${p.amount}">Record</button>` : ""}
    </div>`).join("")}</div>
    <p class="note">Normally you don't need this: people keep paying into the pot each month. It's here for when someone leaves or you want a clean start.</p>`;
}

/* ============ render: activity ============ */
function renderActivity(root) {
  const v = state.view;
  const f = state.filters;
  const months = [...new Set(v.effects.map((ef) => L.monthKey(ef.entry.date)))].sort().reverse();
  const typeChip = (val, label, ic) => `<button class="chip ${f.type === val ? "on" : ""}" type="button" data-type-filter="${val}">${ic ? icon(ic) : ""}${label}</button>`;
  root.innerHTML = `
    <div class="page-head"><div><h1>Activity</h1><p>Every entry, newest first. Tap one to see who moved how much.</p></div>
      ${state.canSave ? `<button class="btn primary" type="button" data-open-form="meal">${icon("plus")} Add expense</button>` : ""}</div>
    <div class="filters">
      <label class="search-box">${icon("search")}<input id="fSearch" class="input" type="search" placeholder="Search title, person, note, date…" value="${esc(f.q)}"></label>
      <select id="fPerson" class="input" style="width:auto"><option value="all">Everyone</option>${v.people.map((p) => `<option value="${esc(p.id)}" ${f.person === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <select id="fMonth" class="input" style="width:auto"><option value="all">All months</option>${months.map((m) => `<option value="${m}" ${f.month === m ? "selected" : ""}>${L.monthLabel(m)}</option>`).join("")}</select>
    </div>
    <div class="chips" style="margin:-4px 0 18px">${typeChip("all", "All")}${typeChip("meal", "Meals", "meal")}${typeChip("pot", "Pot", "pot")}${typeChip("transfer", "Transfers", "transfer")}${typeChip("extra", "Tax & tip", "tax")}</div>
    <div id="activityList"></div>`;
  renderActivityList();
}

function filteredEntries() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return [...state.view.effects].reverse().map((ef) => ef.entry).filter((e) => {
    if (f.type !== "all" && (f.type === "extra" ? !["tax", "tip"].includes(e.type) : e.type !== f.type)) return false;
    if (f.month !== "all" && L.monthKey(e.date) !== f.month) return false;
    const who = L.participants(e);
    if (f.person !== "all" && !who.includes(f.person)) return false;
    if (!q) return true;
    const hay = [e.title, e.note, e.date, fmtDate(e.date, { day: "numeric", month: "long" }), TYPE_META[e.type].label, ...who.map(fullName)].join(" ").toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

function renderActivityList() {
  const list = $("activityList");
  if (!list) return;
  const entries = filteredEntries();
  if (!entries.length) { list.innerHTML = emptyState("Nothing matches these filters"); return; }
  const days = [];
  for (const e of entries) {
    if (!days.length || days[days.length - 1].date !== e.date) days.push({ date: e.date, items: [] });
    days[days.length - 1].items.push(e);
  }
  const shown = days.slice(0, state.dayLimit);
  let i = 0;
  list.innerHTML = shown.map((d) => {
    const food = d.items.filter((e) => e.type === "meal").reduce((s, e) => s + L.effectOf(e).shareTotal, 0);
    return `<section class="day"><div class="day-head"><h4>${esc(relDay(d.date))}<span>${fmtDate(d.date, { day: "numeric", month: "long", year: "numeric" })}</span></h4>${food ? `<span class="day-total">${money(food)} food</span>` : ""}</div>
      <div class="entries">${d.items.map((e) => entryCard(e, i++)).join("")}</div></section>`;
  }).join("") + (days.length > shown.length ? `<div style="text-align:center"><button class="btn" type="button" data-more>Show more days (${days.length - shown.length} left)</button></div>` : "")
    + `<p class="foot-note">${plural(entries.length, "entry", "entries")} · ${plural(days.length, "day")}</p>`;
}

/* ============ render: people ============ */
function renderPeople(root) {
  const v = state.view;
  const rows = [...v.people].sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active === false ? 1 : -1));
  const totalPaid = new Map();
  for (const ef of v.effects) if (ef.entry.type === "meal") for (const [k, val] of ef.paid) totalPaid.set(k, (totalPaid.get(k) || 0) + val);
  root.innerHTML = `
    <div class="page-head"><div><h1>People</h1><p>Green means the group owes them (they paid in more than they ate). Red means they should pay in.</p></div></div>
    <div class="people-grid">${rows.map((p, i) => {
      const bal = personalBalance(p.id);
      const cls = bal > L.EPS ? "good" : bal < -L.EPS ? "bad" : "faint";
      const word = bal > L.EPS ? "Gets money back" : bal < -L.EPS ? "Needs to pay" : "All settled";
      return `<button class="card person-card reveal" type="button" data-person="${esc(p.id)}" style="--h:${hue(p.id)};--i:${i % 8}">
        <div class="top">${avatar(p.id, "")}<div><strong>${esc(p.name)}</strong>${p.active === false ? '<span class="badge">inactive</span>' : p.id === v.holder ? '<span class="badge">pot holder</span>' : ""}</div></div>
        <div class="bal ${cls}" ${countAttr(bal, { abs: true })}>${money(Math.abs(bal))}</div>
        <div class="status ${cls}">${word}${p.id === v.holder ? ` <span class="faint">· holds ${money(v.potCash)} pot cash</span>` : ""}</div>
        <div class="mini-stats">
          <div><small>This month</small><b>${money(Math.round(v.current.foodBy.get(p.id) || 0))}</b></div>
          <div><small>Usual month</small><b>${money(Math.round(v.averageFood.get(p.id) || 0))}</b></div>
          <div><small>Paid out</small><b>${money(Math.round(totalPaid.get(p.id) || 0))}</b></div>
        </div>
      </button>`;
    }).join("")}</div>
    ${state.canSave ? adminPanel() : ""}`;
}

function adminPanel() {
  const v = state.view;
  const used = new Set(state.ledger.entries.flatMap((e) => L.participants(e)));
  return `
  <section class="card reveal" style="margin-top:22px">
    <div class="card-head"><div><h3>Manage people</h3><p>Changes save as soon as you leave a field. Turn someone off to hide them from forms (history stays).</p></div></div>
    <div id="adminRows">${v.people.map((p) => `
      <div class="admin-row" data-admin="${esc(p.id)}">
        ${avatar(p.id, "sm")}
        <label class="field"><input data-pfield="name" value="${esc(p.name)}" aria-label="Name"></label>
        <label class="field ob" title="Wallet before the first entry"><input data-pfield="openingBalance" inputmode="decimal" value="${p.openingBalance}" aria-label="Opening balance"></label>
        <label class="switch" title="Active"><input type="checkbox" data-pfield="active" ${p.active !== false ? "checked" : ""}><span></span></label>
        ${used.has(p.id) || p.id === v.holder ? `<span class="faint" style="width:32px"></span>` : `<button class="icon-btn sm danger" type="button" data-del-person="${esc(p.id)}" title="Delete (never used)">${icon("trash")}</button>`}
      </div>`).join("")}
    </div>
    <form id="addPerson" class="row wrap" style="margin-top:14px">
      <input class="input" name="name" placeholder="New person's name" style="flex:2;min-width:180px" required>
      <input class="input" name="ob" placeholder="Opening balance (0)" inputmode="decimal" style="flex:1;min-width:140px">
      <button class="btn primary" type="submit">${icon("plus")} Add person</button>
    </form>
    <div class="row wrap" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
      <label class="field" style="min-width:220px"><span>Pot holder (budget person)</span>
        <select id="holderSelect">${v.people.map((p) => `<option value="${esc(p.id)}" ${p.id === v.holder ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <p class="muted" style="font-size:13px;flex:1;min-width:220px">Wallet keys (used inside the data files): ${v.people.map((p) => `<code>${esc(p.id)}</code>`).join(" ")}</p>
    </div>
  </section>`;
}

/* ============ render: months ============ */
function renderMonths(root) {
  const v = state.view;
  const months = v.months.filter((m) => m.entryCount || m.isCurrent);
  const chartMonths = months.slice(-8);
  const max = Math.max(1, ...chartMonths.flatMap((m) => [m.potIn, m.potOut, m.outside]));
  const hasTax = months.some((m) => m.tax || m.tip);
  const dash = `<span class="faint">—</span>`;
  root.innerHTML = `
    <div class="page-head"><div><h1>Months</h1><p>Pot = what was left last month + money collected − what ${esc(shortName(v.holder))} paid from it. Money people paid themselves is shown apart.</p></div>
      <div class="row"><button class="btn" type="button" data-export="csv">${icon("download")} CSV</button><button class="btn" type="button" data-export="json">${icon("download")} Backup</button></div></div>
    <section class="card reveal">
      <div class="card-head"><div><h3>Pot in, pot out, and outside</h3><p>Tap a month in the table for the full breakdown</p></div>
        <div class="legend"><span><i style="background:var(--info)"></i>Collected</span><span><i style="background:var(--accent)"></i>Paid from pot</span><span><i style="background:var(--violet)"></i>Outside pot</span></div></div>
      <div class="mchart">${chartMonths.map((m, i) => `
        <div class="mcol" title="${esc(m.label)}: collected ${money(m.potIn)}, from pot ${money(m.potOut)}, outside ${money(m.outside)}"><div class="pair">
          <i class="c" style="--h:${(m.potIn / max) * 100}%;--i:${i}"></i><i class="s" style="--h:${(m.potOut / max) * 100}%;--i:${i}"></i><i class="o" style="--h:${(m.outside / max) * 100}%;--i:${i}"></i></div>
          <small>${L.monthLabel(m.key, true)}</small></div>`).join("")}</div>
    </section>
    <section class="card reveal" style="margin-top:18px">
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th class="r">From last month</th><th class="r">+ Collected</th><th class="r">− Paid from pot</th><th class="r">= Left in pot</th><th class="r">Outside pot</th><th class="r">Total food</th>${hasTax ? '<th class="r">Tax</th><th class="r">Tip</th>' : ""}<th class="r">Days</th></tr></thead>
        <tbody>${[...months].reverse().map((m) => `
          <tr class="click ${m.isCurrent ? "current" : ""}" data-open-month="${m.key}">
            <td>${esc(m.label)}</td>
            ${m.potTracked
              ? `<td class="r">${money(m.potCarried, true)}</td><td class="r">${money(m.potIn)}</td><td class="r">${money(m.potOut)}</td><td class="r ${m.potLeft < -L.EPS ? "bad" : "good"}"><b>${money(m.potLeft)}</b></td>`
              : `<td class="r" colspan="4"><span class="faint">before the pot started</span></td>`}
            <td class="r">${m.outside ? money(m.outside) : dash}</td><td class="r">${money(m.food)}</td>
            ${hasTax ? `<td class="r">${money(m.tax)}</td><td class="r">${money(m.tip)}</td>` : ""}<td class="r">${m.dayCount}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

/* ============ drawers ============ */
function openDrawer(html) {
  const d = $("drawer");
  $("drawerBody").innerHTML = html;
  d.classList.remove("closing");
  d.hidden = false;
  document.body.style.overflow = "hidden";
  animateCounts(d);
}
function closeDrawer() {
  const d = $("drawer");
  if (d.hidden) return;
  d.classList.add("closing");
  setTimeout(() => { d.hidden = true; d.classList.remove("closing"); if ($("sheet").hidden) document.body.style.overflow = ""; }, 230);
}

function openPerson(k) {
  const v = state.view;
  const p = person(k);
  const isHolder = k === v.holder;
  const bal = personalBalance(k);
  const rows = [...(v.history.get(k) || [])].reverse();
  const cls = bal > L.EPS ? "good" : bal < -L.EPS ? "bad" : "faint";
  const monthsFood = v.months.filter((m) => m.foodBy.get(k)).map((m) => [m.key, m.foodBy.get(k)]);
  const maxFood = Math.max(1, ...monthsFood.map((r) => r[1]));
  openDrawer(`
    <div class="drawer-hero">${avatar(k, "lg")}<div><p class="eyebrow">Wallet</p><h2>${esc(p.name)}</h2>
      <p class="${cls}" style="font-family:var(--display);font-size:22px;font-weight:700"><span ${countAttr(bal, { signed: true })}>${money(bal, true)}</span></p>
      <p class="muted" style="font-size:13px">${bal > L.EPS ? "The group owes them this much." : bal < -L.EPS ? "They should pay this much in." : "All settled."}</p></div></div>
    ${isHolder ? `<div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:8px">Pot holder</h3>
      <div class="statement">
        <div class="st-row"><div><strong>Pot cash held for the group</strong><small>Collected − paid from the pot, since ${L.monthLabel(v.months.find((m) => m.potTracked)?.key || "")}</small></div><b>${money(v.potCash)}</b><span></span></div>
        <div class="st-row"><div><strong>Own wallet</strong><small>Their own food and payments, apart from the pot</small></div><b class="${bal > L.EPS ? "good" : bal < -L.EPS ? "bad" : ""}">${money(bal, true)}</b><span></span></div>
        <div class="st-row"><div><strong>Statement total</strong><small>Own wallet − pot cash (this is what the lines below add up to)</small></div><b>${money(v.balances.get(k) || 0, true)}</b><span></span></div>
      </div></div>` : ""}
    ${monthsFood.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Food by month</h3></div><div class="hbars">${monthsFood.map(([m, val], i) => `
      <div class="hbar"><span class="name">${L.monthLabel(m, true)}</span><span class="track"><span class="fill" style="--w:${(val / maxFood) * 100}%;--i:${i}"></span></span><span class="val">${money(val)}</span></div>`).join("")}</div></div>` : ""}
    <h3 style="margin-bottom:6px">Statement</h3>
    <p class="muted" style="font-size:13px;margin-bottom:8px">Each line: what they paid minus their share. Right column is the running wallet.</p>
    <div class="statement">${rows.map((r) => {
      const e = r.effect.entry;
      const paid = r.effect.paid.get(k) || 0;
      const share = r.effect.shares.get(k) || 0;
      return `<div class="st-row"><div><strong>${esc(e.title)}</strong><small>${fmtDate(e.date, { day: "numeric", month: "short", year: "numeric" })} · ${paid ? `paid ${money(paid)}` : ""}${paid && share ? " · " : ""}${share ? `share ${money(share)}` : ""}${!paid && !share ? "joined, no cost" : ""}</small></div>
        <b class="${r.change > 0 ? "good" : r.change < 0 ? "bad" : "faint"}">${money(r.change, true)}</b><span class="bal">${money(r.balance)}</span></div>`;
    }).join("")}
      <div class="st-row"><div><strong>Opening balance</strong><small>Before the first entry in the book</small></div><b>${money(p.openingBalance, true)}</b><span class="bal">${money(p.openingBalance)}</span></div>
    </div>`);
}

function openMonth(key) {
  const v = state.view;
  const m = v.monthMap.get(key);
  if (!m) return;
  const pots = v.effects.filter((ef) => ef.entry.type === "pot" && L.monthKey(ef.entry.date) === key);
  const titles = new Map();
  for (const ef of v.effects) if (ef.entry.type === "meal" && L.monthKey(ef.entry.date) === key) titles.set(ef.entry.title, (titles.get(ef.entry.title) || 0) + ef.shareTotal);
  const top = [...titles].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxT = Math.max(1, ...top.map((t) => t[1]));
  openDrawer(`
    <div class="drawer-hero"><span class="avatar lg" style="--h:20">${icon("calendar")}</span><div><p class="eyebrow">Month</p><h2>${esc(m.label)}</h2>
      ${m.potTracked ? `<p class="${m.potLeft < -L.EPS ? "bad" : "good"}" style="font-family:var(--display);font-size:22px;font-weight:700">${money(Math.abs(m.potLeft))} ${m.potLeft < -L.EPS ? "short in the pot" : "left in the pot"}</p>` : `<p class="muted">Before the pot started</p>`}</div></div>
    ${m.potTracked ? `<div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:8px">Pot cash</h3>
      <div class="statement">
        <div class="st-row"><div><strong>From last month</strong></div><b>${money(m.potCarried, true)}</b><span></span></div>
        <div class="st-row"><div><strong>+ Collected</strong><small>Pot money handed to ${esc(shortName(v.holder))}</small></div><b class="good">${money(m.potIn)}</b><span></span></div>
        <div class="st-row"><div><strong>− Paid from the pot</strong><small>Bills ${esc(shortName(v.holder))} paid, minus their own share${m.potOut - m.mealFromPot > 0.5 ? `, plus ${money(m.potOut - m.mealFromPot)} cash handed out` : ""}</small></div><b class="bad">${money(m.potOut)}</b><span></span></div>
        <div class="st-row"><div><strong>= Left in the pot</strong></div><b>${money(m.potLeft)}</b><span></span></div>
      </div></div>` : ""}
    <div class="card" style="margin-bottom:16px">${sourcesCard(m, true)}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Who put money in</h3><span class="muted">${money(m.collected)}</span></div>
      ${pots.length ? `<div class="statement">${pots.flatMap((ef) => [...ef.paid].map(([k, val]) => `<div class="st-row"><div class="row">${avatar(k, "sm")}<div><strong>${esc(fullName(k))}</strong><small>${fmtDate(ef.entry.date)} · ${esc(ef.entry.title)}</small></div></div><b class="good">${money(val)}</b><span></span></div>`)).join("")}</div>` : `<p class="muted">No pot money this month.</p>`}
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Food by person</h3><span class="muted">${money(m.food)}</span></div>${foodBars(m.foodBy)}</div>
    ${top.length ? `<div class="card"><div class="card-head"><h3>By title</h3></div><div class="hbars">${top.map(([t, val], i) => `<div class="hbar"><span class="name">${esc(t)}</span><span class="track"><span class="fill" style="--w:${(val / maxT) * 100}%;--i:${i}"></span></span><span class="val">${money(val)}</span></div>`).join("")}</div></div>` : ""}
    ${m.tax || m.tip ? `<div class="card" style="margin-top:16px"><h3>Tax ${money(m.tax)} · Tip ${money(m.tip)}</h3></div>` : ""}
    <div style="margin-top:16px"><button class="btn" type="button" data-filter-month="${key}">See this month's entries ${icon("chev")}</button></div>`);
}

/* ============ the add / edit form ============ */
function lastMeal(title) {
  const meals = [...state.ledger.entries].filter((e) => e.type === "meal").sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  return [...meals].reverse().find((e) => !title || e.title.toLowerCase() === title.toLowerCase()) || meals[meals.length - 1];
}
function eatersOf(e) { return e ? (e.for ? [...e.for] : Object.keys(e.shares || {})) : []; }

function blankForm(type = "meal") {
  const holder = state.view.holder;
  const last = lastMeal("Lunch");
  const activeIds = new Set(activePeople().map((p) => p.id));
  return {
    type, date: L.todayISO(), title: DEFAULT_TITLE[type], note: "",
    payer: holder, multiPay: false, total: "", payers: {},
    eaters: eatersOf(last).filter((k) => activeIds.has(k)), split: "equal", shares: {},
    holder, potIn: {}, from: "", to: holder, amount: "", charges: {}
  };
}

function formFromEntry(e) {
  const f = blankForm(e.type);
  Object.assign(f, { date: e.date, title: e.title, note: e.note || "" });
  const str = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, String(v)]));
  if (e.type === "meal") {
    const payers = Object.keys(e.paidBy);
    f.multiPay = payers.length > 1;
    f.payer = payers[0];
    f.total = String(e.paidBy[payers[0]]);
    f.payers = str(e.paidBy);
    f.eaters = eatersOf(e);
    f.split = e.shares ? "custom" : "equal";
    f.shares = str(e.shares);
  } else if (e.type === "pot") {
    f.holder = e.heldBy; f.potIn = str(e.from);
  } else if (e.type === "transfer") {
    f.from = e.from; f.to = e.to; f.amount = String(e.amount);
  } else {
    f.charges = str(e.charges);
  }
  return f;
}

/** People to show in the form: active ones plus anyone already used in the entry being edited. */
function formPeople(extraKeys = []) {
  const keep = new Set(extraKeys);
  return state.ledger.people.filter((p) => p.active !== false || keep.has(p.id));
}

function openForm(form, editingUid = null) {
  state.form = form;
  state.editingUid = editingUid;
  $("sheetEyebrow").textContent = editingUid ? "Editing" : "New entry";
  $("sheetTitle").textContent = editingUid ? "Edit entry" : "Add expense";
  $("saveAnother").hidden = !!editingUid;
  $("formError").hidden = true;
  const s = $("sheet");
  s.classList.remove("closing");
  s.hidden = false;
  document.body.style.overflow = "hidden";
  renderForm();
  setTimeout(() => {
    const target = form.type === "meal" ? $("sheetBody").querySelector('[data-f="total"]') : $("sheetBody").querySelector("input[data-amt], [data-f='amount']");
    if (target && !editingUid && window.innerWidth > 760) target.focus();
  }, 350);
}
function closeForm() {
  const s = $("sheet");
  if (s.hidden) return;
  s.classList.add("closing");
  setTimeout(() => { s.hidden = true; s.classList.remove("closing"); if ($("drawer").hidden) document.body.style.overflow = ""; }, 240);
  state.form = null;
  state.editingUid = null;
}

function titleSuggestions(type) {
  const base = { meal: ["Lunch", "Snacks", "Breakfast", "Tea"], pot: ["Funding"], transfer: ["Exchange"], tax: ["Tax"], tip: ["Tip"] }[type];
  const counts = new Map();
  for (const e of state.ledger.entries) if (e.type === type) counts.set(e.title, (counts.get(e.title) || 0) + 1);
  const recent = [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return [...new Set([...base, ...recent])].slice(0, 8);
}

function pickButtons(people, selected, attr) {
  const set = new Set(selected);
  return `<div class="pick">${people.map((p) => `<button type="button" class="pick-btn ${set.has(p.id) ? "on" : ""}" ${attr}="${esc(p.id)}">${avatar(p.id, "sm")}${esc(shortName(p.id))}</button>`).join("")}</div>`;
}
function amountRows(people, values, group, hint = "") {
  return `<div class="amount-rows">${people.map((p) => `
    <div class="amount-row">${avatar(p.id, "sm")}<span>${esc(p.name)}${hint ? ` <span class="hint">${hint}</span>` : ""}</span>
      <input class="input" inputmode="decimal" placeholder="0" data-amt="${group}:${esc(p.id)}" value="${esc(values[p.id] ?? "")}"></div>`).join("")}</div>`;
}

function renderForm() {
  const f = state.form;
  const editing = state.editingUid ? state.ledger.entries.find((e) => e.uid === state.editingUid) : null;
  const ppl = formPeople(editing ? L.participants(editing) : []);
  const t = TYPE_META[f.type];
  const y = new Date(); y.setDate(y.getDate() - 1);
  let body = `
    <div class="types">${Object.entries(TYPE_META).map(([k, m]) => `<button type="button" class="type-opt ${f.type === k ? "on" : ""}" data-set-type="${k}"><span class="type-icon ${m.tone}">${icon(m.icon)}</span>${m.label}</button>`).join("")}</div>
    <p class="type-help">${esc(t.help)}</p>
    <div class="form-grid">
      <label class="field"><span>Date</span><input type="date" data-f="date" value="${esc(f.date)}" max="2100-01-01"></label>
      <label class="field"><span>Title</span><input data-f="title" value="${esc(f.title)}" placeholder="${DEFAULT_TITLE[f.type]}"></label>
    </div>
    <div class="row wrap" style="margin-top:-8px">
      <button type="button" class="chip ${f.date === L.todayISO() ? "on" : ""}" data-date="${L.todayISO()}">Today</button>
      <button type="button" class="chip ${f.date === L.todayISO(y) ? "on" : ""}" data-date="${L.todayISO(y)}">Yesterday</button>
      <span class="spacer"></span>
      ${titleSuggestions(f.type).map((s) => `<button type="button" class="chip ${f.title === s ? "on accent" : ""}" data-title="${esc(s)}">${esc(s)}</button>`).join("")}
    </div>`;

  if (f.type === "meal") {
    const eaters = ppl.filter((p) => f.eaters.includes(p.id));
    body += `
    <div>
      <div class="section-title"><span class="label">Who paid?</span>
        <button type="button" class="link" data-act="multipay">${f.multiPay ? "One payer" : "More than one payer"}</button></div>
      ${f.multiPay
        ? `${pickButtons(ppl, Object.keys(f.payers), "data-payer-multi")}<div style="margin-top:10px">${amountRows(ppl.filter((p) => p.id in f.payers), f.payers, "payers")}</div>`
        : `${pickButtons(ppl, [f.payer], "data-payer")}
           <label class="field" style="margin-top:12px"><span>Total bill <span class="faint">(you can type 500+220)</span></span><input class="input big" data-f="total" inputmode="decimal" placeholder="0" value="${esc(f.total)}"></label>`}
      <p id="payHint" class="muted" style="font-size:13px;margin-top:8px"></p>
    </div>
    <div>
      <div class="section-title"><span class="label">Who ate? <span class="faint">(${f.eaters.length})</span></span>
        <span class="row"><button type="button" class="btn small ghost" data-act="everyone">Everyone</button><button type="button" class="btn small ghost" data-act="same">Same as last ${esc(f.title || "meal")}</button><button type="button" class="btn small ghost" data-act="none">Clear</button></span></div>
      ${pickButtons(ppl, f.eaters, "data-eater")}
    </div>
    <div>
      <div class="section-title"><span class="label">How to split?</span>
        <div class="segmented"><button type="button" class="${f.split === "equal" ? "on" : ""}" data-split="equal">Equal</button><button type="button" class="${f.split === "custom" ? "on" : ""}" data-split="custom">Custom amounts</button></div></div>
      ${f.split === "equal"
        ? `<p class="muted" id="equalLine" style="font-size:14px"></p>`
        : `${eaters.length ? amountRows(eaters, f.shares, "shares") : `<p class="muted">Pick who ate first.</p>`}
           <div class="row wrap" style="margin-top:10px"><span id="remain" class="remain"></span><span class="spacer"></span>
             <button type="button" class="btn small" data-act="fillrest">Split the rest equally</button><button type="button" class="btn small ghost" data-act="clearshares">Clear amounts</button></div>
           <p class="faint" style="font-size:12.5px;margin-top:6px">Tip: type the odd amounts (e.g. someone had only tea for 50), then press “Split the rest equally”.</p>`}
    </div>`;
  } else if (f.type === "pot") {
    body += `
    <label class="field"><span>Who is holding the cash?</span><select data-f="holder">${ppl.map((p) => `<option value="${esc(p.id)}" ${p.id === f.holder ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <div><div class="section-title"><span class="label">Who put money in?</span><span id="potTotal" class="remain ok"></span></div>
      ${amountRows(ppl, f.potIn, "potIn")}</div>`;
  } else if (f.type === "transfer") {
    body += `
    <div class="form-grid">
      <label class="field"><span>Who gave the cash?</span><select data-f="from"><option value="">Choose…</option>${ppl.map((p) => `<option value="${esc(p.id)}" ${p.id === f.from ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Who received it?</span><select data-f="to"><option value="">Choose…</option>${ppl.map((p) => `<option value="${esc(p.id)}" ${p.id === f.to ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>Amount</span><input class="input big" data-f="amount" inputmode="decimal" placeholder="0" value="${esc(f.amount)}"></label>`;
  } else {
    body += `
    <div><div class="section-title"><span class="label">Who is charged?</span>
      <span class="row"><input class="input" id="sameAll" inputmode="decimal" placeholder="Same for all" style="width:130px;padding:6px 10px"><button type="button" class="btn small" data-act="sameall">Apply</button></span></div>
      ${amountRows(ppl, f.charges, "charges")}</div>`;
  }

  body += `
    <label class="field"><span>Note <span class="faint">(optional)</span></span><input data-f="note" value="${esc(f.note)}" placeholder="e.g. Cash 1000 & 150 for next cola"></label>
    <div class="preview" id="preview"></div>`;
  $("sheetBody").innerHTML = body;
  updateLive();
}

function entryFromForm(strict) {
  const f = state.form;
  const fail = (msg) => ({ error: msg });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return fail("Pick a date.");
  const title = f.title.trim() || DEFAULT_TITLE[f.type];
  const base = { type: f.type, title, date: f.date };
  if (f.note.trim()) base.note = f.note.trim();
  const amounts = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (String(v).trim() === "") continue;
      const n = evalAmount(v);
      if (!Number.isFinite(n)) return { bad: `“${v}” isn't a number.` };
      if (n > 0) out[k] = n;
    }
    return { out };
  };

  if (f.type === "meal") {
    let paidBy;
    if (f.multiPay) {
      const r = amounts(f.payers);
      if (r.bad) return fail(r.bad);
      paidBy = r.out;
      if (!Object.keys(paidBy).length) return fail("Type how much each payer paid.");
    } else {
      const total = evalAmount(f.total);
      if (!f.payer) return fail("Pick who paid.");
      if (!(total > 0)) return fail("Type the total bill.");
      paidBy = { [f.payer]: total };
    }
    if (!f.eaters.length) return fail("Pick who ate.");
    const order = state.ledger.people.map((p) => p.id).filter((k) => f.eaters.includes(k));
    if (f.split === "equal") return { entry: { ...base, paidBy, for: order } };
    const shares = {};
    for (const k of order) {
      const raw = f.shares[k];
      const n = String(raw ?? "").trim() === "" ? 0 : evalAmount(raw);
      if (!Number.isFinite(n) || n < 0) return fail(`Share for ${shortName(k)} isn't a number.`);
      shares[k] = n;
    }
    if (strict && Object.values(shares).every((v) => !v)) return fail("Type at least one share, or switch to Equal.");
    return { entry: { ...base, paidBy, shares } };
  }
  if (f.type === "pot") {
    const r = amounts(f.potIn);
    if (r.bad) return fail(r.bad);
    if (!Object.keys(r.out).length) return fail("Type how much each person put in.");
    return { entry: { ...base, heldBy: f.holder, from: r.out } };
  }
  if (f.type === "transfer") {
    const amount = evalAmount(f.amount);
    if (!f.from || !f.to) return fail("Pick who gave and who received.");
    if (f.from === f.to) return fail("Giver and receiver must be different.");
    if (!(amount > 0)) return fail("Type the amount.");
    return { entry: { ...base, from: f.from, to: f.to, amount } };
  }
  const r = amounts(f.charges);
  if (r.bad) return fail(r.bad);
  if (!Object.keys(r.out).length) return fail("Type an amount for at least one person.");
  return { entry: { ...base, charges: r.out } };
}

function updateLive() {
  const f = state.form;
  if (!f) return;
  // equal line / remaining / pot total
  if (f.type === "meal") {
    const paid = f.multiPay ? Object.values(f.payers).reduce((s, v) => s + (evalAmount(v) || 0), 0) : evalAmount(f.total) || 0;
    const eq = $("equalLine");
    if (eq) eq.innerHTML = f.eaters.length && paid ? `Each of the ${f.eaters.length} pays <b>${money(paid / f.eaters.length)}</b>` : "Type the bill and pick who ate.";
    const rem = $("remain");
    if (rem) {
      const shareSum = f.eaters.reduce((s, k) => s + (evalAmount(f.shares[k]) || 0), 0);
      const diff = L.round2(paid - shareSum);
      rem.className = `remain ${Math.abs(diff) < 0.5 ? "ok" : "off"}`;
      rem.innerHTML = Math.abs(diff) < 0.5 ? `${icon("check")} Shares match the bill` : diff > 0 ? `${money(diff)} not assigned yet` : `${money(-diff)} more than the bill`;
    }
  }
  if (f.type === "pot" && $("potTotal")) {
    $("potTotal").textContent = `Total ${money(Object.values(f.potIn).reduce((s, v) => s + (evalAmount(v) || 0), 0))}`;
  }
  // preview
  const r = entryFromForm(false);
  const pv = $("preview");
  if (r.error) { pv.innerHTML = `<h4>Preview</h4><p class="muted" style="font-size:13.5px">${esc(r.error)}</p>`; return; }
  const ef = L.effectOf(r.entry);
  const holder = state.view.holder;
  let potLine = "";
  const flow = L.potFlow(ef, holder);
  if (flow.potChange > 0.004) potLine = `Pot +${money(flow.potChange)}`;
  else if (flow.potChange < -0.004) potLine = `Pot −${money(-flow.potChange)}`;
  else potLine = "Pot unchanged";
  if (flow.outside > 0.004) potLine += ` · ${money(flow.outside)} outside pot`;
  const hint = $("payHint");
  if (hint) {
    hint.innerHTML = flow.outside > 0.004 && flow.fromPot <= 0.004
      ? `<span class="tag out">outside pot</span> ${esc([...flow.outsideBy.keys()].map(shortName).join(" & "))} paid from their own pocket. Their wallet goes up; the pot doesn't change.`
      : flow.outside > 0.004
        ? `<span class="tag pot">pot + outside</span> Part from the pot, part from people's own pockets.`
        : `<span class="tag pot">from pot</span> ${esc(shortName(holder))} paid with the pot money.`;
  }
  const warn = L.warningsFor(r.entry);
  pv.innerHTML = `<h4><span>What changes</span><span>${esc(potLine)}</span></h4><div class="changes">${changeChips(ef)}</div>${warn.map((w) => `<p class="warn-line">${esc(w)}</p>`).join("")}`;
}

async function submitForm(another = false) {
  if (state.saving || !state.form) return;
  const r = entryFromForm(true);
  const errEl = $("formError");
  if (r.error) {
    errEl.textContent = r.error;
    errEl.hidden = false;
    errEl.style.animation = "none"; void errEl.offsetWidth; errEl.style.animation = "";
    return;
  }
  errEl.hidden = true;
  const prev = cloneLedger();
  const next = cloneLedger();
  let uid;
  if (state.editingUid) {
    const idx = next.entries.findIndex((e) => e.uid === state.editingUid);
    const old = next.entries[idx];
    uid = old.uid;
    next.entries[idx] = { ...r.entry, uid, seq: old.date === r.entry.date ? old.seq : nextSeq(next) };
  } else {
    uid = newUid();
    next.entries.push({ ...r.entry, uid, seq: nextSeq(next) });
  }
  const btn = $("saveBtn");
  btn.disabled = true;
  const ok = await persist(next, state.editingUid ? "Entry updated" : `Saved “${r.entry.title}”`, prev);
  btn.disabled = false;
  if (!ok) return;
  if (another) {
    const keep = state.form;
    const fresh = blankForm(keep.type);
    Object.assign(fresh, { date: keep.date, eaters: keep.eaters, payer: keep.payer, holder: keep.holder, title: keep.title });
    openForm(fresh);
  } else {
    closeForm();
  }
  flashEntry(uid);
}

function flashEntry(uid) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.entry[data-uid="${CSS.escape(uid)}"]`);
    if (el) { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1700); }
  });
}

async function deleteEntry(uid) {
  const prev = cloneLedger();
  const next = cloneLedger();
  const e = next.entries.find((x) => x.uid === uid);
  next.entries = next.entries.filter((x) => x.uid !== uid);
  await persist(next, `Deleted “${e?.title}”`, prev);
}

/* ============ people admin actions ============ */
async function updatePerson(k, field, value) {
  const prev = cloneLedger();
  const next = cloneLedger();
  const p = next.people.find((x) => x.id === k);
  if (field === "openingBalance") {
    const n = evalAmount(value);
    if (!Number.isFinite(n) && !/^-/.test(value)) return toast("Opening balance must be a number", { bad: true });
    p.openingBalance = Number.isFinite(n) ? n : Number(value);
  } else if (field === "active") p.active = value;
  else p.name = String(value).trim() || p.name;
  await persist(next, `${p.name} updated`, prev);
}

/* ============ export ============ */
function exportCSV() {
  const rows = [["date", "type", "title", "person", "paid", "share", "change", "note"]];
  for (const ef of state.view.effects) {
    const e = ef.entry;
    for (const [k, change] of ef.changes) rows.push([e.date, e.type, e.title, fullName(k), ef.paid.get(k) || 0, L.round2(ef.shares.get(k) || 0), L.round2(change), e.note || ""]);
  }
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  download(`lunch-book-${L.todayISO()}.csv`, csv, "text/csv");
}
function exportJSON() {
  const files = L.disassemble(state.ledger);
  download(`lunch-book-backup-${L.todayISO()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), ...files }, null, 2), "application/json");
}

/* ============ events ============ */
function bind() {
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", positionInk);

  $("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", isDark ? "light" : "dark");
    try { localStorage.setItem("theme", isDark ? "light" : "dark"); } catch {}
    paintTheme();
  });
  const openNew = () => openForm(blankForm("meal"));
  $("addBtn").addEventListener("click", openNew);
  $("fab").addEventListener("click", openNew);

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-person],[data-open-month],[data-open-form],[data-record-settle],[data-filter-month],[data-export],[data-close],[data-close-drawer],[data-type-filter],[data-more],[data-act],[data-toggle],[data-del-person]");
    if (!t) return;
    if (t.closest("#sheet") && !t.matches("[data-close]")) return; // form clicks handled separately
    const d = t.dataset;
    if (d.close !== undefined) return closeForm();
    if (d.closeDrawer !== undefined) return closeDrawer();
    if (d.person) return openPerson(d.person);
    if (d.openMonth) return openMonth(d.openMonth);
    if (d.openForm) return openForm(blankForm(d.openForm));
    if (d.export) return d.export === "csv" ? exportCSV() : exportJSON();
    if (d.recordSettle) {
      const [from, to, amount] = d.recordSettle.split("|");
      const f = blankForm("transfer");
      Object.assign(f, { from, to, amount, title: "Settle up" });
      return openForm(f);
    }
    if (d.filterMonth) {
      closeDrawer();
      state.filters = { q: "", type: "all", person: "all", month: d.filterMonth };
      location.hash = "#activity";
      return;
    }
    if (d.typeFilter) { state.filters.type = d.typeFilter; state.dayLimit = 14; return render(); }
    if (d.more !== undefined) { state.dayLimit += 14; return renderActivityList(); }
    if (d.delPerson) {
      const prev = cloneLedger();
      const next = cloneLedger();
      next.people = next.people.filter((p) => p.id !== d.delPerson);
      return persist(next, "Person removed", prev);
    }
    const card = t.closest(".entry");
    if (card && d.act) {
      ev.stopPropagation();
      const e = state.ledger.entries.find((x) => x.uid === card.dataset.uid);
      if (!e) return;
      if (d.act === "edit") return openForm(formFromEntry(e), e.uid);
      if (d.act === "dup") { const f = formFromEntry(e); f.date = L.todayISO(); return openForm(f); }
      if (d.act === "del") return deleteEntry(e.uid);
    }
    if (card && d.toggle !== undefined) card.classList.toggle("open");
  });

  // activity filters
  document.addEventListener("input", (ev) => {
    if (ev.target.id === "fSearch") { state.filters.q = ev.target.value; state.dayLimit = 14; renderActivityList(); }
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "fPerson") { state.filters.person = t.value; renderActivityList(); }
    if (t.id === "fMonth") { state.filters.month = t.value; renderActivityList(); }
    if (t.id === "holderSelect") {
      const prev = cloneLedger(); const next = cloneLedger();
      next.settings.budgetHolder = t.value;
      persist(next, "Pot holder changed", prev);
    }
    const row = t.closest("[data-admin]");
    if (row && t.dataset.pfield) updatePerson(row.dataset.admin, t.dataset.pfield, t.type === "checkbox" ? t.checked : t.value);
  });
  document.addEventListener("submit", (ev) => {
    if (ev.target.id !== "addPerson") return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    const ob = String(fd.get("ob") || "").trim() ? evalAmount(fd.get("ob")) : 0;
    const prev = cloneLedger(); const next = cloneLedger();
    next.people.push({ id: L.makePersonKey(name, next.people.map((p) => p.id)), name, openingBalance: Number.isFinite(ob) ? ob : 0, active: true });
    persist(next, `${name} added`, prev);
  });

  // form
  const sheet = $("sheetBody");
  sheet.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    const f = state.form;
    const d = t.dataset;
    if (d.setType) {
      const keepTitle = !Object.values(DEFAULT_TITLE).includes(f.title) && f.title.trim();
      f.type = d.setType;
      if (!keepTitle) f.title = DEFAULT_TITLE[f.type];
    } else if (d.date) f.date = d.date;
    else if (d.title) f.title = d.title;
    else if (d.payer) f.payer = d.payer;
    else if (d.payerMulti) { if (d.payerMulti in f.payers) delete f.payers[d.payerMulti]; else f.payers[d.payerMulti] = ""; }
    else if (d.eater) f.eaters = f.eaters.includes(d.eater) ? f.eaters.filter((k) => k !== d.eater) : [...f.eaters, d.eater];
    else if (d.split) f.split = d.split;
    else if (d.act === "multipay") {
      f.multiPay = !f.multiPay;
      if (f.multiPay) f.payers = f.payer ? { [f.payer]: f.total } : {};
      else { const [k] = Object.keys(f.payers); f.payer = k || state.view.holder; f.total = f.payers[k] || ""; }
    } else if (d.act === "everyone") f.eaters = activePeople().map((p) => p.id);
    else if (d.act === "none") f.eaters = [];
    else if (d.act === "same") {
      const last = lastMeal(f.title);
      f.eaters = eatersOf(last);
      if (last && last.shares && f.split === "custom") f.shares = {};
      toast(last ? `Same people as “${last.title}” on ${fmtDate(last.date)}` : "No earlier meal found");
    } else if (d.act === "fillrest") {
      const paid = f.multiPay ? Object.values(f.payers).reduce((s, v) => s + (evalAmount(v) || 0), 0) : evalAmount(f.total) || 0;
      const blanks = f.eaters.filter((k) => String(f.shares[k] ?? "").trim() === "");
      const fixed = f.eaters.filter((k) => !blanks.includes(k)).reduce((s, k) => s + (evalAmount(f.shares[k]) || 0), 0);
      if (!blanks.length) return toast("Clear the boxes you want filled first", { bad: true });
      const each = Math.max(0, (paid - fixed) / blanks.length);
      for (const k of blanks) f.shares[k] = String(L.round2(each));
    } else if (d.act === "clearshares") f.shares = {};
    else if (d.act === "sameall") {
      const val = $("sameAll").value;
      for (const p of activePeople()) f.charges[p.id] = val;
    } else return;
    renderForm();
  });
  sheet.addEventListener("input", (ev) => {
    const t = ev.target;
    const f = state.form;
    if (!f) return;
    if (t.dataset.f) f[t.dataset.f] = t.value;
    if (t.dataset.amt) {
      const [group, k] = t.dataset.amt.split(":");
      f[group][k] = t.value;
    }
    if (t.dataset.f === "title" || t.dataset.f === "date") {
      // update chip highlight without losing focus
      sheet.querySelectorAll("[data-title]").forEach((c) => c.classList.toggle("on", c.dataset.title === f.title));
      sheet.querySelectorAll("[data-title]").forEach((c) => c.classList.toggle("accent", c.dataset.title === f.title));
      sheet.querySelectorAll("[data-date]").forEach((c) => c.classList.toggle("on", c.dataset.date === f.date));
    }
    updateLive();
  });
  sheet.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.tagName === "SELECT" && t.dataset.f) { state.form[t.dataset.f] = t.value; updateLive(); }
  });
  $("entryForm").addEventListener("submit", (ev) => { ev.preventDefault(); submitForm(false); });
  $("saveAnother").addEventListener("click", () => submitForm(true));

  document.addEventListener("keydown", (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (ev.key === "Escape") { if (!$("sheet").hidden) closeForm(); else closeDrawer(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter" && !$("sheet").hidden) { ev.preventDefault(); submitForm(false); }
    if (!typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey && $("sheet").hidden && state.canSave && (ev.key === "n" || ev.key === "a")) { ev.preventDefault(); openNew(); }
  });
}

function paintTheme() {
  const root = document.documentElement;
  const dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  $("themeToggle").innerHTML = icon(dark ? "sun" : "moon");
  $("themeColor").content = dark ? "#0e1014" : "#f5f3ee";
}

function route() {
  const hash = location.hash.replace("#", "") || "overview";
  if (hash === "add") {
    history.replaceState(null, "", "#overview");
    setTab("overview");
    if (state.canSave) openForm(blankForm("meal"));
    return;
  }
  setTab(hash);
}

async function init() {
  paintTheme();
  bind();
  try {
    const [ledger, canSave] = await Promise.all([loadLedger(), detectSave()]);
    state.ledger = ledger;
    state.canSave = canSave;
    recompute();
    $("loading").remove();
    route();
  } catch (error) {
    console.error(error);
    $("loading").innerHTML = `<div class="card empty">${icon("x")}<h3>Couldn't load the book</h3><p class="muted">${esc(error.message)}</p><p class="muted" style="margin-top:8px">Run <code>npm start</code> in this folder and open <code>http://127.0.0.1:5501/</code></p></div>`;
  }
}

init();
