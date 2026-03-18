DEFINE TABLE IF NOT EXISTS messages SCHEMALESS;
DEFINE FIELD IF NOT EXISTS thread_id ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS speaker ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS content ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS source ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE messages TYPE string;
DEFINE FIELD IF NOT EXISTS metadata ON TABLE messages TYPE object;
DEFINE INDEX IF NOT EXISTS messages_thread_world_timestamp ON TABLE messages COLUMNS thread_id, world_id, timestamp;

DEFINE TABLE IF NOT EXISTS events SCHEMALESS;
DEFINE FIELD IF NOT EXISTS thread_id ON TABLE events TYPE string;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE events TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON TABLE events TYPE string;
DEFINE FIELD IF NOT EXISTS type ON TABLE events TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE events TYPE string;
DEFINE FIELD IF NOT EXISTS actor ON TABLE events TYPE string;
DEFINE FIELD IF NOT EXISTS location ON TABLE events TYPE object;
DEFINE FIELD IF NOT EXISTS snapshot ON TABLE events TYPE object;
DEFINE FIELD IF NOT EXISTS metadata ON TABLE events TYPE object;
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE events TYPE string;
DEFINE INDEX IF NOT EXISTS events_thread_world_timestamp ON TABLE events COLUMNS thread_id, world_id, timestamp;
DEFINE INDEX IF NOT EXISTS events_world_type_timestamp ON TABLE events COLUMNS world_id, type, timestamp;

DEFINE TABLE IF NOT EXISTS characters SCHEMALESS;
DEFINE FIELD IF NOT EXISTS name ON TABLE characters TYPE string;
DEFINE FIELD IF NOT EXISTS role ON TABLE characters TYPE string;
DEFINE FIELD IF NOT EXISTS personality ON TABLE characters TYPE string;
DEFINE INDEX IF NOT EXISTS characters_name ON TABLE characters COLUMNS name UNIQUE;

DEFINE TABLE IF NOT EXISTS worlds SCHEMALESS;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE worlds TYPE string;
DEFINE FIELD IF NOT EXISTS server_address ON TABLE worlds TYPE string;
DEFINE FIELD IF NOT EXISTS spawn_location ON TABLE worlds TYPE object;
DEFINE FIELD IF NOT EXISTS dimension ON TABLE worlds TYPE string;
DEFINE FIELD IF NOT EXISTS server_brand ON TABLE worlds TYPE string;
DEFINE FIELD IF NOT EXISTS first_seen ON TABLE worlds TYPE string;
DEFINE FIELD IF NOT EXISTS last_seen ON TABLE worlds TYPE string;
DEFINE INDEX IF NOT EXISTS worlds_world_id ON TABLE worlds COLUMNS world_id UNIQUE;

DEFINE TABLE IF NOT EXISTS sessions SCHEMALESS;
DEFINE FIELD IF NOT EXISTS session_id ON TABLE sessions TYPE string;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE sessions TYPE string;
DEFINE FIELD IF NOT EXISTS thread_id ON TABLE sessions TYPE string;
DEFINE FIELD IF NOT EXISTS primary_player ON TABLE sessions TYPE string;
DEFINE FIELD IF NOT EXISTS start_time ON TABLE sessions TYPE string;
DEFINE FIELD IF NOT EXISTS end_time ON TABLE sessions TYPE option<string>;
DEFINE INDEX IF NOT EXISTS sessions_session_id ON TABLE sessions COLUMNS session_id UNIQUE;
DEFINE INDEX IF NOT EXISTS sessions_world_start ON TABLE sessions COLUMNS world_id, start_time;

DEFINE TABLE IF NOT EXISTS jobs SCHEMALESS;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS thread_id ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS type ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS payload ON TABLE jobs TYPE object;
DEFINE FIELD IF NOT EXISTS status ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS progress ON TABLE jobs TYPE number;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE jobs TYPE string;
DEFINE FIELD IF NOT EXISTS started_at ON TABLE jobs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS completed_at ON TABLE jobs TYPE option<string>;
DEFINE FIELD OVERWRITE result ON TABLE jobs TYPE option<object>;
DEFINE FIELD OVERWRITE error ON TABLE jobs TYPE option<object>;
DEFINE INDEX IF NOT EXISTS jobs_world_status_created ON TABLE jobs COLUMNS world_id, status, created_at;

