// agent/firstGreet.js
//
// One-shot "hello" the agent delivers when Panda_Nuggetz (or whoever the
// primary player is) first appears in the world. Independent of the reflex
// pipeline — does not consume reflex cooldowns, does not call the LLM, and
// only fires once per session.
//
// Trigger: a chat/observed event from the primary player that we haven't
// already greeted this session.
//
// Why this lives in its own module:
//  - keeps the runtime.js surface small
//  - easy to disable by setting WELCOME_GREET_DISABLED=1 in env
//  - easy to swap message text without touching the runtime

const DEFAULT_GREETING = (name, bot) =>
  `Hi ${name}! I'm ${bot}. I'll help you build, explore, and stay safe. Ask me anything or just say "welcome hut" if you want me to set up our base.`;

function pickGreeting(name, bot, customGreeting) {
  if (customGreeting && typeof customGreeting === "string" && customGreeting.trim()) {
    return customGreeting.replace(/\{player\}/gi, name).replace(/\{bot\}/gi, bot);
  }
  return DEFAULT_GREETING(name, bot);
}

class FirstGreet {
  constructor({
    logger = console,
    greeting = null,
    primaryPlayer,
    companionName
  }) {
    this.logger = logger;
    this.primaryPlayer = primaryPlayer;
    this.companionName = companionName;
    this.greeting = greeting;
    this.deliveredThisSession = false;
  }

  shouldGreet(payload) {
    if (this.deliveredThisSession) return false;
    if (!payload || payload.username !== this.primaryPlayer) return false;
    return true;
  }

  async deliver(botAdapter, payload) {
    if (!this.shouldGreet(payload)) return false;
    this.deliveredThisSession = true;
    const message = pickGreeting(this.primaryPlayer, this.companionName, this.greeting);
    try {
      await botAdapter.say(message);
      this.logger.info?.(`[first-greet] Delivered greeting to ${this.primaryPlayer}`);
      return true;
    } catch (err) {
      this.logger.error?.(`[first-greet] Failed to deliver: ${err.message}`);
      return false;
    }
  }
}

module.exports = { FirstGreet, pickGreeting, DEFAULT_GREETING };