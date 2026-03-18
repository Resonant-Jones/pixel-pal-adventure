const { getStatementRows } = require("./surrealClient");

function toIso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

class JobStore {
  constructor(client) {
    this.client = client;
  }

  async createJob({
    worldId,
    sessionId,
    threadId,
    type,
    payload = {},
    status = "pending",
    progress = 0,
    createdAt = toIso()
  }) {
    const job = {
      world_id: worldId,
      session_id: sessionId,
      thread_id: threadId,
      type,
      payload,
      status,
      progress,
      created_at: createdAt,
      updated_at: createdAt
    };

    const [created] = await this.client.query("CREATE jobs CONTENT $job RETURN AFTER;", {
      job
    });

    return getStatementRows(created)[0] || job;
  }

  async getNextPendingReflexJob(worldId) {
    if (!worldId) {
      return null;
    }

    const [selected] = await this.client.query(
      'SELECT * FROM jobs WHERE world_id = $worldId AND status = "pending" AND type INSIDE ["reflex_warning", "reflex_comment", "reflex_suggestion", "reflex_memory_callback"] ORDER BY created_at ASC LIMIT 1;',
      {
        worldId
      }
    );

    return getStatementRows(selected)[0] || null;
  }

  async markRunning(jobId, startedAt = toIso()) {
    const [updated] = await this.client.query(
      "UPDATE $jobId MERGE { status: 'running', started_at: $startedAt, updated_at: $startedAt } RETURN AFTER;",
      {
        jobId,
        startedAt
      }
    );

    return getStatementRows(updated)[0] || null;
  }

  async getNextBuildJob(worldId) {
    if (!worldId) {
      return null;
    }

    const [selected] = await this.client.query(
      'SELECT * FROM jobs WHERE world_id = $worldId AND type = "build_structure" AND status INSIDE ["pending", "paused"] ORDER BY created_at ASC LIMIT 20;',
      {
        worldId
      }
    );

    const jobs = getStatementRows(selected);
    const priority = {
      paused: 0,
      pending: 1
    };

    return (
      jobs
        .slice()
        .sort((left, right) => {
          const statusDelta = (priority[left.status] || 99) - (priority[right.status] || 99);
          if (statusDelta !== 0) {
            return statusDelta;
          }

          return String(left.created_at || "").localeCompare(String(right.created_at || ""));
        })[0] || null
    );
  }

  async updateJob(jobId, patch = {}) {
    const payload = {
      ...patch,
      updated_at: patch.updated_at || toIso()
    };

    const [updated] = await this.client.query("UPDATE $jobId MERGE $patch RETURN AFTER;", {
      jobId,
      patch: payload
    });

    return getStatementRows(updated)[0] || null;
  }

  async completeJob(jobId, result = {}, completedAt = toIso()) {
    const [updated] = await this.client.query(
      "UPDATE $jobId MERGE { status: 'completed', progress: 100, result: $result, completed_at: $completedAt, updated_at: $completedAt } RETURN AFTER;",
      {
        jobId,
        result,
        completedAt
      }
    );

    return getStatementRows(updated)[0] || null;
  }

  async failJob(jobId, error = {}, completedAt = toIso()) {
    const [updated] = await this.client.query(
      "UPDATE $jobId MERGE { status: 'failed', error: $error, completed_at: $completedAt, updated_at: $completedAt } RETURN AFTER;",
      {
        jobId,
        error,
        completedAt
      }
    );

    return getStatementRows(updated)[0] || null;
  }

  async pauseRunningJobs(worldId, updatedAt = toIso()) {
    if (!worldId) {
      return [];
    }

    const [updated] = await this.client.query(
      "UPDATE jobs SET status = 'paused', updated_at = $updatedAt WHERE world_id = $worldId AND status = 'running' RETURN AFTER;",
      {
        worldId,
        updatedAt
      }
    );

    return getStatementRows(updated);
  }
}

module.exports = {
  JobStore
};
