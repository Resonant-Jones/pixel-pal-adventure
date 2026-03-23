const { getStatementRows } = require("./surrealClient");
const { buildSignatureKey } = require("../agent/retrySignatures");
const { RecordId } = require("surrealdb");

function toIso() {
  return new Date().toISOString();
}

function limitWords(text, maxWords = 120) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}

function isSuccess(event) {
  return ["succeeded", "success"].includes(event.terminal_outcome);
}

function toRecordId(value, fallbackTable = "learning_events") {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && value.table && value.id !== undefined) {
    return value;
  }

  const raw = String(value);
  const separatorIndex = raw.indexOf(":");

  if (separatorIndex === -1) {
    return new RecordId(fallbackTable, raw);
  }

  const table = raw.slice(0, separatorIndex) || fallbackTable;
  const id = raw.slice(separatorIndex + 1);
  return new RecordId(table, id);
}

function sortOutcomes(events) {
  return events
    .slice()
    .sort((left, right) => {
      const leftSuccess = isSuccess(left);
      const rightSuccess = isSuccess(right);

      if (leftSuccess !== rightSuccess) {
        return leftSuccess ? -1 : 1;
      }

      return String(right.timestamp || "").localeCompare(String(left.timestamp || ""));
    });
}

function summarizeGuidance(events, { actionType, retryDomain, includeEnvironmentConstraint = false } = {}) {
  if (!events.length) {
    return "No recent local outcomes matched this retry pattern.";
  }

  const successes = events.filter(isSuccess);
  const failures = events.filter((event) => !isSuccess(event));
  const lines = [];

  if (successes.length) {
    lines.push(`Recent successes for ${actionType}: ${successes.length}.`);
  }

  if (failures.length) {
    const recentFailure = failures[0];
    lines.push(
      `Recent failure patterns: ${recentFailure.error_code || recentFailure.error_category || "unknown_error"}.`
    );
  }

  if (includeEnvironmentConstraint) {
    lines.push("Recent local connection instability may still affect retries.");
  }

  return limitWords(lines.slice(0, 3).join(" "), 120);
}

function summarizeWhatWorked(events) {
  const successes = events.filter(isSuccess);
  if (!successes.length) {
    return "No recent successful recoveries recorded yet.";
  }

  const counts = new Map();
  for (const event of successes) {
    const key = event.action_type || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const top = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([key, count]) => `${key} (${count})`)
    .join(", ");

  return limitWords(`Recent successes: ${top}.`, 60);
}

class LearningStore {
  constructor(client) {
    this.client = client;
  }

  async recordLearningEvent({
    eventType,
    turnId,
    attemptId,
    commandId = null,
    threadId,
    worldId = null,
    sessionId = null,
    retryDomain,
    signature,
    actionType = "none",
    provider = null,
    operationSubtype = null,
    terminalOutcome = null,
    status = null,
    metadata = {},
    timestamp = toIso()
  }) {
    const signatureKey = buildSignatureKey(signature);

    const event = {
      event_type: eventType,
      turn_id: turnId,
      attempt_id: attemptId,
      command_id: commandId,
      thread_id: threadId,
      world_id: worldId,
      session_id: sessionId,
      retry_domain: retryDomain,
      action_type: actionType,
      provider,
      operation_subtype: operationSubtype,
      signature,
      signature_key: signatureKey,
      signature_version: signature?.signatureVersion || null,
      error_code: signature?.errorCode || null,
      error_category: signature?.errorCategory || null,
      terminal_outcome: terminalOutcome,
      status,
      metadata,
      timestamp
    };

    const [created] = await this.client.query(
      "CREATE learning_events CONTENT $event RETURN AFTER;",
      { event }
    );

    return getStatementRows(created)[0] || event;
  }

  async relateAttemptOutcome({
    attemptId,
    outcomeId,
    threadId,
    worldId = null,
    turnId,
    relationType = "attempt_to_outcome",
    timestamp = toIso()
  }) {
    if (!attemptId || !outcomeId) {
      return null;
    }

    const attempt = toRecordId(attemptId);
    const outcome = toRecordId(outcomeId);
    const edge = {
      thread_id: threadId,
      world_id: worldId,
      turn_id: turnId,
      attempt_id: String(attempt),
      relation_type: relationType,
      timestamp
    };

    const [created] = await this.client.query(
      "RELATE $attempt->learning_edges->$outcome CONTENT $edge RETURN AFTER;",
      {
        attempt,
        outcome,
        edge
      }
    );

    return getStatementRows(created)[0] || edge;
  }

