// agent/trustTier.js
//
// Who is allowed to talk to the companion, and what they get.
//
// The problem this solves, proven live on 2026-11-20: with
// MC_RESPOND_TO_ALL=true, an unapproved player who joined the server asked
// "what was I working on last time?" and the companion answered
// "The half-finished cabin was Panda's." An approved player's private memory
// went to a stranger, because the adventure summaries are world-level context
// and nothing checked who was asking.
//
// The fix is two separate things, and only one of them is a prompt:
//
//   1. CONTEXT SCOPING (the real fix). A guest turn must not receive the
//      approved players' adventure summaries, anchors, learned guidance, or
//      roster. If the material never reaches the model, the model cannot
//      paraphrase it, and no prompt instruction needs to hold.
//
//   2. OUTPUT GUARDING (defence in depth). A guest reply is checked against
//      the approved players' names and replaced if it mentions one. This
//      catches the case where a leak arrives by some path that scoping
//      missed.
//
// Guest actions are restricted to speech. A guest may talk to the companion;
// a guest may not make it build, follow, teleport, dig, or touch anyone's
// saved places. That is enforced in the action executor, not asked for in a
// prompt.
//
// Trusted-companion behaviour is unchanged for approved players. This module
// only narrows what an unapproved one can reach.

const { playerNameCandidates, stripFloodgatePrefix } = require("../minecraft/playerIdentity");

const TRUST_TIERS = Object.freeze({
  APPROVED: "approved",
  GUEST: "guest"
});

// What a guest may cause the companion to do. Everything that changes the
// world, moves the companion, or touches stored state is absent by
// construction rather than by instruction.
const GUEST_ALLOWED_ACTIONS = Object.freeze(["none", "chat"]);

// A guest may be answered, or ignored entirely. "bounded" is the default and
// the one the family wants: a kid who joins and gets silence learns the
// server is broken; a kid who gets a friendly, bounded companion learns there
// are rules.
const GUEST_MODES = Object.freeze(["bounded", "ignore"]);

function buildApprovedNameSet(primaryPlayer, knownPlayers = []) {
  const accepted = new Set();

  for (const name of [primaryPlayer, ...knownPlayers]) {
    if (typeof name !== "string" || !name.trim()) continue;

    for (const candidate of playerNameCandidates(name)) {
      accepted.add(candidate.toLowerCase());
    }
  }

  return accepted;
}

function resolveTrustTier(username, { primaryPlayer, knownPlayers = [] } = {}) {
  if (typeof username !== "string" || !username.trim()) {
    return TRUST_TIERS.GUEST;
  }

  const accepted = buildApprovedNameSet(primaryPlayer, knownPlayers);
  return accepted.has(username.trim().toLowerCase())
    ? TRUST_TIERS.APPROVED
    : TRUST_TIERS.GUEST;
}

function isApprovedPlayer(username, options = {}) {
  return resolveTrustTier(username, options) === TRUST_TIERS.APPROVED;
}

// The names a guest must never be told.
//
// Three forms of each approved name, because a paraphrasing model does not
// reproduce a gamertag — it reaches for the familiar part of it. Given
// "Panda_Nuggetz" it says "Panda". Given "PandaNuggetz120" it says
// "PandaNuggetz". Blocking only the literal name would miss both.
function expandNameForms(name) {
  const forms = new Set();
  const trimmed = name.trim();

  if (!trimmed) return forms;

  forms.add(trimmed);

  const stem = stripFloodgatePrefix(trimmed);
  if (stem) {
    forms.add(stem);
  }

  // "Panda_Nuggetz" -> "Panda". The first separator-delimited token is what a
  // model reaches for when it wants to sound familiar.
  const firstToken = stem.split(/[^a-zA-Z0-9]+/).find(Boolean);
  if (firstToken && firstToken.length >= 3) {
    forms.add(firstToken);

    // "PandaNuggetz120" -> "PandaNuggetz". Trailing digits are a Bedrock
    // suffix, not part of the name anyone says out loud.
    const alphaRun = firstToken.match(/^[a-zA-Z]+/)?.[0];
    if (alphaRun && alphaRun.length >= 3) {
      forms.add(alphaRun);
    }
  }

  return forms;
}

function approvedDisplayNames({ primaryPlayer, knownPlayers = [] } = {}) {
  const names = new Set();

  for (const name of [primaryPlayer, ...knownPlayers]) {
    if (typeof name !== "string" || !name.trim()) continue;

    for (const form of expandNameForms(name)) {
      names.add(form);
    }
  }

  return Array.from(names).filter((name) => name.length >= 3);
}

// Word-boundary matching, so "Panda" does not trip on "Pandalore" and
// "Panda_Nuggetz" does not trip on a longer unrelated name.
function mentionsName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^a-zA-Z0-9_])${escaped}([^a-zA-Z0-9_]|$)`, "i");
  return pattern.test(text);
}

// Defence in depth. Returns the reply unchanged when it is safe, or a bounded
// replacement when it names an approved player.
//
// This is not the primary defence — context scoping is. It exists because a
// rule that only exists in a prompt is a rule that fails silently, and this
// project has already been bitten by exactly that pattern.
function guardGuestReply(message, { primaryPlayer, knownPlayers = [] } = {}) {
  const text = typeof message === "string" ? message : "";
  if (!text.trim()) {
    return { message: text, redacted: false, matchedNames: [] };
  }

  const blocked = approvedDisplayNames({ primaryPlayer, knownPlayers });
  const matchedNames = blocked.filter((name) => mentionsName(text, name));

  if (!matchedNames.length) {
    return { message: text, redacted: false, matchedNames: [] };
  }

  return {
    message:
      "I can't talk about anyone else who plays here. Ask the server owner if you want to know more.",
    redacted: true,
    matchedNames
  };
}

function normalizeGuestMode(value) {
  const mode = String(value || "bounded").trim().toLowerCase();
  return GUEST_MODES.includes(mode) ? mode : "bounded";
}

module.exports = {
  TRUST_TIERS,
  GUEST_ALLOWED_ACTIONS,
  GUEST_MODES,
  resolveTrustTier,
  isApprovedPlayer,
  approvedDisplayNames,
  guardGuestReply,
  normalizeGuestMode
};
