use std::sync::Arc;
use ezman_core::{
    detected_variables, path_placeholders, resolve_with_overrides, Environment, Folder, HttpEngine,
    RequestOverrides, StorageManager,
};
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock,
        ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig,
        Tool, ToolAnnotations,
    },
    service::RequestContext,
    ErrorData as McpError, RoleServer, ServerHandler,
};
use serde::Serialize;
use serde_json::json;

#[derive(Clone)]
pub struct EzmanMcpServer {
    storage: Arc<StorageManager>,
    http_engine: Arc<HttpEngine>,
}

impl EzmanMcpServer {
    pub fn new(storage: Arc<StorageManager>) -> Self {
        let http_engine = Arc::new(HttpEngine::new().expect("Failed to create HTTP engine"));
        Self {
            storage,
            http_engine,
        }
    }

    pub fn tools_list() -> Vec<Tool> {
        let list_collections_schema = json!({
            "type": "object",
            "properties": {}
        });

        let list_requests_schema = json!({
            "type": "object",
            "properties": {
                "collection_id": {
                    "type": "string",
                    "description": "Optional collection ID to filter requests"
                },
                "folder_id": {
                    "type": "string",
                    "description": "Optional folder ID to filter requests"
                }
            }
        });

        let get_request_schema = json!({
            "type": "object",
            "properties": {
                "request_id": {
                    "type": "string",
                    "description": "The unique ID of the request to retrieve"
                }
            },
            "required": ["request_id"]
        });

        let list_environments_schema = json!({
            "type": "object",
            "properties": {}
        });

        let execute_request_schema = json!({
            "type": "object",
            "properties": {
                "request_id": {
                    "type": "string",
                    "description": "The unique ID of the saved request to execute"
                },
                "environment_id": {
                    "type": "string",
                    "description": "Explicit environment ID or name, or 'none' to execute without environment variables. Environment selection is required."
                },
                "variables": {
                    "type": "object",
                    "additionalProperties": { "type": "string" },
                    "description": "Per-call {{variable}} overrides. Highest precedence (collection < environment < variables). Use \"\" for an empty value; null/object/array values are rejected."
                },
                "query": {
                    "type": "object",
                    "additionalProperties": { "type": "string" },
                    "description": "Merge/override query params for this execution only (case-sensitive keys)."
                },
                "headers": {
                    "type": "object",
                    "additionalProperties": { "type": "string" },
                    "description": "Merge/override headers for this execution only (case-insensitive keys)."
                },
                "path_params": {
                    "type": "object",
                    "additionalProperties": { "type": "string" },
                    "description": "Replace whole ':param' or '{param}' segments in the URL path (applied after {{variables}} are resolved; values are percent-encoded). Unmatched keys produce a warning."
                },
                "body": {
                    "description": "Override the request body for this execution only. String = raw body. Object = JSON body (see body_mode). For GraphQL requests use {\"query\": \"...\", \"variables\": {...}}. Omit or null to keep the saved body.",
                    "oneOf": [ { "type": "string" }, { "type": "object" } ]
                },
                "body_mode": {
                    "type": "string",
                    "enum": ["replace", "merge_json"],
                    "default": "replace",
                    "description": "'replace' (default) replaces the saved body; 'merge_json' deep-merges an object into the saved JSON object body (arrays/scalars are replaced)."
                }
            },
            "required": ["request_id"]
        });

        vec![
            Tool::new(
                "list_collections",
                "List locally available collections and nested folders.",
                Arc::new(list_collections_schema.as_object().unwrap().clone()),
            )
            .with_title("List Collections")
            .with_annotations(ToolAnnotations::new().read_only(true)),

            Tool::new(
                "list_requests",
                "List saved requests within a collection or folder.",
                Arc::new(list_requests_schema.as_object().unwrap().clone()),
            )
            .with_title("List Requests")
            .with_annotations(ToolAnnotations::new().read_only(true)),

            Tool::new(
                "get_request",
                "Retrieve saved request details, excluding secret values and credentials.",
                Arc::new(get_request_schema.as_object().unwrap().clone()),
            )
            .with_title("Get Request Details")
            .with_annotations(ToolAnnotations::new().read_only(true)),

            Tool::new(
                "list_environments",
                "List environment names and non-secret metadata. Secret values are redacted.",
                Arc::new(list_environments_schema.as_object().unwrap().clone()),
            )
            .with_title("List Environments")
            .with_annotations(ToolAnnotations::new().read_only(true)),

            Tool::new(
                "execute_request",
                "Execute a saved request using the shared Rust HTTP engine. NOTE: POST, PUT, PATCH, and DELETE requests may mutate remote state. Explicit environment selection is required. Optional per-call overrides (variables, path_params, query, headers, body, body_mode) are ephemeral and never saved. Variable precedence: collection < environment < per-call variables.",
                Arc::new(execute_request_schema.as_object().unwrap().clone()),
            )
            .with_title("Execute Request")
            .with_annotations(ToolAnnotations::new().read_only(false).destructive(false)),
        ]
    }

