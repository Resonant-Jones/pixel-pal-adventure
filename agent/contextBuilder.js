const {
  buildSystemPrompt,
  buildUserPrompt,
  buildAdventureSummarySystemPrompt,
  buildAdventureSummaryUserPrompt
} = require("../ai/promptBuilder");
const { captureWorldSnapshot } = require("../minecraft/worldSnapshot");

async function buildContext({
  messageStore,
  eventStore,
  bot,
  threadId,
  worldId,
  latestMessage,
  primaryPlayer,
  companionName,
  role,
  personality,
  memoryWindow = 12,
  eventWindow = 6,
  summaryContextLimit = 3,
  retryGuidance = null,
  feedbackSummary = null
}) {
  const [recentMessages, recentEvents, recentSummaries, recentReflexEvents] = await Promise.all([
    messageStore.getRecentMessages(threadId, memoryWindow, { worldId }),
    eventStore.getRecentEvents(threadId, eventWindow, { worldId }),
    eventStore.getRecentAdventureSummaries(threadId, summaryContextLimit, { worldId }),
    eventStore.getRecentReflexEvents(threadId, 6, { worldId })
  ]);

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
      recentMessages,
      recentEvents: filteredEvents,
      recentSummaries,
      recentReflexEvents,
      worldSnapshot,
      playerState,
      retryGuidance,
      feedbackSummary
    })
  };
}

async function buildAdventureSummaryContext({
  messageStore,
  eventStore,
  threadId,
  worldId,
  companionName,
  primaryPlayer,
  summaryWindow = 24,
  summaryEventWindow = 12
}) {
  const [recentMessages, recentEvents] = await Promise.all([
    messageStore.getRecentMessages(threadId, summaryWindow, { worldId }),
    eventStore.getRecentEvents(threadId, summaryEventWindow, { worldId })
  ]);

  const filteredEvents = recentEvents.filter((event) => event.type !== "adventure_summary");

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