DEFINE TABLE IF NOT EXISTS reflex_state SCHEMALESS;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE reflex_state TYPE string;
DEFINE FIELD IF NOT EXISTS trigger_type ON TABLE reflex_state TYPE string;
DEFINE FIELD IF NOT EXISTS last_reflex_at ON TABLE reflex_state TYPE option<string>;
DEFINE FIELD IF NOT EXISTS last_event_at ON TABLE reflex_state TYPE option<string>;
DEFINE FIELD IF NOT EXISTS last_signature ON TABLE reflex_state TYPE option<string>;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE reflex_state TYPE string;
DEFINE INDEX IF NOT EXISTS reflex_state_world_trigger ON TABLE reflex_state COLUMNS world_id, trigger_type UNIQUE;

DEFINE TABLE IF NOT EXISTS companion_identity SCHEMALESS;
DEFINE FIELD IF NOT EXISTS display_name ON TABLE companion_identity TYPE string;
DEFINE FIELD IF NOT EXISTS avatar_icon_id ON TABLE companion_identity TYPE string;
DEFINE FIELD IF NOT EXISTS personality_preset ON TABLE companion_identity TYPE string;
DEFINE FIELD IF NOT EXISTS tone_intensity ON TABLE companion_identity TYPE number;
DEFINE FIELD IF NOT EXISTS chat_verbosity ON TABLE companion_identity TYPE string;
DEFINE FIELD IF NOT EXISTS identity_revision ON TABLE companion_identity TYPE number;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE companion_identity TYPE string;

DEFINE TABLE IF NOT EXISTS identity_profiles SCHEMALESS;
DEFINE FIELD IF NOT EXISTS name ON TABLE identity_profiles TYPE string;
DEFINE FIELD IF NOT EXISTS identity ON TABLE identity_profiles TYPE object;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE identity_profiles TYPE string;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE identity_profiles TYPE string;
DEFINE INDEX IF NOT EXISTS identity_profiles_name ON TABLE identity_profiles COLUMNS name;

DEFINE TABLE IF NOT EXISTS anchors SCHEMALESS;
DEFINE FIELD IF NOT EXISTS anchor_id ON TABLE anchors TYPE string;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE anchors TYPE string;
DEFINE FIELD IF NOT EXISTS label ON TABLE anchors TYPE string;
DEFINE FIELD IF NOT EXISTS type ON TABLE anchors TYPE string;
DEFINE FIELD IF NOT EXISTS source ON TABLE anchors TYPE string;
DEFINE FIELD IF NOT EXISTS payload ON TABLE anchors TYPE object;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE anchors TYPE string;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE anchors TYPE string;
DEFINE INDEX IF NOT EXISTS anchors_anchor_id ON TABLE anchors COLUMNS anchor_id UNIQUE;
DEFINE INDEX IF NOT EXISTS anchors_world_created ON TABLE anchors COLUMNS world_id, created_at;

DEFINE TABLE IF NOT EXISTS saved_profiles SCHEMALESS;
DEFINE FIELD IF NOT EXISTS profile_id ON TABLE saved_profiles TYPE string;
DEFINE FIELD IF NOT EXISTS name ON TABLE saved_profiles TYPE string;
DEFINE FIELD IF NOT EXISTS identity ON TABLE saved_profiles TYPE object;
DEFINE FIELD IF NOT EXISTS live_config ON TABLE saved_profiles TYPE object;
DEFINE FIELD IF NOT EXISTS preferred_anchor_behavior ON TABLE saved_profiles TYPE option<object>;
DEFINE FIELD IF NOT EXISTS ui_defaults ON TABLE saved_profiles TYPE option<object>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE saved_profiles TYPE string;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE saved_profiles TYPE string;
DEFINE INDEX IF NOT EXISTS saved_profiles_name ON TABLE saved_profiles COLUMNS name UNIQUE;
DEFINE INDEX IF NOT EXISTS saved_profiles_id ON TABLE saved_profiles COLUMNS profile_id UNIQUE;

DEFINE TABLE IF NOT EXISTS ui_preferences SCHEMALESS;
DEFINE FIELD IF NOT EXISTS key ON TABLE ui_preferences TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE ui_preferences TYPE object;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE ui_preferences TYPE string;
DEFINE INDEX IF NOT EXISTS ui_preferences_key ON TABLE ui_preferences COLUMNS key UNIQUE;

DEFINE EVENT OVERWRITE reflex_warning_on_danger ON TABLE events
WHEN $event = "CREATE" AND (
  $after.type = "creeper_nearby" OR
  $after.type = "mob_nearby" OR
  $after.type = "player_health_low"
)
THEN (
  CREATE jobs CONTENT {
    world_id: $after.world_id,
    session_id: $after.session_id,
    thread_id: $after.thread_id,
    type: "reflex_warning",
    payload: {
      reflex_type: $after.type,
      source_event_id: $after.id,
      world_id: $after.world_id,
      session_id: $after.session_id,
      location: $after.location,
      actor: $after.actor,
      metadata: $after.metadata
    },
    status: "pending",
    progress: 0,
    created_at: <string> time::now(),
    updated_at: <string> time::now()
  }
);

