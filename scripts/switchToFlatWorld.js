#!/usr/bin/env node

// scripts/switchToFlatWorld.js
//
// Cuts the Paper server over to a build-canvas superflat world WITHOUT
// touching the world you already have.
//
// Why this is a script and not a sed command:
//
//   1. level-type / generator-settings / level-name are only read ONCE, when
//      the world folder is created. Changing them on a live server is unsafe
//      because Paper re-serialises server.properties from its own in-memory
//      copy on shutdown and would silently clobber the edit. So we REFUSE to
//      run --apply while the server is still listening.
//   2. The existing world/ folder must survive. We point level-name at a new
//      folder instead of deleting anything, so rollback is one property.
//   3. Mob suppression on 1.21.11 is not /gamerule doMobSpawning - this
//      server stores gamerules as individual namespaced keys in level.dat
//      (minecraft:spawn_mobs, minecraft:spawn_monsters, ...). We patch the
//      NBT directly so it takes effect before anyone can spawn a creeper.
//
// Usage:
//   node scripts/switchToFlatWorld.js --dry-run     report, change nothing
//   node scripts/switchToFlatWorld.js --apply       edit server.properties (server MUST be stopped)
//   node scripts/switchToFlatWorld.js --gamerules   patch <world>/level.dat (server MUST be stopped)
//   node scripts/switchToFlatWorld.js --verify      report what a world actually looks like
//   node scripts/switchToFlatWorld.js --rollback    restore the previous server.properties backup
//
// Exit codes: 0 ok, 1 refused/failed, 2 usage.

const fs = require("fs");
const path = require("path");
const net = require("net");
const zlib = require("zlib");
const nbt = require("prismarine-nbt");

const SERVER_DIR = path.resolve(__dirname, "..", "minecraft-server");
const PROPS = path.join(SERVER_DIR, "server.properties");
const PORT = Number(process.env.PAPER_PORT || 25565);
const TARGET_WORLD = process.env.FLAT_WORLD_NAME || "world_flat";

// Layers are laid down from Y=-64 upward. 1 bedrock + 123 stone + 3 dirt +
// 1 grass = 128 blocks, so grass_block is the top block at Y=63 and the
// walkable surface is Y=64 - the same ground level the old normal world used.
// That matters twice: it keeps us out of slime-chunk territory (slimes spawn
// below Y=40, and the DEFAULT superflat surface is Y=-60), and it keeps the
// coordinates of already-tagged locations on real ground.
const FLAT_SETTINGS = {
  "level-type": "minecraft:flat",
  "level-name": TARGET_WORLD,
  "generate-structures": "false",
  "generator-settings": JSON.stringify({
    layers: [
      { block: "minecraft:bedrock", height: 1 },
      { block: "minecraft:stone", height: 123 },
      { block: "minecraft:dirt", height: 3 },
      { block: "minecraft:grass_block", height: 1 }
    ],
    biome: "minecraft:plains",
    features: false
  })
};

// "No mobs" on this Paper build, expressed as the granular gamerule keys it
// actually stores. doMobSpawning does not exist here; it is split into
// passive/hostile spawn plus several independent spawn sources.
const MOB_RULES = [
  "spawn_mobs",
  "spawn_monsters",
  "spawn_phantoms",
  "spawn_patrols",
  "spawn_wandering_traders",
  "spawn_wardens",
  "spawner_blocks_work",
  "raids",
  "mob_griefing"
];

// Write plain keys, no backslash escaping: java.util.Properties only treats
// ':' and '=' as separators in the KEY, so the colons inside our JSON value
// are literal. level-type is the exception the server itself escapes, so we
// match the escaping Paper writes (minecraft\:flat).
const SERVER_KEYS = Object.keys(FLAT_SETTINGS);

function log(m) {
  console.log(`[flat] ${m}`);
}

