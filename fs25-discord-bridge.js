const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key !== "" && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, ".env.fs25"));

const POLL_MS = Number(process.env.FS25_POLL_MS || 5000);
const LOCAL_LOG_PATH = process.env.FS25_LOG_PATH || "D:/home/sid_8486608/farmingSim_2025/profile/log.txt";
const FTP_ENABLED = !!process.env.FS25_FTP_HOST;
const FTP_LOG_DIR = process.env.FS25_FTP_LOG_DIR || "/";

const farmWebhooks = {
  "farma 1": process.env.FS25_WEBHOOK_FARMA_1,
  "farm 1": process.env.FS25_WEBHOOK_FARMA_1,
  "farma 2": process.env.FS25_WEBHOOK_FARMA_2,
  "farm 2": process.env.FS25_WEBHOOK_FARMA_2,
};

let filePosition = 0;
let partialLine = "";
let currentSourceId = null;
let lastMissingLogWarningAt = 0;
let lastFtpListingDebugAt = 0;
let bridgeStarted = false;

function logInfo(message) {
  console.log(`[fs25-bridge] ${message}`);
}

function normalizeFarmName(farmName) {
  if (farmName == null) {
    return null;
  }

  return String(farmName).trim().toLowerCase();
}

function parsePurchaseLine(line) {
  if (!line.includes("bought")) {
    return null;
  }

  const match = line.match(/\[(FS25_[^\]]+)\]\s+(.+ bought .+ \(([^)]+)\))$/);
  if (match == null) {
    return null;
  }

  return {
    modName: match[1].trim(),
    message: match[2].trim(),
    farmName: match[3].trim(),
  };
}

