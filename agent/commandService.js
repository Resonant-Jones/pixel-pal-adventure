const crypto = require("crypto");

const { nowIso } = require("./runtimeState");

class CommandService {
  constructor({ handlers = {}, logger = console } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.logger = logger;
  }

  register(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  normalize(command = {}) {
    return {
      commandId: command.commandId || crypto.randomUUID(),
      timestamp: command.timestamp || nowIso(),
      ...command
    };
  }

  async execute(command, context = {}) {
    const normalized = this.normalize(command);
    const handler = this.handlers.get(normalized.type);

    if (!handler) {
      const error = new Error(`Unsupported command type "${normalized.type}".`);
      error.code = "unsupported_command";
      throw error;
    }

    this.logger.info?.(`[command] ${normalized.type} ${normalized.commandId}`);
    return handler(normalized, context);
  }
}

module.exports = {
  CommandService
};
