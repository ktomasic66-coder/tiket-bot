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

const LOG_PATH = process.env.FS25_LOG_PATH || "D:/home/sid_8486608/farmingSim_2025/profile/log.txt";
const POLL_MS = 1000;

const farmWebhooks = {
  "farma 1": process.env.FS25_WEBHOOK_FARMA_1,
  "farm 1": process.env.FS25_WEBHOOK_FARMA_1,
  "farma 2": process.env.FS25_WEBHOOK_FARMA_2,
  "farm 2": process.env.FS25_WEBHOOK_FARMA_2,
};

let filePosition = 0;
let partialLine = "";
let lastMissingLogWarningAt = 0;

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

async function processChunk(chunk) {
  const combined = partialLine + chunk.toString("utf8");
  const lines = combined.split(/\r?\n/);
  partialLine = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      await handleLine(trimmed);
    }
  }
}

async function readNewContent() {
  let stats;

  try {
    stats = fs.statSync(LOG_PATH);
  } catch (error) {
    const now = Date.now();
    if (now - lastMissingLogWarningAt >= 10000) {
      logInfo(`Log file not accessible yet: ${LOG_PATH}`);
      lastMissingLogWarningAt = now;
    }
    return;
  }

  if (stats.size < filePosition) {
    filePosition = 0;
    partialLine = "";
    logInfo("Log file was rotated or truncated, resetting reader position");
  }

  if (stats.size === filePosition) {
    return;
  }

  const stream = fs.createReadStream(LOG_PATH, {
    start: filePosition,
    end: stats.size - 1,
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  filePosition = stats.size;

  if (chunks.length > 0) {
    await processChunk(Buffer.concat(chunks));
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

  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
}

async function main() {
  validateConfig();

  try {
    const stats = fs.statSync(LOG_PATH);
    filePosition = stats.size;
  } catch (error) {
    filePosition = 0;
  }

  logInfo(`Watching ${LOG_PATH}`);
  logInfo("Bridge starts from end of file and sends only new purchase lines");

  setInterval(() => {
    readNewContent().catch((error) => {
      logInfo(`Watcher error: ${error.message}`);
    });
  }, POLL_MS);
}

main().catch((error) => {
  console.error(`[fs25-bridge] Startup failed: ${error.message}`);
  process.exit(1);
});
