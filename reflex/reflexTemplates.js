function renderReflexMessage(job) {
  const reflexType = job?.payload?.reflex_type || "unknown";
  const metadata = job?.payload?.metadata || {};
  const memoryHint = metadata.memory_hint || null;

  switch (reflexType) {
    case "creeper_nearby":
      return "Careful, creeper nearby!";
    case "mob_nearby":
      return "Heads up, hostile mob nearby.";
    case "player_health_low":
      return "I am hurt. We should be careful.";
    case "night_approaching":
      return "Night is coming. We should find shelter soon.";
    case "village_found":
      return "That looks like a village. We should investigate.";
    case "cave_found":
      return "That looks like a cave entrance.";
    case "rare_biome_found":
      return "This biome looks unusual.";
    case "interesting_terrain":
      return "This area looks promising for a build.";
    case "player_idle":
      return "Want to explore the area around us?";
    case "memory_proximity":
      if (memoryHint?.name) {
        return `This is close to ${memoryHint.name}.`;
      }

      if (memoryHint?.description) {
        return `This feels familiar. ${memoryHint.description}`;
      }

      return "This place feels familiar.";
    default:
      return "";
  }
}

module.exports = {
  renderReflexMessage
};
