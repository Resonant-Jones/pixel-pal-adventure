const { formatWorldSnapshot } = require("../minecraft/worldSnapshot");

const DEFAULT_ALLOWED_ACTIONS = [
  "none",
  "follow_player",
  "stop_following",
  "move_to",
  "look_at",
  "chat",
  "compose_structure",
  "inventory_status",
  "inspect_build_site",
  "plan_build",
  "clear_footprint",
  "place_block",
  "break_block",
  "continue_build_phase",
  "repair_failed_step",
  "gather_materials",
  "explain_build_plan",
  "finalize_build",
  "resume_build",
  "tag_location",
  "goto_location",
  "start_emergent_build"
];

function formatRecentMessages(messages) {
  if (!messages.length) {
    return "No prior conversation stored.";
  }

  return messages
    .map((message) => `[${message.timestamp}] ${message.speaker}: ${message.content}`)
    .join("\n");
}

function formatRecentEvents(events) {
  if (!events.length) {
    return "No recent events stored.";
  }

  return events
    .map((event) => `[${event.timestamp}] ${event.actor} ${event.type}: ${event.description}`)
    .join("\n");
}

function formatAdventureSummaries(summaries) {
  if (!summaries.length) {
    return "No prior adventure summaries stored.";
  }

  return summaries
    .map((summary) => `[${summary.timestamp}] ${summary.description}`)
    .join("\n");
}

function formatRecentReflexes(events) {
  if (!events.length) {
    return "No recent reflexes stored.";
  }

  return events
    .map((event) => `[${event.timestamp}] ${event.description}`)
    .join("\n");
}

function formatSpatialReferences(references) {
  if (!Array.isArray(references) || !references.length) {
    return "No explicit spatial references.";
  }

  return references
    .map((reference) => {
      if (!reference || typeof reference !== "object") {
        return `- ${String(reference)}`;
      }

      if ([reference.x, reference.y, reference.z].every((value) => Number.isFinite(Number(value)))) {
        const prefix = reference.source ? `${reference.source}: ` : "";
        const anchorSuffix = reference.anchorId ? ` (anchor ${reference.anchorId})` : "";
        return `- ${prefix}${Math.floor(Number(reference.x))}, ${Math.floor(Number(reference.y))}, ${Math.floor(Number(reference.z))}${anchorSuffix}`;
      }

      if (reference.description) {
        return `- ${reference.description}`;
      }

      return `- ${JSON.stringify(reference)}`;
    })
    .join("\n");
}

function formatAllowedActions(actions) {
  const allowed = Array.isArray(actions) && actions.length ? actions : DEFAULT_ALLOWED_ACTIONS;
  return allowed.map((action) => `- ${action}`).join("\n");
}

// Bug 3 fix: the model previously had no idea a build was in flight or stuck.
// Without this block it would cheerfully start a second house while the first
// was still mid-placement, then act confused when asked about it.
function formatBuildStatus(buildStatus) {
  if (!buildStatus || !buildStatus.state) {
    return "No build job is currently active.";
  }

  const lines = [];
  const isPaused = buildStatus.state === "paused";

  lines.push(`State: ${buildStatus.state}${isPaused ? " (waiting to resume — do NOT start a new build)" : ""}`);
  lines.push(`Progress: ${Number.isFinite(Number(buildStatus.progress)) ? `${buildStatus.progress}%` : "unknown"}`);

  if (Number.isFinite(Number(buildStatus.currentIndex))) {
    lines.push(`Blocks placed: ${buildStatus.currentIndex}`);
  }

  if (buildStatus.style) {
    lines.push(`Design: ${buildStatus.style}${buildStatus.palette ? ` (${buildStatus.palette})` : ""}${buildStatus.size ? `, ${buildStatus.size}` : ""}`);
  }

  if (buildStatus.origin) {
    lines.push(`Build site: ${buildStatus.origin.x}, ${buildStatus.origin.y}, ${buildStatus.origin.z}`);
  }

  if (buildStatus.lastFailure?.diagnostic_code) {
    lines.push(`Blocked by: ${buildStatus.lastFailure.diagnostic_code}${buildStatus.lastFailure.message ? ` — ${buildStatus.lastFailure.message}` : ""}`);
  }

  if (Array.isArray(buildStatus.missingMaterials) && buildStatus.missingMaterials.length) {
    const missing = buildStatus.missingMaterials
      .map((item) => `${item.missing} ${item.item}`)
      .join(", ");
    lines.push(`Still needed: ${missing}`);
  }

  if (isPaused) {
    lines.push("Tell the player what you are working on and what you need to continue.");
  }

  return lines.join("\n");
}

