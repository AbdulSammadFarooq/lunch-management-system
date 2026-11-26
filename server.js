const fs = require("fs");
const http = require("http");
const path = require("path");
const L = require("./ledger");

const ROOT = __dirname;
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 5501;
const DATA = path.join(ROOT, "data");
const MONTHS = path.join(DATA, "months");
const BACKUPS = path.join(DATA, ".backup");
const KEEP_BACKUPS = 40;
const MAX_BODY = 5_000_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8"
};

const send = (res, status, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};
const sendJson = (res, status, payload) => send(res, status, JSON.stringify(payload), TYPES[".json"]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readIfExists(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

function writeAtomic(file, text) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text);
  try { fs.renameSync(temp, file); } catch { fs.copyFileSync(temp, file); fs.rmSync(temp, { force: true }); }
}

function pruneBackups() {
  if (!fs.existsSync(BACKUPS)) return;
  const dirs = fs.readdirSync(BACKUPS).sort();
  for (const d of dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS))) {
    fs.rmSync(path.join(BACKUPS, d), { recursive: true, force: true });
  }
}

/** Write only the files whose text changed. Old versions go to data/.backup/<time>/ first. */
function saveLedger(ledger) {
  const { book, months } = L.disassemble(ledger);
  const planned = new Map([[path.join(DATA, "book.json"), L.stringifyBook(book)]]);
  for (const [key, doc] of Object.entries(months)) planned.set(path.join(MONTHS, `${key}.json`), L.stringifyMonth(doc));

  const changed = [...planned].filter(([file, text]) => readIfExists(file) !== text);
  const existingMonths = fs.existsSync(MONTHS) ? fs.readdirSync(MONTHS).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)) : [];
  const removed = existingMonths.map((f) => path.join(MONTHS, f)).filter((f) => !planned.has(f));
  if (!changed.length && !removed.length) return [];

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(BACKUPS, stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(MONTHS, { recursive: true });
  for (const file of [...changed.map(([f]) => f), ...removed]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
  }
  for (const [file, text] of changed) writeAtomic(file, text);
  for (const file of removed) fs.rmSync(file, { force: true });
  pruneBackups();
  return [...changed.map(([f]) => path.relative(ROOT, f)), ...removed.map((f) => `${path.relative(ROOT, f)} (removed)`)];
}

function fileFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.normalize(path.join(ROOT, requested));
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  // never serve dot folders/files (.git, data/.backup), temp files or scripts
  if (relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules" || part === "scripts")) return null;
  if (/\.(tmp|bak)$/.test(filePath)) return null;
  return filePath;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (url.pathname === "/api/ping") return sendJson(res, 200, { ok: true, canSave: true });

  if (url.pathname === "/api/book") {
    if (req.method !== "PUT") return send(res, 405, "Method not allowed");
    try {
      const result = L.validate(JSON.parse(await readBody(req)));
      if (!result.ok) return sendJson(res, 400, { error: result.errors[0], errors: result.errors });
      const written = saveLedger(result.ledger);
      if (written.length) console.log(`[${new Date().toLocaleTimeString()}] saved: ${written.join(", ")}`);
      return sendJson(res, 200, { ok: true, written });
    } catch (error) {
      console.error(error);
      return sendJson(res, 400, { error: error.message === "too large" ? "That book is too large to save." : "Could not save: " + error.message });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  if (url.pathname === "/manage.html") {
    res.writeHead(302, { Location: "/#add" });
    return res.end();
  }
  const filePath = fileFor(url.pathname);
  if (!filePath) return send(res, 403, "Forbidden");
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    if (req.method === "HEAD") { res.writeHead(200, { "Content-Type": type }); return res.end(); }
    send(res, 200, data, type);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🍽  Lunch book is running`);
  console.log(`  ➜  http://${HOST}:${PORT}/        (editing is ON from this computer)`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other server, or run: $env:PORT=5502; npm start`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
});
