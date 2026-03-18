import type { RuntimeEvent } from "../../../shared/contracts";

export function toFriendlyEventText(event: RuntimeEvent): string {
  switch (event.type) {
    case "minecraft_reconnect_started":
      return "I got disconnected. Rejoining now.";
    case "minecraft_reconnect_succeeded":
      return "I’m back in the world.";
    case "minecraft_reconnect_failed":
      return "I’m having trouble getting back in right now.";
    case "retry_started":
      return "That didn’t work. I’m trying another way.";
    case "retry_loop_detected":
      return "I’m stuck on that right now.";
    case "graph_guidance_used":
      return "I remembered something that helped before.";
    case "task_completed":
      return "I finished that.";
    case "task_failed":
      return "I couldn’t finish that yet.";
    case "task_started":
      return "I’m working on it.";
    default:
      return "I’m keeping track of what’s happening.";
  }
}