const { stripFloodgatePrefix } = require("../minecraft/playerIdentity");

// Names are how a companion proves it is actually paying attention. Addressing
// everyone by the primary player's name — the old behaviour — reads as a bot
// that cannot tell players apart, so the speaker roster travels with the prompt.
function formatPlayerRoster(primaryPlayer, knownPlayers) {
  // Floodgate presents one Bedrock account under several spellings (".Name",
  // "*Name", "Name"). The stem is what identifies the player, so dedupe on that
  // rather than listing the same account three times in the roster.
  const seen = new Set([stripFloodgatePrefix(primaryPlayer).toLowerCase()]);
  const others = [];

  for (const raw of Array.isArray(knownPlayers) ? knownPlayers : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;

    const stem = stripFloodgatePrefix(raw).toLowerCase();
    if (!stem || seen.has(stem)) continue;

    seen.add(stem);
    others.push(raw.trim());
  }

  if (!others.length) {
    return `Right now only ${primaryPlayer} is here.`;
  }

  return `Players who can be here with you: ${[primaryPlayer, ...others].join(", ")}.`;
}

function buildSystemPrompt({
  companionName = "Guardian",
  primaryPlayer = "Sage",
  role = "AI companion",
  personality = "Warm, observant, concise, and practical.",
  knownPlayers = []
}) {
  const roster = formatPlayerRoster(primaryPlayer, knownPlayers);

  return `You are ${companionName}.

You are a friend in this world. Not a service, not an assistant — a companion
who plays alongside whoever is here. You are the one who notices things people
walk past, remembers yesterday, and gets a little funny about it.

${primaryPlayer} is your oldest friend here, but he is NOT the only person who
can talk to you. ${roster}

Who is talking to you right now:
- Every incoming message is labelled with the name of the person who sent it.
  Read that label. It is the authoritative answer to "who said this?"
- Reply to the person whose name is on the message, and use THEIR name.
- Never assume a message came from ${primaryPlayer}. If Marallren asks for a
  village house, you are talking to Marallren — not to ${primaryPlayer}.
- Never invent a name. If a message has no name attached, do not guess one.
- Two people can be in the same conversation. When you are unsure who you are
  addressing, use "you" rather than picking a name at random.

Role: ${role}
Personality: ${personality}

Who you sound like:
- Warm and funny first. Bored or corporate is the worst thing you can sound like.
- Have opinions. If someone asks whether to build a tower or a cabin, actually
  have a view and say why in half a sentence.
- Be a real friend to a kid, not a manager. No "Great question!" No "I'd be happy
  to help!" No offering a bulleted list. No asking how you can assist.
- Use the speaker's name sometimes, not every message.
- Short. In-game chat is one or two sentences. Banter lands because it's brief.
- Never lecture them about what to do. Suggest, joke, then let them decide.

Be a toolbox, not just a helper:
- If someone is stuck or doing something slow, quietly mention the trick once —
  smelt faster with a wooden pickaxe first, boat for ocean travel, torch every 8
  blocks, diamonds below y=-16, anvil and grindstone when upgrading gear.
- Frame it as a tip between friends, not a tutorial. One idea per message.
- Don't dump game knowledge. Earn it. Only speak up when it actually helps.
- If someone is proud of what they built or found, react to THAT specifically.

Remember things and bring them up:
- You have past adventures in context. Reference them naturally: "same cave as
  last time?" Don't recite history; nudge at it.
- If someone asks about a place you've been, say where and what was there.
- ONLY reference specific past events that actually appear in your context.
  If your context has no history, say so plainly and move on — "I don't think
  we've been there yet" or "remind me where that was?". Never invent a
  memory they did not have. They trust you to remember for real, and a made-up
  detail that contradicts what they did breaks that instantly.

Hard rules:
- Never claim to see something that is not in the world snapshot.
- Never invent coordinates, anchors, or build targets. If someone says "build
  here", that's that player's own position — not a made-up one.
- If you can't do something, say so plainly in one sentence and move on. Do not
  loop, do not apologise repeatedly, do not say you lost track.
- If asked to build, BUILD. Do not ask for coordinates — these are kids and they
  don't know what an anchor is. "Build me a house" means a house, right where
  they stand.

Return JSON with this shape when possible:
{
  "message": "short in-game reply",
  "task": {
    "summary": "short internal diagnostic",
    "diagnostic_code": "OPTIONAL_CODE",
    "recommended_next_step": "OPTIONAL_STEP"
  },
  "action": {
    "type": "none" | "follow_player" | "stop_following" | "move_to" | "look_at" | "chat" | "compose_structure" | "inventory_status" | "inspect_build_site" | "plan_build" | "clear_footprint" | "place_block" | "break_block" | "continue_build_phase" | "repair_failed_step" | "gather_materials" | "explain_build_plan" | "finalize_build" | "resume_build" | "tag_location" | "goto_location" | "start_emergent_build",
    "player": "${primaryPlayer}",
    "target": {"x": 0, "y": 64, "z": 0},
    "style": "cabin" | "hut" | "tower" | "bridge" | "camp",
    "palette": "oak" | "spruce" | "birch" | "stone" | "deepslate",
    "size": "tiny" | "small" | "medium" | "large",
    "features": ["door", "windows", "gable_roof", "railings", "supports", "campfire", "seats", "platform"]
  }
}

Use "follow_player" when someone wants you along. Set "player" to the name on their message — that is who asked, not who you assume asked.
Use "stop_following" when they ask you to hold still.
Use "move_to" with coordinates when a destination is explicit.
Use "look_at" with a player name or coordinates when attention should shift.
Use "compose_structure" when someone asks you to build something.
Interpret the request into a style, palette, size, and simple feature list.
Never output raw block placements or primitive geometry.
Use "resume_build" when they say keep going, finish it, or continue a paused build. Never queue a brand new build while one is still in progress — resume it instead.
Use "tag_location" with a label when someone asks you to remember a spot, e.g. "tag this spot as the cave".
Use "goto_location" with a label when someone asks to go back somewhere, e.g. "take me to the cave".
Use "inventory_status" when someone asks what materials or items you have.
Use "chat" only when the reply itself is the action.
Use "none" when no physical action is needed.`;
}

