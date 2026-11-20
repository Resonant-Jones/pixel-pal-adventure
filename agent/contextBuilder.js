const {
  DEFAULT_ALLOWED_ACTIONS,
  buildSystemPrompt,
  buildGuestSystemPrompt,
  buildUserPrompt,
  buildAdventureSummarySystemPrompt,
  buildAdventureSummaryUserPrompt
} = require("../ai/promptBuilder");
const { captureWorldSnapshot } = require("../minecraft/worldSnapshot");
const { playerNameCandidates } = require("../minecraft/playerIdentity");
const { TRUST_TIERS, GUEST_ALLOWED_ACTIONS } = require("./trustTier");

function inConversationScope(item, { worldId, threadId, primaryPlayer, storedCompanionName, knownPlayers }, actorField) {
  if (!worldId || !threadId || item.world_id !== worldId || item.thread_id !== threadId) return false;
  if (item[actorField] === storedCompanionName) return true;

  // Previously this kept ONLY the primary player (plus Floodgate aliases), which
  // silently dropped every other player's messages from memory. The companion
  // could not recall anything a second player said, which read as being aloof.
  // Anyone configured as a known companion player now stays in scope.
  const accepted = new Set(playerNameCandidates(primaryPlayer));

  for (const name of Array.isArray(knownPlayers) ? knownPlayers : []) {
    if (typeof name === "string" && name.trim()) {
      for (const candidate of playerNameCandidates(name)) {
        accepted.add(candidate);
      }
    }
  }

  return accepted.has(item[actorField]);
}

// Summaries are world-level memories, but they must still name an owner. Widening
// this to "any known player" fixes summaries recorded while a friend was playing
// without turning into a leak: a summary owned by someone outside the session, or
// owned by nobody at all, stays out.
function inPrimarySummaryScope(item, { worldId, threadId, primaryPlayer, knownPlayers }) {
  if (!worldId || !threadId || item.world_id !== worldId || item.thread_id !== threadId) return false;

  const accepted = new Set(playerNameCandidates(primaryPlayer));
  for (const name of Array.isArray(knownPlayers) ? knownPlayers : []) {
    if (typeof name === "string" && name.trim()) {
      for (const candidate of playerNameCandidates(name)) {
        accepted.add(candidate);
      }
    }
  }

  return accepted.has(item.metadata?.primaryPlayer);
}

