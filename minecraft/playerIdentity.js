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

function resolvePlayerEntity(bot, username) {
  for (const candidate of playerNameCandidates(username)) {
    const entity = bot?.players?.[candidate]?.entity;
    if (entity) return { name: candidate, entity };
  }
  return { name: null, entity: null };
}

function matchesPlayerName(bot, configuredName, observedName) {
  if (typeof observedName !== "string" || !observedName) return false;
  const candidates = playerNameCandidates(configuredName);
  // Chat may arrive before the player's entity becomes visible. Still prefer
  // the exact online name if both a Java name and a Bedrock alias are present.
  const onlineName = candidates.find((name) => Object.hasOwn(bot?.players || {}, name));
  return onlineName ? observedName === onlineName : candidates.includes(observedName);
}

module.exports = { FLOODGATE_USERNAME_PREFIXES, playerNameCandidates, resolvePlayerEntity, matchesPlayerName };