DEFINE TABLE IF NOT EXISTS learning_events SCHEMALESS;
DEFINE FIELD IF NOT EXISTS thread_id ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS turn_id ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS attempt_id ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS command_id ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS event_type ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS retry_domain ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS action_type ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS provider ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS operation_subtype ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS signature ON TABLE learning_events TYPE object;
DEFINE FIELD IF NOT EXISTS signature_key ON TABLE learning_events TYPE string;
DEFINE FIELD IF NOT EXISTS signature_version ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS error_code ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS error_category ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS terminal_outcome ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON TABLE learning_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS metadata ON TABLE learning_events TYPE object;
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE learning_events TYPE string;
DEFINE INDEX IF NOT EXISTS learning_events_thread_world_timestamp ON TABLE learning_events COLUMNS thread_id, world_id, timestamp;
DEFINE INDEX IF NOT EXISTS learning_events_signature_timestamp ON TABLE learning_events COLUMNS signature_key, timestamp;
DEFINE INDEX IF NOT EXISTS learning_events_world_domain_timestamp ON TABLE learning_events COLUMNS world_id, retry_domain, timestamp;
DEFINE INDEX IF NOT EXISTS learning_events_turn_attempt ON TABLE learning_events COLUMNS turn_id, attempt_id;

DEFINE TABLE IF NOT EXISTS learning_edges SCHEMALESS;
DEFINE FIELD IF NOT EXISTS thread_id ON TABLE learning_edges TYPE string;
DEFINE FIELD IF NOT EXISTS world_id ON TABLE learning_edges TYPE string;
DEFINE FIELD IF NOT EXISTS turn_id ON TABLE learning_edges TYPE string;
DEFINE FIELD IF NOT EXISTS attempt_id ON TABLE learning_edges TYPE string;
DEFINE FIELD IF NOT EXISTS relation_type ON TABLE learning_edges TYPE string;
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE learning_edges TYPE string;
DEFINE INDEX IF NOT EXISTS learning_edges_thread_world_timestamp ON TABLE learning_edges COLUMNS thread_id, world_id, timestamp;

DEFINE EVENT OVERWRITE reflex_comment_on_discovery ON TABLE events
WHEN $event = "CREATE" AND (
  $after.type = "cave_found" OR
  $after.type = "village_found" OR
  $after.type = "rare_biome_found"
)
THEN (
  CREATE jobs CONTENT {
    world_id: $after.world_id,
    session_id: $after.session_id,
    thread_id: $after.thread_id,
    type: "reflex_comment",
    payload: {
      reflex_type: $after.type,
      source_event_id: $after.id,
      world_id: $after.world_id,
      session_id: $after.session_id,
      location: $after.location,
      actor: $after.actor,
      metadata: $after.metadata
    },
    status: "pending",
    progress: 0,
    created_at: <string> time::now(),
    updated_at: <string> time::now()
  }
);

DEFINE EVENT OVERWRITE reflex_suggestion_on_context ON TABLE events
WHEN $event = "CREATE" AND (
  $after.type = "night_approaching" OR
  $after.type = "interesting_terrain" OR
  $after.type = "player_idle"
)
THEN (
  CREATE jobs CONTENT {
    world_id: $after.world_id,
    session_id: $after.session_id,
    thread_id: $after.thread_id,
    type: "reflex_suggestion",
    payload: {
      reflex_type: $after.type,
      source_event_id: $after.id,
      world_id: $after.world_id,
      session_id: $after.session_id,
      location: $after.location,
      actor: $after.actor,
      metadata: $after.metadata
    },
    status: "pending",
    progress: 0,
    created_at: <string> time::now(),
    updated_at: <string> time::now()
  }
);

DEFINE EVENT OVERWRITE reflex_memory_callback_on_proximity ON TABLE events
WHEN $event = "CREATE" AND $after.type = "memory_proximity"
THEN (
  CREATE jobs CONTENT {
    world_id: $after.world_id,
    session_id: $after.session_id,
    thread_id: $after.thread_id,
    type: "reflex_memory_callback",
    payload: {
      reflex_type: $after.type,
      source_event_id: $after.id,
      world_id: $after.world_id,
      session_id: $after.session_id,
      location: $after.location,
      actor: $after.actor,
      metadata: $after.metadata
    },
    status: "pending",
    progress: 0,
    created_at: <string> time::now(),
    updated_at: <string> time::now()
  }
);
