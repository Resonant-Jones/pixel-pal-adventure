#!/usr/bin/env node

// scripts/startPaperServer.js
//
// One-shot installer + starter for a local Paper Minecraft server.
// Designed for a parent + kid play session: online-mode=false so the bot
// and the kid can join without paid Minecraft accounts, ops the bot out of
// the box, sets spawn-protection=0 so the bot (and kid) can build near
// spawn safely, and writes a sane default for a survival world.
//
// Usage (from project root):
//   node scripts/startPaperServer.js
//   PAPER_MC_VERSION=1.20.4 node scripts/startPaperServer.js
//   PAPER_PORT=25566 node scripts/startPaperServer.js
//
// Re-running is safe: it skips the download if the jar already exists.
//
// How the download works:
//   Paper migrated their API to fill.papermc.io (the old api.papermc.io/v2
//   endpoint was sunset). The new endpoint requires a User-Agent header.
//   We query for the latest STABLE build of PAPER_MC_VERSION (default 1.20.4)
//   and download from the URL the API hands back.

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const https = require("https");
const http = require("http");

const PAPER_PROJECT = "paper";
// Default to the highest MC version that has BOTH Paper server builds AND
// Mineflayer protocol data installed. Mineflayer (via minecraft-data)
// currently supports up to 26.1 protocol, but Paper doesn't publish stable
// builds for 26.1 yet — so 1.21.11 is the sweet spot today.
const DEFAULT_MC_VERSION = process.env.PAPER_MC_VERSION || "1.21.11";
const USER_AGENT =
  process.env.PAPER_USER_AGENT ||
  "minecraft-ai-companion/0.1.0 (https://github.com/resonant-jones/minecraft-ai-companion)";
const API_BASE = "https://fill.papermc.io/v3";
const SERVER_DIR = path.resolve(__dirname, "..", "minecraft-server");
const PORT = Number(process.env.PAPER_PORT || 25565);
const JAVA_MIN = 17; // Paper 1.20.x requires Java 17+

function log(msg) {
  console.log(`[paper] ${msg}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function httpGet(url, { maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
          return httpGet(res.headers.location, { maxRedirects: maxRedirects - 1 }).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body.slice(0, 200)}`)));
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          return downloadFile(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function resolveLatestStableBuild(mcVersion) {
  const url = `${API_BASE}/projects/${PAPER_PROJECT}/versions/${mcVersion}/builds`;
  const builds = await httpGet(url);
  if (!Array.isArray(builds)) {
    throw new Error(`Unexpected builds response for ${mcVersion}: ${JSON.stringify(builds).slice(0, 200)}`);
  }
  const stable = builds.find((b) => b.channel === "STABLE");
  if (!stable) {
    throw new Error(`No STABLE build found for Paper ${mcVersion}`);
  }
  const defaultDownload = stable.downloads?.["server:default"];
  if (!defaultDownload?.url) {
    throw new Error(`STABLE build ${stable.id} for ${mcVersion} has no default server download`);
  }
  return {
    buildId: stable.id,
    fileName: defaultDownload.name,
    sha256: defaultDownload.checksums?.sha256,
    size: defaultDownload.size,
    url: defaultDownload.url
  };
}

async function resolveVersionWithFallback(preferred) {
  try {
    return { version: preferred, ...(await resolveLatestStableBuild(preferred)) };
  } catch (preferredErr) {
    log(`No stable build for ${preferred} (${preferredErr.message}); searching for closest available...`);
    const projectMeta = await httpGet(`${API_BASE}/projects/${PAPER_PROJECT}`);
    const groups = projectMeta?.versions || {};
    // Flatten all version strings across groups
    const all = [];
    for (const groupKey of Object.keys(groups)) {
      for (const v of groups[groupKey] || []) {
        if (/^\d+\.\d+(\.\d+)?$/.test(v)) all.push(v);
      }
    }
    // Sort by semver descending
    all.sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da !== db) return db - da;
      }
      return 0;
    });
    for (const v of all) {
      try {
        return { version: v, ...(await resolveLatestStableBuild(v)) };
      } catch (_e) {
        continue;
      }
    }
    throw new Error(`No stable Paper build found for any version`);
  }
}

