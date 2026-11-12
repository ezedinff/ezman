use std::sync::Arc;
use ezman_core::{
    Collection, Environment, EnvironmentVariable, HttpMethod, KeyValueItem,
    RequestItem, StorageManager,
};
use ezman_mcp_server::EzmanMcpServer;
use serde_json::json;
use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::test]
async fn test_mcp_tools_and_execution() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());

    // Setup local mock HTTP server
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 2048];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let req_text = String::from_utf8_lossy(&buf[..n]);

            if req_text.contains("GET /api/v1/status") {
                let body = "{\"status\":\"healthy\"}";
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
            }
        }
    });

    // Create a collection with variables and requests
    let mut collection = Collection::new("col-1", "Test API");
    collection.variables.push(KeyValueItem::new("baseUrl", "http://placeholder.invalid"));
    let mut req = RequestItem::new(
        "req-1",
        "Check Status",
        HttpMethod::GET,
        "{{baseUrl}}/api/{{version}}/status",
    );
    req.auth = Some(ezman_core::AuthConfig {
        auth_type: ezman_core::AuthType::Bearer,
        bearer_token: Some("super-secret-token".to_string()),
        ..Default::default()
    });
    collection.requests.push(req);
    storage.save_collection(&collection).unwrap();

    // Create an environment with variables, including a secret
    let mut env = Environment::new("env-dev", "Development");
    env.variables.push(EnvironmentVariable::new("baseUrl", format!("http://127.0.0.1:{}", port), false));
    env.variables.push(EnvironmentVariable::new("version", "v1", false));
    env.variables.push(EnvironmentVariable::new("apiKey", "api-secret-123", true));
    storage.save_environment(&env).unwrap();

    let server = EzmanMcpServer::new(storage);

    // 1. Test `list_collections`
    let list_col_res = server.execute_tool("list_collections", None).await.unwrap();
    assert_eq!(list_col_res.is_error, Some(false));
    let col_text = list_col_res.content[0].as_text().unwrap().text.as_str();
    assert!(col_text.contains("Test API"));

    // 2. Test `list_requests`
    let list_req_res = server.execute_tool("list_requests", None).await.unwrap();
    assert_eq!(list_req_res.is_error, Some(false));
    let req_text = list_req_res.content[0].as_text().unwrap().text.as_str();
    assert!(req_text.contains("Check Status"));
    assert!(req_text.contains("\"is_mutating\": false"));

    // 3. Test `get_request` - verifies secret values are sanitized!
    let mut get_args = serde_json::Map::new();
    get_args.insert("request_id".to_string(), json!("req-1"));
    let get_req_res = server.execute_tool("get_request", Some(get_args)).await.unwrap();
    assert_eq!(get_req_res.is_error, Some(false));
    let get_text = get_req_res.content[0].as_text().unwrap().text.as_str();
    assert!(get_text.contains("[REDACTED]"), "Bearer token must be redacted");
    assert!(!get_text.contains("super-secret-token"), "Raw secret token must not leak");

    // 4. Test `list_environments` - verifies secrets in environment variables are redacted
    let list_env_res = server.execute_tool("list_environments", None).await.unwrap();
    assert_eq!(list_env_res.is_error, Some(false));
    let env_text = list_env_res.content[0].as_text().unwrap().text.as_str();
    assert!(env_text.contains("Development"));
    assert!(env_text.contains("[REDACTED]"), "Secret variable value must be redacted");
    assert!(!env_text.contains("api-secret-123"), "Secret value must not leak");

    // 5. Test `execute_request` without environment selection -> MUST FAIL with explicit error
    let mut exec_args = serde_json::Map::new();
    exec_args.insert("request_id".to_string(), json!("req-1"));
    let exec_err = server.execute_tool("execute_request", Some(exec_args.clone())).await.unwrap_err();
    assert!(exec_err.contains("Explicit environment selection is required"));

    // 6. Test `execute_request` with explicit environment selection -> executes and succeeds!
    exec_args.insert("environment_id".to_string(), json!("env-dev"));
    let exec_res = server.execute_tool("execute_request", Some(exec_args)).await.unwrap();
    assert_eq!(exec_res.is_error, Some(false));
    let exec_text = exec_res.content[0].as_text().unwrap().text.as_str();
    assert!(exec_text.contains("\"status\": 200"));
    assert!(exec_text.contains("healthy"));
    assert!(!exec_text.contains("super-secret-token"));
}

