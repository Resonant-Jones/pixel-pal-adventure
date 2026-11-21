// agent/audience.js
//
// Is anyone there to hear Guardian?
//
// Guardian is a companion. Its autonomous lines — "Careful, creeper
// nearby!", "Want to explore the area around us?", "I'm stuck on this one"
// — are addressed to a player. Speaking them into an empty world is the
// single most uncanny thing a companion can do, and it burns a
// speech-provider call each time.
//
// The symptom is a bot that talks to itself on a timer: the idle detector
// fires ninety seconds after startup, the cooldown is a minute, and the
// world is empty. That is not "a lively world". That is a machine talking
// to nobody, and it was reported as exactly that.
//
// TWO SOURCES, BECAUSE NEITHER IS RELIABLE ALONE
//
//   * the server's player list (mineflayer's tab list) — authoritative for
//     who is connected, but observed to lag or omit a player who is
//     plainly in the world
//   * who Guardian has heard speak recently — always accurate about
//     someone it is talking to, and silent about someone who joined and
//     said nothing
//
// Either one means there is someone to hear it.

// How long someone still counts as "here" after they were last heard.
const AUDIENCE_WINDOW_MS = 120 * 1000;

// Server-side senders that talk in chat but are not people.
//
// Plugins announce themselves in the chat channel exactly the way a player
// does, so the agent hears them the way it hears anyone else. That is
// correct for answering — and wrong for a roster that is supposed to say
// who is in the world. A plugin is never a listener.
//
// This is a denylist rather than a rule because there is no rule available:
// a plugin's chat line is indistinguishable from a player's without asking
// the server, and the server cannot be asked from inside the game.
const SERVER_SENDERS = new Set([
  "viaversion",
  "viaversionplus",
  "floodgate",
  "luckperms",
  "server",
  "minecraft",
  "console"
]);

function isServerSender(name) {
  return SERVER_SENDERS.has(String(name || "").trim().toLowerCase());
}

/**
 * @param {object} options
 * @param {string[]} options.roster        the server's player list, raw
 * @param {string} options.guardianName    the bot's own name
 * @param {Map} options.speakers           name -> { at, count }
 * @param {number} [options.windowMs]
 * @param {number} [options.now]
 */
function hasAudience({
  roster = [],
  guardianName = "Guardian",
  speakers = new Map(),
  windowMs = AUDIENCE_WINDOW_MS,
  now = Date.now()
} = {}) {
  const others = (roster || []).filter(
    (name) => name && name !== guardianName && !isServerSender(name)
  );
  if (others.length > 0) {
    return true;
  }

  const cutoff = now - windowMs;
  for (const [name, info] of speakers || new Map()) {
    // A companion is not its own audience.
    //
    // This is not a hypothetical. The server echoes the bot's own chat back
    // to it, so Guardian's own voice came round as evidence that the player
    // was present — which let it keep talking to an empty room, on a timer,
    // forever.
    if (!name || name === guardianName || isServerSender(name)) {
      continue;
    }

    if (info?.at >= cutoff) {
      return true;
    }
  }

  return false;
}

/**
 * Why there is nobody to hear it, for the log and the event record.
 * "no_audience" is the honest answer in both cases; the distinction only
 * matters when reading the history back.
 */
function audienceState(options = {}) {
  return hasAudience(options) ? "present" : "no_audience";
}

module.exports = {
  hasAudience,
  audienceState,
  isServerSender,
  SERVER_SENDERS,
  AUDIENCE_WINDOW_MS
};
