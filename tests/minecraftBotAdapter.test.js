const assert = require("assert");

const { MinecraftBotAdapter, resolveSupportedMinecraftVersion } = require("../minecraft/bot");

function testConfiguredVersionResolvesWhenSupported() {
  const resolvedVersion = resolveSupportedMinecraftVersion({
    configuredVersion: "1.21.11"
  });

  assert.strictEqual(resolvedVersion, "1.21.11");
}

function testUnsupportedServerVersionThrowsHelpfulError() {
  assert.throws(
    () =>
      resolveSupportedMinecraftVersion({
        serverVersionName: "26.1.1",
        protocolVersion: 775
      }),
    (error) => {
      assert.strictEqual(error.code, "unsupported_minecraft_version");
      assert.strictEqual(error.serverVersionName, "26.1.1");
      assert.strictEqual(error.protocolVersion, 775);
      assert.deepStrictEqual(error.candidates, ["26.1"]);
      return true;
    }
  );
}

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
  .then(testConfiguredVersionResolvesWhenSupported)
  .then(testUnsupportedServerVersionThrowsHelpfulError)
  .then(testDisconnectUsesEnd)
  .then(() => {
    console.log("minecraftBotAdapter tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
