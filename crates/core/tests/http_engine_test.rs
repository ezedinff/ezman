use ezman_core::{
    AuthConfig, AuthType, HttpEngine, HttpMethod, KeyValueItem, RequestBodyConfig,
    RequestBodyType, RequestItem,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::test]
async fn test_http_engine_get_and_post() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        // Handle three requests: GET, POST, and GRAPHQL
        for _ in 0..3 {
            if let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req_text = String::from_utf8_lossy(&buf[..n]);

                    if req_text.starts_with("GET /hello") {
                        let body = "{\"message\":\"hi\"}";
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(resp.as_bytes()).await;
                        let _ = stream.flush().await;
                    } else if req_text.starts_with("POST /echo") {
                        let body = "{\"status\":\"ok\"}";
                        let resp = format!(
                            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(resp.as_bytes()).await;
                        let _ = stream.flush().await;
                    } else if req_text.starts_with("POST /graphql") {
                        let body = "{\"data\":{\"user\":{\"id\":\"123\",\"name\":\"Alice\"}}}";
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(resp.as_bytes()).await;
                        let _ = stream.flush().await;
                    }
                });
            }
        }
    });

    let engine = HttpEngine::new().unwrap();

    // 1. Test GET request
    let mut get_req = RequestItem::new(
        "r1",
        "Test GET",
        HttpMethod::GET,
        format!("http://127.0.0.1:{}/hello", port),
    );
    get_req.params.push(KeyValueItem::new("q", "1"));
    let resp = engine.execute(&get_req, None).await;
    assert_eq!(resp.status, 200, "Error: {:?}", resp.error);
    assert_eq!(resp.body, "{\"message\":\"hi\"}");
    assert!(resp.duration_ms < 5000);

    // 2. Test POST request with body and auth
    let mut post_req = RequestItem::new(
        "r2",
        "Test POST",
        HttpMethod::POST,
        format!("http://127.0.0.1:{}/echo", port),
    );
    post_req.body = RequestBodyConfig {
        body_type: RequestBodyType::Json,
        raw: Some("{\"test\": true}".to_string()),
        ..Default::default()
    };
    post_req.auth = Some(AuthConfig {
        auth_type: AuthType::Bearer,
        bearer_token: Some("secret-token".to_string()),
        ..Default::default()
    });

    let post_resp = engine.execute(&post_req, None).await;
    assert_eq!(post_resp.status, 201, "Error: {:?}", post_resp.error);
    assert_eq!(post_resp.body, "{\"status\":\"ok\"}");

    // 3. Test GraphQL POST request
    let mut gql_req = RequestItem::new(
        "r3",
        "Test GraphQL",
        HttpMethod::POST,
        format!("http://127.0.0.1:{}/graphql", port),
    );
    gql_req.body = RequestBodyConfig {
        body_type: RequestBodyType::GraphQL,
        graphql_query: Some("query GetUser($id: ID!) { user(id: $id) { id name } }".to_string()),
        graphql_variables: Some("{\"id\": \"123\"}".to_string()),
        ..Default::default()
    };

    let gql_resp = engine.execute(&gql_req, None).await;
    assert_eq!(gql_resp.status, 200, "Error: {:?}", gql_resp.error);
    assert!(gql_resp.body.contains("\"name\":\"Alice\""));
}