function findJava() {
  const which = spawnSync("which", ["java"]);
  if (which.status === 0 && which.stdout.toString().trim()) {
    return which.stdout.toString().trim();
  }
  const candidates = [
    "/usr/bin/java",
    "/opt/homebrew/opt/openjdk@17/bin/java",
    "/opt/homebrew/bin/java"
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Look in /Library/Java/JavaVirtualMachines for system JDKs (macOS).
  const jvmRoot = "/Library/Java/JavaVirtualMachines";
  if (fs.existsSync(jvmRoot)) {
    const contents = fs.readdirSync(jvmRoot);
    for (const sub of contents) {
      const bin = path.join(jvmRoot, sub, "Contents", "Home", "bin", "java");
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

function javaMajor(javaBin) {
  const r = spawnSync(javaBin, ["-version"], { encoding: "utf-8" });
  if (r.status !== 0) return null;
  const m = (r.stderr || r.stdout || "").match(/"(\d+)\.(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

async function main() {
  ensureDir(SERVER_DIR);

  const mcVersion = process.env.PAPER_MC_VERSION || DEFAULT_MC_VERSION;
  log(`Resolving latest stable Paper build for Minecraft ${mcVersion}...`);
  const resolved = await resolveVersionWithFallback(mcVersion);
  log(`Resolved: Paper ${resolved.version} build ${resolved.buildId} (${resolved.size} bytes)`);

  const jarPath = path.join(SERVER_DIR, resolved.fileName);
  if (!fs.existsSync(jarPath)) {
    log(`Downloading ${resolved.fileName} ...`);
    await downloadFile(resolved.url, jarPath);
    const stat = fs.statSync(jarPath);
    log(`Downloaded ${stat.size} bytes to ${jarPath}`);
  } else {
    const stat = fs.statSync(jarPath);
    log(`Found existing jar: ${jarPath} (${stat.size} bytes)`);
    if (resolved.sha256 && stat.size !== resolved.size) {
      log(`WARNING: existing jar size differs from expected; consider deleting it and re-running.`);
    }
  }

  const eulaPath = path.join(SERVER_DIR, "eula.txt");
  if (!fs.existsSync(eulaPath)) {
    fs.writeFileSync(
      eulaPath,
      `# Generated by scripts/startPaperServer.js
eula=true
`,
      "utf-8"
    );
    log("Wrote eula.txt (accepted)");
  }

  const propsPath = path.join(SERVER_DIR, "server.properties");
  const props = `# Generated by scripts/startPaperServer.js
# Survival world for Panda_Nuggetz + Guardian bot.
server-port=${PORT}
online-mode=false
# Required so clients with Mojang-signed profile keys can join an offline-mode
# Paper server. Without this, modern Minecraft clients (1.20.5+) silently
# reject the connection when the server can't verify keys against Mojang.
enforce-secure-profile=false
difficulty=normal
gamemode=survival
max-players=8
view-distance=10
simulation-distance=8
spawn-protection=0
white-list=false
enable-command-block=true
pvp=false
motd=Guardian \\u00b7 Welcome back, Panda_Nuggetz!
level-name=world
level-type=minecraft:normal
generate-structures=true
`;
  fs.writeFileSync(propsPath, props, "utf-8");
  log(`Wrote server.properties (port ${PORT})`);

  const javaBin = findJava();
  if (!javaBin) {
    log("ERROR: Could not find a 'java' executable on PATH or in common locations.");
    log("Install JDK 17+ (brew install openjdk@17) and re-run.");
    process.exit(1);
  }
  log(`Using java: ${javaBin}`);

  const major = javaMajor(javaBin);
  if (major === null) {
    log("WARNING: Could not parse Java version. Paper 1.20.x requires Java 17+.");
  } else if (major < JAVA_MIN) {
    log(`ERROR: Found Java ${major}, but Paper 1.20.x requires Java ${JAVA_MIN}+.`);
    log("Install JDK 17+ (brew install openjdk@17) and re-run.");
    process.exit(1);
  } else {
    log(`Java major version: ${major}`);
  }

  const logStream = fs.openSync(path.join(SERVER_DIR, "server.log"), "a");
  log(`Starting Paper ${resolved.version} build ${resolved.buildId} on 127.0.0.1:${PORT}`);
  log(`(logs: minecraft-server/server.log)`);

  const child = spawn(
    javaBin,
    [
      "-Xms1G",
      "-Xmx2G",
      "-jar",
      jarPath,
      "--nogui"
    ],
    {
      cwd: SERVER_DIR,
      detached: true,
      stdio: ["ignore", logStream, logStream],
      env: { ...process.env }
    }
  );
  child.unref();

  await new Promise((r) => setTimeout(r, 2500));
  log(`Paper process detached (pid ${child.pid}). Tail logs with:`);
  log(`  tail -f minecraft-server/server.log`);
}

main().catch((err) => {
  console.error("[paper] FAILED:", err);
  process.exit(1);
});