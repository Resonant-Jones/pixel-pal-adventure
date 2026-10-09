const assert = require("assert");

const { ActionExecutor } = require("../agent/actionExecutor");
const { parseLocationIntent, findBestLabelMatch, scoreLabelMatch, normalizeLabel } = require("../agent/locationIntent");

// --- Tag a spot, then get sent back to it ------------------------------------
//
// Sage: "tag this spot as the diamond cave"  -> remembered
// Sage: "take me back to the diamond cave"   -> teleported
//
// The parse is deterministic and runs before the model, so neither half
// depends on the LLM choosing the right action.

function makeExecutor({ playerPosition = { x: 100, y: 65, z: -200 } } = {}) {
  const anchors = [];
  const teleports = [];
  const said = [];

  const botAdapter = {
    bot: { game: { dimension: "overworld" } },
    getPlayerEntity: () => ({ position: playerPosition }),
    async teleportPlayer(username, position) {
      teleports.push({ username, position });
      return { teleported: true, player: username, position };
    },
    async say(text) { said.push(text); }
  };

  const anchorStore = {
    async createAnchor(anchor) {
      anchors.push(anchor);
      return { id: anchor.id, label: anchor.label, payload: anchor.payload };
    },
    async listAnchors() {
      return anchors.map((a) => ({ id: a.id, label: a.label, type: a.type, payload: a.payload }));
    }
  };

  const executor = new ActionExecutor({
    botAdapter,
    jobStore: {},
    anchorStore,
    getWorldContext: () => ({ worldId: "world:test", sessionId: "s", threadId: "t" }),
    primaryPlayer: "Panda_Nuggetz",
    logger: { warn() {}, error() {}, info() {} }
  });

  return { executor, anchors, teleports, said, botAdapter };
}

// --- parsing -----------------------------------------------------------------

function testParsing() {
  const tags = [
    ["tag this spot as the diamond cave", "the diamond cave"],
    ["mark this place as home base", "home base"],
    ["remember this as the cool hill", "the cool hill"],
    ["call this the treehouse", "the treehouse"],
    ["save this spot as my base", "my base"]
  ];

  for (const [message, expected] of tags) {
    const r = parseLocationIntent(message);
    assert.strictEqual(r.kind, "tag", `"${message}" must parse as a tag`);
    assert.strictEqual(r.label, expected, `"${message}" label`);
  }

  const gotos = [
    ["take me to the diamond cave", "the diamond cave"],
    ["take me back to the diamond cave", "the diamond cave"],
    ["go to home base", "home base"],
    ["return to the cool hill", "the cool hill"],
    ["teleport me to the treehouse", "the treehouse"]
  ];

  for (const [message, expected] of gotos) {
    const r = parseLocationIntent(message);
    assert.strictEqual(r.kind, "goto", `"${message}" must parse as a goto`);
    assert.strictEqual(r.label, expected, `"${message}" label`);
  }

  console.log("  ✓ tagging and recall phrases parse");
}

function testNamelessTagAsksForAName() {
  for (const message of ["tag this spot", "tag this place", "remember this spot", "mark this"]) {
    const r = parseLocationIntent(message);
    assert.strictEqual(r.kind, "tag", `"${message}" is a tag`);
    assert.strictEqual(r.label, null, `"${message}" must not invent a label`);
    assert.strictEqual(r.needsLabel, true, `"${message}" must ask for a name`);
  }

  console.log("  ✓ a nameless tag asks for a name");
}

function testOrdinaryChatIsNotALocationRequest() {
  // The expensive failure here is flinging a child across the map mid-sentence.
  const safe = [
    "hello there",
    "build me a house",
    "take me to bed",
    "what are you doing",
    "i went to the cave yesterday",
    "the cave was cool",
    "where are you"
  ];

  for (const message of safe) {
    const r = parseLocationIntent(message);
    assert.strictEqual(r.kind, null, `"${message}" must NOT trigger a tag or teleport (got ${r.kind})`);
  }

  console.log("  ✓ ordinary chat never triggers a teleport");
}

// --- matching ----------------------------------------------------------------

