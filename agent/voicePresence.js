// agent/voicePresence.js
//
// Who is in the world, and where.
//
// WHY THIS IS NOT A ONE-LINE `Object.keys(bot.players)`
//
// Two different questions are being asked and the obvious source answers only
// one of them:
//
//   "Who is connected?"      the server's player list (mineflayer's
//                            `bot.players`, built from the tab list)
//   "Where are they?"        the loaded entity, which only exists when the
//                            player is close enough to be seen
//
// The tab list was observed to arrive late, or not at all, for a player who
// was plainly in the world and talking to Guardian. A voice link that
// reports "nobody is here" while someone is speaking to it is worse than no
// report at all, so the agent keeps its own memory of who it has heard and
// this module merges the two sources.
//
// The merge is explicit about what it knows:
//   inView       the entity is loaded, so the distance is real
//   lastHeardAt  Guardian heard them speak at this time
//
// Neither is inferred from the other.

// Server-side senders that talk in chat but are not people live in
// agent/audience.js, because the same rule decides both who is in the world
// and who is listening to it.
const { isServerSender } = require("./audience");

// How long the agent remembers having heard a player speak.
//
// Long enough to bridge a gap in the server's player list, short enough that
// someone who left a minute ago is not still reported as being in the world.
const SPEAKER_MEMORY_MS = 90 * 1000;

function recentSpeakerNames(speakers, windowMs = SPEAKER_MEMORY_MS, now = Date.now()) {
  const cutoff = now - windowMs;
  const names = [];

  for (const [name, info] of speakers || new Map()) {
    if (info?.at >= cutoff) {
      names.push(name);
    }
  }

  return names;
}

/**
 * Build the presence payload the companion app reads.
 *
 * @param {object} options
 * @param {object|null} options.snapshot      the world snapshot (positions)
 * @param {string[]} options.roster           the server's player list, raw
 * @param {string} options.guardianName       the bot's own name
 * @param {Map} options.speakers              name -> { at, count }
 * @param {(name: string) => boolean} options.isApproved
 */
function buildVoicePresence({
  snapshot = null,
  roster = [],
  guardianName = "Guardian",
  speakers = new Map(),
  isApproved = () => false,
  now = Date.now()
} = {}) {
  const loadedByName = new Map((snapshot?.players || []).map((player) => [player.name, player]));

  const names = new Set([
    ...roster,
    ...recentSpeakerNames(speakers, SPEAKER_MEMORY_MS, now)
  ]);
  names.delete(guardianName);

  const players = Array.from(names)
    .filter((name) => !isServerSender(name))
    .map((name) => {
    const loaded = loadedByName.get(name);
    const heard = speakers?.get(name);

    return {
      name,
      distance: loaded?.distance ?? null,
      position: loaded?.position ?? null,
      inView: Boolean(loaded),
      lastHeardAt: heard ? new Date(heard.at).toISOString() : null,
      approved: Boolean(isApproved(name))
    };
  });

  return {
    at: new Date(now).toISOString(),
    dimension: snapshot?.dimension ?? null,
    guardian: {
      name: guardianName,
      position: snapshot?.position ?? null,
      health: snapshot?.health ?? null
    },
    players,
    // The raw roster, before any merging. A filtered list that silently
    // drops someone is worse than a list that shows what the server said.
    roster: Array.from(roster),
    primaryPlayer: null
  };
}

module.exports = {
  buildVoicePresence,
  recentSpeakerNames,
  isServerSender,
  SPEAKER_MEMORY_MS
};
