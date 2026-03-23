const assert = require("assert");

const { MinecraftBotAdapter } = require("../minecraft/bot");

async function testDisconnectUsesEnd() {
  let endMessage = null;
  let stopGoalCalled = false;

  const adapter = new MinecraftBotAdapter(
    {
      host: "127.0.0.1",
      port: 25565,
      username: "Guardian",
      primaryPlayer: "Sage",
      followDistance: 2
    },
    {
      info() {},
      warn() {},
      error() {}
    }
  );

  adapter.bot = {
    end(message) {
      endMessage = message;
    },
    pathfinder: {
      setGoal(goal) {
        if (goal === null) {
          stopGoalCalled = true;
        }
      }
    }
  };

  await adapter.disconnect();

  assert.strictEqual(endMessage, "Guardian signing off");
  assert.strictEqual(stopGoalCalled, true);
  assert.strictEqual(adapter.bot, null);
}

Promise.resolve()
  .then(testDisconnectUsesEnd)
  .then(() => {
    console.log("minecraftBotAdapter tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