  async queryOutcomeBucket({
    threadId = null,
    worldId = null,
    retryDomain = null,
    actionType = null,
    signatureKey = null,
    limit = 12,
    since
  }) {
    const filters = ['event_type = "retry_outcome"', "timestamp >= $since"];
    const parameters = {
      since,
      limit
    };

    if (actionType) {
      filters.push("action_type = $actionType");
      parameters.actionType = actionType;
    }

    if (threadId) {
      filters.push("thread_id = $threadId");
      parameters.threadId = threadId;
    }

    if (worldId) {
      filters.push("world_id = $worldId");
      parameters.worldId = worldId;
    }

    if (retryDomain) {
      filters.push("retry_domain = $retryDomain");
      parameters.retryDomain = retryDomain;
    }

    if (signatureKey) {
      filters.push("signature_key = $signatureKey");
      parameters.signatureKey = signatureKey;
    }

    const [selected] = await this.client.query(
      `SELECT * FROM learning_events WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT $limit;`,
      parameters
    );

    return sortOutcomes(getStatementRows(selected));
  }

  async getOutcomeGuidance({
    threadId,
    worldId,
    retryDomain,
    actionType,
    signature,
    limit = 12,
    maxAgeMinutes = 180
  }) {
    if (!actionType) {
      return { guidance: "No recent local outcomes matched this retry pattern.", events: [], scope: "none" };
    }

    const signatureKey = signature ? buildSignatureKey(signature) : null;
    const since = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
    const buckets = [
      {
        scope: "world_thread_signature",
        query: () =>
          this.queryOutcomeBucket({
            threadId,
            worldId,
            retryDomain: retryDomain === "connection" ? retryDomain : retryDomain,
            actionType,
            signatureKey,
            limit,
            since
          })
      },
      {
        scope: "world_signature",
        query: () =>
          this.queryOutcomeBucket({
            worldId,
            retryDomain: retryDomain === "connection" ? retryDomain : retryDomain,
            actionType,
            signatureKey,
            limit,
            since
          })
      },
      {
        scope: "world_action",
        query: () =>
          this.queryOutcomeBucket({
            worldId,
            retryDomain: retryDomain === "connection" ? retryDomain : retryDomain,
            actionType,
            limit,
            since
          })
      },
      {
        scope: "local_fallback",
        query: () =>
          this.queryOutcomeBucket({
            threadId,
            retryDomain: retryDomain === "connection" ? retryDomain : retryDomain,
            actionType,
            limit: Math.min(limit, 6),
            since
          })
      }
    ];

    for (const bucket of buckets) {
      const events = await bucket.query();
      if (events.length) {
        const connectionConstraint =
          retryDomain !== "connection" &&
          (await this.queryOutcomeBucket({
            threadId,
            worldId,
            retryDomain: "connection",
            actionType,
            limit: 2,
            since
          })).length > 0 &&
          events.length < 3;

        return {
          guidance: summarizeGuidance(events.slice(0, 12), {
            actionType,
            retryDomain,
            includeEnvironmentConstraint: connectionConstraint
          }),
          events: events.slice(0, 12),
          scope: bucket.scope
        };
      }
    }

    return {
      guidance: "No recent local outcomes matched this retry pattern.",
      events: [],
      scope: "none"
    };
  }

  async getRecentOutcomeSummary({
    threadId,
    worldId = null,
    limit = 12,
    maxAgeMinutes = 180
  }) {
    if (!threadId) {
      return { summary: "No outcome history available yet.", events: [], scope: "none" };
    }

    const since = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
    const localEvents = await this.queryOutcomeBucket({
      threadId,
      worldId,
      limit,
      since
    });

    if (localEvents.length) {
      return {
        summary: summarizeWhatWorked(localEvents.slice(0, limit)),
        events: localEvents.slice(0, limit),
        scope: "world_thread"
      };
    }

    const fallbackFilters = ["thread_id = $threadId", 'event_type = "retry_outcome"', "timestamp >= $since"];
    const parameters = { threadId, since, limit };
    const [selected] = await this.client.query(
      `SELECT * FROM learning_events WHERE ${fallbackFilters.join(" AND ")} ORDER BY timestamp DESC LIMIT $limit;`,
      parameters
    );
    const fallbackEvents = sortOutcomes(getStatementRows(selected));

    return {
      summary: summarizeWhatWorked(fallbackEvents.slice(0, limit)),
      events: fallbackEvents.slice(0, limit),
      scope: "local_fallback"
    };
  }
}

module.exports = {
  LearningStore,
  summarizeGuidance,
  summarizeWhatWorked,
  sortOutcomes
};
