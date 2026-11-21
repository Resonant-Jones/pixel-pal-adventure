const assert = require("node:assert/strict");

const { hasAudience, AUDIENCE_WINDOW_MS } = require("../agent/audience");
const { ReflexWorker } = require("../reflex/reflexWorker");
const { ReflexClassifier } = require("../reflex/reflexClassifier");

// Guardian must not talk to an empty world.
//
// This is the "it just says things randomly even though Minecraft isn't
// playing" bug. The reflex worker had cooldowns but no audience check, and
// the idle detector fired ninety seconds after startup whether or not the
// player had ever been there — so an empty server got "Want to explore the
// area around us?" every few minutes, forever, at the price of a
// speech-provider call each time.

// ------------------------------------------------------------------ the rule

async function testAudienceRule() {
  const now = 1_700_000_000_000;

  // Somebody on the server's player list. That is an audience.
  assert.equal(
    hasAudience({ roster: ["Guardian", "Panda_Nuggetz"], guardianName: "Guardian", now }),
    true,
    "a player on the server is an audience"
  );

  // Only Guardian. Nobody is listening.
  assert.equal(
    hasAudience({ roster: ["Guardian"], guardianName: "Guardian", now }),
    false,
    "Guardian alone is not an audience"
  );

  assert.equal(hasAudience({ roster: [], guardianName: "Guardian", now }), false);

  // The player list has been observed to omit a player who is plainly in the
  // world, so being heard counts on its own.
  assert.equal(
    hasAudience({
      roster: ["Guardian"],
      guardianName: "Guardian",
      speakers: new Map([["Panda_Nuggetz", { at: now - 5000 }]]),
      now
    }),
    true,
    "someone Guardian has just heard is an audience"
  );

  // But not forever. A player who left ten minutes ago is not listening.
  assert.equal(
    hasAudience({
      roster: ["Guardian"],
      guardianName: "Guardian",
      speakers: new Map([["Panda_Nuggetz", { at: now - 10 * 60 * 1000 }]]),
      now
    }),
    false,
    "someone who left long ago is not an audience"
  );

  // The window is a window.
  assert.equal(
    hasAudience({
      roster: [],
      guardianName: "Guardian",
      speakers: new Map([["Panda_Nuggetz", { at: now - AUDIENCE_WINDOW_MS + 1000 }]]),
      now
    }),
    true
  );

  // A companion is not its own audience.
  //
  // This is not a hypothetical. The server echoes the bot's own chat back to
  // it, so Guardian's own voice came round as evidence that a player was
  // present — which let it keep talking to an empty room, on a timer,
  // forever.
  assert.equal(
    hasAudience({
      roster: ["Guardian"],
      guardianName: "Guardian",
      speakers: new Map([["Guardian", { at: now - 1000 }]]),
      now
    }),
    false,
    "Guardian hearing itself is not evidence that anybody is listening"
  );

  // A plugin announcing itself in chat is not a listener either.
  assert.equal(
    hasAudience({
      roster: ["Guardian"],
      guardianName: "Guardian",
      speakers: new Map([["ViaVersion", { at: now - 1000 }]]),
      now
    }),
    false,
    "a plugin is not an audience"
  );

  assert.equal(
    hasAudience({
      roster: ["Guardian", "ViaVersion"],
      guardianName: "Guardian",
      speakers: new Map(),
      now
    }),
    false,
    "a plugin on the player list is not an audience"
  );

  console.log("  ✓ an audience is somebody connected, or somebody just heard");
}

// ------------------------------------------------------------ the worker

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    type: "reflex",
    payload: {
      reflex_type: "creeper_nearby",
      location: { x: 1, y: 2, z: 3 }
    },
    ...overrides
  };
}

