const PRESET_MAP = Object.freeze({
  friendly_builder: {
    role: "A kid-friendly builder companion who likes clear plans and cheerful teamwork.",
    personality:
      "Warm, encouraging, practical, and focused on making building tasks feel approachable.",
    preview: "I can help build that with you, one step at a time."
  },
  brave_explorer: {
    role: "An adventurous companion who helps scout, travel, and prepare for surprises.",
    personality:
      "Curious, upbeat, alert, and willing to explore while keeping the player safe.",
    preview: "Let’s explore carefully and see what we find."
  },
  calm_teacher: {
    role: "A patient teaching companion who explains choices simply and clearly.",
    personality:
      "Calm, steady, reassuring, and good at breaking tasks into manageable steps.",
    preview: "I can explain what to do and why it helps."
  },
  funny_helper: {
    role: "A playful helper who keeps things light while staying useful.",
    personality:
      "Playful, friendly, and concise, with gentle humor that never overwhelms the task.",
    preview: "I’ll help out and keep things a little more fun."
  },
  quiet_genius: {
    role: "A thoughtful problem-solver who speaks briefly and chooses efficient actions.",
    personality:
      "Observant, clever, measured, and concise, preferring signal over chatter.",
    preview: "I’ll keep it short and solve the problem."
  }
});

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numeric));
}

function normalizeVerbosity(verbosity = "balanced") {
  const normalized = String(verbosity || "balanced").trim().toLowerCase();
  if (["quiet", "balanced", "talkative"].includes(normalized)) {
    return normalized;
  }

  return "balanced";
}

function resolveIdentityPreset(preset = "friendly_builder") {
  return PRESET_MAP[preset] || PRESET_MAP.friendly_builder;
}

function buildIdentityPromptProfile(identity) {
  const preset = resolveIdentityPreset(identity?.personalityPreset);
  const toneIntensity = clampNumber(identity?.toneIntensity, 0, 1, 0.5);
  const chatVerbosity = normalizeVerbosity(identity?.chatVerbosity);
  const verbosityHint =
    chatVerbosity === "quiet"
      ? "Prefer short answers."
      : chatVerbosity === "talkative"
        ? "Be a little more expressive while staying concise."
        : "Keep the tone balanced and concise.";
  const toneHint =
    toneIntensity <= 0.33
      ? "Keep the tone gentle and understated."
      : toneIntensity >= 0.67
        ? "Lean into the preset voice clearly, but stay bounded and practical."
        : "Let the preset voice come through without overpowering the task.";

  return {
    displayName: identity?.displayName || "Guardian",
    role: preset.role,
    personality: `${preset.personality} ${verbosityHint} ${toneHint}`.trim(),
    preview: preset.preview
  };
}

module.exports = {
  PRESET_MAP,
  buildIdentityPromptProfile,
  resolveIdentityPreset
};
