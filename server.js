const fs = require("fs");
const http = require("http");
const path = require("path");
const { validate } = require("./ledger");

const ROOT = __dirname;
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 5501;
const DATA = path.join(ROOT, "data.json");
const MAX_BODY = 2_000_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeLedger(ledger) {
  const json = `${JSON.stringify(ledger, null, 2)}\n`;
  const temp = path.join(ROOT, "data.json.tmp");
  const backup = path.join(ROOT, "data.json.bak");
  fs.writeFileSync(temp, json);
  if (fs.existsSync(DATA)) fs.copyFileSync(DATA, backup);
  try {
    fs.renameSync(temp, DATA);
  } catch {
    fs.copyFileSync(temp, DATA);
    fs.rmSync(temp, { force: true });
  }
}

function fileFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.normalize(path.join(ROOT, requested));
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const base = path.basename(filePath);
  if (base.startsWith(".") || base.endsWith(".bak") || base.endsWith(".tmp")) return null;
  return filePath;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (url.pathname === "/api/ledger") {
    if (req.method === "GET") {
      try {
        send(res, 200, fs.readFileSync(DATA, "utf8"), TYPES[".json"]);
      } catch {
        sendJson(res, 500, { error: "data.json could not be read." });
      }
      return;
    }

    if (req.method === "PUT") {
      try {
        const parsed = JSON.parse(await readBody(req));
        const result = validate(parsed);
        if (!result.ok) {
          sendJson(res, 400, { error: result.errors[0], errors: result.errors });
          return;
        }
        writeLedger(result.ledger);
        sendJson(res, 200, { ok: true, ledger: result.ledger });
      } catch (error) {
        const message = error.message === "too large"
          ? "That book is too large to save."
          : "That was not valid JSON.";
        sendJson(res, 400, { error: message });
      }
      return;
    }

    send(res, 405, "Method not allowed");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  const filePath = fileFor(url.pathname);
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end();
      return;
    }
    send(res, 200, data, type);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Lunch book is running at http://${HOST}:${PORT}`);
  console.log(`Shared page: http://${HOST}:${PORT}/`);
  console.log(`Update page: http://${HOST}:${PORT}/manage.html`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other server, or run: $env:PORT=5502; npm start`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
});
