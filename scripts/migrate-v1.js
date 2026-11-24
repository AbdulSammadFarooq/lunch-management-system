/*
 * One-time migration: old data.json (v1, numeric ids) -> data/book.json + data/months/*.json (v2).
 *
 *   node scripts/migrate-v1.js <old data.json> <old ledger.js>
 *
 * It refuses to write anything unless every wallet, every month's pot and the
 * entry count come out identical under the old and the new calculation.
 */
const fs = require("fs");
const path = require("path");
const L = require("../ledger");

const [oldDataPath, oldLedgerPath] = process.argv.slice(2);
if (!oldDataPath || !oldLedgerPath) {
  console.error("Usage: node scripts/migrate-v1.js <old data.json> <old ledger.js>");
  process.exit(1);
}
const old = JSON.parse(fs.readFileSync(oldDataPath, "utf8"));
const Old = require(path.resolve(oldLedgerPath));

// Readable keys for the people already in the book; anyone else gets an automatic key.
const PREFERRED = { 1: "sammad", 2: "wajahat", 3: "umair", 4: "rizwan", 5: "junaid", 6: "arslan", 7: "adeel", 8: "kashif" };
const keyOf = new Map();
for (const p of old.people) {
  const wanted = PREFERRED[p.id];
  const ok = wanted && ![...keyOf.values()].includes(wanted) && p.name.toLowerCase().includes(wanted);
  keyOf.set(p.id, ok ? wanted : L.makePersonKey(p.name, keyOf.values()));
}
const k = (id) => {
  if (!keyOf.has(Number(id))) throw new Error(`Unknown person id ${id}`);
  return keyOf.get(Number(id));
};
const obj = (list) => Object.fromEntries(list.map((x) => [k(x.personId), x.amount]));

const entries = old.entries.map((e, i) => {
  const base = { date: e.date, type: e.type, title: e.title, seq: i };
  if (e.type === "meal") {
    const out = { ...base, paidBy: obj(e.paid) };
    if (e.split === "custom") {
      const shares = Object.fromEntries((e.shares || []).map((s) => [k(s.personId), s.amount]));
      for (const m of e.members) if (!(k(m) in shares)) shares[k(m)] = 0;
      out.shares = shares;
    } else {
      out.for = e.members.map(k);
    }
    return out;
  }
  if (e.type === "pot") return { ...base, heldBy: k(e.heldBy), from: obj(e.paid) };
  if (e.type === "tax" || e.type === "tip") return { ...base, charges: obj(e.charges) };
  if (e.type === "settle") {
    const ch = [...Old.entryEffect(e).changes].filter(([, v]) => Math.abs(v) > 1e-9);
    const giver = ch.find(([, v]) => v > 0);
    const taker = ch.find(([, v]) => v < 0);
    if (ch.length !== 2 || !giver || !taker || Math.abs(giver[1] + taker[1]) > 1e-9) {
      throw new Error(`Transfer ${e.id} is not a simple one-to-one hand-over; convert it by hand.`);
    }
    return { ...base, type: "transfer", from: k(giver[0]), to: k(taker[0]), amount: giver[1] };
  }
  throw new Error(`Unknown entry type ${e.type} in ${e.id}`);
});

const ledger = {
  settings: {
    currency: old.settings.currency,
    currencyCode: old.settings.currencyCode,
    budgetHolder: k(old.settings.budgetPersonId),
    statsFrom: old.settings.statsFrom
  },
  people: old.people.map((p) => ({ id: k(p.id), name: p.name, openingBalance: p.openingBalance, active: p.active !== false })),
  entries
};

const result = L.validate(ledger);
if (!result.ok) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

/* ---- prove nothing changed ---- */
const files = L.disassemble(result.ledger);
const reloaded = L.assemble(files.book, Object.values(files.months).map((m) => JSON.parse(L.stringifyMonth(m))));
const a = Old.compute(old);
const b = L.compute(reloaded);
const problems = [];
const close = (x, y) => Math.abs(x - y) < 1e-6;

if (reloaded.entries.length !== old.entries.length) problems.push(`entry count ${old.entries.length} -> ${reloaded.entries.length}`);
for (const p of old.people) {
  const before = a.balances.get(p.id);
  const after = b.balances.get(k(p.id));
  if (!close(before, after)) problems.push(`${p.name}: ${before} -> ${after}`);
}
for (const m of a.months) {
  const n = b.monthMap.get(m.key);
  for (const f of ["collected", "consumed", "ownShare", "carriedIn", "left", "tax", "tip"]) {
    if (!n || !close(m[f], n[f])) problems.push(`${m.key} ${f}: ${m[f]} -> ${n && n[f]}`);
  }
}
if (problems.length) {
  console.error("Migration would change numbers. Nothing written.\n" + problems.join("\n"));
  process.exit(1);
}

/* ---- write ---- */
const root = path.join(__dirname, "..", "data");
fs.mkdirSync(path.join(root, "months"), { recursive: true });
fs.writeFileSync(path.join(root, "book.json"), L.stringifyBook(files.book));
for (const [key, doc] of Object.entries(files.months)) {
  fs.writeFileSync(path.join(root, "months", `${key}.json`), L.stringifyMonth(doc));
}

console.log(`OK: ${old.entries.length} entries, ${old.people.length} people, ${Object.keys(files.months).length} month files.`);
console.log("Wallets (old = new):");
for (const p of old.people) console.log(`  ${k(p.id).padEnd(8)} ${p.name.padEnd(18)} ${b.balances.get(k(p.id)).toFixed(2)}`);
console.log("Current month left in pot:", b.current.left.toFixed(2));
