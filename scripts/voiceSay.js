#!/usr/bin/env node

// scripts/voiceSay.js
//
// Say a line in Guardian's voice and save the audio, so a voice can be
// auditioned before it is wired into the game.
//
// Usage:
//   node scripts/voiceSay.js "hey, want to build something weird?"
//   node scripts/voiceSay.js "hey" --voice English_energetic_young_man
//   node scripts/voiceSay.js "hey" --speed 1.2 --out .local/voice/try.mp3
//   node scripts/voiceSay.js --list
//
// Prints where the file went and how long it is. No provider call happens if
// VOICE_ENABLED is not true — this script sets it for itself, because
// auditioning a voice is the whole point of running it.
//
// --list prints the voice ids MiniMax actually serves for this account.
// That matters more than it looks: an id that does not exist fails with
// provider error 2054 "voice id not exist", which reads like a network
// fault and is not one.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("node:fs");
const path = require("node:path");
const { MiniMaxTtsClient } = require("../voice/ttsClient");

function parseArgs(argv) {
  const args = { text: null, voice: null, speed: null, out: null, list: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === "--voice") {
      args.voice = value;
      i += 1;
    } else if (flag === "--speed") {
      args.speed = Number(value);
      i += 1;
    } else if (flag === "--out") {
      args.out = value;
      i += 1;
    } else if (flag === "--list") {
      args.list = true;
    } else if (!args.text) {
      args.text = flag;
    }
  }

  return args;
}

// Print the live voice catalogue for this account.
//
// This matters more than it looks: an id that does not exist fails with
// provider error 2054 "voice id not exist", which reads like a network fault
// and is not one.
async function listVoices() {
  const baseUrl = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1";
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!apiKey) {
    console.error("MINIMAX_API_KEY is not set.");
    process.exit(1);
  }

  const response = await fetch(`${baseUrl}/get_voice`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ voice_type: "all" })
  });

  const payload = await response.json();
  const voices = payload?.system_voice || [];

  console.log(`${voices.length} system voices\n`);

  for (const voice of voices) {
    const description = Array.isArray(voice.description) ? voice.description[0] : voice.description;
    console.log(`${voice.voice_id.padEnd(38)} ${voice.voice_name || ""}`);
    if (description) {
      console.log(`${" ".repeat(38)} ${description}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    await listVoices();
    return;
  }

  if (!args.text) {
    console.error('usage: node scripts/voiceSay.js "<text>" [--voice <id>] [--speed <n>] [--out <path>]');
    console.error('       node scripts/voiceSay.js --list');
    process.exit(2);
  }

  // Auditioning a voice IS enabling the voice, for this process only.
  const env = { ...process.env, VOICE_ENABLED: "true" };
  if (args.voice) env.VOICE_ID = args.voice;
  if (Number.isFinite(args.speed)) env.VOICE_SPEED = String(args.speed);

  const client = new MiniMaxTtsClient({ env });
  const result = await client.speak(args.text);

  const outPath = path.resolve(
    args.out || path.join(__dirname, "..", ".local", "voice", `try-${Date.now()}.${result.format}`)
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.audio);

  console.log(`voice:  ${result.voiceId}`);
  console.log(`model:  ${result.model}`);
  console.log(`length: ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log(`bytes:  ${result.audio.length}`);
  console.log(`file:   ${outPath}`);
}

main().catch((error) => {
  console.error(`voiceSay failed: ${error?.message || error}`);
  process.exit(1);
});
