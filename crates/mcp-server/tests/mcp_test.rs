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
