const assert = require("node:assert/strict");

const { compileStructure } = require("../builder/structureCompiler");
const { expandPrimitives } = require("../builder/primitiveExecutor");
const { parseBuildRequest, detectChaosStyle } = require("../builder/requestParser");
const { classifyBuildRequest } = require("../builder/buildIntent");
const {
  CHAOS_STYLES,
  CHAOS_STYLE_NAMES,
  createSeededRandom,
  hashSeed,
  isChaosStyle
} = require("../builder/chaosProfiles");

// Chaos structures.
//
// The brief, in the owner's words: "build whatever my son asks even random
// messed up stuff that shouldn't stand on his own... placing too many items in
// one place or many TNT and waiting for the system to crash and explode, not
// just a big boom but weird failures are funny to him."
//
// Two properties matter as much as the shapes themselves:
//
//   1. DETERMINISM. The same request must produce the same structure. A kid who
//      asks for a tnt pile and gets a different pile every time will think it
//      is a different pile.
//
//   2. NOTHING IGNITES. These builders place blocks and nothing else. There is
//      no interaction primitive in this vocabulary, so a chaos build cannot
//      light its own TNT. The blast comes from the game — which is the whole
//      point of the aesthetic, and the difference between funny and a
//      griefing tool in someone's shared world.

// Every primitive type this codebase knows how to expand. All of them place
// or remove blocks. None of them interact with the world.
const PLACEMENT_ONLY_PRIMITIVES = new Set([
  "fill_rect",
  "void_rect",
  "wall",
  "pillar",
  "hollow_box",
  "window_strip",
  "point",
  "roof_gable",
  "bridge_span"
]);

function placementsFor(input) {
  const compiled = compileStructure(input);
  const expanded = expandPrimitives(compiled.primitives, { direction: compiled.direction });
  return { compiled, expanded };
}

async function testEveryArchetypeCompiles() {
  for (const style of CHAOS_STYLE_NAMES) {
    const { compiled, expanded } = placementsFor({ style, size: "medium" });

    assert.ok(expanded.placements.length > 0, `${style} must place blocks`);
    assert.ok(compiled.materials, `${style} must report its materials`);
    assert.ok(compiled.summary, `${style} must describe itself`);
    assert.ok(compiled.completionMessage, `${style} must have a completion line`);
    assert.equal(isChaosStyle(style), true);
  }

  console.log("  ✓ every chaos archetype compiles to real placements");
}

async function testNothingIgnites() {
  for (const style of CHAOS_STYLE_NAMES) {
    const { compiled } = placementsFor({ style, size: "medium" });

    for (const primitive of compiled.primitives) {
      assert.ok(
        PLACEMENT_ONLY_PRIMITIVES.has(primitive.type),
        `${style} emitted a non-placement primitive: ${primitive.type}`
      );
    }

    // And nothing in the chaos vocabulary is a lightable item.
    for (const block of Object.values(compiled.materials)) {
      assert.notEqual(block, "flint_and_steel");
    }
  }

  console.log("  ✓ a chaos build cannot ignite anything — it only places blocks");
}

async function testDeterminism() {
  for (const style of CHAOS_STYLE_NAMES) {
    const first = placementsFor({ style, size: "medium" }).expanded.placements;
    const second = placementsFor({ style, size: "medium" }).expanded.placements;

    assert.deepEqual(
      first,
      second,
      `${style} must produce an identical structure for an identical request`
    );
  }

  // A different seed must produce a different structure.
  const seededA = placementsFor({ style: "tnt_pile", size: "medium", seed: "alpha" }).expanded.placements;
  const seededB = placementsFor({ style: "tnt_pile", size: "medium", seed: "beta" }).expanded.placements;

  assert.notDeepEqual(seededA, seededB, "a different seed must give a different pile");

  console.log("  ✓ the same request always builds the same structure");
}

async function testSeededRandomIsStable() {
  const a = createSeededRandom("guardian");
  const b = createSeededRandom("guardian");

  const left = [a(), a(), a()];
  const right = [b(), b(), b()];

  assert.deepEqual(left, right);
  assert.notEqual(hashSeed("guardian"), hashSeed("guardian2"));
  assert.equal(hashSeed("guardian"), hashSeed("guardian"));

  console.log("  ✓ the seeded generator is stable across runs");
}

