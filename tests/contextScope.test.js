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

  // A second player must stay in memory. Filtering every message to the primary
  // player alone made a friend invisible, which read to the kids as the bot
  // ignoring whoever was not the "main" player.
  const friendMessages = [
    { ...base, speaker: ".Marallren", content: "FRIEND_SAYS_HELLO" },
    { ...base, speaker: "Guardian", content: "FRIEND_REPLY" }
  ];
  const friendContext = await buildContext({
    ...options,
    knownPlayers: ["Panda_Nuggetz", ".Marallren"],
    messageStore: { getRecentMessages: async () => friendMessages }
  });
  assert.equal(friendContext.recentMessages.length, 2, "a known player's messages stay in scope");
  assert.match(friendContext.userPrompt, /FRIEND_SAYS_HELLO/);
  assert.match(friendContext.userPrompt, /FRIEND_REPLY/);

  // An unknown outsider is still excluded.
  const outsider = await buildContext({
    ...options,
    knownPlayers: ["Panda_Nuggetz", ".Marallren"],
    messageStore: { getRecentMessages: async () => [{ ...base, speaker: "Stranger", content: "PRIVATE_OUTSIDER" }] }
  });
  assert.deepEqual(outsider.recentMessages, [], "players outside the session stay out of memory");

  // A summary owned by a known player is in scope; one owned by nobody is not.
  const friendSummary = await buildContext({
    ...options,
    knownPlayers: ["Panda_Nuggetz", ".Marallren"],
    eventStore: {
      getRecentEvents: async () => [],
      getRecentAdventureSummaries: async () => [
        { ...base, actor: "Guardian", description: "FRIEND_SUMMARY", metadata: { primaryPlayer: ".Marallren" } }
      ],
      getRecentReflexEvents: async () => []
    }
  });
  assert.equal(friendSummary.recentSummaries.length, 1, "a friend's summary is remembered");

  console.log("context scope tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