function serverIsListening() {
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: "127.0.0.1" });
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1200);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function escapeKey(key, value) {
  return value.includes(":") ? `${key}=${value.replace(/:/g, "\\:")}` : `${key}=${value}`;
}

function applyProps() {
  const original = fs.readFileSync(PROPS, "utf8");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(SERVER_DIR, `server.properties.bak-${stamp}`);
  fs.writeFileSync(backup, original);

  const lines = original.split("\n");
  const remaining = new Set(SERVER_KEYS);

  const next = lines.map((line) => {
    const m = line.match(/^([A-Za-z0-9_.-]+)=/);
    if (!m) return line;
    const key = m[1];
    if (!remaining.has(key)) return line;
    remaining.delete(key);
    return escapeKey(key, FLAT_SETTINGS[key]);
  });

  // Any key that was absent gets appended after the last real property line.
  for (const key of remaining) {
    next.push(escapeKey(key, FLAT_SETTINGS[key]));
  }

  fs.writeFileSync(PROPS, next.join("\n"));
  log(`backup written: ${path.basename(backup)}`);
  log("server.properties updated");
  return backup;
}

function readProps() {
  const out = {};
  for (const line of fs.readFileSync(PROPS, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function worldDir(name) {
  return path.join(SERVER_DIR, name);
}

function patchGamerules() {
  const dir = worldDir(TARGET_WORLD);
  const levelDat = path.join(dir, "level.dat");
  if (!fs.existsSync(levelDat)) {
    throw new Error(
      `${levelDat} not found. The world has not been generated yet —\n` +
        "  start the server once with level-name set to " + TARGET_WORLD + ", then re-run --gamerules."
    );
  }

  const originalGz = fs.readFileSync(levelDat);
  const original = zlib.gunzipSync(originalGz);
  const tag = nbt.parseUncompressed(original);

  const data = tag.value?.Data?.value;
  if (!data) throw new Error("level.dat has no Data compound - refusing to guess.");

  const rules = data.game_rules?.value;
  if (!rules) throw new Error("level.dat has no Data.game_rules compound - refusing to guess.");

  const unknown = MOB_RULES.filter((r) => !rules[`minecraft:${r}`]);
  if (unknown.length === MOB_RULES.length) {
    throw new Error(
      "none of the expected gamerule keys exist on this server:\n  " + unknown.join(", ") +
        "\nRefusing to invent keys. Inspect the world first."
    );
  }

  const applied = [];
  for (const r of MOB_RULES) {
    const key = `minecraft:${r}`;
    if (!rules[key]) continue;
    if (rules[key].value !== 0) applied.push(r);
    rules[key] = { type: rules[key].type, value: 0 };
  }

  if (applied.length === 0) {
    log(`all mob gamerules already 0 in ${TARGET_WORLD}/level.dat - nothing to do`);
    return;
  }

  const out = zlib.gzipSync(nbt.writeUncompressed(tag), { level: 9 });
  fs.writeFileSync(levelDat, out);

  // Read it straight back. A write we cannot verify is a write we do not claim.
  const check = nbt.parseUncompressed(zlib.gunzipSync(fs.readFileSync(levelDat)));
  const cr = check.value.Data.value.game_rules.value;
  const bad = MOB_RULES.filter((r) => cr[`minecraft:${r}`] && cr[`minecraft:${r}`].value !== 0);

  log(`patched ${applied.length} gamerules: ${applied.join(", ")}`);
  log(`level.dat ${originalGz.length}B -> ${out.length}B, verified on re-read`);
  if (bad.length) throw new Error(`verification FAILED, still non-zero: ${bad.join(", ")}`);
}

function verify(name) {
  const dir = worldDir(name);
  if (!fs.existsSync(dir)) {
    log(`world "${name}" does not exist at ${dir}`);
    return;
  }
  const levelDat = path.join(dir, "level.dat");
  if (!fs.existsSync(levelDat)) {
    log(`world "${name}" exists but has no level.dat yet (never booted)`);
    return;
  }
  const data = nbt.parseUncompressed(zlib.gunzipSync(fs.readFileSync(levelDat))).value.Data.value;
  const spawn = data.spawn?.value?.pos?.value;
  const wgs = data.WorldGenSettings?.value || {};
  const gen = wgs.generator?.value?.type?.value;
  const rules = data.game_rules?.value || {};

  log(`world "${name}"`);
  log(`  spawn        : ${spawn ? `${spawn[0]}, ${spawn[1]}, ${spawn[2]}` : "unknown"}`);
  log(`  generator    : ${gen || "unknown"}`);
  if (wgs.generate_features) log(`  features     : ${wgs.generate_features.value}`);
  const on = MOB_RULES.filter((r) => rules[`minecraft:${r}`]?.value !== 0);
  log(`  mob spawning : ${on.length ? `ON -> ${on.join(", ")}` : "all off"}`);
  if (spawn) log(`  surface Y    : ${spawn[1]} (builds should sit at Y=${spawn[1]})`);
}

function rollback() {
  const dir = SERVER_DIR;
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("server.properties.bak-"))
    .sort();
  if (!backups.length) {
    log("no server.properties backup found - nothing to roll back to");
    return;
  }
  const latest = backups[backups.length - 1];
  fs.copyFileSync(path.join(dir, latest), PROPS);
  log(`restored ${latest} -> server.properties`);
  log("NOTE: the generated world folder is left in place; delete it by hand if unwanted");
}

// ---------------------------------------------------------------------------
// --cutover: run the whole swap unattended once the server is down.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(shouldBeOpen, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const open = await serverIsListening();
    if (open === shouldBeOpen) return true;
    last = open;
    await sleep(1000);
  }
  log(`timed out after ${timeoutMs}ms waiting for port ${PORT} to be ${shouldBeOpen ? "open" : "free"}`);
  return false;
}

