// builder/chaosProfiles.js
//
// Deliberately broken structures.
//
// The owner's son does not want architecture. He wants the game to misbehave in
// interesting ways — "placing too many items in one place or many TNT and
// waiting for the system to crash and explode, not just a big boom but weird
// failures are funny to him." That is a design brief, not a bug report.
//
// So these archetypes do not stand up, do not enclose, and do not work. A pile
// of TNT is a pile of TNT. A chest maze with one sealed chest is a chest maze
// where one chest is sealed. The comedy is in the failure, and the failure is
// supposed to be the game's, not ours.
//
// ONE HARD RULE: these builders PLACE BLOCKS AND NOTHING ELSE.
//
// There is no interaction primitive in this vocabulary — no flint and steel, no
// redstone torch being switched on, no explosion, no fire. Every primitive here
// is a placement or a removal. Guardian builds the mess and never lights it.
// The blast comes from the game, which is the entire point of the aesthetic, and
// it is also the difference between this being funny and this being a griefing
// tool in someone's shared world.
//
// DETERMINISM: the same request must produce the same structure, every time.
// A kid who asks for a TNT pile and gets a different pile every time will think
// it is a different pile, and a kid who rebuilds the same pile expects it to
// match. Every random choice here comes from a seeded PRNG, never Math.random.

const CHAOS_BLOCKS = Object.freeze({
  tnt: "tnt",
  redstoneWire: "redstone_wire",
  redstoneTorch: "redstone_torch",
  lever: "lever",
  chest: "chest",
  stone: "stone",
  cobblestone: "cobblestone",
  dirt: "dirt",
  sand: "sand",
  gravel: "gravel",
  glass: "glass",
  bone: "bone_block",
  slime: "slime_block",
  sponge: "sponge",
  pumpkin: "pumpkin",
  hay: "hay_block",
  wool: "white_wool",
  obsidian: "obsidian",
  magma: "magma_block",
  cobweb: "cobweb"
});

// Items a kid is likely to pile up. Order is stable so the seed picks by index.
const PILE_BLOCKS = Object.freeze([
  CHAOS_BLOCKS.cobblestone,
  CHAOS_BLOCKS.dirt,
  CHAOS_BLOCKS.sand,
  CHAOS_BLOCKS.gravel,
  CHAOS_BLOCKS.glass,
  CHAOS_BLOCKS.bone,
  CHAOS_BLOCKS.slime,
  CHAOS_BLOCKS.sponge,
  CHAOS_BLOCKS.stone,
  CHAOS_BLOCKS.chest
]);

const SCRAP_BLOCKS = Object.freeze([
  CHAOS_BLOCKS.stone,
  CHAOS_BLOCKS.cobblestone,
  CHAOS_BLOCKS.dirt,
  CHAOS_BLOCKS.sand,
  CHAOS_BLOCKS.glass,
  CHAOS_BLOCKS.pumpkin,
  CHAOS_BLOCKS.hay,
  CHAOS_BLOCKS.wool,
  CHAOS_BLOCKS.slime,
  CHAOS_BLOCKS.bone,
  CHAOS_BLOCKS.gravel,
  CHAOS_BLOCKS.cobweb
]);

// Grid side length per size preset.
const GRID_BY_SIZE = Object.freeze({ tiny: 3, small: 5, medium: 7, large: 9 });

// The catalogue. Each entry carries the defaults the style resolver needs, a
// description for the build summary, and the completion line the child sees.
const CHAOS_STYLES = Object.freeze({
  tnt_pile: {
    palette: "oak",
    size: "medium",
    features: [],
    description: "pile of TNT in one place",
    completion: "Piled. I did not light it — that's your job."
  },
  item_pile: {
    palette: "oak",
    size: "medium",
    features: [],
    description: "stack of one item, absurdly tall",
    completion: "That's a lot of one thing. Genuinely a lot."
  },
  tnt_maze: {
    palette: "oak",
    size: "medium",
    features: [],
    description: "lattice of TNT walls and corridors",
    completion: "Maze's up. One spark does the rest."
  },
  floating_pile: {
    palette: "oak",
    size: "small",
    features: [],
    description: "heap with no support under it",
    completion: "That should not be floating. It is anyway."
  },
  redstone_junk: {
    palette: "oak",
    size: "small",
    features: [],
    description: "redstone that leads nowhere",
    completion: "Wired. It does not do anything. Lovely."
  },
  chest_maze: {
    palette: "oak",
    size: "small",
    features: [],
    description: "grid of chests, one sealed in",
    completion: "Every chest opens. Except one. You'll find it."
  },
  scrap_heap: {
    palette: "oak",
    size: "small",
    features: [],
    description: "heap of unrelated junk",
    completion: "Piled. I don't know what any of it is for."
  }
});

const CHAOS_STYLE_NAMES = Object.freeze(Object.keys(CHAOS_STYLES));

