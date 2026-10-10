// Derive minecraft-server/ops.json from configuration.
//
// Why this module exists at all: ops.json was previously hand-created once and
// then rotted. It held a single player entry whose name matched no account, and
// because the UUID was correct *for that dead name* the file looked healthy.
// The child it was meant for could not run a single command, and nothing in the
// file explained why.
//
// Two hard-won rules are encoded here:
//
//  1. Paper keys operators by UUID, not by name. A wrong UUID silently does
//     nothing, however correct the username looks.
//
//  2. Floodgate UUIDs cannot be computed. Bedrock accounts get
//     00000000-0000-0000-0009-<xuid>, not the offline-mode MD5 UUID. The only
//     trustworthy source is usercache.json, which the server maintains itself.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FLOODGATE_PREFIXES = [".", "*", "+", "-"];

// Paper's offline-mode UUID for a plain Java account: a version 3 (MD5) UUID
// over "OfflinePlayer:<name>".
//
// Correct ONLY for non-Floodgate players. This is why the bot can be computed
// and a Bedrock account cannot.
function offlinePlayerUuid(username) {
  const digest = crypto.createHash("md5").update(`OfflinePlayer:${username}`, "utf8").digest();
  digest[6] = (digest[6] & 0x0f) | 0x30; // version 3
  digest[8] = (digest[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = digest.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

// Paper's authoritative name -> UUID map, for every account that has ever
// joined, Java and Bedrock alike.
function readUserCache(serverDir) {
  const cachePath = path.join(serverDir, "usercache.json");

  try {
    if (!fs.existsSync(cachePath)) {
      return new Map();
    }

    const entries = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const byName = new Map();

    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.name && entry?.uuid) {
        byName.set(entry.name, entry.uuid);
      }
    }

    return byName;
  } catch (_error) {
    return new Map();
  }
}

// Resolve a configured gamertag to the account Paper actually knows.
//
// This world has BOTH kinds of account and they must not be confused:
//
//   Panda_Nuggetz        Java desktop client, connects straight to 25565
//   .PandaNuggetz120     Bedrock client, arrives via Geyser + Floodgate
//
// The dot is NOT a rule to apply to every name — it is what Floodgate added to
// one particular account. Blindly prefixing turns the Java name into
// ".Panda_Nuggetz", which matches nothing, and the child silently loses their
// permissions. So: exact match first, prefix only as a fallback.
function resolveAccount(userCache, configured) {
  const bare = String(configured || "").trim();

  if (!bare) {
    return { name: "", uuid: null };
  }

  if (userCache.has(bare)) {
    return { name: bare, uuid: userCache.get(bare) };
  }

  for (const prefix of FLOODGATE_PREFIXES) {
    const candidate = `${prefix}${bare}`;

    if (userCache.has(candidate)) {
      return { name: candidate, uuid: userCache.get(candidate) };
    }
  }

  return { name: "", uuid: null, pending: bare };
}

function configuredNames(env) {
  const botUsername = env.MC_BOT_USERNAME || "Guardian";
  const primary = env.PRIMARY_PLAYER || env.MC_PRIMARY_PLAYER || "";
  const companions = String(env.COMPANION_PLAYERS || "").split(",");

  return {
    botUsername,
    players: Array.from(
      new Set([primary, ...companions].map((n) => String(n || "").trim()).filter(Boolean))
    )
  };
}

function writeOperators({ serverDir, env = process.env, logger = console } = {}) {
  const { botUsername, players } = configuredNames(env);
  const userCache = readUserCache(serverDir);
  const operators = [];
  const unknown = [];

  // The bot is a plain Java account and may not have joined yet on a fresh
  // install, so it is the one case worth computing.
  operators.push({
    uuid: userCache.get(botUsername) || offlinePlayerUuid(botUsername),
    name: botUsername,
    level: 4,
    bypassesPlayerLimit: false
  });

  for (const player of players) {
    if (player === botUsername) {
      continue;
    }

    const resolved = resolveAccount(userCache, player);

    if (!resolved.uuid) {
      unknown.push(player);
      continue;
    }

    operators.push({
      uuid: resolved.uuid,
      name: resolved.name,
      level: 4,
      bypassesPlayerLimit: false
    });
  }

  const opsPath = path.join(serverDir, "ops.json");
  fs.writeFileSync(opsPath, `${JSON.stringify(operators, null, 2)}\n`, "utf-8");

  logger.log?.(
    `[ops] Wrote ops.json for ${operators.length} account(s): ${operators.map((o) => o.name).join(", ")}`
  );

  if (unknown.length) {
    logger.warn?.(
      `[ops] No UUID recorded yet for: ${unknown.join(", ")}. An account's UUID only ` +
        "exists after it joins once — run this again afterwards, or they will show " +
        "as a Member with no commands."
    );
  }

  return { operators, unknown };
}

module.exports = {
  FLOODGATE_PREFIXES,
  offlinePlayerUuid,
  readUserCache,
  resolveAccount,
  configuredNames,
  writeOperators
};