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
  const others = (roster || []).filter((name) => name && name !== guardianName);
  if (others.length > 0) {
    return true;
  }

  const cutoff = now - windowMs;
  for (const info of speakers?.values?.() || []) {
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
  AUDIENCE_WINDOW_MS
};
