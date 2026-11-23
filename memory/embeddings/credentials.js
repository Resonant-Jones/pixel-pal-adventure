// memory/embeddings/credentials.js
//
// Where an API key chosen in the picker lives.
//
// WHY IT IS NOT IN .env
//
// The whole point of the picker is that a user should not have to open a
// dotfile to use the thing they picked. A key typed into the panel is
// written here instead, and the file is never committed: it lives under
// `.local/`, which is already ignored.
//
// WHY IT IS NOT IN THE DATABASE
//
// The database holds memories, not secrets. A key that has to be readable
// by the agent and the companion app, but that neither of them should be
// able to leak into a memory dump, belongs in a file with tight
// permissions rather than in a table.
//
// WHAT ELSE IS HERE
//
// The key is stored per provider, so switching between OpenAI and a local
// model does not lose the one you are not currently using.

const fs = require("node:fs");
const path = require("node:path");

const CREDENTIALS_FILE = path.resolve(__dirname, "..", "..", ".local", "credentials.json");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readAll(filePath = CREDENTIALS_FILE) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // A corrupt credentials file must not stop the agent from starting. The
    // worst case is that the user types the key again.
    return {};
  }
}

function writeAll(credentials, filePath = CREDENTIALS_FILE) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });

  // writeFile only applies mode when it creates the file, so set it again.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort. The directory is already inside the project.
  }

  return credentials;
}

/**
 * The key for a provider, preferring what the user typed over what is in
 * the environment.
 */
function credentialFor(providerId, env = process.env, filePath = CREDENTIALS_FILE) {
  const id = String(providerId || "").trim().toLowerCase();
  const stored = readAll(filePath);

  const fromStore = stored?.[id]?.apiKey;
  if (fromStore) {
    return String(fromStore);
  }

  const envNames = {
    openai: ["OPENAI_API_KEY"],
    compatible: ["COMPATIBLE_EMBED_API_KEY"],
    minimax: ["MINIMAX_API_KEY"],
    codexify: ["CODEXIFY_API_KEY", "GUARDIAN_API_KEY"]
  }[id] || [];

  for (const name of envNames) {
    const value = String(env[name] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function storeCredential(providerId, apiKey, filePath = CREDENTIALS_FILE) {
  const id = String(providerId || "").trim().toLowerCase();

  if (!id) {
    return readAll(filePath);
  }

  const credentials = readAll(filePath);

  if (apiKey === null || apiKey === undefined || String(apiKey).trim() === "") {
    delete credentials[id];
  } else {
    credentials[id] = {
      apiKey: String(apiKey).trim(),
      updated_at: new Date().toISOString()
    };
  }

  return writeAll(credentials, filePath);
}

function hasStoredCredential(providerId, env = process.env, filePath = CREDENTIALS_FILE) {
  return Boolean(credentialFor(providerId, env, filePath));
}

module.exports = {
  CREDENTIALS_FILE,
  credentialFor,
  hasStoredCredential,
  readAll,
  storeCredential,
  writeAll
};
