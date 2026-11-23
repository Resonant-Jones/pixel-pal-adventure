# The embedder picker — how Guardian turns a sentence into something it can find again

**Written:** 2026-11-23
**Status:** picker built and verified live. The memory system that *consumes*
the chosen embedder is not built yet — see §7.

---

## 1. The requirement

> *"we need to make this part configurable where a user can pick and choose an
> embedder though openai or their provider of choice or a local option without
> digging into 'deep settings'"*

Two clauses, and the second one is the harder one.

**"pick and choose an embedder"** is easy to satisfy with an environment
variable. **`"without digging into deep settings"`** is the actual constraint:
the choice has to be reachable from a screen, by someone who has never opened
a dotfile, and it has to be possible to pick a provider that does not work
yet — because you cannot paste a key into a menu that only lists providers
that already have keys.

## 2. The rule

A provider is offered if it can be **made to work** by a user, not only if it
happens to work on this machine right now.

What changes is the *status* beside it: ready, needs a key, broken. What
never changes is the *list*. A list that shows only what is currently
configured is deep settings with extra steps — the user cannot see the option
they want, only the one that is already on.

## 3. The catalogue

| id | label | needs | notes |
|---|---|---|---|
| `codexify` | Codexify | address | The model Codexify already runs. Same vectors Codexify stores. |
| `deterministic` | Built-in (offline) | nothing | The floor. Cannot fail. Lexical, not semantic — it says so. |
| `openai` | OpenAI | key, model | `text-embedding-3-small` by default. |
| `compatible` | Another provider | key, address, model | Any service speaking the OpenAI embeddings API. Together, Groq, Voyage, Jina, LM Studio, vLLM. |
| `minimax` | MiniMax | key, model | `embo-01`, on the key already in `.env`. |

Every one of them is always listed. On this machine, today:

```
codexify      LOCAL        the backend is not running
deterministic IN USE       256 dimensions, no network
openai        NEEDS A KEY  no key yet
compatible    NEEDS A KEY  no key yet
minimax       KEY SAVED    the key exists but has no embeddings quota
```

## 4. The contract with Codexify

Guardian's embedder interface mirrors Codexify's `MemoryOSEmbedder`
(`guardian/memoryos/embedders/base.py`): a `name`, `embed(text)` and
`embed_batch(texts)`, plus `modelName` and `dimension`.

That is on purpose. The same provider produces the same vector in either
place, which is what makes memory portable between this laptop and the server
instead of two systems that quietly disagree about what a thing means.

Codexify's HTTP contract:

```
POST {base}/api/embeddings
  { "texts": [...], "embedder": "local", "model": "..." }
  -> { "provider": "local", "model": "...", "vectors": [[...], ...] }

GET {base}/api/health/embedder
```

Auth header: `X-Guardian-Key`. The bearer form is sent too, since a proxy in
front of it may prefer that.

**The address is not a forever address.** The base URL is a *field in the
panel*, it travels with the choice, and it is persisted with it. The
Codexify backend on the server and the Codexify backend on the laptop are the
same software at different doors; the panel is where that difference gets
settled.

## 5. How a choice is made

Three rules make it honest:

1. **A choice is probed before it is believed.** Picking a provider that does
   not work reports why, in a sentence — "No API key for the openai embedder.
   Paste the key in the Memory panel" — instead of leaving the user to
   discover it later as silently empty search results.
2. **A choice is remembered.** It lives in `ui_preferences`, keyed
   `memory.embedder`, so it survives a restart without anyone touching a
   dotfile.
3. **A broken choice degrades loudly.** The floor is the deterministic
   provider, and the status says the fallback is in use and why.

Failure messages carry a `code` and a `remedy`. A stack trace is not an
answer.

## 6. Where the code is

```
memory/embeddings/base.js              the interface, and the vector rules
memory/embeddings/registry.js           the catalogue, the probe, providerEnv()
memory/embeddings/credentials.js        .local/credentials.json, 0600, per provider
memory/embeddings/providers/…           deterministic, codexify, openaiCompatible, minimax
memory/uiPreferenceStore.js             ui_preferences, schemaless
agent/agentRuntime.js                   getEmbedder, getEmbeddingStatus, probeEmbedder, setEmbedder
control/localControlServer.js           GET/POST /memory/embedder, POST /memory/embedder/probe
companion/companionApp.js               proxies /api/memory/embedder{,/probe}
companion/ui/                           the Memory panel
```

**Keys typed into the panel go to `.local/credentials.json`** (mode 0600,
gitignored), not to `.env` and not to the database. A key the agent and the
companion app must both reach, but that neither should be able to leak into a
memory dump, belongs in a file with tight permissions rather than in a table.
The database holds memories, not secrets.

### One bug worth remembering

The first version read the *active* provider's credential when building a
provider. Since credentials are stored per provider, that made every
freshly-typed key look like "no key" at exactly the moment it was wanted —
the probe of the provider you were typing a key *for* never saw the key you
had just typed.

The fix is `providerEnv(providerId, …)`: the environment is built *for* the
provider being probed. It is pinned by
`tests/embedderPicker.test.js`.

## 7. What is not built

**Nothing consumes the chosen embedder yet.** The picker selects and verifies
a provider; there is no semantic memory store writing vectors into SurrealDB
and no retrieval path searching them. That is the next build, and it is a
separate piece of work: SurrealDB 3.0.4 cannot search vectors server-side
(no HNSW before 3.1, no `vector::similarity`, and closures are disabled so
cosine cannot be computed in SurrealQL), so candidate fetch happens in Node
and the similarity is computed in JavaScript.
