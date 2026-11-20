const {
  DEFAULT_ALLOWED_ACTIONS,
  buildSystemPrompt,
  buildUserPrompt,
  buildAdventureSummarySystemPrompt,
  buildAdventureSummaryUserPrompt
} = require("../ai/promptBuilder");
const { captureWorldSnapshot } = require("../minecraft/worldSnapshot");
const { playerNameCandidates } = require("../minecraft/playerIdentity");

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
  buildStatus = null
}) {
  const [messages, events, summaries, reflexes] = await Promise.all([
    messageStore.getRecentMessages(threadId, memoryWindow, { worldId }),
    eventStore.getRecentEvents(threadId, eventWindow, { worldId }),
    eventStore.getRecentAdventureSummaries(threadId, summaryContextLimit, { worldId }),
    eventStore.getRecentReflexEvents(threadId, 6, { worldId })
  ]);

  const scope = { worldId, threadId, primaryPlayer, storedCompanionName, knownPlayers };
  const recentMessages = messages.filter((item) => inConversationScope(item, scope, "speaker"));
  const recentEvents = events.filter((item) => inConversationScope(item, scope, "actor"));
  const recentSummaries = summaries.filter((item) => inPrimarySummaryScope(item, scope));
  const recentReflexEvents = reflexes.filter((item) => inConversationScope(item, scope, "actor"));
  const filteredEvents = recentEvents.filter((event) => event.type !== "adventure_summary");
  const worldSnapshot = captureWorldSnapshot(bot, { focusPlayer: primaryPlayer });
  const playerState = worldSnapshot.player_state;

  return {
    recentMessages,
    recentEvents: filteredEvents,
    recentSummaries,
    recentReflexEvents,
    worldSnapshot,
    playerState,
    systemPrompt: buildSystemPrompt({
      companionName,
      primaryPlayer,
      role,
      personality,
      knownPlayers
    }),
    userPrompt: buildUserPrompt({
      latestMessage,
      speakerName,
      operatorInstruction,
      spatialReferences,
      allowedActions,
      recentMessages,
      recentEvents: filteredEvents,
      recentSummaries,
      recentReflexEvents,
      worldSnapshot,
      playerState,
      retryGuidance,
      feedbackSummary,
      buildStatus
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