// FNV-1a. Small, fast, and stable across runs — which is the only property
// that matters here.
function hashSeed(value) {
  const text = String(value ?? "");

  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

// mulberry32. A tiny, well-distributed PRNG.
function createSeededRandom(seed) {
  let state = hashSeed(seed) >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  if (!values.length) {
    return null;
  }

  return values[Math.floor(random() * values.length) % values.length];
}

function gridFor(plan) {
  return GRID_BY_SIZE[plan.size] || GRID_BY_SIZE.medium;
}

// The item a pile is made of, when the request named one. "a pile of dirt"
// should be dirt.
function resolvePileBlock(plan, random) {
  const named = (plan.features || []).find((feature) => PILE_BLOCKS.includes(feature));
  return named || pick(random, PILE_BLOCKS);
}

// --- the archetypes -------------------------------------------------------

// A cluster of TNT columns, all different heights, all in one place. The
// shape you get when you keep shifting TNT down.
function buildTntPile(plan, random) {
  const grid = gridFor(plan);
  const half = Math.floor(grid / 2);
  const primitives = [];

  for (let x = 0; x < grid; x += 1) {
    for (let z = 0; z < grid; z += 1) {
      const distance = Math.abs(x - half) + Math.abs(z - half);
      const centreBoost = distance === 0 ? 4 : 0;
      const height = Math.max(1, Math.round(random() * 4) + centreBoost);

      primitives.push({
        type: "pillar",
        base: { x, y: 0, z },
        height,
        block: CHAOS_BLOCKS.tnt
      });
    }
  }

  return primitives;
}

// One item type, as tall as the bot will go. This is the "too many items in
// one place" shape: a single column with a skirt of the same thing around it.
function buildItemPile(plan, random) {
  const block = resolvePileBlock(plan, random);
  const grid = gridFor(plan);
  const half = Math.floor(grid / 2);
  const height = 12 + Math.round(random() * 12) + half * 2;
  const primitives = [
    {
      type: "pillar",
      base: { x: half, y: 0, z: half },
      height,
      block
    }
  ];

  // A low skirt of the same block, so it reads as a pile rather than a pillar.
  const skirt = 1 + Math.round(random() * 2);

  for (let x = 0; x < grid; x += 1) {
    for (let z = 0; z < grid; z += 1) {
      if (x === half && z === half) {
        continue;
      }

      if (Math.abs(x - half) + Math.abs(z - half) > skirt) {
        continue;
      }

      primitives.push({
        type: "pillar",
        base: { x, y: 0, z },
        height: Math.max(1, Math.round(random() * 2)),
        block
      });
    }
  }

  return primitives;
}

// Walls of TNT with gaps to walk through. One ignition and it all goes at
// once, in a shape nobody planned.
function buildTntMaze(plan, random) {
  const grid = gridFor(plan);
  const primitives = [];
  const wallHeight = 2 + Math.round(random() * 2);

  for (let x = 0; x < grid; x += 1) {
    for (let z = 0; z < grid; z += 1) {
      // A lattice, not a maze: alternating walls with gaps. A genuine maze
      // would need a solver, and the point here is that it looks like one and
      // is not.
      const onWall = (x + z) % 2 === 0;

      if (!onWall) {
        continue;
      }

      // Punch a random hole in every third wall segment.
      if (random() < 0.33) {
        continue;
      }

      primitives.push({
        type: "fill_rect",
        start: { x, y: 0, z },
        end: { x, y: wallHeight - 1, z },
        block: CHAOS_BLOCKS.tnt
      });
    }
  }

  // A cache of loose TNT in the middle, for the benefit of anyone who survives
  // long enough to reach it.
  primitives.push({
    type: "fill_rect",
    start: { x: Math.floor(grid / 2) - 1, y: 0, z: Math.floor(grid / 2) - 1 },
    end: { x: Math.floor(grid / 2), y: 1, z: Math.floor(grid / 2) },
    block: CHAOS_BLOCKS.tnt
  });

  return primitives;
}

// A heap that starts in mid-air. The comedy is that Minecraft will not
// correct it.
function buildFloatingPile(plan, random) {
  const grid = gridFor(plan);
  const half = Math.floor(grid / 2);
  const lift = 4 + Math.round(random() * 4);
  const primitives = [];

  for (let x = 0; x < grid; x += 1) {
    for (let z = 0; z < grid; z += 1) {
      const distance = Math.abs(x - half) + Math.abs(z - half);
      const height = Math.max(1, grid - distance);

      if (height <= 0) {
        continue;
      }

      primitives.push({
        type: "pillar",
        base: { x, y: lift, z },
        height,
        block: pick(random, SCRAP_BLOCKS)
      });
    }
  }

  // One thin stalk that stops just short of the ground, so the thing is
  // almost supported. "Almost" is the joke.
  primitives.push({
    type: "pillar",
    base: { x: half, y: 1, z: half },
    height: Math.max(1, lift - 1),
    block: CHAOS_BLOCKS.obsidian
  });

  return primitives;
}

// Redstone that goes nowhere. Runs of wire, torches, a lever, and a repeated
// shape that never closes a circuit.
function buildRedstoneJunk(plan, random) {
  const grid = gridFor(plan);
  const primitives = [];

  for (let z = 0; z < grid; z += 1) {
    for (let x = 0; x < grid; x += 1) {
      // Wire only along the edges, so the runs look deliberate and connect to
      // nothing.
      const onEdge = x === 0 || z === 0 || x === grid - 1 || z === grid - 1;

      if (!onEdge || random() < 0.2) {
        continue;
      }

      primitives.push({
        type: "point",
        position: { x, y: 0, z },
        block: CHAOS_BLOCKS.redstoneWire
      });
    }
  }

  // Torches standing on the wire, plus levers that control nothing.
  const torchCount = 2 + Math.round(random() * 4);

  for (let i = 0; i < torchCount; i += 1) {
    primitives.push({
      type: "point",
      position: {
        x: Math.floor(random() * grid),
        y: 1,
        z: Math.floor(random() * grid)
      },
      block: CHAOS_BLOCKS.redstoneTorch
    });
  }

  const leverCount = 1 + Math.round(random() * 3);

  for (let i = 0; i < leverCount; i += 1) {
    primitives.push({
      type: "point",
      position: {
        x: Math.floor(random() * grid),
        y: 0,
        z: Math.floor(random() * grid)
      },
      block: CHAOS_BLOCKS.lever
    });
  }

  return primitives;
}

// A grid of chests separated by walls, with one cell sealed off. Every chest
// opens except the one, and finding that one is the whole game.
function buildChestMaze(plan, random) {
  const grid = gridFor(plan);
  const half = Math.floor(grid / 2);
  const primitives = [];
  const sealed = {
    x: Math.floor(random() * grid),
    z: Math.floor(random() * grid)
  };

  for (let x = 0; x < grid; x += 1) {
    for (let z = 0; z < grid; z += 1) {
      const isWall = x % 2 === 0 || z % 2 === 0;

      if (isWall) {
        primitives.push({
          type: "fill_rect",
          start: { x, y: 0, z },
          end: { x, y: 2, z },
          block: CHAOS_BLOCKS.cobblestone
        });
        continue;
      }

      if (x === sealed.x && z === sealed.z) {
        // The sealed one. Cobblestone where the chest should be.
        primitives.push({
          type: "fill_rect",
          start: { x, y: 0, z },
          end: { x, y: 2, z },
          block: CHAOS_BLOCKS.cobblestone
        });
        continue;
      }

      primitives.push({
        type: "point",
        position: { x, y: 0, z },
        block: CHAOS_BLOCKS.chest
      });
    }
  }

  // A chest on top of the sealed cell, so there is something to find.
  primitives.push({
    type: "point",
    position: { x: sealed.x, y: 3, z: sealed.z },
    block: CHAOS_BLOCKS.chest
  });

  // A single chest out in the open, as a decoy.
  primitives.push({
    type: "point",
    position: { x: half, y: 0, z: grid + 1 },
    block: CHAOS_BLOCKS.chest
  });

  return primitives;
}

// A mound of unrelated junk. Nothing here goes together, which is the point.
function buildScrapHeap(plan, random) {
  const grid = gridFor(plan);
  const half = Math.floor(grid / 2);
  const primitives = [];

  for (let x = 0; x < grid; x += 1) {
    for (let z = 0; z < grid; z += 1) {
      const distance = Math.abs(x - half) + Math.abs(z - half);
      const height = Math.max(0, half - distance + 1 + Math.round(random() * 2));

      if (height <= 0) {
        continue;
      }

      primitives.push({
        type: "pillar",
        base: { x, y: 0, z },
        height,
        block: pick(random, SCRAP_BLOCKS)
      });
    }
  }

  return primitives;
}

const BUILDERS = {
  tnt_pile: buildTntPile,
  item_pile: buildItemPile,
  tnt_maze: buildTntMaze,
  floating_pile: buildFloatingPile,
  redstone_junk: buildRedstoneJunk,
  chest_maze: buildChestMaze,
  scrap_heap: buildScrapHeap
};

// The seed. An explicit one wins; otherwise it is derived from the plan, so
// the same shape always produces the same structure.
function resolveSeed(plan) {
  if (plan.seed !== undefined && plan.seed !== null && plan.seed !== "") {
    return String(plan.seed);
  }

  return [plan.style, plan.size, plan.paletteName, plan.direction, (plan.features || []).join(",")].join("|");
}

function buildChaosPrimitives(plan) {
  const builder = BUILDERS[plan.style];

  if (!builder) {
    return [];
  }

  const random = createSeededRandom(resolveSeed(plan));
  return builder(plan, random);
}

function isChaosStyle(style) {
  return Object.hasOwn(CHAOS_STYLES, style);
}

module.exports = {
  CHAOS_BLOCKS,
  CHAOS_STYLES,
  CHAOS_STYLE_NAMES,
  PILE_BLOCKS,
  SCRAP_BLOCKS,
  buildChaosPrimitives,
  createSeededRandom,
  hashSeed,
  isChaosStyle,
  resolveSeed
};
