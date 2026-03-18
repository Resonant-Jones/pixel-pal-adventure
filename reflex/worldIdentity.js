const crypto = require("crypto");

function normalizeBlockPosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(Number(position.x || 0)),
    y: Math.floor(Number(position.y || 0)),
    z: Math.floor(Number(position.z || 0))
  };
}

function hashWorldIdentity(parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

function resolveWorldIdentity(botAdapter) {
  const signals = botAdapter.getWorldIdentitySignals();
  const spawn = normalizeBlockPosition(signals.spawnPoint) || { x: 0, y: 0, z: 0 };
  const dimension = signals.dimension || "unknown";
  const serverBrand = signals.serverBrand || "unknown";
  const serverAddress = signals.serverAddress || "unknown:0";

  const worldId = hashWorldIdentity([
    serverAddress,
    `${spawn.x},${spawn.y},${spawn.z}`,
    dimension,
    serverBrand
  ]);

  return {
    worldId,
    serverAddress,
    spawnLocation: spawn,
    dimension,
    serverBrand
  };
}

module.exports = {
  resolveWorldIdentity
};