function findPaperJar() {
  const jars = fs
    .readdirSync(SERVER_DIR)
    .filter((f) => /^paper-.*\.jar$/.test(f))
    .sort();
  if (!jars.length) throw new Error(`no Paper jar in ${SERVER_DIR} - run: npm run mc:server`);
  return path.join(SERVER_DIR, jars[jars.length - 1]);
}

async function startPaper() {
  const { spawnSync } = require("child_process");
  const which = spawnSync("which", ["java"], { encoding: "utf-8" });
  if (which.status !== 0) throw new Error("no 'java' on PATH");

  const jar = findPaperJar();
  const logDir = path.resolve(SERVER_DIR, "..", ".local");
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, "paper-cutover.log"), "a");

  const child = require("child_process").spawn(
    "java",
    ["-Xms1G", "-Xmx2G", "-jar", jar, "--nogui"],
    { cwd: SERVER_DIR, detached: true, stdio: ["ignore", out, out] }
  );
  child.unref();
  log(`spawned Paper (pid ${child.pid}), waiting for port ${PORT}…`);
  return child.pid;
}

async function stopPaper(pid) {
  try {
    process.kill(pid, "SIGTERM");
    log(`SIGTERM -> pid ${pid}, waiting for graceful save…`);
  } catch (e) {
    log(`could not signal pid ${pid}: ${e.message}`);
    return false;
  }
  return waitForPort(false, 90000, "paper");
}

