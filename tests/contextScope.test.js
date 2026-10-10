const assert = require("node:assert/strict");
const { buildContext, buildAdventureSummaryContext } = require("../agent/contextBuilder");

async function main() {
  const base = { thread_id: "player-thread", world_id: "world" };
  const messages = [
    { ...base, speaker: ".Panda_Nuggetz", content: "our cave" },
    { ...base, speaker: "Guardian", content: "our reply" },
    { ...base, speaker: "OtherPlayer", content: "PRIVATE_OTHER_PLAYER" },
    { ...base, thread_id: "other-thread", speaker: "Panda_Nuggetz", content: "PRIVATE_OTHER_THREAD" },
    { ...base, world_id: "other-world", speaker: "Panda_Nuggetz", content: "PRIVATE_OTHER_WORLD" }
  ];
  const events = [
    { ...base, actor: "Panda_Nuggetz", description: "found a cave", type: "discovery" },
    { ...base, actor: "OtherPlayer", description: "PRIVATE_OTHER_EVENT", type: "chat_observed" }
  ];
  const summaries = [
    { ...base, actor: "Guardian", description: "our summary", metadata: { primaryPlayer: "Panda_Nuggetz" } },
    { ...base, actor: "Guardian", description: "PRIVATE_UNOWNED_SUMMARY" },
    { ...base, actor: "Guardian", description: "PRIVATE_OTHER_SUMMARY", metadata: { primaryPlayer: "OtherPlayer" } }
  ];
  const options = {
    threadId: "player-thread", worldId: "world", primaryPlayer: "Panda_Nuggetz",
    companionName: "NewName", storedCompanionName: "Guardian", bot: null,
    messageStore: { getRecentMessages: async () => messages },
    eventStore: {
      getRecentEvents: async () => events,
      getRecentAdventureSummaries: async () => summaries,
      getRecentReflexEvents: async () => []
    },
    latestMessage: "hello"
  };
  const context = await buildContext(options);
  assert.equal(context.recentMessages.length, 2);
  assert.equal(context.recentSummaries.length, 1);
  assert.match(context.userPrompt, /our cave/);
  assert.match(context.userPrompt, /our reply/);
  assert.match(context.userPrompt, /our summary/);
  assert.doesNotMatch(context.userPrompt, /PRIVATE_/);
  const summaryContext = await buildAdventureSummaryContext(options);
  assert.doesNotMatch(summaryContext.userPrompt, /PRIVATE_/);
  const unavailable = await buildContext({ ...options, worldId: null });
  assert.deepEqual(unavailable.recentMessages, []);
  console.log("context scope tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
