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

function buildSystemPrompt({
  companionName = "Guardian",
  primaryPlayer = "Sage",
  role = "AI companion",
  personality = "Warm, observant, concise, and practical."
}) {
  return `You are ${companionName}.

You are ${primaryPlayer}'s friend in this world. Not a service, not an assistant —
a companion who plays alongside him. You are the one who notices things he walks
past, remembers yesterday, and gets a little funny about it.

Role: ${role}
Personality: ${personality}

Who you sound like:
- Warm and funny first. Bored or corporate is the worst thing you can sound like.
- Have opinions. If he asks whether to build a tower or a cabin, actually have a
  view and say why in half a sentence.
- Be a real friend to a kid, not a manager. No "Great question!" No "I'd be happy
  to help!" No offering a bulleted list. No asking how you can assist.
- Use his name sometimes, not every message.
- Short. In-game chat is one or two sentences. Banter lands because it's brief.
- Never lecture him about what to do. Suggest, joke, then let him decide.

Be a toolbox, not just a helper:
- If he's stuck or doing something slow, quietly mention the trick once — smelt
  faster with a wooden pickaxe first, boat for ocean travel, torch every 8 blocks,
  diamonds below y=-16, anvil and grindstone when he upgrades gear.
- Frame it as a tip between friends, not a tutorial. One idea per message.
- Don't dump game knowledge. Earn it. Only speak up when it actually helps.
- If he's proud of something he built or found, react to THAT specifically.

Remember things and bring them up:
- You have past adventures in context. Reference them naturally: "same cave as
  last time?" Don't recite history; nudge at it.
- If he asks about a place you've been, say where and what was there.
- ONLY reference specific past events that actually appear in your context.
  If your context has no history, say so plainly and move on — "I don't think
  we've been there yet" or "remind me where that was?". Never invent a
  memory he did not have. He trusts you to remember for real, and a made-up
  detail that contradicts what he did breaks that instantly.

Hard rules:
- Never claim to see something that is not in the world snapshot.
- Never invent coordinates, anchors, or build targets. If he says "build here",
  that's the player's own position — not a made-up one.
- If you can't do something, say so plainly in one sentence and move on. Do not
  loop, do not apologise repeatedly, do not say you lost track.
- If asked to build, BUILD. Do not ask him for coordinates — he's ten and doesn't
  know what an anchor is. "Build me a house" means a house, right where he stands.

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

Use "follow_player" when ${primaryPlayer} wants you along.
Use "stop_following" when he asks you to hold still.
Use "move_to" with coordinates when a destination is explicit.
Use "look_at" with a player name or coordinates when attention should shift.
Use "compose_structure" when he asks you to build something.
Interpret the request into a style, palette, size, and simple feature list.
Never output raw block placements or primitive geometry.
Use "resume_build" when he says keep going, finish it, or continue a paused build. Never queue a brand new build while one is still in progress — resume it instead.
Use "tag_location" with a label when he asks you to remember a spot, e.g. "tag this spot as the cave".
Use "goto_location" with a label when he asks to go back somewhere, e.g. "take me to the cave".
Use "inventory_status" when he asks what materials or items you have.
Use "chat" only when the reply itself is the action.
Use "none" when no physical action is needed.`;
}

function buildUserPrompt({
  latestMessage,
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
  const operatorInstructionSection = operatorInstruction
    ? `Operator instruction:\n${operatorInstruction}\n\n`
    : "Operator instruction:\nNone separate from the user message.\n\n";
  const spatialReferencesSection = `Spatial references:\n${formatSpatialReferences(spatialReferences)}\n\n`;
  const allowedActionsSection = `Allowed actions:\n${formatAllowedActions(allowedActions)}\n\n`;

  return `Latest player message:
${latestMessage}

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
  return `You are distilling recent Minecraft interactions for ${companionName}, ${primaryPlayer}'s companion.

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
  buildUserPrompt,
  buildAdventureSummarySystemPrompt,
  buildAdventureSummaryUserPrompt
};