function testFuzzyMatching() {
  const anchors = [
    { label: "the diamond cave", payload: { position: { x: 1, y: 2, z: 3 } } },
    { label: "home base", payload: { position: { x: 4, y: 5, z: 6 } } },
    { label: "cave entrance near the village", payload: { position: { x: 7, y: 8, z: 9 } } }
  ];

  assert.strictEqual(findBestLabelMatch("the diamond cave", anchors).anchor.label, "the diamond cave");
  assert.strictEqual(findBestLabelMatch("diamond cave", anchors).anchor.label, "the diamond cave");
  assert.strictEqual(findBestLabelMatch("home", anchors).anchor.label, "home base");

  // A phrase covering only part of a longer label should still beat nothing,
  // but a genuinely unknown name must NOT be guessed at.
  assert.strictEqual(findBestLabelMatch("volcano lair", anchors), null, "unknown names must not be guessed");

  console.log("  ✓ matching is fuzzy but refuses to guess");
}

// --- end to end --------------------------------------------------------------

async function testTagThenReturn() {
  const { executor, anchors, teleports } = makeExecutor({ playerPosition: { x: 100, y: 65, z: -200 } });

  // 1. Tag it.
  const tagResult = await executor.execute({
    message: "",
    action: { type: "tag_location", label: "the diamond cave" }
  });

  assert.strictEqual(anchors.length, 1, "must save exactly one anchor");
  assert.strictEqual(anchors[0].label, "the diamond cave");
  assert.strictEqual(anchors[0].worldId, "world:test");
  assert.deepStrictEqual(
    anchors[0].payload.position,
    { x: 100, y: 65, z: -200 },
    "must record where the PLAYER is standing, not the bot"
  );
  assert.ok(tagResult.messageSent, "must confirm out loud");

  // 2. Come back.
  const gotoResult = await executor.execute({
    message: "",
    action: { type: "goto_location", label: "diamond cave" }
  });

  assert.strictEqual(teleports.length, 1, "must teleport exactly once");
  assert.strictEqual(teleports[0].username, "Panda_Nuggetz", "must move the player");
  assert.deepStrictEqual(teleports[0].position, { x: 100, y: 65, z: -200 });
  assert.strictEqual(gotoResult.anchor.found, true);
  assert.strictEqual(gotoResult.anchor.label, "the diamond cave");

  console.log("  ✓ tag then return moves the player to the tagged spot");
}

async function testUnknownLocationIsRefused() {
  const { executor, teleports } = makeExecutor();

  const result = await executor.execute({
    message: "",
    action: { type: "goto_location", label: "the moon base" }
  });

  assert.strictEqual(teleports.length, 0, "must not teleport to an unknown place");
  assert.strictEqual(result.anchor.found, false);
  assert.ok(result.messageSent, "must say it does not know that place");

  console.log("  ✓ an unknown location is refused, not guessed");
}

async function testTagWithoutPlayerIsRefused() {
  const { executor, anchors } = makeExecutor({ playerPosition: null });

  let threw = false;
  try {
    await executor.execute({ message: "", action: { type: "tag_location", label: "nowhere" } });
  } catch (error) {
    threw = true;
    assert.match(error.message, /player is not visible/i);
  }

  assert.ok(threw, "tagging with no visible player must fail loudly");
  assert.strictEqual(anchors.length, 0, "must not save a bogus anchor");

  console.log("  ✓ tagging without a visible player fails loudly");
}

async function testTagWithoutStoreIsRefused() {
  const executor = new ActionExecutor({
    botAdapter: { getPlayerEntity: () => ({ position: { x: 0, y: 0, z: 0 } }) },
    jobStore: {},
    anchorStore: null,
    getWorldContext: () => ({ worldId: "w" }),
    logger: { warn() {} }
  });

  await assert.rejects(
    () => executor.execute({ message: "", action: { type: "tag_location", label: "x" } }),
    /requires anchor storage/
  );

  console.log("  ✓ a missing store fails loudly");
}

(async () => {
  console.log("locationTagging tests");

  testParsing();
  testNamelessTagAsksForAName();
  testOrdinaryChatIsNotALocationRequest();
  testFuzzyMatching();
  await testTagThenReturn();
  await testUnknownLocationIsRefused();
  await testTagWithoutPlayerIsRefused();
  await testTagWithoutStoreIsRefused();

  console.log("locationTagging tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});