#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Instant,
};
use tauri::State;

const MANIFEST_DIR: &str = ".local";
const MANIFEST_FILE: &str = "guardian-shell.settings.json";

#[derive(Serialize, Clone)]
struct RuntimeBootstrap {
    host: String,
    port: u16,
    token: String,
    status: String,
    profile_id: Option<String>,
    profile_name: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ShellRuntimeStatus {
    running: bool,
    profile_id: Option<String>,
    profile_name: Option<String>,
    uptime_ms: Option<u64>,
    pid: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StartupBaseSettings {
    #[serde(rename = "primaryPlayer")]
    primary_player: String,
    #[serde(rename = "companionName")]
    companion_name: String,
    #[serde(rename = "companionRole")]
    companion_role: String,
    #[serde(rename = "companionPersonality")]
    companion_personality: String,
    #[serde(rename = "llmProvider")]
    llm_provider: String,
    minecraft: MinecraftSettings,
    agent: AgentSettings,
    retry: RetrySettings,
    reconnect: ReconnectSettings,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MinecraftSettings {
    host: String,
    port: u16,
    auth: String,
    version: Option<String>,
    #[serde(rename = "followDistance")]
    follow_distance: u32,
    #[serde(rename = "respondToAllPlayers")]
    respond_to_all_players: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentSettings {
    #[serde(rename = "memoryWindow")]
    memory_window: u32,
    #[serde(rename = "eventWindow")]
    event_window: u32,
    #[serde(rename = "summaryInterval")]
    summary_interval: u32,
    #[serde(rename = "summaryWindow")]
    summary_window: u32,
    #[serde(rename = "summaryContextLimit")]
    summary_context_limit: u32,
    #[serde(rename = "maxPendingTurns")]
    max_pending_turns: u32,
    #[serde(rename = "reflexObservationIntervalMs")]
    reflex_observation_interval_ms: u32,
    #[serde(rename = "reflexWorkerIntervalMs")]
    reflex_worker_interval_ms: u32,
    #[serde(rename = "buildWorkerIntervalMs")]
    build_worker_interval_ms: u32,
    #[serde(rename = "reflexGlobalCooldownMs")]
    reflex_global_cooldown_ms: u32,
    #[serde(rename = "reflexTriggerCooldownMs")]
    reflex_trigger_cooldown_ms: u32,
    #[serde(rename = "reflexIdleThresholdMs")]
    reflex_idle_threshold_ms: u32,
    #[serde(rename = "allowAutoGiveBuildMaterials")]
    allow_auto_give_build_materials: bool,
    #[serde(rename = "debugBuildPlans")]
    debug_build_plans: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RetrySettings {
    #[serde(rename = "maxAttempts")]
    max_attempts: u32,
    #[serde(rename = "baseDelayMs")]
    base_delay_ms: u32,
    #[serde(rename = "maxDelayMs")]
    max_delay_ms: u32,
    jitter: f64,
    #[serde(rename = "graphFromAttempt")]
    graph_from_attempt: u32,
    #[serde(rename = "loopThreshold")]
    loop_threshold: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ReconnectSettings {
    #[serde(rename = "maxAttempts")]
    max_attempts: u32,
    #[serde(rename = "baseDelayMs")]
    base_delay_ms: u32,
    #[serde(rename = "maxDelayMs")]
    max_delay_ms: u32,
    jitter: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LaunchProfile {
    id: String,
    name: String,
    description: Option<String>,
    #[serde(rename = "isDefault")]
    is_default: Option<bool>,
    overrides: HashMap<String, serde_json::Value>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StartupSettingsManifest {
    version: String,
    #[serde(rename = "activeProfileId")]
    active_profile_id: Option<String>,
    profiles: Vec<LaunchProfile>,
    #[serde(rename = "baseSettings")]
    base_settings: StartupBaseSettings,
    #[serde(rename = "lastMergedAt")]
    last_merged_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StartupSecrets {
    #[serde(rename = "minimaxApiKey")]
    minimax_api_key: Option<String>,
    #[serde(rename = "groqApiKey")]
    groq_api_key: Option<String>,
    #[serde(rename = "ollamaApiKey")]
    ollama_api_key: Option<String>,
    #[serde(rename = "surrealPassword")]
    surreal_password: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SettingsLoadResult {
    manifest: StartupSettingsManifest,
    validation: SettingsValidationResult,
    merged_from: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SettingsValidationResult {
    valid: bool,
    errors: Vec<ValidationError>,
    warnings: Vec<ValidationWarning>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ValidationError {
    path: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ValidationWarning {
    path: String,
    message: String,
}

struct ManagedRuntime {
    child: Child,
    host: String,
    port: u16,
    token: String,
    profile_id: Option<String>,
    profile_name: Option<String>,
    started_at: Instant,
}

#[derive(Default)]
struct RuntimeManager {
    runtime: Mutex<Option<ManagedRuntime>>,
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("dashboard workspace root")
        .to_path_buf()
}

fn manifest_path() -> PathBuf {
    project_root().join(MANIFEST_DIR).join(MANIFEST_FILE)
}

fn env_path() -> PathBuf {
    project_root().join(".env")
}

fn find_free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .map_err(|error| error.to_string())?
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| error.to_string())
}

fn build_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn node_binary() -> String {
    std::env::var("GUARDIAN_NODE_BIN").unwrap_or_else(|_| "node".to_string())
}

fn validate_manifest(manifest: &StartupSettingsManifest) -> SettingsValidationResult {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if manifest.version.is_empty() {
        errors.push(ValidationError {
            path: "version".to_string(),
            message: "Manifest version is required".to_string(),
        });
    }

    if manifest.base_settings.primary_player.is_empty() {
        errors.push(ValidationError {
            path: "base_settings.primary_player".to_string(),
            message: "Primary player is required".to_string(),
        });
    }

    if manifest.base_settings.companion_name.is_empty() {
        errors.push(ValidationError {
            path: "base_settings.companion_name".to_string(),
            message: "Companion name is required".to_string(),
        });
    }

    let valid_providers = ["minimax", "groq", "ollama"];
    if !valid_providers.contains(&manifest.base_settings.llm_provider.as_str()) {
        errors.push(ValidationError {
            path: "base_settings.llm_provider".to_string(),
            message: "LLM provider must be minimax, groq, or ollama".to_string(),
        });
    }

    if let Some(ref active_id) = manifest.active_profile_id {
        if !manifest.profiles.iter().any(|p| &p.id == active_id) {
            warnings.push(ValidationWarning {
                path: "active_profile_id".to_string(),
                message: format!(
                    "Active profile \"{}\" not found in profiles list",
                    active_id
                ),
            });
        }
    }

    SettingsValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn load_manifest() -> Option<StartupSettingsManifest> {
    let path = manifest_path();
    if !path.exists() {
        return None;
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).ok(),
        Err(_) => None,
    }
}

fn migrate_manifest_from_env() -> StartupSettingsManifest {
    let env_path = env_path();
    let mut env_vars: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    if env_path.exists() {
        if let Ok(content) = fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    env_vars.insert(key.trim().to_string(), value.trim().to_string());
                }
            }
        }
    }

    let get_env = |key: &str, default: &str| -> String {
        env_vars
            .get(key)
            .cloned()
            .unwrap_or_else(|| default.to_string())
    };

    let get_env_num = |key: &str, fallback: u32| -> u32 {
        env_vars
            .get(key)
            .map(|v| v.parse().unwrap_or(fallback))
            .unwrap_or(fallback)
    };

    let get_env_u16 = |key: &str, fallback: u16| -> u16 {
        env_vars
            .get(key)
            .map(|v| v.parse().unwrap_or(fallback))
            .unwrap_or(fallback)
    };

    let get_env_bool = |key: &str, fallback: bool| -> bool {
        env_vars
            .get(key)
            .map(|v| v.parse::<bool>().unwrap_or(fallback))
            .unwrap_or(fallback)
    };

    let primary_player = get_env("PRIMARY_PLAYER", &get_env("MC_PRIMARY_PLAYER", "Sage"));
    let companion_name = get_env("MC_BOT_USERNAME", &get_env("COMPANION_NAME", "Guardian"));

    let manifest = StartupSettingsManifest {
        version: "1.0.0".to_string(),
        active_profile_id: Some("default".to_string()),
        profiles: vec![LaunchProfile {
            id: "default".to_string(),
            name: "Default".to_string(),
            description: Some("Default launch profile".to_string()),
            is_default: Some(true),
            overrides: std::collections::HashMap::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }],
        base_settings: StartupBaseSettings {
            primary_player: primary_player.clone(),
            companion_name: companion_name.clone(),
            companion_role: get_env("COMPANION_ROLE", "AI companion"),
            companion_personality: get_env(
                "COMPANION_PERSONALITY",
                "Warm, observant, concise, practical, and grounded in the Minecraft world.",
            ),
            llm_provider: get_env("LLM_PROVIDER", "groq"),
            minecraft: MinecraftSettings {
                host: get_env("MC_HOST", "127.0.0.1"),
                port: get_env_u16("MC_PORT", 25565),
                auth: get_env("MC_AUTH", "offline"),
                version: env_vars.get("MC_VERSION").cloned(),
                follow_distance: get_env_num("MC_FOLLOW_DISTANCE", 2),
                respond_to_all_players: get_env_bool("MC_RESPOND_TO_ALL", false),
            },
            agent: AgentSettings {
                memory_window: get_env_num("AGENT_MEMORY_WINDOW", 12),
                event_window: get_env_num("AGENT_EVENT_WINDOW", 6),
                summary_interval: get_env_num("AGENT_SUMMARY_INTERVAL", 24),
                summary_window: get_env_num("AGENT_SUMMARY_WINDOW", 24),
                summary_context_limit: get_env_num("AGENT_SUMMARY_CONTEXT_LIMIT", 3),
                max_pending_turns: get_env_num("AGENT_MAX_PENDING_TURNS", 4),
                reflex_observation_interval_ms: get_env_num("AGENT_REFLEX_INTERVAL_MS", 5000),
                reflex_worker_interval_ms: get_env_num("AGENT_REFLEX_WORKER_INTERVAL_MS", 1000),
                build_worker_interval_ms: get_env_num("AGENT_BUILD_WORKER_INTERVAL_MS", 1000),
                reflex_global_cooldown_ms: get_env_num("AGENT_REFLEX_GLOBAL_COOLDOWN_MS", 60000),
                reflex_trigger_cooldown_ms: get_env_num("AGENT_REFLEX_TRIGGER_COOLDOWN_MS", 180000),
                reflex_idle_threshold_ms: get_env_num("AGENT_REFLEX_IDLE_THRESHOLD_MS", 90000),
                allow_auto_give_build_materials: get_env_bool(
                    "ALLOW_AUTO_GIVE_BUILD_MATERIALS",
                    false,
                ),
                debug_build_plans: get_env_bool("AGENT_BUILD_DEBUG", false),
            },
            retry: RetrySettings {
                max_attempts: get_env_num("AGENT_RETRY_MAX_ATTEMPTS", 3),
                base_delay_ms: get_env_num("AGENT_RETRY_BASE_DELAY_MS", 500),
                max_delay_ms: get_env_num("AGENT_RETRY_MAX_DELAY_MS", 5000),
                jitter: 0.25,
                graph_from_attempt: get_env_num("AGENT_RETRY_GRAPH_FROM_ATTEMPT", 2),
                loop_threshold: get_env_num("AGENT_RETRY_LOOP_THRESHOLD", 3),
            },
            reconnect: ReconnectSettings {
                max_attempts: get_env_num("MC_RECONNECT_MAX_ATTEMPTS", 5),
                base_delay_ms: get_env_num("MC_RECONNECT_BASE_DELAY_MS", 1000),
                max_delay_ms: get_env_num("MC_RECONNECT_MAX_DELAY_MS", 15000),
                jitter: 0.25,
            },
        },
        last_merged_at: chrono::Utc::now().to_rfc3339(),
    };

    manifest
}

fn save_manifest(manifest: &StartupSettingsManifest) -> Result<(), String> {
    let root = project_root();
    let local_dir = root.join(MANIFEST_DIR);

    if !local_dir.exists() {
        fs::create_dir_all(&local_dir).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(manifest_path(), content).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_secrets() -> StartupSecrets {
    let env_path = env_path();
    if !env_path.exists() {
        return StartupSecrets {
            minimax_api_key: None,
            groq_api_key: None,
            ollama_api_key: None,
            surreal_password: None,
        };
    }

    match fs::read_to_string(&env_path) {
        Ok(content) => {
            let mut secrets = StartupSecrets {
                minimax_api_key: None,
                groq_api_key: None,
                ollama_api_key: None,
                surreal_password: None,
            };

            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }

                if let Some((key, value)) = line.split_once('=') {
                    let value = value.trim().to_string();
                    if value.is_empty() {
                        continue;
                    }

                    match key.trim() {
                        "MINIMAX_API_KEY" => secrets.minimax_api_key = Some(value),
                        "GROQ_API_KEY" => secrets.groq_api_key = Some(value),
                        "OLLAMA_API_KEY" => secrets.ollama_api_key = Some(value),
                        "SURREAL_PASSWORD" => secrets.surreal_password = Some(value),
                        _ => {}
                    }
                }
            }

            secrets
        }
        Err(_) => StartupSecrets {
            minimax_api_key: None,
            groq_api_key: None,
            ollama_api_key: None,
            surreal_password: None,
        },
    }
}

fn save_secrets(secrets: &StartupSecrets) -> Result<(), String> {
    let env_path = env_path();
    let mut existing_content = String::new();

    if env_path.exists() {
        existing_content = fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    }

    let mut lines: Vec<&str> = existing_content.lines().collect();
    let mut has_minimax = false;
    let mut has_groq = false;
    let mut has_ollama = false;
    let mut has_surreal = false;

    lines.retain(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            return true;
        }

        if let Some((key, _)) = trimmed.split_once('=') {
            match key.trim() {
                "MINIMAX_API_KEY" => {
                    if secrets.minimax_api_key.is_some() {
                        has_minimax = true;
                        return false;
                    }
                    return true;
                }
                "GROQ_API_KEY" => {
                    if secrets.groq_api_key.is_some() {
                        has_groq = true;
                        return false;
                    }
                    return true;
                }
                "OLLAMA_API_KEY" => {
                    if secrets.ollama_api_key.is_some() {
                        has_ollama = true;
                        return false;
                    }
                    return true;
                }
                "SURREAL_PASSWORD" => {
                    if secrets.surreal_password.is_some() {
                        has_surreal = true;
                        return false;
                    }
                    return true;
                }
                _ => true,
            }
        } else {
            true
        }
    });

    let mut new_lines = Vec::new();
    for line in lines {
        new_lines.push(line.to_string());
    }

    if !has_minimax {
        if let Some(ref key) = secrets.minimax_api_key {
            new_lines.push(format!("MINIMAX_API_KEY={}", key));
        }
    }
    if !has_groq {
        if let Some(ref key) = secrets.groq_api_key {
            new_lines.push(format!("GROQ_API_KEY={}", key));
        }
    }
    if !has_ollama {
        if let Some(ref key) = secrets.ollama_api_key {
            new_lines.push(format!("OLLAMA_API_KEY={}", key));
        }
    }
    if !has_surreal {
        if let Some(ref key) = secrets.surreal_password {
            new_lines.push(format!("SURREAL_PASSWORD={}", key));
        }
    }

    fs::write(&env_path, new_lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_active_profile_name(manifest: &StartupSettingsManifest) -> (Option<String>, Option<String>) {
    if let Some(ref active_id) = manifest.active_profile_id {
        if let Some(profile) = manifest.profiles.iter().find(|p| &p.id == active_id) {
            return (Some(active_id.clone()), Some(profile.name.clone()));
        }
    }
    (None, None)
}

#[tauri::command]
fn get_runtime_status(state: State<'_, RuntimeManager>) -> ShellRuntimeStatus {
    let guard = state.runtime.lock().ok();
    match guard.as_ref().and_then(|g| g.as_ref()) {
        Some(runtime) => {
            let uptime = runtime.started_at.elapsed().as_millis() as u64;
            ShellRuntimeStatus {
                running: true,
                profile_id: runtime.profile_id.clone(),
                profile_name: runtime.profile_name.clone(),
                uptime_ms: Some(uptime),
                pid: Some(runtime.child.id()),
            }
        }
        None => ShellRuntimeStatus {
            running: false,
            profile_id: None,
            profile_name: None,
            uptime_ms: None,
            pid: None,
        },
    }
}

#[tauri::command]
fn load_shell_settings() -> Result<SettingsLoadResult, String> {
    let manifest = match load_manifest() {
        Some(m) => m,
        None => {
            let migrated = migrate_manifest_from_env();
            if let Err(e) = save_manifest(&migrated) {
                return Err(format!("Failed to create settings manifest: {}", e));
            }
            println!("[settings] No manifest found, migrated from .env");
            migrated
        }
    };

    let validation = validate_manifest(&manifest);
    let (_profile_id, _profile_name) = get_active_profile_name(&manifest);

    Ok(SettingsLoadResult {
        manifest,
        validation,
        merged_from: vec!["defaults".to_string(), "manifest".to_string()],
    })
}

#[tauri::command]
fn save_shell_settings(manifest: StartupSettingsManifest) -> Result<(), String> {
    let validation = validate_manifest(&manifest);
    if !validation.valid {
        return Err("Manifest validation failed".to_string());
    }

    save_manifest(&manifest)
}

#[tauri::command]
fn load_shell_secrets() -> StartupSecrets {
    load_secrets()
}

#[tauri::command]
fn save_shell_secrets(secrets: StartupSecrets) -> Result<(), String> {
    save_secrets(&secrets)
}

#[tauri::command]
fn start_runtime(
    state: State<'_, RuntimeManager>,
    profile_id: Option<String>,
) -> Result<RuntimeBootstrap, String> {
    let mut guard = state
        .runtime
        .lock()
        .map_err(|_| "runtime lock poisoned".to_string())?;

    if let Some(ref mut runtime) = *guard {
        let still_running = runtime
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none();
        if still_running {
            return Ok(RuntimeBootstrap {
                host: runtime.host.clone(),
                port: runtime.port,
                token: runtime.token.clone(),
                status: "already_running".to_string(),
                profile_id: runtime.profile_id.clone(),
                profile_name: runtime.profile_name.clone(),
            });
        }
    }

    let port = find_free_port()?;
    let token = build_token();
    let host = "127.0.0.1".to_string();
    let root = project_root();

    let mut cmd = Command::new(node_binary());
    cmd.current_dir(&root)
        .arg("scripts/startAgent.js")
        .env("GUARDIAN_CONTROL_HOST", &host)
        .env("GUARDIAN_CONTROL_PORT", port.to_string())
        .env("GUARDIAN_CONTROL_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    if let Some(ref pid) = profile_id {
        cmd.env("GUARDIAN_PROFILE", pid);
    }

    let mut child = cmd.spawn().map_err(|error| error.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    if let Ok(Some(exit_status)) = child.try_wait() {
        return Err(format!(
            "Runtime process exited immediately with status: {:?}",
            exit_status
        ));
    }

    let (resolved_profile_id, resolved_profile_name) = if let Some(ref pid) = profile_id {
        if let Some(manifest) = load_manifest() {
            if let Some(profile) = manifest.profiles.iter().find(|p| &p.id == pid) {
                (Some(pid.clone()), Some(profile.name.clone()))
            } else {
                (Some(pid.clone()), None)
            }
        } else {
            (Some(pid.clone()), None)
        }
    } else if let Some(manifest) = load_manifest() {
        get_active_profile_name(&manifest)
    } else {
        (None, None)
    };

    *guard = Some(ManagedRuntime {
        child,
        host: host.clone(),
        port,
        token: token.clone(),
        profile_id: resolved_profile_id.clone(),
        profile_name: resolved_profile_name.clone(),
        started_at: Instant::now(),
    });

    Ok(RuntimeBootstrap {
        host,
        port,
        token,
        status: "running".to_string(),
        profile_id: resolved_profile_id,
        profile_name: resolved_profile_name,
    })
}

#[tauri::command]
fn restart_runtime(
    state: State<'_, RuntimeManager>,
    profile_id: Option<String>,
) -> Result<RuntimeBootstrap, String> {
    {
        let mut guard = state
            .runtime
            .lock()
            .map_err(|_| "runtime lock poisoned".to_string())?;
        if let Some(ref mut runtime) = *guard {
            let _ = runtime.child.kill();
        }
        *guard = None;
    }

    start_runtime(state, profile_id)
}

#[tauri::command]
fn stop_runtime(state: State<'_, RuntimeManager>) -> Result<(), String> {
    let mut guard = state
        .runtime
        .lock()
        .map_err(|_| "runtime lock poisoned".to_string())?;
    if let Some(ref mut runtime) = *guard {
        runtime.child.kill().map_err(|error| error.to_string())?;
    }
    *guard = None;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(RuntimeManager::default())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            load_shell_settings,
            save_shell_settings,
            load_shell_secrets,
            save_shell_secrets,
            start_runtime,
            restart_runtime,
            stop_runtime
        ])
        .run(tauri::generate_context!())
        .expect("error while running Guardian Dashboard");
}