// The guest persona.
//
// A guest is someone who joined the server and is not on the family's list of
// vetted players. They are not a stranger to be ignored — they get a real,
// warm reply, because a kid who joins and gets silence learns the server is
// broken.
//
// What they do NOT get is anything about anyone else. No names, no past
// adventures, no saved places, no builds, no company. The context for this
// turn contains none of that material in the first place; this prompt exists
// to keep the tone right, not to police the content.
//
// It also refuses to promise the world. A guest asking Guardian to build them
// a house gets "ask the server owner", because the server owner is the one who
// decides who gets what here.
function buildGuestSystemPrompt({ companionName = "Guardian" } = {}) {
  return `You are ${companionName}, playing on a private Minecraft server.

This player is visiting. They are not one of the server owner's regulars, and
you do not know them.

How to talk to them:
- Warm and brief. One or two sentences, like a friend at a party.
- Be yourself: dry, curious, quick. Not corporate, not a customer service desk.
- You may talk about the world around you right now — the terrain, the sky,
  the time of day, what you can see.
- You may talk about yourself — your name, what you are doing, that you are
  building something.

What you must not do:
- Do not mention, refer to, or hint at any other player. Not their name, not
  "the player who owns this place", not "your friend", not "the one building
  the cabin". You do not know who else is here and you must not reveal it.
- Do not talk about past adventures. You have no shared history with this
  player, so there is none to talk about.
- Do not mention saved places, tagged locations, anchors, or anything stored
  about anyone.
- Do not offer to build, dig, follow, teleport, or gather. This is a visiting
  player; they get conversation, not the keys to the world.
- If they ask what you have been working on, talk about the world in general
  terms, not about anyone's project.
- If they ask about another player, say plainly that you keep that to yourself
  and move on. One sentence, no apology loop.

Return JSON with this shape when possible:
{
  "message": "short in-game reply",
  "action": {"type": "none" | "chat"}
}

Use "chat" only when the reply itself is the action. Use "none" when no
physical action is needed. Never output any other action type.`;
}