async function sendToDiscord(webhookUrl, content) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${responseText}`);
  }
}

async function handleLine(line) {
  const parsed = parsePurchaseLine(line);
  if (parsed == null) {
    return;
  }

  const webhookUrl = farmWebhooks[normalizeFarmName(parsed.farmName)];
  if (webhookUrl == null || webhookUrl === "") {
    logInfo(`No webhook configured for "${parsed.farmName}", skipping: ${parsed.message}`);
    return;
  }

  try {
    await sendToDiscord(webhookUrl, parsed.message);
    logInfo(`Sent purchase for ${parsed.farmName}: ${parsed.message}`);
  } catch (error) {
    logInfo(`Failed to send purchase for ${parsed.farmName}: ${error.message}`);
  }
}

async function processTextChunk(text) {
  const combined = partialLine + text;
  const lines = combined.split(/\r?\n/);
  partialLine = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      await handleLine(trimmed);
    }
  }
}

async function readLocalContent() {
  let stats;

  try {
    stats = fs.statSync(LOCAL_LOG_PATH);
  } catch (error) {
    const now = Date.now();
    if (now - lastMissingLogWarningAt >= 10000) {
      logInfo(`Log file not accessible yet: ${LOCAL_LOG_PATH}`);
      lastMissingLogWarningAt = now;
    }
    return;
  }

  const sourceId = `local:${LOCAL_LOG_PATH}`;
  if (currentSourceId !== sourceId) {
    currentSourceId = sourceId;
    filePosition = stats.size;
    partialLine = "";
    logInfo(`Watching local log ${LOCAL_LOG_PATH}`);
    return;
  }

  if (stats.size < filePosition) {
    filePosition = 0;
    partialLine = "";
    logInfo("Local log file was rotated or truncated, resetting reader position");
  }

  if (stats.size === filePosition) {
    return;
  }

  const stream = fs.createReadStream(LOCAL_LOG_PATH, {
    start: filePosition,
    end: stats.size - 1,
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  filePosition = stats.size;

  if (chunks.length > 0) {
    await processTextChunk(Buffer.concat(chunks).toString("utf8"));
  }
}

async function getFtpClient() {
  const ftp = await import("basic-ftp");
  const client = new ftp.Client();
  client.ftp.verbose = false;

  await client.access({
    host: process.env.FS25_FTP_HOST,
    port: Number(process.env.FS25_FTP_PORT || 21),
    user: process.env.FS25_FTP_USER,
    password: process.env.FS25_FTP_PASSWORD,
    secure: false,
  });

  return client;
}

function pickLatestLogFile(entries) {
  const matchingEntries = entries.filter((entry) => /^log_.*\.txt$/i.test(entry.name || ""));

  if (matchingEntries.length === 0) {
    return null;
  }

  return matchingEntries
    .sort((a, b) => {
      const aTime = a.modifiedAt instanceof Date ? a.modifiedAt.getTime() : 0;
      const bTime = b.modifiedAt instanceof Date ? b.modifiedAt.getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }

      return String(b.name || "").localeCompare(String(a.name || ""));
    })[0] || null;
}

function toFtpPath(dir, fileName) {
  const cleanDir = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  if (cleanDir === "") {
    return `/${fileName}`;
  }

  return `${cleanDir}/${fileName}`;
}

async function readFtpContent() {
  let client;

  try {
    client = await getFtpClient();
    const entries = await client.list(FTP_LOG_DIR);
    const latestLog = pickLatestLogFile(entries);

    if (latestLog == null) {
      const now = Date.now();
      if (now - lastFtpListingDebugAt >= 30000) {
        const visibleNames = entries.map((entry) => entry.name).filter(Boolean);
        logInfo(`FTP dir ${FTP_LOG_DIR} visible entries: ${visibleNames.join(", ") || "(empty)"}`);
        lastFtpListingDebugAt = now;
      }
      logInfo(`No log_*.txt file found in FTP dir ${FTP_LOG_DIR}`);
      return;
    }

    const remotePath = toFtpPath(FTP_LOG_DIR, latestLog.name);
    const sourceId = `ftp:${remotePath}`;

    if (currentSourceId !== sourceId) {
      currentSourceId = sourceId;
      filePosition = latestLog.size;
      partialLine = "";
      logInfo(`Watching FTP log ${remotePath}`);
      return;
    }

    if (latestLog.size < filePosition) {
      filePosition = 0;
      partialLine = "";
      logInfo("FTP log was rotated or truncated, resetting reader position");
    }

    if (latestLog.size === filePosition) {
      return;
    }

    const chunks = [];
    await client.downloadTo(
      {
        write(chunk) {
          chunks.push(Buffer.from(chunk));
        },
        end() {},
      },
      remotePath,
      filePosition
    );

    filePosition = latestLog.size;

    if (chunks.length > 0) {
      await processTextChunk(Buffer.concat(chunks).toString("utf8"));
    }
  } catch (error) {
    logInfo(`FTP read failed: ${error.message}`);
  } finally {
    if (client != null) {
      client.close();
    }
  }
}

function validateConfig() {
  const missing = [];

  if (!farmWebhooks["farma 1"]) {
    missing.push("FS25_WEBHOOK_FARMA_1");
  }

  if (!farmWebhooks["farma 2"]) {
    missing.push("FS25_WEBHOOK_FARMA_2");
  }

  if (FTP_ENABLED) {
    if (!process.env.FS25_FTP_HOST) missing.push("FS25_FTP_HOST");
    if (!process.env.FS25_FTP_PORT) missing.push("FS25_FTP_PORT");
    if (!process.env.FS25_FTP_USER) missing.push("FS25_FTP_USER");
    if (!process.env.FS25_FTP_PASSWORD) missing.push("FS25_FTP_PASSWORD");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
}

async function pollOnce() {
  if (FTP_ENABLED) {
    await readFtpContent();
    return;
  }

  await readLocalContent();
}

async function startFs25Bridge() {
  if (bridgeStarted) {
    logInfo("Bridge already started, skipping duplicate start");
    return;
  }

  bridgeStarted = true;
  validateConfig();

  if (FTP_ENABLED) {
    logInfo(`Starting in FTP mode (${process.env.FS25_FTP_HOST}:${process.env.FS25_FTP_PORT}, dir ${FTP_LOG_DIR})`);
  } else {
    logInfo(`Starting in local file mode (${LOCAL_LOG_PATH})`);
  }

  logInfo("Bridge starts from end of the active log and sends only new purchase lines");

  await pollOnce();

  setInterval(() => {
    pollOnce().catch((error) => {
      logInfo(`Watcher error: ${error.message}`);
    });
  }, POLL_MS);
}

module.exports = {
  startFs25Bridge,
};

if (require.main === module) {
  startFs25Bridge().catch((error) => {
    console.error(`[fs25-bridge] Startup failed: ${error.message}`);
    process.exit(1);
  });
}
