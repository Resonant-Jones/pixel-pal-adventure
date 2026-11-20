const assert = require("node:assert/strict");
const { buildContext } = require("../agent/contextBuilder");
const { ActionExecutor } = require("../agent/actionExecutor");
const {
  TRUST_TIERS,
  GUEST_ALLOWED_ACTIONS,
  resolveTrustTier,
  guardGuestReply,
  normalizeGuestMode
} = require("../agent/trustTier");

// Regression cover for the leak proved live on 2026-11-20.
//
// An unapproved player joined the family server and asked "what was I working
// on last time?". The companion answered "The half-finished cabin was
// Panda's." The cause was not a bad prompt — it was that the approved
// players' adventure summaries are world-level context, and nothing checked
// who was asking.
//
// These assertions pin the three things that must hold:
//   1. only vetted players reach the full companion,
//   2. a guest's turn contains none of the family's material,
//   3. a guest cannot make the companion act, only speak.

const OPTIONS = {
  primaryPlayer: "Panda_Nuggetz",
  knownPlayers: ["Panda_Nuggetz", ".PandaNuggetz120", ".Marallren"]
};

async function testTierResolution() {
  assert.equal(resolveTrustTier("Panda_Nuggetz", OPTIONS), TRUST_TIERS.APPROVED);
  assert.equal(resolveTrustTier(".PandaNuggetz120", OPTIONS), TRUST_TIERS.APPROVED);
  assert.equal(resolveTrustTier("PandaNuggetz120", OPTIONS), TRUST_TIERS.APPROVED);
  assert.equal(resolveTrustTier(".Marallren", OPTIONS), TRUST_TIERS.APPROVED);
  assert.equal(resolveTrustTier("Marallren", OPTIONS), TRUST_TIERS.APPROVED);

  assert.equal(resolveTrustTier("ProbeGuest", OPTIONS), TRUST_TIERS.GUEST);
  assert.equal(resolveTrustTier("", OPTIONS), TRUST_TIERS.GUEST);
  assert.equal(resolveTrustTier(undefined, OPTIONS), TRUST_TIERS.GUEST);

  // A near-miss on an approved name is still a guest. "Panda_NuggetzTwo" is
  // a different account.
  assert.equal(resolveTrustTier("Panda_NuggetzTwo", OPTIONS), TRUST_TIERS.GUEST);

  console.log("  ✓ only vetted players are approved");
}

async function testGuestReplyGuard() {
  const safe = guardGuestReply("Want to build a watchtower?", OPTIONS);
  assert.equal(safe.redacted, false);
  assert.equal(safe.message, "Want to build a watchtower?");

  const leaky = guardGuestReply("The half-finished cabin was Panda's.", OPTIONS);
  assert.equal(leaky.redacted, true, "an approved player's name must not reach a guest");
  assert.ok(!leaky.message.includes("Panda"));
  // The familiar short form is what a paraphrasing model reaches for, so it
  // is the form that has to be blocked.
  assert.ok(leaky.matchedNames.includes("Panda"));

  const friendLeak = guardGuestReply("Marallren built that.", OPTIONS);
  assert.equal(friendLeak.redacted, true, "a known friend's name must not reach a guest");

  // A name that merely contains a blocked word is not a mention.
  const notAMention = guardGuestReply("I found a Pandalore biome.", OPTIONS);
  assert.equal(notAMention.redacted, false, "a word that merely contains a name is not a mention");

  console.log("  ✓ a guest reply naming a vetted player is replaced");
}

