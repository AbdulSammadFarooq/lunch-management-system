/*
 * Lunch book — data model and calculations.
 * Shared by the browser (window.LunchLedger) and Node (require("./ledger")).
 *
 * Files on disk
 *   data/book.json          settings, people, list of months
 *   data/months/YYYY-MM.json   every entry of one month, grouped by day
 *
 * People are referenced by a short key ("sammad"), never by a number.
 *
 * Entry types (one line each in the month file)
 *   meal      { type, title, paidBy:{key:amt}, for:[keys] }            equal split
 *             { type, title, paidBy:{key:amt}, shares:{key:amt} }      custom split
 *   pot       { type, title, heldBy:key, from:{key:amt} }              cash handed to the pot holder
 *   transfer  { type, title, from:key, to:key, amount }                cash between two people, not food
 *   tax / tip { type, title, charges:{key:amt} }                       taken off wallets, not food
 *   Any entry may also have  note: "free text".
 *
 * Wallet rule: a wallet moves by (what they paid) − (their share).
 * Pot rule:    the month's pot falls by everyone's share except the budget holder's own.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LunchLedger = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const TYPES = ["meal", "pot", "transfer", "tax", "tip"];
  const EPS = 0.009;

  /* ---------- small helpers ---------- */

  const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const sumValues = (obj) => Object.values(obj || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const monthKey = (date) => String(date || "").slice(0, 7);

  function formatMoney(value, currency = "Rs.", signed = false) {
    const amount = Number(value) || 0;
    const body = Math.abs(amount).toLocaleString("en-PK", { maximumFractionDigits: 2 });
    if (Math.abs(amount) < 0.005) return `${currency} 0`;
    if (signed) return `${amount > 0 ? "+" : "−"}${currency} ${body}`;
    return `${amount < 0 ? "−" : ""}${currency} ${body}`;
  }

  function monthLabel(key, short = false) {
    const [y, m] = String(key).split("-").map(Number);
    if (!y || !m) return key;
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
      month: short ? "short" : "long",
      year: "numeric"
    });
  }

  function todayISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  const GENERIC = new Set(["muhammad", "mohammad", "muhammed", "abdul", "syed", "m", "mr"]);

  function makePersonKey(name, takenKeys) {
    const taken = new Set(takenKeys || []);
    const words = slugify(name);
    const candidates = [];
    const specific = words.filter((w) => !GENERIC.has(w));
    if (specific[0]) candidates.push(specific[0]);
    if (words[0]) candidates.push(words[0]);
    if (words.length > 1) candidates.push(words.join("-"));
    for (const c of candidates) if (c && !taken.has(c)) return c;
    const base = candidates[0] || "person";
    let n = 2;
    while (taken.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  }

  /* ---------- entry → wallet effect ---------- */

  function toMap(obj) {
    const map = new Map();
    for (const [k, v] of Object.entries(obj || {})) map.set(k, (map.get(k) || 0) + (Number(v) || 0));
    return map;
  }

  function effectOf(entry) {
    let paid = new Map();
    let shares = new Map();
    switch (entry.type) {
      case "meal": {
        paid = toMap(entry.paidBy);
        if (entry.shares) {
          shares = toMap(entry.shares);
        } else {
          const members = entry.for || [];
          const total = sumValues(entry.paidBy);
          const each = members.length ? total / members.length : 0;
          for (const k of members) shares.set(k, each);
        }
        break;
      }
      case "pot":
        paid = toMap(entry.from);
        shares.set(entry.heldBy, sumValues(entry.from));
        break;
      case "transfer":
        paid.set(entry.from, Number(entry.amount) || 0);
        shares.set(entry.to, (shares.get(entry.to) || 0) + (Number(entry.amount) || 0));
        break;
      case "tax":
      case "tip":
        shares = toMap(entry.charges);
        break;
    }
    const changes = new Map();
    for (const k of new Set([...paid.keys(), ...shares.keys()])) {
      changes.set(k, (paid.get(k) || 0) - (shares.get(k) || 0));
    }
    const paidTotal = [...paid.values()].reduce((a, b) => a + b, 0);
    const shareTotal = [...shares.values()].reduce((a, b) => a + b, 0);
    const total = entry.type === "tax" || entry.type === "tip" ? shareTotal : paidTotal;
    return { entry, paid, shares, changes, total, paidTotal, shareTotal };
  }

  /** How an entry moves the real cash in the holder's pot. `ef` is effectOf(entry). */
  function potFlow(ef, holder) {
    const e = ef.entry;
    const out = { potChange: 0, fromPot: 0, outside: 0, outsideBy: new Map(), holderSelf: 0 };
    if (e.type === "pot" && e.heldBy === holder) out.potChange = ef.total;
    if (e.type === "meal") {
      const ph = ef.paid.get(holder) || 0;
      const sh = ef.shares.get(holder) || 0;
      out.fromPot = Math.max(0, ph - sh);
      out.potChange = -out.fromPot;
      out.holderSelf = Math.min(ph, sh);
      for (const [k, v] of ef.paid) {
        if (k === holder) continue;
        out.outside += v;
        out.outsideBy.set(k, (out.outsideBy.get(k) || 0) + v);
      }
    }
    if (e.type === "transfer") {
      if (e.from === holder) out.potChange -= ef.total;
      if (e.to === holder) out.potChange += ef.total;
    }
    return out;
  }

  /** People who took part in an entry (for search, chips, filters). */
  function participants(entry) {
    const e = effectOf(entry);
    return [...new Set([...e.paid.keys(), ...e.shares.keys()])];
  }

  /* ---------- main calculation ---------- */

  function compute(ledger, now = new Date()) {
    const settings = ledger.settings || {};
    const currency = settings.currency || "Rs.";
    const holder = settings.budgetHolder;
    const people = ledger.people || [];
    const byKey = new Map(people.map((p) => [p.id, p]));
    const entries = [...(ledger.entries || [])].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.seq || 0) - (b.seq || 0)
    );
    const effects = entries.map(effectOf);

    const balances = new Map(people.map((p) => [p.id, Number(p.openingBalance) || 0]));
    const history = new Map(people.map((p) => [p.id, []]));
    for (const ef of effects) {
      for (const [k, change] of ef.changes) {
        if (!balances.has(k)) continue;
        const next = balances.get(k) + change;
        balances.set(k, next);
        history.get(k).push({ effect: ef, change, balance: next });
      }
    }

    const months = new Map();
    const ensure = (key) => {
      if (!months.has(key)) {
        months.set(key, {
          key, label: monthLabel(key), collected: 0, ownShare: 0, consumed: 0,
          food: 0, tax: 0, tip: 0, entryCount: 0,
          foodBy: new Map(), taxBy: new Map(), tipBy: new Map(), collectedBy: new Map(),
          paidBy: new Map(), days: new Set(),
          // real cash in the pot held by the budget holder
          potIn: 0, potOut: 0, mealFromPot: 0, outside: 0, outsideBy: new Map(), holderSelf: 0
        });
      }
      return months.get(key);
    };

    for (const ef of effects) {
      const m = ensure(monthKey(ef.entry.date));
      m.entryCount++;
      const t = ef.entry.type;

      // Pot cash flow: only money that really passes through the holder's hands.
      //  pot money given to the holder  -> into the pot
      //  holder pays a bill             -> out of the pot, except the holder's own share (he pays that himself)
      //  someone else pays a bill       -> NOT from the pot ("outside the pot"), it goes to their wallet
      //  transfers to / from the holder -> into / out of the pot
      Object.assign(ef, potFlow(ef, holder));
      m.holderSelf += ef.holderSelf;
      m.mealFromPot += ef.fromPot;
      m.outside += ef.outside;
      for (const [k, v] of ef.outsideBy) m.outsideBy.set(k, (m.outsideBy.get(k) || 0) + v);
      if (ef.potChange > 0) m.potIn += ef.potChange;
      else m.potOut -= ef.potChange;

      if (t === "pot") {
        m.collected += ef.total;
        for (const [k, v] of ef.paid) m.collectedBy.set(k, (m.collectedBy.get(k) || 0) + v);
        continue;
      }
      if (t === "tax" || t === "tip") {
        m[t] += ef.total;
        const by = t === "tax" ? m.taxBy : m.tipBy;
        for (const [k, v] of ef.shares) by.set(k, (by.get(k) || 0) + v);
        continue;
      }
      // meals and transfers both draw on the pot (same rule as the original book)
      m.consumed += ef.shareTotal;
      m.ownShare += ef.shares.get(holder) || 0;
      if (t === "meal") {
        m.food += ef.shareTotal;
        m.days.add(ef.entry.date);
        for (const [k, v] of ef.shares) m.foodBy.set(k, (m.foodBy.get(k) || 0) + v);
        for (const [k, v] of ef.paid) m.paidBy.set(k, (m.paidBy.get(k) || 0) + v);
      }
    }

    const currentKey = monthKey(todayISO(now));
    ensure(currentKey);

    const firstPot = effects.find((ef) => ef.entry.type === "pot");
    const rolloverFrom = firstPot ? monthKey(firstPot.entry.date) : "";
    let carried = 0;
    let potCarry = 0;
    const monthList = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const m of monthList) {
      m.potTracked = !!rolloverFrom && m.key >= rolloverFrom;
      m.potCarried = m.potTracked ? potCarry : 0;
      m.potLeft = m.potCarried + m.potIn - m.potOut;
      if (m.potTracked) potCarry = m.potLeft;
      m.totalFood = m.food;
      m.carriedIn = 0;
      m.budget = m.collected + m.ownShare;
      m.groupSpend = m.consumed - m.ownShare;
      if (rolloverFrom && m.key >= rolloverFrom) {
        m.carriedIn = carried;
        m.budget += carried;
        carried = m.budget - m.consumed;
      }
      m.available = m.collected + m.carriedIn;
      m.left = m.budget - m.consumed;
      m.isCurrent = m.key === currentKey;
      m.dayCount = m.days.size;
    }

    // typical month of food per person (complete months from statsFrom)
    const statsFrom = settings.statsFrom || "";
    let avgKeys = monthList.filter((m) => m.key >= statsFrom && m.key < currentKey && m.food > 0).map((m) => m.key);
    const current = monthList.find((m) => m.isCurrent);
    if (!avgKeys.length && current.food > 0) avgKeys = [currentKey];
    const averageFood = new Map(people.map((p) => [p.id, 0]));
    for (const key of avgKeys) {
      const m = months.get(key);
      for (const p of people) averageFood.set(p.id, averageFood.get(p.id) + (m.foodBy.get(p.id) || 0) / avgKeys.length);
    }

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysLeft = Math.max(daysInMonth - dayOfMonth + 1, 0);
    const pace = dayOfMonth > 0 ? current.potOut / dayOfMonth : 0;
    const potCash = potCarry;
    const holderWallet = balances.get(holder) || 0;

    const meals = effects.filter((ef) => ef.entry.type === "meal");
    const mealDates = [...new Set(meals.map((ef) => ef.entry.date))].sort();

    return {
      settings, currency, holder, holderName: byKey.get(holder)?.name || "—",
      people, byKey, balances, history, effects,
      months: monthList, monthMap: months, averageFood, averageMonths: avgKeys.length,
      averageIsCurrentOnly: avgKeys.length === 1 && avgKeys[0] === currentKey,
      current: {
        ...current, daysInMonth, dayOfMonth, daysLeft, pace,
        dailyRoom: daysLeft > 0 ? Math.max(current.potLeft, 0) / daysLeft : 0,
        daysOfPot: pace > 0 ? current.potLeft / pace : null
      },
      // cash the holder is keeping for the group right now, and the holder's own personal wallet
      potCash,
      holderPersonal: holderWallet + potCash,
      overall: {
        food: meals.reduce((s, ef) => s + ef.shareTotal, 0),
        meals: meals.length,
        days: mealDates.length,
        firstDate: mealDates[0] || "",
        lastDate: mealDates[mealDates.length - 1] || ""
      },
      net: [...balances.values()].reduce((a, b) => a + b, 0)
    };
  }

  /** Fewest cash hand-overs that would bring every active wallet to zero. */
  function settlePlan(balances, people) {
    const active = new Set(people.filter((p) => p.active !== false).map((p) => p.id));
    const debtors = [];
    const creditors = [];
    for (const [k, v] of balances) {
      if (!active.has(k)) continue;
      const amt = round2(v);
      if (amt < -0.5) debtors.push({ k, amt: -amt });
      else if (amt > 0.5) creditors.push({ k, amt });
    }
    debtors.sort((a, b) => b.amt - a.amt);
    creditors.sort((a, b) => b.amt - a.amt);
    const plan = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amt, creditors[j].amt);
      plan.push({ from: debtors[i].k, to: creditors[j].k, amount: round2(pay) });
      debtors[i].amt -= pay;
      creditors[j].amt -= pay;
      if (debtors[i].amt < 0.5) i++;
      if (creditors[j].amt < 0.5) j++;
    }
    return plan;
  }

  /* ---------- files <-> in-memory ledger ---------- */

  const ENTRY_KEY_ORDER = ["type", "title", "paidBy", "for", "shares", "heldBy", "from", "to", "amount", "charges", "note"];

  function cleanEntryForDisk(entry) {
    const out = {};
    for (const key of ENTRY_KEY_ORDER) if (entry[key] !== undefined && entry[key] !== "") out[key] = entry[key];
    return out;
  }

  /** Build the in-memory ledger from book.json + month files. */
  function assemble(book, monthDocs) {
    const entries = [];
    let seq = 0;
    const docs = [...monthDocs].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    for (const doc of docs) {
      for (const date of Object.keys(doc.days || {}).sort()) {
        for (const raw of doc.days[date] || []) {
          entries.push({ ...raw, date, seq: seq++, uid: `u${seq}` });
        }
      }
    }
    return {
      settings: { ...(book.settings || {}) },
      people: (book.people || []).map((p) => ({ ...p })),
      entries
    };
  }

  /** Split an in-memory ledger into the files that live on disk. */
  function disassemble(ledger) {
    const sorted = [...ledger.entries].sort((a, b) => a.date.localeCompare(b.date) || (a.seq || 0) - (b.seq || 0));
    const months = {};
    for (const e of sorted) {
      const key = monthKey(e.date);
      months[key] = months[key] || { month: key, days: {} };
      (months[key].days[e.date] = months[key].days[e.date] || []).push(cleanEntryForDisk(e));
    }
    const book = {
      version: 2,
      settings: ledger.settings,
      people: ledger.people.map((p) => ({ id: p.id, name: p.name, openingBalance: p.openingBalance, active: p.active !== false })),
      months: Object.keys(months).sort()
    };
    return { book, months };
  }

  /** Pretty JSON where each entry / person sits on its own line (easy to read and diff). */
  function inline(value) {
    if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
    if (value && typeof value === "object") {
      const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
      return parts.length ? `{ ${parts.join(", ")} }` : "{}";
    }
    return JSON.stringify(value);
  }

  function stringifyMonth(doc) {
    const days = Object.keys(doc.days).sort().map((date) => {
      const lines = doc.days[date].map((e) => `      ${inline(e)}`).join(",\n");
      return `    "${date}": [\n${lines}\n    ]`;
    });
    return `{\n  "month": "${doc.month}",\n  "days": {\n${days.join(",\n")}\n  }\n}\n`;
  }

  function stringifyBook(book) {
    const people = book.people.map((p) => `    ${inline(p)}`).join(",\n");
    return `{\n  "version": ${book.version},\n  "settings": ${JSON.stringify(book.settings, null, 2).replace(/\n/g, "\n  ")},\n  "people": [\n${people}\n  ],\n  "months": ${JSON.stringify(book.months)}\n}\n`;
  }

  /* ---------- validation ---------- */

  function validate(ledger) {
    const errors = [];
    const people = [];
    const keys = new Set();
    for (const p of ledger.people || []) {
      const id = String(p.id || "").trim();
      const name = String(p.name || "").trim();
      const ob = Number(p.openingBalance);
      if (!/^[a-z0-9-]+$/.test(id)) { errors.push(`Person "${name || id}" needs a key of lowercase letters/numbers.`); continue; }
      if (keys.has(id)) { errors.push(`Person key "${id}" is used twice.`); continue; }
      if (!name) { errors.push(`Person "${id}" needs a name.`); continue; }
      if (!Number.isFinite(ob)) { errors.push(`${name} needs a numeric opening balance.`); continue; }
      keys.add(id);
      people.push({ id, name, openingBalance: ob, active: p.active !== false });
    }
    if (!people.length) errors.push("Add at least one person.");

    const known = (k) => keys.has(k);
    const amountMap = (obj, label, allowZero) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return `${label} is missing.`;
      const ks = Object.keys(obj);
      if (!ks.length) return `${label} needs at least one person.`;
      for (const k of ks) {
        if (!known(k)) return `${label} names "${k}", who is not in the book.`;
        const v = Number(obj[k]);
        if (!Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) return `${label} needs amounts above zero.`;
      }
      return "";
    };

    const entries = [];
    (ledger.entries || []).forEach((e, i) => {
      const where = `${e.title || "Entry"} on ${e.date || "?"}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date))) return errors.push(`Entry ${i + 1} needs a date like 2026-11-24.`);
      if (!String(e.title || "").trim()) return errors.push(`The entry on ${e.date} needs a title.`);
      if (!TYPES.includes(e.type)) return errors.push(`${where} has an unknown type "${e.type}".`);
      let err = "";
      if (e.type === "meal") {
        err = amountMap(e.paidBy, "Paid by", false);
        if (!err && e.shares) err = amountMap(e.shares, "Shares", true);
        else if (!err && (!Array.isArray(e.for) || !e.for.length)) err = "Pick who ate.";
        else if (!err && e.for.some((k) => !known(k))) err = "Someone in the list is not in the book.";
        if (!err && e.shares && e.for) err = "Use either an equal split (for) or custom shares, not both.";
      } else if (e.type === "pot") {
        err = known(e.heldBy) ? amountMap(e.from, "Money in", false) : "Pick who holds the pot.";
      } else if (e.type === "transfer") {
        if (!known(e.from) || !known(e.to)) err = "Pick who gave and who received.";
        else if (e.from === e.to) err = "Giver and receiver must be different people.";
        else if (!(Number(e.amount) > 0)) err = "Amount must be above zero.";
      } else {
        err = amountMap(e.charges, "Charges", false);
      }
      if (err) return errors.push(`${where}: ${err}`);
      const clean = { ...cleanEntryForDisk(e), date: e.date, seq: e.seq ?? i, uid: e.uid || `n${i}` };
      clean.title = String(clean.title).trim();
      if (clean.note) clean.note = String(clean.note).trim();
      if (e.type === "meal" && e.for) clean.for = [...new Set(e.for)];
      if (e.type === "transfer") clean.amount = Number(e.amount);
      entries.push(clean);
    });

    const s = ledger.settings || {};
    const settings = {
      currency: String(s.currency || "Rs."),
      currencyCode: String(s.currencyCode || "PKR"),
      budgetHolder: keys.has(s.budgetHolder) ? s.budgetHolder : people[0]?.id,
      statsFrom: String(s.statsFrom || "")
    };
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], ledger: { settings, people, entries } };
  }

  /** Warnings that don't block saving (e.g. custom shares not adding up). */
  function warningsFor(entry) {
    if (entry.type === "meal" && entry.shares) {
      const diff = sumValues(entry.shares) - sumValues(entry.paidBy);
      if (Math.abs(diff) > 0.5) return [`Shares add up to ${round2(sumValues(entry.shares))} but ${round2(sumValues(entry.paidBy))} was paid (difference ${round2(diff)}).`];
    }
    return [];
  }

  return {
    TYPES, EPS, round2, sumValues, monthKey, monthLabel, todayISO, formatMoney,
    makePersonKey, effectOf, potFlow, participants, compute, settlePlan,
    assemble, disassemble, stringifyMonth, stringifyBook, validate, warningsFor
  };
});
