#!/usr/bin/env node

// scripts/probeChat.js
//
// Talk to the RUNNING Guardian as a chosen player identity and print exactly
// what comes back.
//
// Why this exists:
//   verify:adventure.js proves physics and lifecycle against an isolated
//   throwaway server with synthetic fixtures. It never touches the real
//   runtime, the real provider, or the real memory store. That is correct for
//   a regression suite and useless for the question that actually matters:
//   "does the live Guardian talk to this player, and what does it say?"
//
//   This script answers that question against the live stack. It is an
//   operator probe, not a verifier: it assumes a stack is already running.
//
// Usage:
//   node scripts/probeChat.js --as Panda_Nuggetz --say "hello" --say "what do you remember?"
//   node scripts/probeChat.js --as SomeGuest --say "hi" --wait 12
//
// Flags:
//   --as <name>      The player identity to connect as (required).
//   --say <text>     A message to send. Repeatable, sent in order.
//   --gap <ms>       Milliseconds between messages. Default 6000.
//   --wait <ms>      How long to listen after the last message. Default 15000.
//   --host <host>    Override MC_HOST. Default from .env.
//   --port <port>    Override MC_PORT. Default from .env.
//
// Exit codes:
//   0  connected, transcript produced
//   2  bad usage
//   3  could not connect
//
// Notes:
//   * Chat messages this probe sends ARE recorded in the family's message log.
//     Prefix them with something identifiable ("[probe]") so they can be found
//     and removed later.
//   * The probe never moves, builds, or acts. It stands still and listens.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mineflayer = require("mineflayer");

function parseArgs(argv) {
  const args = {
    as: null,
    say: [],
    gap: 6000,
    wait: 15000,
    host: process.env.MC_HOST || "127.0.0.1",
    port: Number(process.env.MC_PORT || 25565),
    version: process.env.MC_VERSION || "1.21.11"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    switch (flag) {
      case "--as":
        args.as = value;
        i += 1;
        break;
      case "--say":
        args.say.push(value);
        i += 1;
        break;
      case "--gap":
        args.gap = Number(value);
        i += 1;
        break;
      case "--wait":
        args.wait = Number(value);
        i += 1;
        break;
      case "--host":
        args.host = value;
        i += 1;
        break;
      case "--port":
        args.port = Number(value);
        i += 1;
        break;
      case "--help":
      case "-h":
        console.log(fs_readHelp());
        process.exit(0);
        break;
      default:
        console.error(`unknown flag: ${flag}`);
        process.exit(2);
    }
  }

  if (!args.as) {
    console.error("--as <name> is required");
    process.exit(2);
  }

  return args;
}

function fs_readHelp() {
  return [
    "probeChat.js — talk to the running Guardian as a chosen identity",
    "",
    "  node scripts/probeChat.js --as <name> [--say <text>] [--gap <ms>] [--wait <ms>]",
    "",
    "  --as     player identity to connect as (required)",
    "  --say    message to send, repeatable",
    "  --gap    ms between messages (default 6000)",
    "  --wait   ms to listen after the last message (default 15000)"
  ].join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const transcript = [];
  let spawned = false;

  console.log(`[probe] connecting as "${args.as}" to ${args.host}:${args.port} …`);

  const bot = mineflayer.createBot({
    host: args.host,
    port: args.port,
    username: args.as,
    version: args.version,
    auth: "offline"
  });

  const shutdown = (code) => {
    try {
      bot.quit();
    } catch {
      /* already gone */
    }
    setTimeout(() => process.exit(code), 400);
  };

  bot.on("error", (error) => {
    console.error(`[probe] connection error: ${error.message}`);
    shutdown(3);
  });

  bot.on("kicked", (reason) => {
    console.error(`[probe] kicked: ${reason}`);
    shutdown(3);
  });

  bot.on("spawn", () => {
    spawned = true;
    console.log(`[probe] spawned as ${bot.username} at ${bot.entity.position}`);
  });

  bot.on("chat", (name, message) => {
    if (name === bot.username) return;
    transcript.push({ from: name, message });
    console.log(`  <${name}> ${message}`);
  });

  const deadline = Date.now() + 20000;
  while (!spawned && Date.now() < deadline) {
    await sleep(250);
  }

  if (!spawned) {
    console.error("[probe] never spawned");
    shutdown(3);
    return;
  }

  await sleep(1500);

  for (const message of args.say) {
    console.log(`  > ${bot.username}: ${message}`);
    bot.chat(message);
    await sleep(args.gap);
  }

  await sleep(args.wait);

  console.log("");
  console.log(`[probe] transcript (${transcript.length} inbound message(s)):`);
  for (const line of transcript) {
    console.log(`  ${line.from}: ${line.message}`);
  }

  if (!transcript.length) {
    console.log("  (Guardian did not say anything back)");
  }

  shutdown(0);
}

main().catch((error) => {
  console.error(`[probe] failed: ${error?.stack || error}`);
  process.exit(3);
});
