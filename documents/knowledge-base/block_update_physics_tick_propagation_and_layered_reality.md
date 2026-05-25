# Minecraft Agent Knowledge Object: Block Update Physics, Tick Propagation, and Layered Reality

## Source

- Video: "Nobody Realized Minecraft Was Connected Like This" by RedLogic
- Core claim: Minecraft is not continuously simulated at every block. It is an event-driven, tick-based, layered system where blocks react when updates, scheduled ticks, random ticks, or validation packets cause them to re-evaluate.
- Source transcript: The video explains five "laws of reality" in Minecraft: block updates, tick snapshots, random ticks, non-uniform update propagation, and client-server desync behavior. :contentReference[oaicite:0]{index=0}

---

## Executive Summary

Minecraft should be understood as a distributed event system rather than a continuously simulated physical world.

Blocks generally do not poll their surroundings every moment. Instead, the world changes through discrete events: block placement, block breaking, state changes, scheduled updates, random ticks, redstone-specific propagation, entity interactions, and client-server validation. These events cause affected blocks to re-evaluate their own validity or behavior.

For a Minecraft Agent, this means the world should not be modeled only as a static snapshot of nearby blocks. It should be modeled as a reactive graph of possible cascades. The agent should learn not only "what exists nearby," but also "what will update if this block changes," "which mechanics propagate signal farther than normal," "which blocks are waiting for a trigger," and "where client/server reality may disagree."

This knowledge is especially valuable for:
- redstone reasoning
- trap and puzzle construction
- hidden doors
- crop/falling-block mechanics
- Bedrock/Java behavioral contrast analysis
- event-based world observation
- debugging ghost block or desync issues
- teaching Sage how Minecraft secretly thinks

---

## Canonical Mental Model

Minecraft world logic can be framed as:

```text
event -> update propagation -> re-evaluation -> scheduled/random tick effects -> visible world change -> server/client reconciliation
````

Or, from the agent's runtime perspective:

```text
world signal -> perception event -> reasoning context -> action decision -> Mineflayer action -> observed result -> persistence/retry learning
```

The agent should treat Minecraft as an event propagation substrate.

A block is not merely an object. A block is a node in a local rule network.

---

## Law 1: Nothing Changes Until Acted Upon

### Principle

Blocks do not constantly check whether their surroundings are valid. A block usually reacts only when something causes it to receive an update.

Examples from the video:

* Floating sand can remain suspended if no update reaches it.
* Sand falls when a nearby change tells it to re-evaluate.
* One falling sand block can update adjacent sand, causing a cascade.
* Piston-head removal can avoid sending a block update because the piston head is removed before the game determines which blocks need updates.

### Agent Interpretation

The world has latent invalid states.

A structure may contain blocks that "should" fall, break, update, or transform, but they will not do so until the proper event reaches them. Therefore, the agent should distinguish between:

```text
currently stable
actually valid
latent unstable
triggered unstable
```

### Implementation Implication

Add an `updateSensitivity` concept to world reasoning.

Possible fields:

```ts
type BlockUpdateSensitivity = {
  block: string
  position: Vec3
  canRemainLatentlyInvalid: boolean
  updateTriggers: string[]
  likelyReactionOnUpdate: "fall" | "break" | "drop" | "power_change" | "state_change" | "none" | "unknown"
}
```

### Agent Prompt Concept

When reasoning about blocks, consider whether a block is valid only because it has not yet received an update. Do not assume that a floating or unsupported block is permanently stable.

---

## Law 2: The World Updates in Snapshots

### Principle

Minecraft does not simulate continuously. It advances in discrete ticks.

The video states:

* The game processes the world in game ticks.
* Minecraft runs at 20 ticks per second.
* Each tick processes pending world changes before moving to the next tick.
* Some block reactions occur immediately when updated.
* Other reactions are scheduled with a delay.

Examples:

* Crops do not constantly check for light.
* If the light source is removed from a crop field, crops may remain temporarily.
* Once one crop receives a block update, connected crops can break rapidly.
* Falling blocks use a different update logic and include a two-tick delay before acting on a block update.

### Agent Interpretation

The agent should reason in discrete update frames, not continuous time.

There is a difference between:

* a current world snapshot
* a pending consequence
* a scheduled consequence
* a random future consequence

### Implementation Implication

Add tick-aware reasoning to the world model.

Possible event shape:

```ts
type WorldTickEvent = {
  tickEstimate?: number
  source: "chat" | "block_change" | "entity_move" | "time_update" | "random_tick" | "scheduled_update" | "agent_action"
  observedAt: string
  affectedPositions: Vec3[]
  expectedDelayTicks?: number
  expectedCascade?: boolean
}
```

### Agent Prompt Concept

Minecraft changes in ticks. Some effects occur immediately, some after scheduled delays, and some only when triggered. Before acting, consider whether the observed state may change on the next tick or after a short scheduled delay.

---

## Law 3: The World Is Constantly Being Poked by Random Ticks

### Principle

Minecraft randomly selects blocks in loaded subchunks to receive random ticks. These random ticks drive ongoing environmental behavior.

The video lists random tick effects including:

* plant growth
* leaf decay
* grass spreading
* copper weathering
* ice melting
* lava spreading fire
* zombie piglin spawning in nether portals

The video states:

* Each loaded subchunk is a 16 x 16 x 16 region.
* Each tick, Minecraft chooses three random blocks in every loaded subchunk by default.
* The number of chosen blocks is affected by the `randomTickSpeed` gamerule.
* If a selected block has a random tick function, that function executes.
* A specific block receives a random tick on average around every 68 seconds.
* About half of blocks in a subchunk receive a random tick by around 47 seconds.

### Agent Interpretation

The world contains probabilistic background processes.

The agent should not treat all change as directly caused by players. Some change emerges from random tick mechanics.

### Implementation Implication

Add probabilistic environmental forecasting.

Possible reasoning fields:

```ts
type RandomTickForecast = {
  block: string
  position: Vec3
  randomTickEligible: boolean
  possibleOutcomes: string[]
  riskLevel: "low" | "medium" | "high"
  averageTriggerWindowSeconds?: number
}
```

### Agent Prompt Concept

Some blocks change because random ticks poke them. When observing crops, leaves, grass, copper, fire, ice, portals, or similar systems, consider random ticks as a possible cause of change.

---

## Law 4: Not All Updates Spread the Same Way

### Principle

Basic block updates usually affect adjacent blocks, but some blocks, especially redstone components, propagate updates in special directions or ranges.

The video gives these examples:

### Redstone Torch

* Sends updates two blocks away in all directions.

### Redstone Dust

* When placed: sends updates two blocks above and below.
* When toggled by right click: sends updates horizontally through blocks.
* When broken: sends updates in all four horizontal directions.
* When updated by another redstone dust: sends updates two blocks away in all directions.

### Repeaters and Comparators

* Send updates two blocks away only in the direction they face.
* This happens when placed, broken, or updated.

### Observer Limitation

The video notes that these special redstone block updates are not always detected by observers. Some require traditional piston-based block update detectors.

### Tripwire Hook

Tripwire hooks are especially important.

The video states:

* Tripwire hooks can send block updates up to 40 blocks away.
* This can ignore walls.
* When a tripwire hook facing north or east receives an update, it searches up to 40 blocks away for an aligned tripwire.
* If found, that tripwire receives a detectable redstone block update.
* This enables invisible long-distance signals, hidden base keys, and escape room mechanisms.

### Agent Interpretation

Minecraft has multiple propagation classes.

Not all signals are local. Some are:

* adjacent
* directional
* two-block redstone updates
* hidden through-block updates
* long-range tripwire updates
* scheduled
* random

The agent must not assume all causality is visible or adjacent.

### Implementation Implication

Create a `SignalPropagationProfile`.

```ts
type SignalPropagationProfile = {
  sourceBlock: string
  triggerAction: "place" | "break" | "right_click" | "entity_cross" | "neighbor_update" | "power_change"
  propagationType: "adjacent" | "directional" | "two_block" | "vertical" | "through_block" | "long_range" | "scheduled" | "random"
  maxDistanceBlocks: number
  directions: string[]
  observerDetectable: boolean | "sometimes"
  pistonBudDetectable?: boolean
  notes?: string
}
```

Seed profiles:

```ts
const SIGNAL_PROFILES = {
  redstone_torch: {
    propagationType: "two_block",
    maxDistanceBlocks: 2,
    directions: ["all"],
    observerDetectable: "sometimes"
  },
  redstone_dust_placed: {
    propagationType: "vertical",
    maxDistanceBlocks: 2,
    directions: ["up", "down"],
    observerDetectable: "sometimes"
  },
  redstone_dust_right_clicked: {
    propagationType: "through_block",
    maxDistanceBlocks: 2,
    directions: ["north", "south", "east", "west"],
    observerDetectable: "sometimes"
  },
  repeater_or_comparator: {
    propagationType: "directional",
    maxDistanceBlocks: 2,
    directions: ["facing"],
    observerDetectable: "sometimes"
  },
  tripwire_hook_north_or_east: {
    propagationType: "long_range",
    maxDistanceBlocks: 40,
    directions: ["facing_line"],
    observerDetectable: true,
    notes: "Can create invisible signal paths through walls when aligned with tripwire."
  }
}
```

### Agent Prompt Concept

When reasoning about redstone, hidden doors, traps, or puzzles, remember that some redstone components send special block updates beyond adjacent blocks. Tripwire hooks can create long-range invisible signal channels up to 40 blocks.

---

## Law 5: Minecraft Reality Has Layers

### Principle

Player interaction is resolved across client and server layers.

The video describes the sequence:

1. The client reacts immediately and visually shows the block placement or break.
2. The client sends the action to the server.
3. The server is the source of truth.
4. The server validates whether the action is legal.
5. If valid, the server updates the world in memory.
6. The server sends the update back to nearby players.
7. If client and server disagree, the client is corrected.

Usually this takes less than a tenth of a second, but during lag the gap can be longer or fail to reconcile cleanly.

Examples:

* Ghost blocks occur when the client believes a block exists but the server does not.
* Entities may fall through ghost blocks.
* The player may stand on a ghost block.
* Interacting with a ghost block causes validation and makes it disappear.
* The video gives an example where placing a block while moving it to the off-hand creates a brief gap where the player can jump from a block that the server later invalidates.

### Agent Interpretation

There are multiple layers of truth:

```text
client-perceived state
server-authoritative state
agent-observed state
persisted memory state
```

The agent should not assume that one visual or immediate observation is final truth.

### Implementation Implication

Add state confidence and confirmation logic.

```ts
type ObservedWorldState = {
  position: Vec3
  blockClientVisible?: string
  blockServerConfirmed?: string
  confidence: "visual" | "observed" | "server_confirmed" | "memory_confirmed"
  lastValidatedAt?: string
  suspectedGhostBlock?: boolean
}
```

For Mineflayer, the agent primarily observes server-side state, but it may still encounter desync, failed placement, pathfinding mismatch, or delayed block updates. Treat unexpected placement/pathing failures as possible state reconciliation issues, not merely action failures.

### Agent Prompt Concept

Minecraft has layered reality. The server is authoritative, but clients can temporarily see or interact with states that are not server-valid. If a block behaves strangely, suspect desync, ghost blocks, lag, or delayed validation.

---

## Mapping to Current Minecraft Agent Architecture

The current Minecraft Agent already resembles Minecraft's update system.

Current architecture:

* Mineflayer observes Minecraft chat and world state.
* `agent/agentRuntime.js` decides whether to observe, answer, or run commands.
* `minecraft/worldSnapshot.js` captures nearby world state.
* `agent/contextBuilder.js` assembles recent messages, events, summaries, reflexes, and snapshots.
* `ai/promptBuilder.js` builds prompts.
* `agent/actionExecutor.js` executes structured actions.
* `memory/*` persists messages, events, jobs, identity, worlds, sessions, and retry learning.
* `reflex/*` handles automatic world responses.
* `builder/*` compiles build jobs.
* `control/*` and dashboard expose runtime state and operator control.

Relevant existing docs:

* The system already frames perception, reasoning, and action as separated phases.
* The data flow already moves from Minecraft signals to runtime, model, action, and persistence.
* Reflex and build workers already run as asynchronous background processes.
* Persistent events and messages form the main audit trail.

### Key Architectural Translation

```text
Minecraft block update -> Agent world/reflex event
Minecraft scheduled update -> Agent queued job / delayed effect
Minecraft random tick -> Agent periodic scan / probabilistic reflex
Minecraft redstone special update -> Agent non-local semantic trigger
Minecraft client-server reconciliation -> Agent action confirmation + retry learning
```

---

## Recommended Knowledge Layer Additions

### 1. Add `worldSignal` Events

Add a new semantic event category for detected or inferred world signal behavior.

```ts
type WorldSignalEvent = {
  type: "world_signal"
  signalKind:
    | "block_update"
    | "scheduled_update"
    | "random_tick"
    | "redstone_update"
    | "tripwire_long_range"
    | "client_server_reconciliation"
    | "latent_invalid_state"
  sourcePosition?: Vec3
  affectedPositions?: Vec3[]
  sourceBlock?: string
  triggerAction?: string
  confidence: "observed" | "inferred" | "predicted"
  expectedOutcome?: string
  notes?: string
}
```

### 2. Add Update Physics to `worldSnapshot`

Current snapshots should be extended with reasoning helpers, not just nearby blocks.

Potential additions:

* nearby redstone components
* unstable blocks
* gravity-sensitive blocks
* crops/light-sensitive blocks
* tripwire/tripwire hook alignments
* possible signal paths
* recently changed blocks
* detected block state transitions

### 3. Add Reflex Types

Potential reflex triggers:

* `latent_falling_block_detected`
* `crop_update_cascade_possible`
* `redstone_signal_path_detected`
* `tripwire_long_range_signal_detected`
* `possible_ghost_block_or_desync`
* `random_tick_sensitive_area`
* `hidden_door_mechanism_detected`
* `trap_signal_detected`

### 4. Add Build Planner Awareness

The build planner should understand signal mechanics for:

* hidden doors
* secret keys
* traps
* crop harvest mechanisms
* sand/gravel cascade builds
* escape rooms
* tripwire signal relays

### 5. Add Teaching Mode Language

For Sage-facing explanations:

```text
Minecraft blocks are sleepy. They do not constantly look around. They wake up when another block pokes them with an update. Redstone is like secret wiring that can poke blocks farther away. Random ticks are the world gently poking random blocks to see if they want to grow, melt, spread, or change.
```

This framing is useful for child-friendly explanation while remaining technically accurate.

---

## High-Value Agent Behaviors Enabled

### Hidden Mechanism Reasoning

The agent can answer:

* "Why did this door open from far away?"
* "Can we make this trap invisible?"
* "Can a tripwire send a signal through this wall?"

### Cascade Prediction

The agent can predict:

* sand/gravel falling chains
* crop breaking cascades
* redstone update propagation
* delayed falling block behavior

### Debugging

The agent can diagnose:

* ghost blocks
* failed placements
* crops breaking unexpectedly
* redstone not being observer-detected
* mechanisms only triggering when broken/right-clicked

### Creative Construction

The agent can propose:

* tripwire-based hidden keys
* redstone dust right-click locks
* repeater orientation passcodes
* random tick farms
* update-suppressed floating block builds

---

## Prompt Injection Snippet for Minecraft Agent

Use this as compact system knowledge:

```text
Minecraft is a tick-based event propagation system, not a continuously simulated world. Blocks generally do not poll their environment; they react when block updates, scheduled ticks, random ticks, redstone-specific updates, entity interactions, or server validation events cause them to re-evaluate. Some invalid states can remain latent until triggered. Minecraft processes world logic in discrete game ticks, usually 20 per second. Some reactions are immediate, while others are scheduled with delay, such as falling blocks. Random ticks probabilistically poke blocks in loaded subchunks and drive growth, decay, spreading, melting, weathering, fire, and similar environmental behavior. Redstone components can propagate updates in non-standard ways, including directional, two-block, through-block, and long-range tripwire-hook signals up to 40 blocks. Client and server reality can temporarily disagree; the server is authoritative, but ghost blocks and validation gaps can appear under lag or timing edge cases. When reasoning about the world, infer not only what blocks exist, but what updates they may send, receive, delay, suppress, or misrepresent.
```

---

## Agent Design Principle

The Minecraft Agent should not merely observe world state.

It should infer world causality.

```text
Bad model:
"I see blocks."

Better model:
"I see a reactive graph of blocks, triggers, delays, signals, and possible cascades."
```

---

## Tag Set

* minecraft
* minecraft-agent
* mineflayer
* world-model
* block-updates
* event-propagation
* game-ticks
* scheduled-updates
* random-ticks
* redstone
* tripwire-hooks
* ghost-blocks
* client-server-desync
* reflex-layer
* build-planner
* hidden-mechanisms
* traps
* teaching-sage
* agent-architecture

---

## Canonical One-Liner

Minecraft is a world of blocks that behave like sleeping event listeners: nothing changes until something pokes the graph.