async fn spawn_echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else { break };
            tokio::spawn(async move {
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let body = String::from_utf8_lossy(&buf[..n]).to_string();
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
            });
        }
    });
    port
}

async fn run(server: &EzmanMcpServer, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let res = server
        .execute_tool("execute_request", Some(args.as_object().unwrap().clone()))
        .await?;
    Ok(serde_json::from_str(&res.content[0].as_text().unwrap().text).unwrap())
}

#[tokio::test]
async fn test_execute_request_overrides() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());
    let port = spawn_echo_server().await;

    let mut collection = Collection::new("col", "API");
    collection.variables.push(KeyValueItem::new("id", "from-collection"));
    let mut get = RequestItem::new("get", "Get", HttpMethod::GET, "{{baseUrl}}/users/{{id}}?keep=1");
    get.headers.push(KeyValueItem::new("X-Trace", "saved"));
    let path = RequestItem::new("path", "Path", HttpMethod::GET, "{{baseUrl}}/a/:id/b/{bid}");
    let mut put = RequestItem::new("put", "Put", HttpMethod::PUT, "{{baseUrl}}/items");
    put.body.body_type = ezman_core::RequestBodyType::Json;
    put.body.raw = Some(r#"{"name":"old","tags":{"a":1}}"#.into());
    collection.requests.extend([get, path, put]);
    storage.save_collection(&collection).unwrap();

    let mut env = Environment::new("env", "Dev");
    env.variables.push(EnvironmentVariable::new("baseUrl", format!("http://127.0.0.1:{}", port), false));
    env.variables.push(EnvironmentVariable::new("id", "from-env", false));
    storage.save_environment(&env).unwrap();
    let server = EzmanMcpServer::new(storage.clone());

    // no overrides: env beats collection
    let out = run(&server, json!({"request_id": "get", "environment_id": "Dev"})).await.unwrap();
    assert!(out["request"]["resolved_url"].as_str().unwrap().ends_with("/users/from-env?keep=1"));
    assert_eq!(out["request"]["overrides_applied"], json!([]));

    // variables > env, plus query and headers
    let out = run(&server, json!({
        "request_id": "get", "environment_id": "Dev",
        "variables": {"id": "42"}, "query": {"keep": "2", "extra": "x"}, "headers": {"x-trace": "call"}
    })).await.unwrap();
    assert!(out["request"]["resolved_url"].as_str().unwrap().ends_with("/users/42?keep=2"));
    let echoed = out["response"]["body"].as_str().unwrap();
    assert!(echoed.contains("GET /users/42?keep=2&extra=x"), "{echoed}");
    assert!(echoed.to_lowercase().contains("x-trace: call"));
    assert!(!echoed.contains("x-trace: saved"));

    // path params for both styles, unmatched key warns
    let out = run(&server, json!({
        "request_id": "path", "environment_id": "Dev",
        "path_params": {"id": "123", "bid": "9", "nope": "1"}
    })).await.unwrap();
    assert!(out["request"]["resolved_url"].as_str().unwrap().ends_with("/a/123/b/9"));
    assert_eq!(out["warnings"].as_array().unwrap().len(), 1);

    // body string, object replace, merge_json
    let out = run(&server, json!({"request_id": "put", "environment_id": "Dev", "body": "raw-body"})).await.unwrap();
    assert!(out["response"]["body"].as_str().unwrap().ends_with("raw-body"));
    let out = run(&server, json!({"request_id": "put", "environment_id": "Dev", "body": {"name": "new"}})).await.unwrap();
    assert!(out["response"]["body"].as_str().unwrap().ends_with(r#"{"name":"new"}"#));
    let out = run(&server, json!({
        "request_id": "put", "environment_id": "Dev", "body": {"tags": {"b": 2}}, "body_mode": "merge_json"
    })).await.unwrap();
    let echoed = out["response"]["body"].as_str().unwrap();
    let body: serde_json::Value = serde_json::from_str(echoed.rsplit("\r\n\r\n").next().unwrap()).unwrap();
    assert_eq!(body, json!({"name": "old", "tags": {"a": 1, "b": 2}}));

    // invalid override values are rejected
    assert!(run(&server, json!({"request_id": "get", "environment_id": "Dev", "variables": {"id": null}})).await.is_err());

    // nothing persisted
    let (_, saved) = storage.find_request("get").unwrap().unwrap();
    assert_eq!(saved.url, "{{baseUrl}}/users/{{id}}?keep=1");
    assert_eq!(saved.headers[0].value, "saved");
    assert!(saved.params.is_empty());
    let (_, saved_put) = storage.find_request("put").unwrap().unwrap();
    assert_eq!(saved_put.body.raw.unwrap(), r#"{"name":"old","tags":{"a":1}}"#);

    // existing error behavior unchanged
    let err = run(&server, json!({"request_id": "missing", "environment_id": "Dev"})).await.unwrap_err();
    assert!(err.contains("not found"));
    let err = run(&server, json!({"request_id": "get", "environment_id": "Nope"})).await.unwrap_err();
    assert!(err.contains("Environment 'Nope' not found"));
    let err = run(&server, json!({"request_id": "get"})).await.unwrap_err();
    assert!(err.contains("Explicit environment selection is required"));

    // discoverability
    let res = server.execute_tool("get_request", Some(json!({"request_id": "path"}).as_object().unwrap().clone())).await.unwrap();
    let v: serde_json::Value = serde_json::from_str(&res.content[0].as_text().unwrap().text).unwrap();
    assert_eq!(v["detected_variables"], json!(["baseUrl"]));
    assert_eq!(v["path_placeholders"], json!(["id", "bid"]));
}

async fn manage(server: &EzmanMcpServer, tool: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let result = server.execute_tool(tool, Some(args.as_object().unwrap().clone())).await?;
    assert_eq!(result.is_error, Some(false));
    serde_json::from_str(&result.content[0].as_text().unwrap().text).map_err(|e| e.to_string())
}

#[tokio::test]
async fn test_manage_collection_tree_and_execute_created_request() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());
    let server = EzmanMcpServer::new(storage.clone());
    let port = spawn_echo_server().await;
    let collection = manage(&server, "create_collection", json!({
        "name": "Agent API", "description": "Created via MCP",
        "variables": [{"key": "baseUrl", "value": format!("http://127.0.0.1:{port}")}]
    })).await.unwrap();
    let cid = collection["id"].as_str().unwrap();
    assert!(!collection.to_string().contains("collection-secret"));
    storage.update_collection(cid, |collection| {
        collection.mcp_allow_secrets = true;
        collection.auth = Some(ezman_core::AuthConfig {
            auth_type: ezman_core::AuthType::Bearer,
            bearer_token: Some("collection-secret".into()),
            ..Default::default()
        });
        Ok(())
    }).unwrap();
    let folder = manage(&server, "create_folder", json!({
        "collection_id": cid, "name": "Users"
    })).await.unwrap();
    let fid = folder["folder"]["id"].as_str().unwrap();
    let nested = manage(&server, "create_folder", json!({
        "collection_id": cid, "parent_folder_id": fid, "name": "Nested"
    })).await.unwrap();
    let nested_id = nested["folder"]["id"].as_str().unwrap();
    let request = manage(&server, "create_request", json!({
        "collection_id": cid, "folder_id": nested_id, "name": "Create user",
        "method": "POST", "url": "{{baseUrl}}/users",
        "headers": [{"key": "Authorization", "value": "header-secret"}],
        "body": {"body_type": "json", "raw": "{\"name\":\"agent\"}"},
        "scripts": {"pre_request": "console.log('before')"}
    })).await.unwrap();
    let rid = request["request"]["id"].as_str().unwrap();
    assert!(request.to_string().contains("header-secret"));
    let before = storage.get_collection(cid).unwrap().unwrap();
    let before_request = before.find_request(rid).unwrap().clone();

    manage(&server, "update_collection", json!({
        "collection_id": cid, "changes": {"name": "Renamed", "auth": {"basic_username": "agent"}}
    })).await.unwrap();
    manage(&server, "update_folder", json!({
        "collection_id": cid, "folder_id": nested_id, "changes": {"name": "Details"}
    })).await.unwrap();
    manage(&server, "update_request", json!({
        "collection_id": cid, "request_id": rid,
        "changes": {"name": "Updated", "scripts": {"post_response": "console.log('after')"}}
    })).await.unwrap();
    let saved = storage.get_collection(cid).unwrap().unwrap();
    assert_eq!(saved.auth.unwrap().bearer_token.as_deref(), Some("collection-secret"));
    let (_, saved_request) = storage.find_request(rid).unwrap().unwrap();
    assert_eq!(saved_request.headers[0].value, "header-secret");
    assert_eq!(saved_request.created_at, before_request.created_at);
    assert_eq!(saved_request.body, before_request.body);
    assert_eq!(saved_request.scripts.pre_request, "console.log('before')");
    assert_eq!(saved_request.scripts.post_response, "console.log('after')");
    assert!(saved_request.updated_at >= before_request.updated_at);

    let output = run(&server, json!({"request_id": rid, "environment_id": "none"})).await.unwrap();
    assert_eq!(output["response"]["status"], 200);
    assert!(output["response"]["body"].as_str().unwrap().contains("{\"name\":\"agent\"}"));

    // Explicit null moves to root; omitted destination leaves an item in place.
    manage(&server, "update_folder", json!({
        "collection_id": cid, "folder_id": nested_id, "changes": {"parent_folder_id": null}
    })).await.unwrap();
    manage(&server, "update_request", json!({
        "collection_id": cid, "request_id": rid, "changes": {"folder_id": fid}
    })).await.unwrap();
    storage.update_collection(cid, |collection| { collection.mcp_allow_secrets = false; Ok(()) }).unwrap();
    let read = manage(&server, "get_collection", json!({"collection_id": cid})).await.unwrap();
    assert_eq!(read["folders"][0]["requests"][0]["id"], rid);
    assert_eq!(read["folders"][1]["id"], nested_id);
    assert!(!read.to_string().contains("header-secret"));
    assert!(!read.to_string().contains("collection-secret"));

    storage.update_collection(cid, |collection| { collection.mcp_allow_secrets = true; Ok(()) }).unwrap();
    manage(&server, "delete_request", json!({"collection_id": cid, "request_id": rid})).await.unwrap();
    assert!(storage.find_request(rid).unwrap().is_none());
    manage(&server, "delete_folder", json!({"collection_id": cid, "folder_id": fid})).await.unwrap();
    manage(&server, "delete_collection", json!({"collection_id": cid})).await.unwrap();
    assert!(storage.get_collection(cid).unwrap().is_none());
}

#[tokio::test]
async fn test_management_validation_and_failed_edits_are_atomic() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());
    let mut collection = Collection::new("col", "Original");
    let mut parent = ezman_core::Folder::new("parent", "Parent");
    parent.folders.push(ezman_core::Folder::new("child", "Child"));
    parent.requests.push(RequestItem::new("first", "First", HttpMethod::GET, "https://example.com"));
    parent.requests.push(RequestItem::new("second", "Second", HttpMethod::GET, "https://example.com"));
    collection.folders.push(parent);
    storage.save_collection(&collection).unwrap();
    let server = EzmanMcpServer::new(storage.clone());

    for (tool, args) in [
        ("update_folder", json!({"collection_id": "col", "folder_id": "parent", "changes": {"parent_folder_id": "child"}})),
        ("update_folder", json!({"collection_id": "col", "folder_id": "parent", "changes": {"parent_folder_id": "parent"}})),
        ("update_request", json!({"collection_id": "col", "request_id": "first", "changes": {"folder_id": "missing", "name": "Lost"}})),
        ("update_collection", json!({"collection_id": "col", "changes": {"name": " "}})),
        ("update_collection", json!({"collection_id": "col", "changes": {"id": "hijacked"}})),
        ("update_collection", json!({"collection_id": "col", "changes": {"auth": {"bearer_token": "[REDACTED]"}}})),
        ("update_request", json!({"collection_id": "col", "request_id": "first", "changes": {"method": "BAD"}})),
        ("update_request", json!({"collection_id": "col", "request_id": "missing", "changes": {"name": "No"}})),
        ("create_request", json!({"collection_id": "col", "name": "No URL"})),
        ("create_collection", json!({"name": "Invalid", "auth": {"unknown": "secret-do-not-echo"}})),
        ("get_collection", json!({"collection_id": "../preferences"})),
        ("delete_collection", json!({"collection_id": "../../preferences"})),
    ] {
        let error = manage(&server, tool, args).await.unwrap_err();
        assert!(!error.contains("secret-do-not-echo"));
        assert_eq!(storage.get_collection("col").unwrap().unwrap(), collection, "{tool}: {error}");
    }
    manage(&server, "update_request", json!({
        "collection_id": "col", "request_id": "first", "changes": {"name": "Renamed"}
    })).await.unwrap();
    let saved = storage.get_collection("col").unwrap().unwrap();
    assert_eq!(saved.folders[0].requests[0].id, "first", "Updating must preserve order");
    assert_eq!(saved.folders[0].requests[1].id, "second");
    manage(&server, "delete_folder", json!({"collection_id": "col", "folder_id": "parent"})).await.unwrap();
    assert!(storage.get_collection("col").unwrap().unwrap().folders.is_empty());
    assert!(storage.find_request("first").unwrap().is_none());

    let tools = EzmanMcpServer::tools_list();
    assert_eq!(tools.iter().find(|t| t.name == "create_collection").unwrap().annotations.as_ref().unwrap().read_only_hint, Some(false));
    assert_eq!(tools.iter().find(|t| t.name == "delete_folder").unwrap().annotations.as_ref().unwrap().destructive_hint, Some(true));
    assert_eq!(tools.iter().find(|t| t.name == "get_collection").unwrap().annotations.as_ref().unwrap().read_only_hint, Some(true));
}