function makeWorker({ audience = true, job = makeJob() } = {}) {
  const said = [];
  const completed = [];

  const jobStore = {
    getNextPendingReflexJob: async () => job,
    markRunning: async () => {},
    completeJob: async (id, payload) => {
      completed.push({ id, payload });
    },
    failJob: async () => {}
  };

  const reflexStateStore = {
    getState: async () => null,
    upsertState: async () => {}
  };

  const botAdapter = {
    say: async (message) => {
      said.push(message);
    },
    getSnapshot: () => ({ position: { x: 1, y: 2, z: 3 } })
  };

  const worker = new ReflexWorker({
    botAdapter,
    eventStore: { recordEvent: async () => {} },
    jobStore,
    reflexStateStore,
    threadId: "minecraft:127.0.0.1:25565:panda_nuggetz",
    companionName: "Guardian",
    getWorldContext: () => ({ worldId: "world-1", sessionId: "session-1" }),
    globalCooldownMs: 0,
    perTriggerCooldownMs: 0,
    getReflexPolicy: () => ({ enabled: true, highSalienceOnly: false }),
    hasAudience: () => audience,
    logger: { log() {}, warn() {}, error() {}, info() {} }
  });

  return { worker, said, completed };
}

async function testReflexWorkerRespectsTheRoom() {
  const alone = makeWorker({ audience: false });
  await alone.worker.runOnce();

  assert.equal(alone.said.length, 0, "Guardian must not speak into an empty world");
  assert.equal(alone.completed.length, 1);
  assert.equal(alone.completed[0].payload.suppressed, true);
  assert.equal(
    alone.completed[0].payload.reason,
    "no_audience",
    "the reason has to say why, not just that it was suppressed"
  );

  const watched = makeWorker({ audience: true });
  await watched.worker.runOnce();

  assert.equal(watched.said.length, 1, "with somebody there, Guardian still speaks");
  assert.match(watched.said[0], /creeper/i);
  assert.equal(watched.completed[0].payload.suppressed, false);

  console.log("  ✓ the reflex worker stays quiet when the room is empty");
}

// ---------------------------------------------------------- the classifier

function makeClassifier() {
  const recorded = [];

  const botAdapter = {
    bot: { entity: { position: { x: 1, y: 2, z: 3 } } },
    getPlayerEntity: () => null,
    getSnapshot: () => ({
      position: { x: 1, y: 2, z: 3 },
      health: 20,
      biome: "plains",
      nearby_entities: [],
      nearby_blocks: [],
      time_of_day: "day"
    }),
    config: { username: "Guardian" }
  };

  const classifier = new ReflexClassifier({
    botAdapter,
    eventStore: {
      recordEvent: async (event) => {
        recorded.push(event);
        return event;
      },
      findNearbyMemoryHints: async () => []
    },
    threadId: "thread-1",
    primaryPlayer: "Panda_Nuggetz",
    companionName: "Guardian",
    getWorldContext: () => ({ worldId: "world-1", sessionId: "session-1" }),
    idleThresholdMs: 0,
    logger: { log() {}, warn() {}, error() {}, info() {} }
  });

  return { classifier, recorded };
}

async function testIdleNeedsAPlayerWhoWasThere() {
  const neverThere = makeClassifier();

  // The idle threshold is zero, so "the player has gone quiet" would be
  // detected immediately — except that the player was never here at all.
  await neverThere.classifier.scan("test");
  const idle = neverThere.recorded.find((event) => event.type === "player_idle");
  assert.equal(idle, undefined, "a player who was never there cannot be idle");

  // Once someone has been heard, "they have gone quiet" is a real thing to
  // say to them.
  const wasThere = makeClassifier();
  wasThere.classifier.markPrimaryActivity();
  await wasThere.classifier.scan("test");
  const nowIdle = wasThere.recorded.find((event) => event.type === "player_idle");
  assert.ok(nowIdle, "a player who was there and went quiet can be idle");

  console.log("  ✓ 'the player is idle' needs a player who was actually there");
}

// ------------------------------------------------------------------ run

async function main() {
  console.log("audience");

  await testAudienceRule();
  await testReflexWorkerRespectsTheRoom();
  await testIdleNeedsAPlayerWhoWasThere();

  console.log("  all audience tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