async function buildContext({
  messageStore,
  eventStore,
  bot,
  threadId,
  worldId,
  latestMessage,
  speakerName = null,
  primaryPlayer,
  knownPlayers = [],
  presentPlayers = null,
  companionName,
  storedCompanionName = companionName,
  role,
  personality,
  memoryWindow = 12,
  eventWindow = 6,
  summaryContextLimit = 3,
  retryGuidance = null,
  feedbackSummary = null,
  operatorInstruction = null,
  spatialReferences = [],
  allowedActions = DEFAULT_ALLOWED_ACTIONS,
  buildStatus = null,
  trustTier = TRUST_TIERS.APPROVED
}) {
  // A guest turn is scoped to the guest.
  //
  // This is the real fix for the leak proved live on 2026-11-20, where an
  // unapproved player asked "what was I working on last time?" and the
  // companion answered "The half-finished cabin was Panda's."
  //
  // Rather than adding a rule that says "do not mention other players", the
  // scope itself is narrowed: the guest becomes the primary player for the
  // purposes of this turn. The existing scope machinery then does the rest —
  // their conversation history is their own, and the adventure summaries that
  // reach the prompt are the ones owned by them, which is to say none of the
  // family's. Nothing to paraphrase, because nothing was sent.
  const isGuest = trustTier === TRUST_TIERS.GUEST;
  const scopedPrimaryPlayer = isGuest ? speakerName || primaryPlayer : primaryPlayer;
  const scopedKnownPlayers = isGuest ? [] : knownPlayers;
  // Who Guardian can SEE — everyone present in the world. Kept separate from
  // the trust roster above: presence decides who it can address, trust decides
  // whose memories it may reach. A guest gets no roster at all.
  const rosterPlayers = isGuest ? [] : (presentPlayers || knownPlayers);

  const [messages, events, summaries, reflexes] = await Promise.all([
    messageStore.getRecentMessages(threadId, memoryWindow, { worldId }),
    eventStore.getRecentEvents(threadId, eventWindow, { worldId }),
    eventStore.getRecentAdventureSummaries(threadId, summaryContextLimit, { worldId }),
    eventStore.getRecentReflexEvents(threadId, 6, { worldId })
  ]);

  const scope = {
    worldId,
    threadId,
    primaryPlayer: scopedPrimaryPlayer,
    storedCompanionName,
    knownPlayers: scopedKnownPlayers
  };
  const recentMessages = messages.filter((item) => inConversationScope(item, scope, "speaker"));
  const recentEvents = events.filter((item) => inConversationScope(item, scope, "actor"));
  const recentSummaries = summaries.filter((item) => inPrimarySummaryScope(item, scope));
  const recentReflexEvents = reflexes.filter((item) => inConversationScope(item, scope, "actor"));
  const filteredEvents = recentEvents.filter((event) => event.type !== "adventure_summary");
  const worldSnapshot = captureWorldSnapshot(bot, { focusPlayer: scopedPrimaryPlayer });
  const playerState = worldSnapshot.player_state;

  // A guest gets no saved places, no learned guidance, and no build status.
  // Those are all family state, and a guest's turn has no business with
  // any of them.
  const scopedSpatialReferences = isGuest ? [] : spatialReferences;
  const scopedRetryGuidance = isGuest ? null : retryGuidance;
  const scopedFeedbackSummary = isGuest ? null : feedbackSummary;
  const scopedBuildStatus = isGuest ? null : buildStatus;
  const scopedAllowedActions = isGuest ? GUEST_ALLOWED_ACTIONS : allowedActions;

  return {
    recentMessages,
    recentEvents: filteredEvents,
    recentSummaries,
    recentReflexEvents,
    worldSnapshot,
    playerState,
    systemPrompt: isGuest
      ? buildGuestSystemPrompt({ companionName })
      : buildSystemPrompt({
          companionName,
          primaryPlayer,
          role,
          personality,
          knownPlayers: rosterPlayers
        }),
    userPrompt: buildUserPrompt({
      latestMessage,
      speakerName,
      operatorInstruction,
      spatialReferences: scopedSpatialReferences,
      allowedActions: scopedAllowedActions,
      recentMessages,
      recentEvents: filteredEvents,
      recentSummaries,
      recentReflexEvents,
      worldSnapshot,
      playerState,
      retryGuidance: scopedRetryGuidance,
      feedbackSummary: scopedFeedbackSummary,
      buildStatus: scopedBuildStatus
    })
  };
}

async function buildAdventureSummaryContext({
  messageStore,
  eventStore,
  threadId,
  worldId,
  companionName,
  storedCompanionName = companionName,
  primaryPlayer,
  knownPlayers = [],
  summaryWindow = 24,
  summaryEventWindow = 12
}) {
  const [messages, events] = await Promise.all([
    messageStore.getRecentMessages(threadId, summaryWindow, { worldId }),
    eventStore.getRecentEvents(threadId, summaryEventWindow, { worldId })
  ]);

  const scope = { worldId, threadId, primaryPlayer, storedCompanionName, knownPlayers };
  const recentMessages = messages.filter((item) => inConversationScope(item, scope, "speaker"));
  const filteredEvents = events.filter((item) => item.type !== "adventure_summary" && inConversationScope(item, scope, "actor"));

  return {
    recentMessages,
    recentEvents: filteredEvents,
    systemPrompt: buildAdventureSummarySystemPrompt({
      companionName,
      primaryPlayer
    }),
    userPrompt: buildAdventureSummaryUserPrompt({
      recentMessages,
      recentEvents: filteredEvents
    })
  };
}

module.exports = {
  buildContext,
  buildAdventureSummaryContext
};
