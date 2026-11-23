// companion/inputGuard.js
//
// Keeps macOS's default input device on the machine's own microphone.
//
// WHY IT IS NEEDED AT ALL
//
// macOS 27.2 has no switch for "do not use the iPhone microphone". The
// System Settings search turned up iPhone Mirroring, iPhone Widgets,
// Handoff, AirDrop, AirPlay Receiver, Notifications, Hearing Devices and
// the Privacy pane — and nothing else. There is no Control for it and no
// writable `defaults` key either: the state belongs to the Continuity
// capture subsystem.
//
// What is there is the cause. This Mac sees the family iPhone — "ScoutNode",
// iPhone17,1 — as a Continuity Camera, and a Continuity Camera brings its
// microphone with it. "ScoutNode Microphone" is a real, selectable input on
// this machine, and macOS picks it when the camera is in use.
//
// So the outcome is enforced rather than the switch flipped: this watches the
// system default input and puts it back on the pinned device if it moves.
//
// WHAT IT DOES NOT DO
//
// It does not stop the iPhone from being a camera, and it does not stop
// macOS from *offering* the phone's microphone. It only decides which one
// the machine is listening to by default. The phone's microphone stays
// refused for Guardian's own capture regardless — that is a separate,
// stricter rule in deviceResolver.js, and it does not depend on this.
//
// IT IS NOT A SECURITY BOUNDARY
//
// This is a convenience. Anyone who can run code as this user can also run
// the guard's inverse. The real protection for the son's privacy is the
// name-pinned capture in the companion app, which never asks the system
// default for anything.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BINARY = path.join(ROOT, ".local", "bin", "guard-default-input");

class InputGuard {
  constructor({
    binaryPath = DEFAULT_BINARY,
    deviceName = "MacBook Air Microphone",
    intervalSeconds = 5,
    logger = console
  } = {}) {
    this.binaryPath = binaryPath;
    this.deviceName = deviceName;
    this.intervalSeconds = intervalSeconds;
    this.logger = logger;

    this.child = null;
    this.restartTimer = null;
    this.stopping = false;
    this.status = {
      enabled: false,
      running: false,
      available: false,
      device: deviceName,
      lastEvent: null,
      lastEventAt: null,
      moves: 0,
      error: null
    };
  }

  #refreshAvailability() {
    this.status.available = fs.existsSync(this.binaryPath);
    return this.status.available;
  }

  /**
   * Start watching.
   *
   * A missing binary is not an error: the companion app must still work on a
   * machine where the guard was never built. It reports the fact and carries
   * on, because the capture path pins its own device by name anyway.
   */
  start() {
    this.stopping = false;

    if (!this.#refreshAvailability()) {
      this.status.enabled = false;
      this.status.running = false;
      this.status.error = `The guard is not built (${this.binaryPath}). Run scripts/buildInputGuard.sh.`;
      this.logger.warn?.(`[guard] ${this.status.error}`);
      return false;
    }

    this.status.enabled = true;
    this.status.error = null;
    this.#spawn();
    return true;
  }

  #spawn() {
    if (this.stopping) {
      return;
    }

    const child = spawn(
      this.binaryPath,
      ["--ensure", this.deviceName, "--interval", String(this.intervalSeconds)],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    this.child = child;
    this.status.running = true;

    const onLine = (line) => {
      const text = String(line || "").trim();
      if (!text) return;

      if (text.includes("moved back")) {
        this.status.moves += 1;
        this.status.lastEvent = text;
        this.status.lastEventAt = new Date().toISOString();
        this.logger.warn?.(`[guard] ${text}`);
      }
    };

    child.stdout?.on("data", (chunk) => String(chunk).split("\n").forEach(onLine));
    child.stderr?.on("data", (chunk) => String(chunk).split("\n").forEach(onLine));

    child.on("error", (error) => {
      this.status.running = false;
      this.status.error = error?.message || String(error);
      this.logger.error?.(`[guard] ${this.status.error}`);
    });

    child.on("exit", (code, signal) => {
      this.status.running = false;

      if (this.stopping) {
        return;
      }

      // The guard is meant to run forever. If it stops on its own it either
      // crashed or was killed, and a guard that is not running is a guard
      // that is not guarding — so it comes back.
      this.status.error = `The guard stopped (code ${code}, signal ${signal}). Restarting it.`;
      this.logger.warn?.(`[guard] ${this.status.error}`);

      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.#spawn();
      }, 3000);
    });
  }

  stop() {
    this.stopping = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.child) {
      this.child.kill();
      this.child = null;
    }

    this.status.running = false;
  }

  getStatus() {
    return {
      ...this.status,
      available: fs.existsSync(this.binaryPath)
    };
  }
}

module.exports = {
  InputGuard,
  DEFAULT_BINARY
};
