const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(root, ".local"), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, ".local", "crossplay-test-"));
const server = path.join(directory, "server");
const bin = path.join(directory, "bin");
function write(relative, content) {
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
try {
  for (const [command, body] of Object.entries({
    timeout: 'shift\nexec "$@"',
    lsof: 'echo "java 123 synthetic 10 UDP *:19132"',
    route: 'echo "interface: en0"',
    ifconfig: 'echo "inet 192.168.1.50 netmask 0xffffff00"'
  })) fs.chmodSync(write(`bin/${command}`, `#!/bin/sh\n${body}\n`), 0o755);
  write("server/plugins/Geyser-Spigot.jar", "synthetic");
  write("server/plugins/floodgate-spigot.jar", "synthetic");
  write("server/plugins/floodgate/key.pem", "synthetic test fixture");
  write("server/plugins/floodgate/config.yml", 'username-prefix: "."\n');
  write("server/plugins/Geyser-Spigot/config.yml", 'bedrock:\n  port: 19132\njava:\n  auth-type: floodgate\n');
  const log = '[12:00:00] [GeyserServer/INFO]: [Geyser-Spigot] Started Geyser on UDP port 19132\n[12:00:00] [Server thread/INFO]: [floodgate] Enabling floodgate\n';
  const logFile = write("server/logs/latest.log", log + '[12:00:00] [worker/WARN]: [Geyser-Spigot] Error whilst checking for Geyser update!\n');
  function verify() {
    return spawnSync("bash", [path.join(root, "scripts", "verifyCrossplay.sh")], {
      env: { ...process.env, MINECRAFT_SERVER_DIR: server, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8"
    });
  }
  const warning = verify();
  assert.equal(warning.status, 0, warning.stderr);
  assert.match(warning.stdout, /runtime auth mode is unverified/);
  assert.doesNotMatch(warning.stdout, /these values are live/);
  assert.match(warning.stdout, /0 failed, 1 unverified/);
  fs.appendFileSync(logFile, '[12:00:01] [Server thread/ERROR]: [Geyser-Spigot] Failed to bind Bedrock port\n');
  assert.equal(verify().status, 1, "real plugin errors must still fail");
  console.log("crossplay verifier tests passed");
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
