const {
  DEFAULT_ALLOWED_ACTIONS,
  buildSystemPrompt,
  buildUserPrompt,
  buildAdventureSummarySystemPrompt,
  buildAdventureSummaryUserPrompt
} = require("../ai/promptBuilder");
const { captureWorldSnapshot } = require("../minecraft/worldSnapshot");
const { playerNameCandidates } = require("../minecraft/playerIdentity");

function inConversationScope(item, { worldId, threadId, primaryPlayer, storedCompanionName }, actorField) {
  if (!worldId || !threadId || item.world_id !== worldId || item.thread_id !== threadId) return false;
  return item[actorField] === storedCompanionName || playerNameCandidates(primaryPlayer).includes(item[actorField]);
}

async function buildContext({
  messageStore,
  eventStore,
  bot,
  threadId,
  worldId,
  latestMessage,
  primaryPlayer,
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

  const scope = { worldId, threadId, primaryPlayer, storedCompanionName };
  const recentMessages = messages.filter((item) => inConversationScope(item, scope, "speaker"));
  const recentEvents = events.filter((item) => inConversationScope(item, scope, "actor"));
  const recentSummaries = summaries.filter((item) => inConversationScope(item, scope, "actor") &&
    playerNameCandidates(primaryPlayer).includes(item.metadata?.primaryPlayer));
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
      personality
    }),
    userPrompt: buildUserPrompt({
      latestMessage,
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
  summaryWindow = 24,
  summaryEventWindow = 12
}) {
  const [messages, events] = await Promise.all([
    messageStore.getRecentMessages(threadId, summaryWindow, { worldId }),
    eventStore.getRecentEvents(threadId, summaryEventWindow, { worldId })
  ]);

  const scope = { worldId, threadId, primaryPlayer, storedCompanionName };
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
