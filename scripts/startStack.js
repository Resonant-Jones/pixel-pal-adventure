#!/usr/bin/env node

// scripts/startStack.js
//
// One command to get from "nothing running" to "world is live and Guardian is
// in it". Built because the alternative — remembering three terminals, two
// ports, and a cd into a nested folder — is exactly the kind of friction that
// stops a kid from ever being able to start their own world.
//
// Usage (from either the repo root or minecraft-ai-companion/):
//   npm start
//
// Guarantees:
//   * Idempotent. Anything already listening is left alone and reported as
//     already-up. Running this twice never spawns a duplicate Paper.
//   * Order matters: Paper and SurrealDB come up before the agent, because the
//     agent fails fast and confusingly if either is missing.
//   * The agent runs in the FOREGROUND so Ctrl+C actually stops it. The
//     daemons are detached and survive.

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "minecraft-server");
const LOG_DIR = path.join(ROOT, ".local", "logs");

const MC_PORT = Number(process.env.PAPER_PORT || 25565);
const SURREAL_PORT = Number(process.env.SURREAL_PORT || 8001);
const BEDROCK_PORT = Number(process.env.BEDROCK_PORT || 19132);
// The agent's own control plane. Used to detect a second copy of Guardian.
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 8787);

const C = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  red: "\u001b[31m"
};

function log(msg) {
  console.log(`${C.dim}[stack]${C.reset} ${msg}`);
}

function ok(msg) {
  console.log(`${C.green}[stack] ✓${C.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${C.yellow}[stack] !${C.reset} ${msg}`);
}

function fail(msg) {
  console.error(`${C.red}[stack] ✗${C.reset} ${msg}`);
}

// Probe a TCP port without shelling out to nc/curl and without hanging.
function isPortOpen(port, host = "127.0.0.1", timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

// Paper answers a plain TCP connect even before it finishes booting, so a
// second probe on the Minecraft status port is what actually confirms "ready".
async function waitForPort(port, { timeoutMs = 90000, label = "service" } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  warn(`${label} did not open port ${port} within ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

function findPaperJar() {
  if (!fs.existsSync(SERVER_DIR)) return null;

  const jars = fs
    .readdirSync(SERVER_DIR)
    .filter((name) => /^paper-.*\.jar$/.test(name))
    .sort();

  return jars.length ? path.join(SERVER_DIR, jars[jars.length - 1]) : null;
}

function findJava() {
  const which = spawnSync("which", ["java"], { encoding: "utf-8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }

  const jvmRoot = "/Library/Java/JavaVirtualMachines";
  if (fs.existsSync(jvmRoot)) {
    for (const sub of fs.readdirSync(jvmRoot)) {
      const bin = path.join(jvmRoot, sub, "Contents", "Home", "bin", "java");
      if (fs.existsSync(bin)) return bin;
    }
  }

  return null;
}

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const addr of addresses || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

async function startPaper() {
  if (await isPortOpen(MC_PORT)) {
    ok(`Minecraft server already up on ${MC_PORT} — leaving it alone.`);
    return true;
  }

  const jar = findPaperJar();
  if (!jar) {
    fail("No Paper jar found in minecraft-server/.");
    log("Run this once to download it:  npm run mc:server");
    return false;
  }

  const java = findJava();
  if (!java) {
    fail("No 'java' on PATH. Install a JDK 17+:  brew install openjdk@17");
    return false;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOG_DIR, "paper.log"), "a");

  const child = spawn(java, ["-Xms1G", "-Xmx2G", "-jar", jar, "--nogui"], {
    cwd: SERVER_DIR,
    detached: true,
    stdio: ["ignore", out, out]
  });
  child.unref();

  log(`starting Minecraft server (this takes 30-60s)…`);
  if (await waitForPort(MC_PORT, { timeoutMs: 120000, label: "Minecraft" })) {
    ok(`Minecraft server up on ${MC_PORT} (pid ${child.pid}).`);
    return true;
  }

  return false;
}

async function startSurreal() {
  if (await isPortOpen(SURREAL_PORT)) {
    ok(`SurrealDB already up on ${SURREAL_PORT} — leaving it alone.`);
    return true;
  }

  const which = spawnSync("which", ["surreal"], { encoding: "utf-8" });
  if (which.status !== 0) {
    fail("SurrealDB CLI not found. Install it:  brew install surrealdb/tap/surreal");
    return false;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOG_DIR, "surreal.log"), "a");

  const child = spawn(
    which.stdout.trim(),
    [
      "start",
      "--bind",
      `127.0.0.1:${SURREAL_PORT}`,
      "--user",
      "root",
      "--pass",
      "secret",
      "--default-namespace",
      "minecraft",
      "--default-database",
      "companion",
      `surrealkv://${path.join(ROOT, ".local", "guardian-memory")}`
    ],
    { detached: true, stdio: ["ignore", out, out], cwd: ROOT }
  );
  child.unref();

  if (await waitForPort(SURREAL_PORT, { timeoutMs: 45000, label: "SurrealDB" })) {
    ok(`SurrealDB up on ${SURREAL_PORT} (pid ${child.pid}).`);
    return true;
  }

  return false;
}

