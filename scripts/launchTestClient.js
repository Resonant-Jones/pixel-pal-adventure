#!/usr/bin/env node

// scripts/launchTestClient.js
//
// Launch a real Minecraft Java client straight into the family server.
//
// WHY THIS EXISTS
//
// The Minecraft launcher is a CEF app whose game window is an OpenGL surface.
// Driving it with synthetic input is unreliable, and the launcher's UI has no
// scriptable path to "join 127.0.0.1:25565" — the only route is clicking
// through Multiplayer → Direct Connection by hand.
//
// But the launcher already downloaded everything a client needs: the bundled
// JRE, the 1.21.11 jar, the 107 libraries, the natives and the assets. The
// launch arguments are just an argv. So this script assembles them itself and
// starts the client directly, with --quickPlayMultiplayer so it joins the
// server without touching a menu.
//
// That turns "a human has to click through four screens to open a client" into
// one command — which is the difference between a visual check happening once
// and a visual check happening every time.
//
// Usage:
//   node scripts/launchTestClient.js
//   node scripts/launchTestClient.js --server 127.0.0.1:25565 --name Panda_Nuggetz
//   node scripts/launchTestClient.js --dry-run        # print the command, run nothing
//
// The account: an offline-mode server accepts any name, so the client is
// launched with the name you pass and a placeholder token. Use a name from
// COMPANION_PLAYERS if you want the approved tier; anything else is a guest
// and Guardian will treat it as one — which is also worth testing.
//
// KNOWN LIMIT (verified 2026-11-20): the client boots and then stalls,
// because Minecraft 1.21 wants a valid session and the launcher's
// `accessToken` in launcher_accounts.json is an empty string — the live token
// lives in the macOS keychain. This script is therefore the documented launch
// path, not yet a headless one. The launcher route still works: Multiplayer →
// Direct Connection → 127.0.0.1:25565.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MINECRAFT_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "minecraft"
);

const DEFAULT_VERSION = "1.21.11";
const DEFAULT_SERVER = "127.0.0.1:25565";

function parseArgs(argv) {
  const args = {
    server: DEFAULT_SERVER,
    name: "Panda_Nuggetz",
    version: DEFAULT_VERSION,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === "--server") {
      args.server = value;
      i += 1;
    } else if (flag === "--name") {
      args.name = value;
      i += 1;
    } else if (flag === "--version") {
      args.version = value;
      i += 1;
    } else if (flag === "--dry-run") {
      args.dryRun = true;
    } else {
      console.error(`unknown flag: ${flag}`);
      process.exit(2);
    }
  }

  return args;
}

// A library is used when its rules allow this platform. The Mojang rule
// format is a list of {action, os} entries; the last matching entry wins.
//
// A library with NO rules is allowed. That is the Mojang convention, and
// getting it backwards silently drops libraries — which shows up much later
// as "Unable to initialize main class ... NoClassDefFoundError: joptsimple".
function libraryMatchesRules(rules = []) {
  if (!rules.length) {
    return true;
  }

  const current = { os: "osx", arch: "arm64" };

  let allowed = false;

  for (const rule of rules) {
    if (rule.os && rule.os.name && rule.os.name !== current.os) {
      continue;
    }

    if (rule.os && rule.os.arch && rule.os.arch !== current.arch) {
      continue;
    }

    allowed = rule.action === "allow";
  }

  return allowed;
}

function resolveLibraryPath(library) {
  const downloads = library.downloads?.artifact;
  if (!downloads?.path) {
    return null;
  }

  return path.join(MINECRAFT_DIR, "libraries", downloads.path);
}

function resolveNativePath(library) {
  const native = library.downloads?.classifiers?.["natives-macos-arm64"];
  if (!native?.path) {
    return null;
  }

  return path.join(MINECRAFT_DIR, "libraries", native.path);
}

function findJava() {
  const bundled = path.join(
    MINECRAFT_DIR,
    "runtime",
    "java-runtime-delta",
    "mac-os-arm64",
    "java-runtime-delta",
    "jre.bundle",
    "Contents",
    "Home",
    "bin",
    "java"
  );

  if (fs.existsSync(bundled)) {
    return bundled;
  }

  return "java";
}

// The natives have to come out of their jars and onto the library path, or the
// game starts and then fails to load LWJGL.
function extractNatives(nativeJars, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const jar of nativeJars) {
    if (!fs.existsSync(jar)) {
      continue;
    }

    try {
      const { execFileSync } = require("node:child_process");
      execFileSync("/usr/bin/unzip", ["-o", "-q", jar, "-d", targetDir], { stdio: "ignore" });
    } catch (error) {
      console.warn(`[launch] could not extract natives from ${path.basename(jar)}: ${error.message}`);
    }
  }
}

function buildCommand(args) {
  const versionDir = path.join(MINECRAFT_DIR, "versions", args.version);
  const versionJson = path.join(versionDir, `${args.version}.json`);
  const clientJar = path.join(versionDir, `${args.version}.jar`);

  if (!fs.existsSync(versionJson) || !fs.existsSync(clientJar)) {
    throw new Error(
      `Minecraft ${args.version} is not installed at ${versionDir}. Install it in the launcher first.`
    );
  }

  const meta = JSON.parse(fs.readFileSync(versionJson, "utf8"));

  const classPathEntries = [clientJar];
  const nativeJars = [];

  for (const library of meta.libraries || []) {
    if (!libraryMatchesRules(library.rules)) {
      continue;
    }

    const artifact = resolveLibraryPath(library);
    if (artifact) {
      classPathEntries.push(artifact);
    }

    const native = resolveNativePath(library);
    if (native) {
      nativeJars.push(native);
    }
  }

  const nativesDir = path.join(MINECRAFT_DIR, "natives-macos-arm64");
  extractNatives(nativeJars, nativesDir);

  const gameDir = path.join(MINECRAFT_DIR, "test-client-profile");
  fs.mkdirSync(gameDir, { recursive: true });

  const java = findJava();

  const gameArgs = [
    "-Xmx2G",
    `-Djava.library.path=${nativesDir}`,
    "-cp",
    classPathEntries.join(path.delimiter),
    meta.mainClass,
    "--username",
    args.name,
    // An offline-mode server checks nothing about the client, so a placeholder
    // token is enough. "legacy" user type keeps the client from trying to
    // fetch a profile it does not have.
    "--accessToken",
    "0",
    "--uuid",
    "00000000000040008000000000000000",
    "--userType",
    "legacy",
    "--version",
    args.version,
    "--versionType",
    "release",
    "--gameDir",
    gameDir,
    "--assetsDir",
    path.join(MINECRAFT_DIR, "assets"),
    "--assetIndex",
    String(meta.assets || "29"),
    "--width",
    "1280",
    "--height",
    "720",
    // The whole point: join the server without a menu.
    "--quickPlayMultiplayer",
    args.server
  ];

  return { java, gameArgs, meta, gameDir };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { java, gameArgs, meta } = buildCommand(args);

  if (args.dryRun) {
    console.log(`${java} \\`);
    console.log(gameArgs.map((a) => `  ${JSON.stringify(a)}`).join(" \\\n"));
    console.log(`\n# mainClass: ${meta.mainClass}`);
    return;
  }

  console.log(`[launch] starting Minecraft ${args.version} as "${args.name}" → ${args.server}`);

  const child = spawn(java, gameArgs, {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: MINECRAFT_DIR
  });

  child.on("exit", (code) => {
    console.log(`[launch] client exited (${code})`);
    process.exit(code ?? 0);
  });

  const stop = () => {
    console.log("[launch] stopping client");
    child.kill("SIGTERM");
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
