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

// The app runs beside the game. It must not be the thing that takes the
// machine down.
//
// This is not theoretical. A speech-provider rate limit returned an HTTP 429
// from the control plane, the floating promise that was waiting on it
// rejected, and Node's default for an unhandled rejection is to throw —
// which killed the app mid-conversation. The fix below is the belt to the
// braces that are already in the code: every awaited path handles its own
// failures, and these two handlers make sure anything that slips through
// loses a log line instead of the process.
process.on("unhandledRejection", (reason) => {
  console.error("[companion] unhandled rejection (kept running):", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[companion] uncaught exception (kept running):", error?.stack || error);
});

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
    const { resolveInputDevice, resolveOutputDevice } = require("../companion/deviceResolver");

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

    const input = resolveInputDevice(config.audio.inputDevice, devices, {
      blockedInputs: config.audio.blockedInputs
    });
    const output = resolveOutputDevice(config.audio.outputDevice);

    console.log("");
    console.log(`control plane: ${config.controlPlane.baseUrl}`);
    console.log(`ui:            http://${config.listen.host}:${config.listen.port}`);
    console.log(`voice in:      ${describe(input)}`);
    console.log(`voice out:     ${describe(output)}`);
    console.log(`blocked:       ${config.audio.blockedInputs.join(", ") || "(nothing)"}`);

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

function describe(resolved) {
  if (!resolved?.ok) {
    const why = resolved?.reason === "blocked"
      ? "refused — it is on the blocked list"
      : resolved?.reason === "not_present"
        ? `not available (wanted "${resolved.wanted}")`
        : "not configured";
    return why;
  }

  const device = resolved.device;
  return device.name
    ? `${device.name}${device.index === null ? "" : ` (index ${device.index})`}`
    : `device ${device.index}`;
}

main().catch((error) => {
  console.error(`companion app failed to start: ${error?.message || error}`);
  process.exit(1);
});