    pub async fn execute_tool(
        &self,
        name: &str,
        arguments: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<CallToolResult, String> {
        let args = arguments.unwrap_or_default();

        match name {
            "list_collections" => {
                let collections = self.storage.list_collections().map_err(|e| e.to_string())?;
                let summaries: Vec<CollectionSummary> = collections
                    .into_iter()
                    .map(|col| {
                        let folders: Vec<FolderSummary> =
                            col.folders.iter().map(summarize_folder).collect();
                        CollectionSummary {
                            id: col.id,
                            name: col.name,
                            description: col.description,
                            folders_count: col.folders.len(),
                            requests_count: col.requests.len(),
                            folders,
                        }
                    })
                    .collect();
                let json = serde_json::to_string_pretty(&summaries).unwrap_or_default();
                Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
            }

            "list_requests" => {
                let filter_col_id = args.get("collection_id").and_then(|v| v.as_str());
                let filter_folder_id = args.get("folder_id").and_then(|v| v.as_str());

                let collections = self.storage.list_collections().map_err(|e| e.to_string())?;
                let mut requests = Vec::new();
                for col in &collections {
                    if let Some(c_id) = filter_col_id {
                        if col.id != c_id {
                            continue;
                        }
                    }

                    if filter_folder_id.is_none() {
                        for req in &col.requests {
                            requests.push(RequestSummary {
                                id: req.id.clone(),
                                collection_id: col.id.clone(),
                                collection_name: col.name.clone(),
                                folder_id: None,
                                folder_name: None,
                                name: req.name.clone(),
                                method: req.method.to_string(),
                                url: req.url.clone(),
                                is_mutating: req.method.is_mutating(),
                                detected_variables: detected_variables(req),
                                path_placeholders: path_placeholders(&req.url),
                            });
                        }
                    }

                    for folder in &col.folders {
                        collect_requests_from_folder(
                            folder,
                            &col.id,
                            &col.name,
                            filter_folder_id,
                            &mut requests,
                        );
                    }
                }
                let json = serde_json::to_string_pretty(&requests).unwrap_or_default();
                Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
            }

            "get_request" => {
                let req_id = args
                    .get("request_id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing required argument: 'request_id'".to_string())?;

                let found = self.storage.find_request(req_id).map_err(|e| e.to_string())?;
                match found {
                    Some((col, req)) => {
                        let sanitized_req = req.sanitize_secrets();
                        let result = json!({
                            "collection_id": col.id,
                            "collection_name": col.name,
                            "detected_variables": detected_variables(&req),
                            "path_placeholders": path_placeholders(&req.url),
                            "request": sanitized_req,
                        });
                        let json = serde_json::to_string_pretty(&result).unwrap_or_default();
                        Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
                    }
                    None => Err(format!("Request with ID '{}' not found", req_id)),
                }
            }

            "list_environments" => {
                let environments = self.storage.list_environments().map_err(|e| e.to_string())?;
                let sanitized: Vec<Environment> = environments
                    .into_iter()
                    .map(|env| env.sanitize_secrets())
                    .collect();
                let json = serde_json::to_string_pretty(&sanitized).unwrap_or_default();
                Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
            }

            "execute_request" => {
                let req_id = args
                    .get("request_id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing required parameter: 'request_id'".to_string())?;

                let environments = self.storage.list_environments().map_err(|e| e.to_string())?;
                let env_arg = args.get("environment_id").and_then(|v| v.as_str());

                // Enforce explicit environment selection
                if !environments.is_empty() && env_arg.is_none() {
                    let available_names: Vec<String> = environments
                        .iter()
                        .map(|e| format!("'{}' (id: {})", e.name, e.id))
                        .collect();
                    return Err(format!(
                        "Explicit environment selection is required for execution. Please provide 'environment_id' with one of the available environments: {}, or 'none' to run without environment variables.",
                        available_names.join(", ")
                    ));
                }

                let selected_env: Option<Environment> = match env_arg {
                    None | Some("none") | Some("") => None,
                    Some(id_or_name) => {
                        let found = environments
                            .iter()
                            .find(|e| e.id == id_or_name || e.name.eq_ignore_ascii_case(id_or_name));
                        match found {
                            Some(env) => Some(env.clone()),
                            None => {
                                let available: Vec<String> = environments
                                    .iter()
                                    .map(|e| format!("'{}' (id: {})", e.name, e.id))
                                    .collect();
                                return Err(format!(
                                    "Environment '{}' not found. Available environments: {}",
                                    id_or_name,
                                    available.join(", ")
                                ));
                            }
                        }
                    }
                };

                let (collection, request) = self
                    .storage
                    .find_request(req_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("Request with ID '{}' not found", req_id))?;

                let overrides = RequestOverrides::from_args(&args).map_err(|e| e.to_string())?;
                let overridden = resolve_with_overrides(
                    Some(&collection),
                    selected_env.as_ref(),
                    &request,
                    &overrides,
                )
                .map_err(|e| e.to_string())?;
                let resolved_request = overridden.request;

                let response = self
                    .http_engine
                    .execute(&resolved_request, collection.auth.as_ref())
                    .await;

                // Never echo secret environment values back to the agent.
                let secrets: Vec<&str> = selected_env
                    .iter()
                    .flat_map(|e| e.variables.iter())
                    .filter(|v| v.enabled && v.secret && !v.value.is_empty())
                    .map(|v| v.value.as_str())
                    .collect();
                let redact = |text: &str| {
                    secrets
                        .iter()
                        .fold(text.to_string(), |acc, s| acc.replace(s, "[REDACTED]"))
                };

                let output = json!({
                    "request": {
                        "id": request.id,
                        "name": request.name,
                        "method": request.method.as_str(),
                        "url": redact(&resolved_request.url),
                        "resolved_url": redact(&resolved_request.url),
                        "is_mutating": request.method.is_mutating(),
                        "environment": selected_env.as_ref().map(|e| e.name.as_str()).unwrap_or("none"),
                        "overrides_applied": overridden.applied,
                    },
                    "warnings": overridden.warnings,
                    "response": {
                        "status": response.status,
                        "status_text": response.status_text,
                        "duration_ms": response.duration_ms,
                        "size_bytes": response.size_bytes,
                        "headers": response.headers,
                        "body": response.body,
                        "error": response.error.as_deref().map(|e| redact(e)),
                    }
                });

                let json = serde_json::to_string_pretty(&output).unwrap_or_default();
                Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
            }

            unknown => Err(format!("Unknown tool: {}", unknown)),
        }
    }
}

#[derive(Serialize)]
struct CollectionSummary {
    id: String,
    name: String,
    description: Option<String>,
    folders_count: usize,
    requests_count: usize,
    folders: Vec<FolderSummary>,
}

#[derive(Serialize)]
struct FolderSummary {
    id: String,
    name: String,
    requests_count: usize,
    subfolders: Vec<FolderSummary>,
}

fn summarize_folder(folder: &Folder) -> FolderSummary {
    FolderSummary {
        id: folder.id.clone(),
        name: folder.name.clone(),
        requests_count: folder.requests.len(),
        subfolders: folder.folders.iter().map(summarize_folder).collect(),
    }
}

#[derive(Serialize)]
struct RequestSummary {
    id: String,
    collection_id: String,
    collection_name: String,
    folder_id: Option<String>,
    folder_name: Option<String>,
    name: String,
    method: String,
    url: String,
    is_mutating: bool,
    detected_variables: Vec<String>,
    path_placeholders: Vec<String>,
}

fn collect_requests_from_folder(
    folder: &Folder,
    col_id: &str,
    col_name: &str,
    filter_folder_id: Option<&str>,
    results: &mut Vec<RequestSummary>,
) {
    let current_matches = filter_folder_id.map_or(true, |f_id| folder.id == f_id);

    if current_matches {
        for req in &folder.requests {
            results.push(RequestSummary {
                id: req.id.clone(),
                collection_id: col_id.to_string(),
                collection_name: col_name.to_string(),
                folder_id: Some(folder.id.clone()),
                folder_name: Some(folder.name.clone()),
                name: req.name.clone(),
                method: req.method.to_string(),
                url: req.url.clone(),
                is_mutating: req.method.is_mutating(),
                                detected_variables: detected_variables(req),
                                path_placeholders: path_placeholders(&req.url),
            });
        }
    }

    for sub in &folder.folders {
        collect_requests_from_folder(
            sub,
            col_id,
            col_name,
            filter_folder_id,
            results,
        );
    }
}

impl ServerHandler for EzmanMcpServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(Self::tools_list()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        match self.execute_tool(&request.name, request.arguments).await {
            Ok(result) => Ok(result.into()),
            Err(err_msg) => Ok(CallToolResult::error(vec![ContentBlock::text(err_msg)]).into()),
        }
    }
}