#[tokio::test]
async fn test_manage_environments_and_individual_variables_without_losing_secrets() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());
    let server = EzmanMcpServer::new(storage.clone());
    let env = manage(&server, "create_environment", json!({
        "name": "Dev", "variables": [
            {"key": "baseUrl", "value": "https://old.example.com"}
        ]
    })).await.unwrap();
    let eid = env["id"].as_str().unwrap();
    assert!(!env.to_string().contains("secret-token"));
    storage.update_environment(eid, |environment| {
        environment.mcp_allow_secrets = true;
        environment.variables.insert(0, EnvironmentVariable::new("token", "secret-token", true));
        Ok(())
    }).unwrap();
    manage(&server, "update_environment", json!({
        "environment_id": eid, "changes": {"name": "Development"}
    })).await.unwrap();
    manage(&server, "set_variable", json!({
        "resource": "environment", "resource_id": eid, "key": "baseUrl", "value": "https://new.example.com"
    })).await.unwrap();
    manage(&server, "set_variable", json!({
        "resource": "environment", "resource_id": eid, "key": "token", "enabled": false
    })).await.unwrap();
    let mut saved = storage.get_environment(eid).unwrap().unwrap();
    assert_eq!(saved.variables[0].value, "secret-token");
    assert!(saved.variables[0].secret);
    assert!(!saved.variables[0].enabled);
    assert_eq!(saved.variables[1].value, "https://new.example.com");
    saved.mcp_allow_secrets = false;
    storage.save_environment(&saved).unwrap();
    let read = manage(&server, "get_environment", json!({"environment_id": eid})).await.unwrap();
    assert!(!read.to_string().contains("secret-token"));
    assert!(manage(&server, "update_environment", json!({
        "environment_id": eid, "changes": {"variables": read["variables"]}
    })).await.is_err(), "Redacted snapshots must not overwrite credentials");
    assert!(manage(&server, "set_variable", json!({
        "resource": "environment", "resource_id": eid, "key": "new"
    })).await.is_err(), "New variables require a value");
    assert_eq!(storage.get_environment(eid).unwrap().unwrap(), saved);
    manage(&server, "delete_variable", json!({
        "resource": "environment", "resource_id": eid, "key": "baseUrl"
    })).await.unwrap();
    storage.update_environment(eid, |environment| { environment.mcp_allow_secrets = true; Ok(()) }).unwrap();
    manage(&server, "delete_environment", json!({"environment_id": eid})).await.unwrap();
    assert!(storage.get_environment(eid).unwrap().is_none());

    let collection = manage(&server, "create_collection", json!({"name": "Variables"})).await.unwrap();
    let cid = collection["id"].as_str().unwrap();
    manage(&server, "set_variable", json!({
        "resource": "collection", "resource_id": cid, "key": "baseUrl", "value": "", "description": "API URL"
    })).await.unwrap();
    manage(&server, "set_variable", json!({
        "resource": "collection", "resource_id": cid, "key": "baseUrl", "enabled": false
    })).await.unwrap();
    let saved = storage.get_collection(cid).unwrap().unwrap();
    assert_eq!(saved.variables[0].value, "");
    assert_eq!(saved.variables[0].description.as_deref(), Some("API URL"));
    assert!(!saved.variables[0].enabled);
    manage(&server, "delete_variable", json!({
        "resource": "collection", "resource_id": cid, "key": "baseUrl"
    })).await.unwrap();
    assert!(storage.get_collection(cid).unwrap().unwrap().variables.is_empty());
}

