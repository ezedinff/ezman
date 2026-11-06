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
