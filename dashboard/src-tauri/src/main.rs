#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::State;

#[derive(Serialize, Clone)]
struct RuntimeBootstrap {
    host: String,
    port: u16,
    token: String,
    status: String,
}

struct ManagedRuntime {
    child: Child,
    host: String,
    port: u16,
    token: String,
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

#[tauri::command]
fn ensure_runtime(state: State<'_, RuntimeManager>) -> Result<RuntimeBootstrap, String> {
    let mut guard = state.runtime.lock().map_err(|_| "runtime lock poisoned".to_string())?;

    let needs_spawn = match guard.as_mut() {
        Some(runtime) => runtime
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some(),
        None => true,
    };

    if needs_spawn {
      let port = find_free_port()?;
      let token = build_token();
      let host = "127.0.0.1".to_string();
      let root = project_root();

      let child = Command::new(node_binary())
          .current_dir(root)
          .arg("scripts/startAgent.js")
          .env("GUARDIAN_CONTROL_HOST", &host)
          .env("GUARDIAN_CONTROL_PORT", port.to_string())
          .env("GUARDIAN_CONTROL_TOKEN", &token)
          .stdin(Stdio::null())
          .stdout(Stdio::inherit())
          .stderr(Stdio::inherit())
          .spawn()
          .map_err(|error| error.to_string())?;

      *guard = Some(ManagedRuntime {
          child,
          host: host.clone(),
          port,
          token: token.clone(),
      });
    }

    let runtime = guard.as_ref().ok_or_else(|| "runtime not available".to_string())?;
    Ok(RuntimeBootstrap {
        host: runtime.host.clone(),
        port: runtime.port,
        token: runtime.token.clone(),
        status: "running".to_string(),
    })
}

#[tauri::command]
fn stop_runtime(state: State<'_, RuntimeManager>) -> Result<(), String> {
    let mut guard = state.runtime.lock().map_err(|_| "runtime lock poisoned".to_string())?;
    if let Some(runtime) = guard.as_mut() {
        runtime.child.kill().map_err(|error| error.to_string())?;
    }
    *guard = None;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(RuntimeManager::default())
        .invoke_handler(tauri::generate_handler![ensure_runtime, stop_runtime])
        .run(tauri::generate_context!())
        .expect("error while running Guardian Dashboard");
}
