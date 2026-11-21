#!/usr/bin/env node

// scripts/startCompanion.js
//
// Start the companion app.
//
// Usage:
//   node scripts/startCompanion.js
//   node scripts/startCompanion.js --check      report the audio route and exit
//
// This runs OUTSIDE the agent sandbox, on purpose.
//
// The agent cannot open CoreAudio: inside the sandbox, AVFoundation cannot
// even enumerate the devices, so a companion app started from there would
// look like it was listening while capturing nothing. Run it from your own
// Terminal and it gets the microphone.
//
// The agent does not need to be running for the app to start, but the app
// will show the agent as offline until it is.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { getCompanionConfig } = require("../companion/companionConfig");
const { CompanionApp } = require("../companion/companionApp");
const { MiniMaxTtsClient } = require("../voice/ttsClient");

function parseArgs(argv) {
  const args = { check: false };

  for (const flag of argv) {
    if (flag === "--check") args.check = true;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getCompanionConfig();

  if (!config.controlPlane.token) {
    console.error("GUARDIAN_CONTROL_TOKEN is not set in .env — the app cannot reach the agent.");
    process.exit(1);
  }

  // The player's voice. A separate client so Guardian's voice and the test
  // voice cannot be confused for one another.
  const playerTts = new MiniMaxTtsClient({
    env: {
      ...process.env,
      VOICE_ENABLED: "true",
      VOICE_ID: config.playerVoice.voiceId,
      VOICE_SPEED: String(config.playerVoice.speed)
    }
  });

  const app = new CompanionApp({ config, playerTts });

  if (args.check) {
    const devices = await app.audio.listInputDevices();
    const outputs = await app.audio.probeOutputDevices();

    console.log("input devices:");
    for (const device of devices) {
      console.log(`  [${device.index}] ${device.name}`);
    }
    console.log("output devices (probed):");
    for (const device of outputs) {
      console.log(`  [${device.index}] writable`);
    }
    console.log("");
    console.log(`control plane: ${config.controlPlane.baseUrl}`);
    console.log(`ui:            http://${config.listen.host}:${config.listen.port}`);
    console.log(`voice out:     ${config.audio.outputDevice ? describe(config.audio.outputDevice) : "not configured"}`);
    console.log(`voice in:      ${config.audio.inputDevice ? describe(config.audio.inputDevice) : "not configured"}`);

    await app.audio.stopAll();
    return;
  }

  await app.start();

  const shutdown = async () => {
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function describe(device) {
  if (device.index !== null && device.index !== undefined) {
    return device.name ? `${device.name} (index ${device.index})` : `index ${device.index}`;
  }
  return device.name;
}

main().catch((error) => {
  console.error(`companion app failed to start: ${error?.message || error}`);
  process.exit(1);
});