#[tokio::test]
async fn test_mcp_secret_permissions_default_deny_mutations_and_cannot_self_enable() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());
    let mut collection = Collection::new("protected", "Protected");
    let mut token = KeyValueItem::new("token", "collection-private-value");
    token.secret = true;
    collection.variables.push(token);
    collection.variables.push(KeyValueItem::new("baseUrl", "https://example.com"));
    let mut folder = ezman_core::Folder::new("folder", "Folder");
    folder.auth = Some(ezman_core::AuthConfig {
        auth_type: ezman_core::AuthType::Bearer,
        bearer_token: Some("folder-private-value".into()),
        ..Default::default()
    });
    let mut request = RequestItem::new("req", "Request", HttpMethod::GET, "https://example.com");
    request.headers.push(KeyValueItem::new("Authorization", "header-private-value"));
    folder.requests.push(request);
    collection.folders.push(folder);
    // Older files without the permission field must also default to denying access.
    let mut legacy = serde_json::to_value(&collection).unwrap();
    legacy.as_object_mut().unwrap().remove("mcp_allow_secrets");
    let collection: Collection = serde_json::from_value(legacy).unwrap();
    storage.save_collection(&collection).unwrap();
    let mut environment = Environment::new("env", "Protected");
    environment.variables.push(EnvironmentVariable::new("token", "env-private-value", true));
    storage.save_environment(&environment).unwrap();
    let server = EzmanMcpServer::new(storage.clone());

    for (tool, args) in [
        ("update_collection", json!({"collection_id": "protected", "changes": {"mcp_allow_secrets": true}})),
        ("create_collection", json!({"name": "Escalation", "mcp_allow_secrets": true})),
        ("create_collection", json!({"name": "Secret", "auth": {"auth_type": "bearer", "bearer_token": "new-secret"}})),
        ("create_environment", json!({"name": "Secret", "variables": [{"key": "token", "value": "new-secret", "secret": true}]})),
        ("update_environment", json!({"environment_id": "env", "changes": {"mcp_allow_secrets": true}})),
        ("update_environment", json!({"environment_id": "env", "changes": {"variables": []}})),
        ("set_variable", json!({"resource": "environment", "resource_id": "env", "key": "token", "secret": false})),
        ("set_variable", json!({"resource": "collection", "resource_id": "protected", "key": "token", "value": "replacement"})),
        ("delete_variable", json!({"resource": "collection", "resource_id": "protected", "key": "token"})),
        ("delete_variable", json!({"resource": "environment", "resource_id": "env", "key": "token"})),
        ("update_collection", json!({"collection_id": "protected", "changes": {"variables": []}})),
        ("update_folder", json!({"collection_id": "protected", "folder_id": "folder", "changes": {"auth": null}})),
        ("update_request", json!({"collection_id": "protected", "request_id": "req", "changes": {"headers": []}})),
        ("create_request", json!({"collection_id": "protected", "name": "Secret", "url": "https://example.com", "auth": {"auth_type": "basic", "basic_password": "new-secret"}})),
        ("delete_request", json!({"collection_id": "protected", "request_id": "req"})),
        ("delete_folder", json!({"collection_id": "protected", "folder_id": "folder"})),
        ("delete_collection", json!({"collection_id": "protected"})),
        ("delete_environment", json!({"environment_id": "env"})),
    ] {
        assert!(manage(&server, tool, args).await.is_err(), "{tool} must reject protected edits");
        assert_eq!(storage.get_collection("protected").unwrap().unwrap(), collection, "{tool}");
        assert_eq!(storage.get_environment("env").unwrap().unwrap(), environment, "{tool}");
    }

    // Metadata, normal variables and structural moves remain usable with secrets locked.
    manage(&server, "update_collection", json!({"collection_id": "protected", "changes": {"name": "Renamed"}})).await.unwrap();
    manage(&server, "set_variable", json!({"resource": "collection", "resource_id": "protected", "key": "baseUrl", "value": "https://new.example.com"})).await.unwrap();
    let moved = manage(&server, "update_request", json!({
        "collection_id": "protected", "request_id": "req", "changes": {"folder_id": null, "name": "Moved"}
    })).await.unwrap();
    assert!(!moved.to_string().contains("header-private-value"));
    assert_eq!(storage.get_collection("protected").unwrap().unwrap().requests[0].name, "Moved");
    let env = manage(&server, "update_environment", json!({"environment_id": "env", "changes": {"name": "Renamed"}})).await.unwrap();
    assert_eq!(env["variables"][0]["value"], "[REDACTED]");

    // A user opt-in is persisted outside MCP and takes effect without restarting the server.
    storage.update_collection("protected", |c| { c.mcp_allow_secrets = true; Ok(()) }).unwrap();
    storage.update_environment("env", |e| { e.mcp_allow_secrets = true; Ok(()) }).unwrap();
    let updated = manage(&server, "update_request", json!({
        "collection_id": "protected", "request_id": "req", "changes": {"headers": [{"key": "Authorization", "value": "new-header-value"}]}
    })).await.unwrap();
    assert!(updated.to_string().contains("new-header-value"));
    manage(&server, "set_variable", json!({"resource": "environment", "resource_id": "env", "key": "token", "value": "new-env-value"})).await.unwrap();
    manage(&server, "delete_collection", json!({"collection_id": "protected"})).await.unwrap();
    manage(&server, "delete_environment", json!({"environment_id": "env"})).await.unwrap();
}