async function cutover() {
  if (await serverIsListening()) {
    log(`Paper is STILL listening on ${PORT}.`);
    log("Stop the server first, then run this again:");
    log("  Ctrl-C in the terminal running scripts/startStack.js");
    log("  or:  kill <paper-pid>");
    log("(this script cannot signal a process it did not start - the OS refuses)");
    process.exit(1);
  }
  log(`port ${PORT} is free`);

  log("");
  log("STEP 1/4  apply flat world settings");
  applyProps();

  log("");
  log("STEP 2/4  boot Paper so " + TARGET_WORLD + " generates");
  const pid = await startPaper();
  if (!(await waitForPort(true, 180000, "paper"))) throw new Error("Paper never opened its port");
  // Give the spawn chunk time to be written before we stop again.
  await sleep(8000);
  verify(TARGET_WORLD);

  log("");
  log("STEP 3/4  stop Paper, then disable mob spawning");
  if (!(await stopPaper(pid))) throw new Error("could not stop Paper - rerun with --gamerules later");
  patchGamerules();

  log("");
  log("STEP 4/4  start Paper on the flat world");
  const pid2 = await startPaper();
  if (!(await waitForPort(true, 180000, "paper"))) throw new Error("Paper never reopened its port");
  await sleep(5000);

  log("");
  verify(TARGET_WORLD);
  log("");
  log("done. Paper is up on the flat world.");
  log("Now start the rest of the stack so Guardian joins it:");
  log("  node scripts/startStack.js");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("usage: node scripts/switchToFlatWorld.js --dry-run|--apply|--gamerules|--verify|--rollback|--cutover");
    process.exit(2);
  }
  const mode = args[0];
  const MODES = ["--dry-run", "--apply", "--gamerules", "--verify", "--rollback", "--cutover"];
  if (!MODES.includes(mode)) {
    console.log(`unknown option: ${mode}`);
    console.log(`valid: ${MODES.join(" ")}`);
    process.exit(2);
  }

  if (!fs.existsSync(PROPS)) {
    console.error(`[flat] ${PROPS} not found - is this the right project?`);
    process.exit(1);
  }

  const live = await serverIsListening();

  if (mode === "--dry-run") {
    const p = readProps();
    log(`server ${live ? `RUNNING on ${PORT}` : `stopped (${PORT} free)`}`);
    log(`current level-name / level-type : ${p["level-name"]} / ${p["level-type"]}`);
    log(`target world folder             : ${TARGET_WORLD}`);
    log(`exists already                  : ${fs.existsSync(worldDir(TARGET_WORLD))}`);
    log("would set:");
    for (const key of SERVER_KEYS) log(`  ${key}=${FLAT_SETTINGS[key]}`);
    try {
      JSON.parse(FLAT_SETTINGS["generator-settings"]);
      log("generator-settings JSON parses OK");
    } catch (e) {
      log(`generator-settings JSON is INVALID: ${e.message}`);
      process.exit(1);
    }
    log("nothing was changed");
    return;
  }

  if (mode === "--verify") {
    verify(TARGET_WORLD);
    const p = readProps();
    log(`server.properties level-name = ${p["level-name"]}`);
    return;
  }

  if (mode === "--rollback") {
    if (live) {
      log(`server is RUNNING on ${PORT}. Stop it first - rollback rewrites server.properties.`);
      process.exit(1);
    }
    rollback();
    return;
  }

  // --cutover manages the Paper lifecycle itself, so it checks the port
  // directly rather than relying on the snapshot taken above.
  if (mode === "--cutover") {
    await cutover();
    return;
  }

  // --apply and --gamerules both mutate state Paper owns.
  if (live) {
    log(`REFUSING: Paper is listening on ${PORT}.`);
    log("  level-type/level-name/generator-settings are read once at world creation, and");
    log("  Paper rewrites server.properties from memory on shutdown - editing now would be");
    log("  silently undone. Stop the server, then re-run.");
    process.exit(1);
  }

  if (mode === "--apply") {
    if (fs.existsSync(worldDir(TARGET_WORLD))) {
      log(`NOTE: ${TARGET_WORLD} already exists. Overwriting server.properties is still safe`);
      log("      (existing chunks are not regenerated), but its generator is already locked in.");
    }
    applyProps();
    log("");
    log("next: start the server, let it generate, stop it, then run --gamerules");
    return;
  }

  if (mode === "--gamerules") {
    patchGamerules();
  }
}

main().catch((e) => {
  console.error(`[flat] ERROR: ${e.message}`);
  process.exit(1);
});