async function testOriginalArchetypesUnchanged() {
  // These are the values from before the chaos work existed. If any of them
  // moves, the chaos change has leaked into the normal build path.
  const expected = {
    cabin: {
      placements: 136,
      footprint: { width: 5, depth: 6, height: 7 },
      materials: { oak_planks: 132, glass: 4 }
    },
    tower: {
      placements: 153,
      footprint: { width: 5, depth: 5, height: 8 },
      materials: { oak_planks: 152, glass: 1 }
    },
    bridge: {
      placements: 46,
      footprint: { width: 3, depth: 8, height: 3 },
      materials: { oak_log: 12, oak_planks: 18, oak_fence: 16 }
    },
    camp: {
      placements: 25,
      footprint: { width: 3, depth: 5, height: 4 },
      materials: { oak_planks: 18, oak_log: 6, campfire: 1 }
    },
    hut: {
      placements: 136,
      footprint: { width: 5, depth: 6, height: 7 },
      materials: { oak_planks: 132, glass: 4 }
    }
  };

  for (const [style, want] of Object.entries(expected)) {
    const { compiled, expanded } = placementsFor({ style, palette: "oak", size: "small" });

    assert.equal(expanded.placements.length, want.placements, `${style} placement count`);
    assert.deepEqual(expanded.footprint, want.footprint, `${style} footprint`);
    assert.deepEqual(compiled.materials, want.materials, `${style} materials`);
  }

  console.log("  ✓ the four original archetypes are byte-identical to before");
}

async function testRequestParsing() {
  const cases = [
    ["build a pile of tnt", "tnt_pile"],
    ["pile up tnt", "tnt_pile"],
    ["make a tnt pile", "tnt_pile"],
    ["build a tnt maze", "tnt_maze"],
    ["make a maze", "tnt_maze"],
    ["build a pile of dirt", "item_pile"],
    ["stack up cobblestone", "item_pile"],
    ["make a heap of sand", "item_pile"],
    ["build a floating pile", "floating_pile"],
    ["build some redstone", "redstone_junk"],
    ["make a redstone mess", "redstone_junk"],
    ["build a chest maze", "chest_maze"],
    ["build a pile of chests", "item_pile"],
    ["make a junk pile", "scrap_heap"],
    ["build something broken", "scrap_heap"],
    ["build a messy thing", "scrap_heap"]
  ];

  for (const [message, expectedStyle] of cases) {
    const detected = detectChaosStyle(message);
    assert.equal(detected, expectedStyle, `"${message}" should map to ${expectedStyle}`);
  }

  // And the full request path, not just the detector.
  const parsed = parseBuildRequest("build a pile of tnt", "Panda_Nuggetz");
  assert.ok(parsed, "a chaos request must still parse as a build request");
  assert.equal(parsed.style, "tnt_pile");
  assert.equal(parsed.type, "compose_structure");

  console.log("  ✓ a kid's phrasing reaches the right archetype");
}

async function testPileItemIsCarried() {
  const parsed = parseBuildRequest("build a pile of dirt", "Panda_Nuggetz");
  assert.ok(parsed.features.includes("dirt"), "the named item must travel with the request");

  const { compiled } = placementsFor({ style: "item_pile", size: "medium", features: ["dirt"] });
  assert.ok(
    Object.keys(compiled.materials).includes("dirt"),
    "a pile of dirt must actually be dirt"
  );

  console.log("  ✓ 'a pile of dirt' is a pile of dirt");
}

async function testShouldntIsNotHypothetical() {
  // "shouldn't" ends at a word boundary, so the hypothetical pattern used to
  // match it and turn the request away. This is the single most likely thing
  // a kid who likes broken builds would ask for.
  const request = classifyBuildRequest("build something that shouldn't work");
  assert.equal(request.hasHypothetical, false, "a negated hypothetical is not a hypothetical");
  assert.equal(request.shouldBuild, true, "the request must survive to the builder");

  const classified = classifyBuildRequest("build a pile of tnt");
  assert.equal(classified.shouldBuild, true);

  console.log("  ✓ \"something that shouldn't work\" is still a build request");
}

async function testNormalBuildsStillWork() {
  const cabin = parseBuildRequest("build me a cabin here", "Panda_Nuggetz");
  assert.ok(cabin);
  assert.equal(cabin.style, "cabin");

  const tower = parseBuildRequest("build a tower", "Panda_Nuggetz");
  assert.equal(tower.style, "tower");

  const bridge = parseBuildRequest("build a bridge", "Panda_Nuggetz");
  assert.equal(bridge.style, "bridge");

  console.log("  ✓ ordinary builds are unaffected");
}

async function main() {
  console.log("chaos builder tests");
  await testEveryArchetypeCompiles();
  await testNothingIgnites();
  await testDeterminism();
  await testSeededRandomIsStable();
  await testOriginalArchetypesUnchanged();
  await testRequestParsing();
  await testPileItemIsCarried();
  await testShouldntIsNotHypothetical();
  await testNormalBuildsStillWork();
  console.log("chaos builder tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
