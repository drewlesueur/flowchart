const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const CERT_FILE = process.env.CERT_FILE;
const KEY_FILE = process.env.KEY_FILE;
const FILES_DIR = process.env.FILES_DIR || "/home/ubuntu/flowchart_files";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function resolvePublicPath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return resolved;
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function isAllowedFileName(name) {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function resolveDataFile(name) {
  if (!isAllowedFileName(name)) {
    return null;
  }

  const root = path.normalize(FILES_DIR + path.sep);
  const resolved = path.normalize(path.join(FILES_DIR, name));

  if (!resolved.startsWith(root)) {
    return null;
  }

  return resolved;
}

function inferLanguage(name) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".js") {
    return "JavaScript";
  }
  if (extension === ".ts") {
    return "TypeScript";
  }
  if (extension === ".py") {
    return "Python";
  }
  if (extension === ".rb") {
    return "Ruby";
  }
  if (extension === ".java") {
    return "Java";
  }
  return "Code";
}

function summarizeContents(contents) {
  const line = contents
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    return "Empty file.";
  }

  return line.length > 88 ? `${line.slice(0, 85)}...` : line;
}

function listCodeFiles() {
  const names = fs.readdirSync(FILES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => isAllowedFileName(name))
    .sort((a, b) => a.localeCompare(b));

  return names.map((name) => {
    const filePath = resolveDataFile(name);
    const contents = fs.readFileSync(filePath, "utf8");
    return {
      id: name,
      name,
      language: inferLanguage(name),
      description: summarizeContents(contents),
    };
  });
}

function seedDefaultFiles() {
  const existingFiles = fs.readdirSync(FILES_DIR);
  if (existingFiles.length > 0) {
    return;
  }

  const defaults = {
    "order-fulfillment.js": `function classifyOrder(order) {
  if (!order.paid) {
    return "hold";
  }

  if (order.total > 1000) {
    approve(order);
  } else {
    review(order);
  }

  for (const item of order.items) {
    if (item.backordered) {
      notifyCustomer(item);
    }
  }

  ship(order);
  return "done";
}
`,
    "incident-triage.js": `function triageIncident(incident) {
  if (incident.severity === "critical") {
    pageOnCall();
  } else {
    createTicket();
  }

  while (!incident.mitigated) {
    attemptRecovery();

    if (incident.customerImpact) {
      postStatusUpdate();
    }

    if (incident.retryCount > 2) {
      escalateIncident();
      return "escalated";
    }
  }

  closeIncident();
  return "resolved";
}
`,
    "deploy-pipeline.js": `async function deployRelease(release) {
  buildArtifacts(release);

  if (!testsPassed(release)) {
    rollback(release);
    return "tests_failed";
  }

  if (release.requiresApproval) {
    requestApproval(release);
  } else {
    deployToProduction(release);
  }

  for (const region of release.regions) {
    if (!healthCheck(region)) {
      rollbackRegion(region);
    }
  }

  return "complete";
}
`,
  };

  for (const [name, contents] of Object.entries(defaults)) {
    fs.writeFileSync(path.join(FILES_DIR, name), contents, "utf8");
  }
}

async function handleApi(req, res, requestUrl) {
  if (requestUrl.pathname === "/api/files" && req.method === "GET") {
    sendJson(res, 200, listCodeFiles());
    return true;
  }

  if (requestUrl.pathname === "/api/files" && req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const payload = body ? JSON.parse(body) : {};
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      const content = typeof payload.content === "string" ? payload.content : "";
      const filePath = resolveDataFile(name);

      if (!filePath) {
        sendJson(res, 400, { error: "File name must use only letters, numbers, dot, underscore, or dash." });
        return true;
      }

      if (fs.existsSync(filePath)) {
        sendJson(res, 409, { error: "A file with that name already exists." });
        return true;
      }

      fs.writeFileSync(filePath, content, "utf8");
      sendJson(res, 201, { ok: true, id: name });
      return true;
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return true;
    }
  }

  if (requestUrl.pathname.startsWith("/api/files/")) {
    const name = decodeURIComponent(requestUrl.pathname.slice("/api/files/".length));
    const filePath = resolveDataFile(name);

    if (!filePath) {
      sendJson(res, 400, { error: "Invalid file name." });
      return true;
    }

    if (req.method === "GET") {
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: "File not found." });
        return true;
      }

      sendText(res, 200, fs.readFileSync(filePath, "utf8"));
      return true;
    }

    if (req.method === "PUT") {
      try {
        const body = await readRequestBody(req);
        const payload = body ? JSON.parse(body) : {};
        const content = typeof payload.content === "string" ? payload.content : "";

        if (!fs.existsSync(filePath)) {
          sendJson(res, 404, { error: "File not found." });
          return true;
        }

        fs.writeFileSync(filePath, content, "utf8");
        sendJson(res, 200, { ok: true });
        return true;
      } catch (error) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
    }
  }

  return false;
}

requireEnv("CERT_FILE", CERT_FILE);
requireEnv("KEY_FILE", KEY_FILE);
ensureDirectory(FILES_DIR);
seedDefaultFiles();

const tlsOptions = {
  cert: fs.readFileSync(CERT_FILE),
  key: fs.readFileSync(KEY_FILE),
};

const server = https.createServer(tlsOptions, (req, res) => {
  const requestUrl = new URL(req.url || "/", `https://localhost:${PORT}`);

  handleApi(req, res, requestUrl)
    .then((handled) => {
      if (handled) {
        return;
      }

      const filePath = resolvePublicPath(requestUrl.pathname);
      if (!filePath) {
        sendText(res, 403, "Forbidden");
        return;
      }

      fs.readFile(filePath, (error, contents) => {
        if (error) {
          const status = error.code === "ENOENT" ? 404 : 500;
          sendText(res, status, status === 404 ? "Not found" : "Server error");
          return;
        }

        const extension = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[extension] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(contents);
      });
    })
    .catch((error) => {
      sendText(res, 500, `Server error: ${error.message}`);
    });
});

server.listen(PORT, () => {
  console.log(`Flow chart app running at https://localhost:${PORT}`);
});