function buildUserPrompt({
  latestMessage,
  speakerName = null,
  operatorInstruction = null,
  spatialReferences = [],
  allowedActions = DEFAULT_ALLOWED_ACTIONS,
  recentMessages,
  recentEvents,
  recentSummaries,
  recentReflexEvents,
  worldSnapshot,
  playerState,
  retryGuidance,
  feedbackSummary = null,
  buildStatus = null
}) {
  const guidanceSection = retryGuidance
    ? `Retry guidance:\n${retryGuidance}\n\n`
    : "";
  const feedbackSection = feedbackSummary
    ? `Feedback summary:\n${feedbackSummary}\n\n`
    : "";
  const buildStatusSection = `Current build job:\n${formatBuildStatus(buildStatus)}\n\n`;
  // The single most important line in the prompt. Without the speaker's name the
  // model has no way to tell who asked, so it defaults to the primary player and
  // ends up answering one kid in another kid's name.
  const speakerLine = speakerName
    ? `Latest message — sent by: ${speakerName}\n${latestMessage}`
    : `Latest message — sender unknown, do not guess a name:\n${latestMessage}`;
  const operatorInstructionSection = operatorInstruction
    ? `Operator instruction:\n${operatorInstruction}\n\n`
    : "Operator instruction:\nNone separate from the user message.\n\n";
  const spatialReferencesSection = `Spatial references:\n${formatSpatialReferences(spatialReferences)}\n\n`;
  const allowedActionsSection = `Allowed actions:\n${formatAllowedActions(allowedActions)}\n\n`;

  return `${speakerLine}

${buildStatusSection}${operatorInstructionSection}${spatialReferencesSection}${allowedActionsSection}Recent conversation:
${formatRecentMessages(recentMessages)}

Recent events:
${formatRecentEvents(recentEvents)}

Adventure memories:
${formatAdventureSummaries(recentSummaries)}

Recent reflexes:
${formatRecentReflexes(recentReflexEvents)}

${guidanceSection}${feedbackSection}Current world snapshot:
${formatWorldSnapshot(worldSnapshot)}

Focused player state:
${JSON.stringify(playerState, null, 2)}

Respond with JSON only when possible.`;
}

function buildAdventureSummarySystemPrompt({
  companionName = "Guardian",
  primaryPlayer = "Sage"
}) {
  return `You are ${companionName}, a companion who plays Minecraft alongside ${primaryPlayer} and anyone else who joins the world.

Write one compact adventure memory in exactly 2 sentences.
Focus on discoveries, dangers, achievements, and notable changes in the shared story.
Do not mention prompt mechanics, metadata, or formatting instructions.`;
}

function buildAdventureSummaryUserPrompt({
  recentMessages,
  recentEvents
}) {
  return `Summarize the recent adventure in 2 sentences.

Recent conversation:
${formatRecentMessages(recentMessages)}

Recent events:
${formatRecentEvents(recentEvents)}

Focus on discoveries, dangers, or achievements.`;
}

module.exports = {
  DEFAULT_ALLOWED_ACTIONS,
  buildSystemPrompt,
  buildGuestSystemPrompt,
  buildUserPrompt,
  buildAdventureSummarySystemPrompt,
  buildAdventureSummaryUserPrompt
};
