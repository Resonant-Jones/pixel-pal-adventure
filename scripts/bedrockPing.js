#!/usr/bin/env node
// .local/bedrockPing.js
//
// Ask a Bedrock client which version it is.
//
// The Bedrock client listens for RakNet "unconnected pings" on UDP 19133
// and answers with an "unconnected pong" whose MOTD string carries the
// protocol number and the game version:
//
//   MCPE;<motd>;<protocol>;<version>;...
//
// So one UDP round trip answers "what Bedrock version is this device on"
// without anybody opening the app.
//
// Usage:  node .local/bedrockPing.js 192.168.4.157 [port]

const dgram = require("node:dgram");
const os = require("node:os");

const MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
  0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78
]);

const target = process.argv[2] || "255.255.255.255";
const port = Number(process.argv[3] || 19133);
const timeoutMs = Number(process.argv[4] || 4000);

function buildPing() {
  const packet = Buffer.alloc(1 + 8 + 16 + 8);
  packet.writeUInt8(0x01, 0);
  packet.writeBigUInt64BE(BigInt(Date.now()), 1);
  MAGIC.copy(packet, 9);
  packet.writeBigUInt64BE(BigInt(process.hrtime.bigint() & 0xffffffffffffn), 25);
  return packet;
}

// "MCPE;motd;protocol;version;..." -> the fields we care about
function parseMotd(motd) {
  const parts = motd.split(";");
  return {
    edition: parts[0],
    motd: parts[1],
    protocol: parts[2],
    version: parts[3],
    fields: parts
  };
}

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

const done = (code, payload) => {
  try { socket.close(); } catch { /* already closed */ }
  if (payload) process.stdout.write(`${payload}\n`);
  process.exit(code);
};

socket.on("error", (error) => done(1, `socket error: ${error.message}`));

socket.on("message", (message, remote) => {
  if (message[0] !== 0x1c) return done(1, "not a pong");

  const length = message.readUInt16BE(33);
  const motd = message.slice(35, 35 + length).toString("utf8");
  const parsed = parseMotd(motd);

  done(0, JSON.stringify({
    from: `${remote.address}:${remote.port}`,
    edition: parsed.edition,
    protocol: parsed.protocol,
    version: parsed.version
  }));
});

socket.bind(() => {
  try {
    socket.setBroadcast(true);
  } catch { /* not permitted here; unicast still works */ }
  socket.send(buildPing(), port, target);
});

setTimeout(() => done(1, `no answer from ${target}:${port} within ${timeoutMs}ms`), timeoutMs);
