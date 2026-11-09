use std::sync::Arc;
use tauri::{Manager, State};
use ezman_core::{
    AppPreferences, Collection, Environment, HttpEngine, HttpResponse,
    ImportResult, PostmanImporter, RequestItem, StorageManager, VariableResolver,
};

struct AppState {
    storage: Arc<StorageManager>,
    http_engine: Arc<HttpEngine>,
}

#[tauri::command]
fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    state.storage.list_collections().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_collection(id: String, state: State<'_, AppState>) -> Result<Option<Collection>, String> {
    state.storage.get_collection(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_collection(collection: Collection, state: State<'_, AppState>) -> Result<(), String> {
    state.storage.save_collection(&collection).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_collection(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.storage.delete_collection(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_environments(state: State<'_, AppState>) -> Result<Vec<Environment>, String> {
    state.storage.list_environments().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_environment(id: String, state: State<'_, AppState>) -> Result<Option<Environment>, String> {
    state.storage.get_environment(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_environment(environment: Environment, state: State<'_, AppState>) -> Result<(), String> {
    state.storage.save_environment(&environment).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_environment(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.storage.delete_environment(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<AppPreferences, String> {
    state.storage.get_preferences().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_preferences(preferences: AppPreferences, state: State<'_, AppState>) -> Result<(), String> {
    state.storage.save_preferences(&preferences).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_postman_collection(
    json_content: String,
    state: State<'_, AppState>,
) -> Result<ImportResult, String> {
    let result = PostmanImporter::import_json(&json_content).map_err(|e| e.to_string())?;
    state.storage.save_collection(&result.collection).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn execute_request(
    request: RequestItem,
    collection_id: Option<String>,
    environment_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<HttpResponse, String> {
    let collection = if let Some(cid) = collection_id {
        state.storage.get_collection(&cid).map_err(|e| e.to_string())?
    } else {
        None
    };

    let environment = if let Some(eid) = environment_id {
        if eid != "none" && !eid.is_empty() {
            state.storage.get_environment(&eid).map_err(|e| e.to_string())?
        } else {
            None
        }
    } else {
        None
    };

    let resolver = VariableResolver::from_collection_and_environment(
        collection.as_ref(),
        environment.as_ref(),
    );

    let resolved_req = resolver.resolve_request(&request);
    let inherited_auth = collection
        .as_ref()
        .and_then(|c| c.auth.as_ref())
        .map(|auth| resolver.resolve_auth(auth));

    let response = state.http_engine.execute(&resolved_req, inherited_auth.as_ref()).await;
    Ok(response)
}

#[derive(serde::Serialize)]
struct McpInfo {
    path: String,
    exists: bool,
}

/// The bundled `ezman-mcp` sidecar sits next to the app executable.
#[tauri::command]
fn get_mcp_info() -> Result<McpInfo, String> {
    let name = if cfg!(windows) { "ezman-mcp.exe" } else { "ezman-mcp" };
    let path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("cannot locate app directory")?
        .join(name);
    Ok(McpInfo {
        exists: path.exists(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage = Arc::new(StorageManager::new().expect("Failed to initialize storage manager"));
    let http_engine = Arc::new(HttpEngine::new().expect("Failed to initialize HTTP engine"));

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            app.manage(AppState {
                storage,
                http_engine,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_collections,
            get_collection,
            save_collection,
            delete_collection,
            list_environments,
            get_environment,
            save_environment,
            delete_environment,
            get_preferences,
            save_preferences,
            import_postman_collection,
            execute_request,
            get_mcp_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
