# Persistence

This repo uses SurrealDB as the durable state store for conversation, world/session state, build jobs, reflex cooldowns, and retry learning.

## Storage Surface

| Table / relation | Source file | Purpose |
| --- | --- | --- |
| `messages` | `memory/messageStore.js` | Chat history for prompt context |
| `events` | `memory/eventStore.js` | Lifecycle, reflex, retry, and build events |
| `worlds` | `memory/worldStore.js` | Durable world identity and last-seen metadata |
| `sessions` | `memory/sessionStore.js` | Per-connect runtime sessions |
| `characters` | `memory/messageStore.js` | Prompt-facing companion character record |
| `jobs` | `memory/jobStore.js` | Reflex and build work queue |
| `reflex_state` | `memory/reflexStateStore.js` | Cooldown and last-seen state for reflex triggers |
| `companion_identity` | `memory/companionIdentityStore.js` | Active companion identity |
| `saved_profiles` | `memory/profileStore.js` | Saved live-config / identity profiles |
| `identity_profiles` | `schemas/surrealSchema.surql` | Schema-defined identity profiles table; not currently written by runtime code |
| `ui_preferences` | `schemas/surrealSchema.surql` | Schema-defined UI preferences table; not currently written by runtime code |
| `anchors` | `memory/anchorStore.js` | Durable build / point / area / path anchors |
| `learning_events` | `memory/learningStore.js` | Retry attempts and outcomes |
| `learning_edges` | `memory/learningStore.js` | Relations between attempt and outcome records |

## Effective Record Shapes

### `messages`

Stored fields:

- `thread_id`
- `world_id`
- `session_id`
- `speaker`
- `content`
- `source`
- `timestamp`
- `metadata`

`memory/messageStore.js` also seeds the `characters` table via `ensureCharacter()` so the prompt has a companion identity record to read from.

### `characters`

Stored fields:

- `name`
- `role`
- `personality`

This table is prompt-facing rather than turn-facing. It helps keep the companion name, role, and personality coherent.

### `events`

Stored fields:

- `thread_id`
- `world_id`
- `session_id`
- `type`
- `description`
- `location`
- `actor`
- `snapshot`
- `metadata`
- `timestamp`

### `jobs`

Stored fields:

- `world_id`
- `session_id`
- `thread_id`
- `type`
- `payload`
- `status`
- `progress`
- `created_at`
- `updated_at`
- optional `started_at`
- optional `completed_at`
- optional `result`
- optional `error`

### `learning_events`

Stored fields:

- `thread_id`
- `world_id`
- `session_id`
- `turn_id`
- `attempt_id`
- `command_id`
- `event_type`
- `retry_domain`
- `action_type`
- `provider`
- `operation_subtype`
- `signature`
- `signature_key`
- `signature_version`
- `error_code`
- `error_category`
- `terminal_outcome`
- `status`
- `metadata`
- `timestamp`

## Constraints That Matter

- `memory/sessionStore.js#createSession()` requires a `worldId`.
- `memory/reflexStateStore.js#upsertState()` requires both `worldId` and `triggerType`.
- `memory/learningStore.js#relateAttemptOutcome()` needs valid record IDs on both sides of the relation.
- `memory/surrealClient.js#sanitizeSurrealValue()` removes `null` values from nested objects before writes.
- `schemas/surrealSchema.surql` defines indexes on the hot query paths. Keeping the fields aligned with those indexes matters more than adding extra object noise.

## Failure Modes From Shape Drift

1. **Silent missing fields**
   - The write succeeds, but a dashboard or query later reads `undefined` where it expected a string or object.

2. **Query mismatch**
   - `learningStore` buckets, event filters, or dashboard views stop matching because the field name changed.

3. **Relation breakage**
   - `learning_edges` is only useful if attempt and outcome records remain valid `RecordId` values.

4. **Trigger mismatch**
   - The reflex job triggers in `schemas/surrealSchema.surql` depend on exact event `type` strings.

## Important Storage Pitfalls

- The tables are intentionally schemaless in SurrealDB, so code discipline is the real schema.
- Events and messages carry nested objects such as `snapshot` and `metadata`; those are useful, but they also make drift easy.
- The runtime writes both an event record and a learning record for retry attempts. If one succeeds and the other fails, the history becomes partially complete.
- `eventStore.findNearbyMemoryHints()` only works well when some code path writes nearby-location events with a usable `location`.

## Known Risks / Gaps

- Schema drift can hide until a query path or dashboard panel depends on the missing field.
- The `learning_events` table is designed for local guidance, not for large-scale analytics or long retention without cleanup.
- `messages` and `events` are the primary audit trail. If either store goes missing, operator debugging gets much harder.