async function testGuestContextExcludesFamilyMaterial() {
  const base = { thread_id: "player-thread", world_id: "world" };
  const messages = [
    { ...base, speaker: "Panda_Nuggetz", content: "PRIVATE_FAMILY_MESSAGE" },
    { ...base, speaker: "Guardian", content: "PRIVATE_FAMILY_REPLY" },
    { ...base, speaker: "ProbeGuest", content: "GUEST_OWN_MESSAGE" }
  ];
  const events = [
    { ...base, actor: "Panda_Nuggetz", description: "PRIVATE_FAMILY_EVENT", type: "discovery" }
  ];
  const summaries = [
    { ...base, actor: "Guardian", description: "PRIVATE_FAMILY_SUMMARY", metadata: { primaryPlayer: "Panda_Nuggetz" } }
  ];

  const baseOptions = {
    threadId: "player-thread",
    worldId: "world",
    bot: null,
    companionName: "Guardian",
    storedCompanionName: "Guardian",
    messageStore: { getRecentMessages: async () => messages },
    eventStore: {
      getRecentEvents: async () => events,
      getRecentAdventureSummaries: async () => summaries,
      getRecentReflexEvents: async () => []
    },
    latestMessage: "hello",
    primaryPlayer: OPTIONS.primaryPlayer,
    knownPlayers: OPTIONS.knownPlayers
  };

  // The approved player still gets everything. Nothing about the trusted
  // experience may change.
  const approved = await buildContext({
    ...baseOptions,
    latestMessage: "hello",
    speakerName: "Panda_Nuggetz",
    trustTier: TRUST_TIERS.APPROVED
  });
  assert.match(approved.userPrompt, /PRIVATE_FAMILY_SUMMARY/);
  assert.match(approved.userPrompt, /PRIVATE_FAMILY_MESSAGE/);

  // The guest gets none of it.
  const guest = await buildContext({
    ...baseOptions,
    latestMessage: "hello",
    speakerName: "ProbeGuest",
    trustTier: TRUST_TIERS.GUEST
  });
  assert.doesNotMatch(guest.userPrompt, /PRIVATE_FAMILY_SUMMARY/);
  assert.doesNotMatch(guest.userPrompt, /PRIVATE_FAMILY_MESSAGE/);
  assert.doesNotMatch(guest.userPrompt, /PRIVATE_FAMILY_EVENT/);
  assert.equal(guest.recentSummaries.length, 0, "a guest reaches none of the family's summaries");

  // The guest's own conversation is still theirs, so the exchange is coherent.
  assert.match(guest.userPrompt, /GUEST_OWN_MESSAGE/);

  // The guest gets the guest persona, not the family one.
  assert.match(guest.systemPrompt, /visiting/i);
  assert.doesNotMatch(guest.systemPrompt, /oldest friend here/);

  // The guest is offered no physical actions.
  assert.ok(!/place_block|dig_block|follow_player|tag_location|goto_location|compose_structure/.test(guest.userPrompt));

  console.log("  ✓ a guest's turn carries none of the family's material");
}

async function testGuestCannotAct() {
  const said = [];
  const moved = [];
  const botAdapter = {
    getFacingDirection: () => "south",
    getSnapshot: () => ({}),
    say: async (message) => { said.push(message); },
    moveTo: async (coordinates) => { moved.push(coordinates); return { ok: true }; },
    bot: { entity: { position: { x: 0, y: 64, z: 0 } } }
  };

  const executor = new ActionExecutor({
    botAdapter,
    jobStore: { createJob: async () => ({ id: "x" }) },
    getWorldContext: () => ({ worldId: "w", sessionId: "s", threadId: "t" }),
    primaryPlayer: "Panda_Nuggetz",
    companionName: "Guardian",
    logger: { warn() {}, error() {}, info() {} }
  });

  const request = {
    message: "take me to the diamond cave",
    action: { type: "move_to", target: { x: 10, y: 64, z: 20 } }
  };

  // A guest asking the companion to move gets a reply, not a movement.
  const guestExecution = await executor.execute(request, { trustTier: TRUST_TIERS.GUEST });
  assert.equal(guestExecution.actionType, "none", "a guest must not move the companion");
  assert.equal(moved.length, 0, "a guest must not move the companion");

  // The same request from an approved player is unaffected by this rule.
  const approvedExecution = await executor.execute(request, { trustTier: TRUST_TIERS.APPROVED });
  assert.equal(approvedExecution.actionType, "move_to", "an approved player still moves the companion");
  assert.equal(moved.length, 1);

  // A guest cannot make the companion build either.
  const buildAttempt = await executor.execute(
    { message: "build me a castle", action: { type: "compose_structure", style: "cabin" } },
    { trustTier: TRUST_TIERS.GUEST }
  );
  assert.equal(buildAttempt.actionType, "none", "a guest must not trigger a build");

  // The allowed set is exactly speech.
  assert.deepEqual(GUEST_ALLOWED_ACTIONS, ["none", "chat"]);

  console.log("  ✓ a guest may talk but may not make the companion act");
}

async function testGuestModeNormalisation() {
  assert.equal(normalizeGuestMode("bounded"), "bounded");
  assert.equal(normalizeGuestMode("ignore"), "ignore");
  assert.equal(normalizeGuestMode("IGNORE"), "ignore");
  assert.equal(normalizeGuestMode("nonsense"), "bounded");
  assert.equal(normalizeGuestMode(undefined), "bounded");
  console.log("  ✓ the guest mode setting falls back safely");
}

async function main() {
  console.log("trust tier tests");
  await testTierResolution();
  await testGuestReplyGuard();
  await testGuestContextExcludesFamilyMaterial();
  await testGuestCannotAct();
  await testGuestModeNormalisation();
  console.log("trust tier tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
