// Paper's player list is the authority for names. Floodgate aliases are a
// transport compatibility rule, not proof of an authenticated account.
const FLOODGATE_USERNAME_PREFIXES = [".", "*", "+", "-"];

function playerNameCandidates(username) {
  if (typeof username !== "string" || !username.trim()) return [];
  const name = username.trim();
  const candidates = [name];
  if (FLOODGATE_USERNAME_PREFIXES.some((prefix) => name.startsWith(prefix) && name.length > 1)) {
    candidates.push(name.slice(1));
  } else {
    candidates.push(...FLOODGATE_USERNAME_PREFIXES.map((prefix) => `${prefix}${name}`));
  }
  return candidates;
}

function stripFloodgatePrefix(username) {
  if (typeof username !== "string") return "";
  const name = username.trim();

  const prefix = FLOODGATE_USERNAME_PREFIXES.find(
    (candidate) => name.startsWith(candidate) && name.length > candidate.length
  );

  return prefix ? name.slice(1) : name;
}

function resolvePlayerEntity(bot, username) {
  for (const candidate of playerNameCandidates(username)) {
    const entity = bot?.players?.[candidate]?.entity;
    if (entity) return { name: candidate, entity };
  }
  return { name: null, entity: null };
}

// Bedrock gamertags routinely carry a numeric suffix — "SageTheMage1847" — and
// the person configuring the server frequently only remembers the stem. An
// exact match therefore fails on a player who is obviously the right one, and
// the companion silently ignores the child it exists for.
//
// So a configured stem may resolve to a real player, but ONLY when the extra
// characters are digits. That keeps "SageTheMage" from ever binding to
// "SageTheMageTwo" or "SageTheMageEvil", which is the failure mode that would
// make this unsafe.
function matchesByNumericSuffix(configuredName, observedName) {
  const configured = stripFloodgatePrefix(configuredName);
  const observed = stripFloodgatePrefix(observedName);

  if (!configured || !observed || observed.length <= configured.length) return false;
  if (!observed.startsWith(configured)) return false;

  const suffix = observed.slice(configured.length);

  return /^[0-9]+$/.test(suffix);
}

// Find the name the server actually knows this player by, preferring an exact
// match and falling back to a numeric-suffix match. Used both for chat matching
// and to report the real name so an operator can pin it exactly.
function resolveOnlinePlayerName(bot, configuredName) {
  // Presence in `bot.players` is the online check, NOT the presence of an
  // entity: a player is listed before their entity is populated. Keying this
  // off the entity made an exact online name lose to a suffix fallback.
  const candidates = playerNameCandidates(configuredName);
  const onlineName = candidates.find((name) => Object.hasOwn(bot?.players || {}, name));

  if (onlineName) return { name: onlineName, exact: true };

  const stem = stripFloodgatePrefix(configuredName);
  if (!stem) return { name: null, exact: false };

  for (const online of Object.keys(bot?.players || {})) {
    if (matchesByNumericSuffix(stem, online)) {
      return { name: online, exact: false };
    }
  }

  return { name: null, exact: false };
}

function matchesPlayerName(bot, configuredName, observedName) {
  if (typeof observedName !== "string" || !observedName) return false;
  const candidates = playerNameCandidates(configuredName);
  // Chat may arrive before the player's entity becomes visible. Still prefer
  // the exact online name if both a Java name and a Bedrock alias are present.
  const onlineName = candidates.find((name) => Object.hasOwn(bot?.players || {}, name));
  if (onlineName) return observedName === onlineName;

  return (
    candidates.includes(observedName) || matchesByNumericSuffix(configuredName, observedName)
  );
}

module.exports = {
  FLOODGATE_USERNAME_PREFIXES,
  playerNameCandidates,
  stripFloodgatePrefix,
  resolvePlayerEntity,
  matchesByNumericSuffix,
  resolveOnlinePlayerName,
  matchesPlayerName
};