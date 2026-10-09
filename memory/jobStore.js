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
      "UPDATE type::record($jobId) MERGE { status: \"running\", started_at: $startedAt, updated_at: $startedAt } RETURN AFTER;",
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

    let selected;
    try {
      // Must destructure the outer array. `client.query()` returns one entry
      // per statement — `[[row, row, ...]]`. Assigning the whole result leaves
      // `jobs` as a single-element array whose only element is an ARRAY, so
      // every `job.status` reads undefined, the filter drops everything, and
      // the worker silently returns null while jobs sit in `pending` forever.
      [selected] = await this.client.query(
        'SELECT * FROM jobs WHERE world_id = $worldId AND type INSIDE ["build_structure", "build_emergent"] AND status INSIDE ["pending", "paused"] ORDER BY created_at ASC LIMIT 20;',
        {
          worldId
        }
      );
    } catch (error) {
      // Swallow transient DB errors so the worker's poll loop survives auth
      // refreshes, network blips, or schema hiccups. The next tick will retry.
      console.warn("[jobStore] getNextBuildJob failed (will retry next tick):", error?.message || error);
      return null;
    }

    const jobs = getStatementRows(selected);
    const now = Date.now();
    const priority = {
      paused: 0,
      pending: 1
    };

    return (
      jobs
        .filter((job) => {
          if (job.status === "pending") {
            return true;
          }

          if (job.status === "paused") {
            if (!job.resume_at) {
              return true;
            }

            const resumeAt = Date.parse(job.resume_at);
            return Number.isFinite(resumeAt) ? resumeAt <= now : false;
          }

          return false;
        })
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

  async getActiveBuildJob(worldId) {
    if (!worldId) {
      return null;
    }

    const [selected] = await this.client.query(
      'SELECT * FROM jobs WHERE world_id = $worldId AND type INSIDE ["build_structure", "build_emergent"] AND status INSIDE ["running", "paused", "pending"] ORDER BY updated_at DESC LIMIT 1;',
      {
        worldId
      }
    );

    return getStatementRows(selected)[0] || null;
  }

  async updateJob(jobId, patch = {}) {
    const payload = {
      ...patch,
      updated_at: patch.updated_at || toIso()
    };

    const [updated] = await this.client.query("UPDATE type::record($jobId) MERGE $patch RETURN AFTER;", {
      jobId,
      patch: payload
    });

    return getStatementRows(updated)[0] || null;
  }

  async completeJob(jobId, result = {}, completedAt = toIso()) {
    const [updated] = await this.client.query(
      "UPDATE type::record($jobId) MERGE { status: \"completed\", progress: 100, result: $result, completed_at: $completedAt, updated_at: $completedAt } RETURN AFTER;",
      {
        jobId,
        result,
        completedAt
      }
    );

    return getStatementRows(updated)[0] || null;
  }

  async pauseJob(jobId, error = {}, resumeAt = toIso(), patch = {}) {
    const updatedAt = toIso();
    const [updated] = await this.client.query("UPDATE type::record($jobId) MERGE $patch RETURN AFTER;", {
      jobId,
      patch: {
        ...patch,
        status: "paused",
        error,
        resume_at: resumeAt,
        updated_at: updatedAt
      }
    });

    return getStatementRows(updated)[0] || null;
  }

  async failJob(jobId, error = {}, completedAt = toIso()) {
    const [updated] = await this.client.query(
      "UPDATE type::record($jobId) MERGE { status: \"failed\", error: $error, completed_at: $completedAt, updated_at: $completedAt } RETURN AFTER;",
      {
        jobId,
        error,
        completedAt
      }
    );

    return getStatementRows(updated)[0] || null;
  }

  // Make a paused job immediately eligible again.
  //
  // Resume has to actively clear the backoff, because getNextBuildJob() skips
  // any job whose resume_at is still in the future. Without this, a child
  // saying "keep going" would be ignored for up to the full material-delay
  // window and the bot would look like it had not heard him.
  async resumeBuildJob(jobId, resumeAt = toIso()) {
    if (!jobId) {
      return null;
    }

    const updatedAt = toIso();
    const payload = {
      jobId,
      resumeAt,
      updatedAt
    };

    const [updated] = await this.client.query(
      'UPDATE type::record($jobId) SET status = "pending", resume_at = $resumeAt, updated_at = $updatedAt WHERE $jobId RETURN AFTER;',
      payload
    );

    return getStatementRows(updated)[0] || null;
  }

  async pauseRunningJobs(worldId, updatedAt = toIso()) {
    if (!worldId) {
      return [];
    }

    const [updated] = await this.client.query(
      "UPDATE jobs SET status = 'paused', resume_at = $updatedAt, updated_at = $updatedAt WHERE world_id = $worldId AND status = 'running' RETURN AFTER;",
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
