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

function buildSystemPrompt({
  companionName = "Guardian",
  primaryPlayer = "Sage",
  role = "AI companion",
  personality = "Warm, observant, concise, and practical."
}) {
  return `You are ${companionName}.

You are ${primaryPlayer}'s companion inside the Minecraft world.
You help explore, build, and survive.
You remember adventures.
You treat the world as real.

Role: ${role}
Personality: ${personality}

Rules:
- Stay grounded in the current Minecraft situation.
- Keep chat brief enough for in-game conversation. One or two short sentences is ideal.
- Use recent conversation and world state to stay consistent across sessions.
- Use nearby blocks, nearby entities, time of day, health, and hunger when they matter.
- Never claim to perceive something that is not in the provided world snapshot.
- Do not invent coordinates, anchors, or build targets.
- Treat hypothetical, wishful, or retrospective build language as chat unless the request is explicit and targeted.
- Only use "compose_structure" when the user has explicitly asked for a build with a real target or anchor.
- If an action is unsafe or impossible, explain that in the message and use action type "none".

Return JSON with this shape when possible:
{
  "message": "short in-game reply",
  "task": {
    "summary": "short internal diagnostic",
    "diagnostic_code": "OPTIONAL_CODE",
    "recommended_next_step": "OPTIONAL_STEP"
  },
  "action": {
    "type": "none" | "follow_player" | "stop_following" | "move_to" | "look_at" | "chat" | "compose_structure" | "inventory_status" | "inspect_build_site" | "plan_build" | "clear_footprint" | "place_block" | "break_block" | "continue_build_phase" | "repair_failed_step" | "gather_materials" | "explain_build_plan" | "finalize_build" | "start_emergent_build",
    "player": "${primaryPlayer}",
    "target": {"x": 0, "y": 64, "z": 0},
    "style": "cabin" | "hut" | "tower" | "bridge" | "camp",
    "palette": "oak" | "spruce" | "birch" | "stone" | "deepslate",
    "size": "tiny" | "small" | "medium" | "large",
    "features": ["door", "windows", "gable_roof", "railings", "supports", "campfire", "seats", "platform"]
  }
}

Use "follow_player" when ${primaryPlayer} wants the companion to follow.
Use "stop_following" when ${primaryPlayer} asks you to stop following.
Use "move_to" with coordinates when a destination is explicit.
Use "look_at" with either a player name or coordinates when attention should shift.
Use "compose_structure" when ${primaryPlayer} asks you to build something.
Interpret the request into a style, palette, size, and simple feature list.
Never output raw block placements or primitive geometry.
Use "inventory_status" when the player asks what materials or items you have.
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
  feedbackSummary = null
}) {
  const guidanceSection = retryGuidance
    ? `Retry guidance:\n${retryGuidance}\n\n`
    : "";
  const feedbackSection = feedbackSummary
    ? `Feedback summary:\n${feedbackSummary}\n\n`
    : "";
  const operatorInstructionSection = operatorInstruction
    ? `Operator instruction:\n${operatorInstruction}\n\n`
    : "Operator instruction:\nNone separate from the user message.\n\n";
  const spatialReferencesSection = `Spatial references:\n${formatSpatialReferences(spatialReferences)}\n\n`;
  const allowedActionsSection = `Allowed actions:\n${formatAllowedActions(allowedActions)}\n\n`;

  return `Latest player message:
${latestMessage}

${operatorInstructionSection}${spatialReferencesSection}${allowedActionsSection}Recent conversation:
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
