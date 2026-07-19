mod capture;
mod capture_loop;
mod chunk;
mod commands;
mod foreground;
mod graphiti;
mod langfuse;
mod llm;
mod settings;
mod vault;

use commands::AppState;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn build_state(app: &tauri::App) -> anyhow::Result<AppState> {
    let config_dir = app.path().app_config_dir()?;
    let data_dir = app.path().app_data_dir()?;
    let vault_dir = data_dir.join("vault");
    std::fs::create_dir_all(&vault_dir)?;

    // Graphiti sidecar stores its DBs in a subdirectory of the vault.
    let graphiti_dir = vault_dir.join("graphiti");
    std::fs::create_dir_all(&graphiti_dir)?;

    let db = vault::open(&vault_dir.join("zevdigital.db"))?;
    let settings = settings::Settings::load(&config_dir);

    Ok(AppState {
        config_dir,
        vault_dir,
        db: std::sync::Mutex::new(db),
        settings: std::sync::Mutex::new(settings),
        capture: capture::provider(),
        sidecar_port: graphiti::DEFAULT_PORT,
        sidecar_ready: std::sync::Mutex::new(false),
        capture_running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        capture_thread: std::sync::Mutex::new(None),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let state = build_state(app).map_err(|e| e.to_string())?;
            app.manage(state);

            // The graph service ships inside Zev.Digital. It is an internal local
            // process (bound to 127.0.0.1), not a separate app users must run.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();
                let port = state.sidecar_port;
                if graphiti::health_check(port).await {
                    log::info!("Using existing Graphiti sidecar on port {port}");
                    return;
                }
                let data_dir = state.vault_dir.join("graphiti");
                let port_arg = port.to_string();
                let data_dir_arg = data_dir.to_string_lossy().into_owned();
                match app_handle.shell().sidecar("contxt-sidecar") {
                    Ok(command) => match command
                        .args(["--port", port_arg.as_str(), "--data-dir", data_dir_arg.as_str()])
                        .spawn()
                    {
                        Ok((_events, _child)) => log::info!("Started bundled Graphiti sidecar"),
                        Err(error) => log::warn!("Could not start bundled Graphiti sidecar: {error}"),
                    },
                    Err(error) => log::warn!("Bundled Graphiti sidecar is unavailable: {error}"),
                }
            });

            // Health-check the local sidecar in the background and push settings
            // (extraction mode / model) once it's ready.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();
                let port = state.sidecar_port;
                let settings = state.settings.lock().unwrap().clone();

                for _ in 0..30 {
                    if graphiti::health_check(port).await {
                        *state.sidecar_ready.lock().unwrap() = true;
                        let _ = graphiti::configure(port, &settings).await;
                        log::info!("Graphiti sidecar ready on port {port}");
                        return;
                    }
                    let _ = tauri::async_runtime::spawn_blocking(|| {
                        std::thread::sleep(std::time::Duration::from_secs(1));
                    })
                    .await;
                }
                log::warn!("Graphiti sidecar not detected on port {port} — graph search unavailable, using FTS5 fallback");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_active_window,
            commands::ask,
            commands::list_sources,
            commands::delete_source,
            commands::clear_vault,
            commands::llm_health,
            commands::get_settings,
            commands::set_settings,
            commands::graphiti_health,
            commands::get_graph,
            commands::start_capture_loop,
            commands::stop_capture_loop,
            commands::capture_loop_status,
            commands::list_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::set_source_collection,
            commands::rename_source,
            commands::list_chunks,
            commands::delete_chunk,
            commands::delete_graph_node,
            commands::delete_graph_edge,
            commands::create_graph_node,
            commands::create_graph_edge,
            commands::export_graph,
            commands::export_vault_json,
            commands::export_vault_markdown,
            commands::save_text_file,
            commands::import_file,
            commands::save_chat_memory,
            commands::read_source_text,
            commands::update_source_content,
            commands::list_ollama_models,
            commands::list_llm_traces,
            commands::get_llm_trace,
            commands::clear_llm_traces,
            commands::llm_trace_stats,
            commands::list_experts,
            commands::get_expert,
            commands::create_expert,
            commands::update_expert,
            commands::delete_expert,
            commands::set_collection_instructions,
            commands::ask_council,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