function printBanner() {
  const lan = lanAddress();
  const geyserInstalled =
    fs.existsSync(SERVER_DIR) &&
    fs.readdirSync(SERVER_DIR).some((name) => /^geyser.*\.jar$/i.test(name));

  console.log("");
  console.log(`${C.bold}${C.cyan}  Guardian is live.${C.reset}`);
  console.log("");
  console.log(`  ${C.bold}Java / desktop${C.reset}`);
  console.log(`    connect to  ${C.cyan}127.0.0.1:${MC_PORT}${C.reset}`);

  console.log("");
  console.log(`  ${C.bold}Bedrock / iPad${C.reset}`);
  if (geyserInstalled && lan) {
    console.log(`    Servers → Add Server → ${C.cyan}${lan}${C.reset}  port ${C.cyan}${BEDROCK_PORT}${C.reset}`);
  } else if (!geyserInstalled) {
    console.log(`    ${C.yellow}Geyser is not installed yet.${C.reset} Drop Geyser-Spigot.jar and`);
    console.log(`    Floodgate.jar into minecraft-server/plugins/ and restart.`);
    if (lan) {
      console.log(`    Then connect to ${C.cyan}${lan}${C.reset} port ${C.cyan}${BEDROCK_PORT}${C.reset}.`);
    }
  }

  console.log("");
  console.log(`  ${C.dim}Ctrl+C stops Guardian. The world keeps running.${C.reset}`);
  console.log("");
}

async function main() {
  console.log("");
  log(`bringing up the stack…`);

  const surrealUp = await startSurreal();
  if (!surrealUp) {
    process.exit(1);
  }

  const paperUp = await startPaper();
  if (!paperUp) {
    process.exit(1);
  }

  printBanner();

  // Refuse to start a second Guardian.
  //
  // Two agents sharing a username will kick each other forever: every kick
  // triggers a reconnect, and every reconnect kicks the other copy. One run of
  // that produced ~2200 join/leave cycles and an 1.8 MB log. Better to stop
  // here with a clear message than to start a war.
  if (await isPortOpen(CONTROL_PORT)) {
    fail(`Guardian already appears to be running (control plane on ${CONTROL_PORT}).`);
    log("Stop the other instance first (Ctrl+C in its terminal), then run this again.");
    log("The world itself is untouched — only the companion needs stopping.");
    process.exit(1);
  }

  log("starting Guardian…");
  console.log("");

  // Foreground on purpose: Ctrl+C must reach the agent.
  const agent = spawn(process.execPath, [path.join(ROOT, "scripts", "startAgent.js")], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env }
  });

  agent.on("exit", (code) => {
    log(`Guardian exited (code ${code}). The world is still running.`);
    process.exit(code ?? 0);
  });

  const forwardSignal = (signal) => {
    if (!agent.killed) agent.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
}

main().catch((error) => {
  fail(error?.stack || error?.message || String(error));
  process.exit(1);
});