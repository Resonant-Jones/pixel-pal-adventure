function isAirBlock(block) {
  return !block || ["air", "cave_air", "void_air"].includes(block.name);
}

function evaluateBuildProgress({ botAdapter, origin, placements = [] }) {
  if (!botAdapter?.bot || !origin) {
    return {
      completion_percent: 0,
      missing_blocks_count: 0,
      wrong_blocks_count: 0,
      obstructed_positions: [],
      recommended_next_actions: [],
      stall_reason: "missing_context",
      last_meaningful_progress_at: null
    };
  }

  let correct = 0;
  let missing = 0;
  let wrong = 0;
  const obstructed = [];

  for (const placement of placements) {
    const absolute = {
      x: origin.x + placement.x,
      y: origin.y + placement.y,
      z: origin.z + placement.z
    };

    const block = botAdapter.bot.blockAt(absolute);
    if (!block || isAirBlock(block)) {
      missing += 1;
      continue;
    }

    if (block.name === placement.block) {
      correct += 1;
      continue;
    }

    wrong += 1;
    obstructed.push(absolute);
  }

  const total = placements.length || 0;
  const completion = total ? Math.round((correct / total) * 100) : 0;
  const recommended = [];

  if (missing > 0) {
    recommended.push("place_block");
  }

  if (wrong > 0) {
    recommended.push("break_block");
  }

  return {
    completion_percent: completion,
    phase_status: completion === 100 ? "complete" : "in_progress",
    missing_blocks_count: missing,
    wrong_blocks_count: wrong,
    obstructed_positions: obstructed.slice(0, 12),
    recommended_next_actions: recommended,
    stall_reason: null,
    last_meaningful_progress_at: new Date().toISOString()
  };
}

function buildFeedbackPacket(progress, options = {}) {
  if (!progress) {
    return null;
  }

  return {
    type: "build_progress",
    priority: progress.completion_percent >= 80 ? "low" : "medium",
    source: "build",
    summary: `Build progress ${progress.completion_percent}% (${progress.missing_blocks_count} missing, ${progress.wrong_blocks_count} wrong).`,
    diagnostic_code: options.diagnostic_code || null,
    speakable_summary: options.speakable_summary || null,
    cooldown_seconds: options.cooldown_seconds || 20,
    metadata: {
      completion_percent: progress.completion_percent,
      missing_blocks_count: progress.missing_blocks_count,
      wrong_blocks_count: progress.wrong_blocks_count,
      obstructed_positions: progress.obstructed_positions
    }
  };
}

module.exports = {
  evaluateBuildProgress,
  buildFeedbackPacket
};