#[tokio::test]
async fn test_secret_read_permissions_are_independent_and_execution_redacts_echoes() {
    let tmp = tempdir().unwrap();
    let storage = Arc::new(StorageManager::with_dir(tmp.path()).unwrap());
    let port = spawn_echo_server().await;
    let mut collection = Collection::new("col", "API");
    let mut request = RequestItem::new("req", "Echo", HttpMethod::POST, format!("http://127.0.0.1:{port}/{{{{token}}}}"));
    request.auth = Some(ezman_core::AuthConfig {
        auth_type: ezman_core::AuthType::Basic,
        basic_username: Some("private-user".into()),
        basic_password: Some("private-password".into()),
        ..Default::default()
    });
    request.body.body_type = ezman_core::RequestBodyType::Text;
    request.body.raw = Some("{{token}}".into());
    collection.requests.push(request);
    storage.save_collection(&collection).unwrap();
    let mut environment = Environment::new("env", "Dev");
    environment.variables.push(EnvironmentVariable::new("token", "environment private value", true));
    storage.save_environment(&environment).unwrap();
    let server = EzmanMcpServer::new(storage.clone());

    for (collection_access, environment_access) in [(false, false), (true, false), (false, true), (true, true), (false, false)] {
        storage.update_collection("col", |c| { c.mcp_allow_secrets = collection_access; Ok(()) }).unwrap();
        storage.update_environment("env", |e| { e.mcp_allow_secrets = environment_access; Ok(()) }).unwrap();
        for tool in ["get_collection", "get_request"] {
            let args = if tool == "get_collection" { json!({"collection_id": "col"}) } else { json!({"request_id": "req"}) };
            let read = manage(&server, tool, args).await.unwrap().to_string();
            assert_eq!(read.contains("private-password"), collection_access, "{tool}");
            assert_eq!(read.contains("private-user"), collection_access, "{tool}");
        }
        for tool in ["get_environment", "list_environments"] {
            let args = if tool == "get_environment" { json!({"environment_id": "env"}) } else { json!({}) };
            let read = manage(&server, tool, args).await.unwrap().to_string();
            assert_eq!(read.contains("environment private value"), environment_access, "{tool}");
        }
        let output = run(&server, json!({"request_id": "req", "environment_id": "env"})).await.unwrap();
        assert_eq!(output["response"]["status"], 200, "Locked secrets remain usable for execution");
        let text = output.to_string();
        assert_eq!(text.contains("environment private value"), environment_access);
        assert_eq!(text.contains("environment%20private%20value"), environment_access);
        assert_eq!(text.contains("cHJpdmF0ZS11c2VyOnByaXZhdGUtcGFzc3dvcmQ="), collection_access, "Basic auth echo must be protected too");
    }
}
