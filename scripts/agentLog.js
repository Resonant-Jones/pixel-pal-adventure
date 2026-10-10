// Duplicate the agent's console output to a file on disk.
//
// The agent's stdout goes straight to the terminal that launched it, and that
// output was being lost the moment the terminal scrolled or closed. Paper keeps
// its own server-side log, but the agent's decisions — did survival subscribe,
// did it see the creeper, what did it decide, was it interrupted — existed only
// in a scrollback buffer nobody could search.
//
// That made the three deaths in a single boot unexplainable: the evidence needed
// to diagnose them had never been written down.
//
// This tees rather than replaces, so Ctrl+C and terminal behaviour are
// unchanged. It is intentionally dependency-free and must never be able to take
// the agent down with it.

const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.AGENT_LOG_DIR
  ? path.resolve(process.env.AGENT_LOG_DIR)
  : path.join(__dirname, "..", ".local", "logs");

const MAX_BYTES = Number(process.env.AGENT_LOG_MAX_BYTES || 8 * 1024 * 1024);

function installAgentLogTee() {
  let stream = null;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, "agent.log");

    // Roll once at startup rather than mid-run: a failed rotation must never
    // take the agent with it.
    try {
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;

      if (size > MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch (_error) {
      // Rotation is best-effort. Appending is what matters.
    }

    stream = fs.createWriteStream(file, { flags: "a" });
    stream.on("error", () => {
      // A broken log file must never escalate into an agent crash.
      stream = null;
    });
  } catch (_error) {
    return null;
  }

  if (!stream) return null;

  const write = (args) => {
    try {
      stream.write(`${args.join(" ")}\n`);
    } catch (_error) {
      // Swallow: losing a log line is strictly better than dying.
    }
  };

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args) => {
    write(args);
    originalLog(...args);
  };
  console.warn = (...args) => {
    write(args);
    originalWarn(...args);
  };
  console.error = (...args) => {
    write(args);
    originalError(...args);
  };

  return stream;
}

module.exports = { installAgentLogTee, LOG_DIR };