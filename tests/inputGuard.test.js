const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { InputGuard } = require("../companion/inputGuard");

// The microphone watchdog.
//
// The rule it has to obey: the companion app must keep working on a machine
// where the watchdog was never built. The watchdog is a convenience — macOS
// 27.2 has no switch for "do not use the iPhone microphone", so the outcome
// is enforced instead — and a convenience that takes the app down with it
// would be worse than not having it.
//
// The other rule: a watchdog that silently stops is not a watchdog. If the
// process dies, it comes back.

function testMissingBinaryIsNotFatal() {
  const guard = new InputGuard({
    binaryPath: path.join(__dirname, "..", ".local", "bin", "definitely-not-built"),
    deviceName: "MacBook Air Microphone",
    logger: { warn() {}, error() {}, log() {} }
  });

  const started = guard.start();

  assert.equal(started, false, "a missing binary must report that it did not start");
  assert.equal(guard.getStatus().running, false);
  assert.equal(guard.getStatus().available, false);
  assert.match(guard.getStatus().error, /not built/, "the reason must be stated");

  guard.stop();
}

function testStatusShape() {
  const guard = new InputGuard({
    binaryPath: path.join(__dirname, "..", ".local", "bin", "guard-default-input"),
    deviceName: "MacBook Air Microphone",
    logger: { warn() {}, error() {}, log() {} }
  });

  const status = guard.getStatus();

  assert.equal(status.device, "MacBook Air Microphone");
  assert.equal(status.moves, 0);
  assert.equal(status.running, false);
  assert.equal(typeof status.available, "boolean");
}

// The built binary, if it is there, must actually be the thing it claims to
// be: a program that can list the audio devices and refuses to guess.
function testBuiltBinaryBehaves() {
  const binary = path.join(__dirname, "..", ".local", "bin", "guard-default-input");

  if (!fs.existsSync(binary)) {
    // Not built on this machine — nothing to prove.
    return;
  }

  const { execFileSync } = require("node:child_process");
  const output = execFileSync(binary, ["--list"], { encoding: "utf8" });

  assert.match(output, /default input:/, "the listing must say what the default input is");

  // A device name that does not exist must be refused, not guessed at.
  // The guard exits 2 for that, which execFileSync reports as a throw, so
  // the message is read out of the failure rather than the success path.
  let missing = "";

  try {
    missing = execFileSync(binary, ["--once", "--ensure", "No Such Microphone"], {
      encoding: "utf8"
    });
  } catch (error) {
    missing = `${error.stdout || ""}${error.stderr || ""}`;
    assert.equal(error.status, 2, "an absent device must exit 2");
  }

  assert.match(missing, /no input device named/, "an absent device must be named as absent");
}

console.log("inputGuard");
testMissingBinaryIsNotFatal();
testStatusShape();
testBuiltBinaryBehaves();
console.log("  all input guard tests passed");
