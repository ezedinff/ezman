use serde_json::Value;
use uuid::Uuid;
use crate::error::{CoreError, Result};
use crate::model::{
    ApiKeyLocation, AuthConfig, AuthType, Collection, Folder, HttpMethod, ImportResult,
    ImportWarning, KeyValueItem, RequestBodyConfig, RequestBodyType, RequestItem,
    RequestScripts,
};

pub struct PostmanImporter;

impl PostmanImporter {
    pub fn import_json(json_str: &str) -> Result<ImportResult> {
        let root: Value = serde_json::from_str(json_str)
            .map_err(|e| CoreError::ImportError(format!("Invalid JSON: {}", e)))?;

        Self::import_value(&root)
    }

    pub fn import_value(root: &Value) -> Result<ImportResult> {
        let mut warnings = Vec::new();

        // 1. Verify and extract collection info
        let info = root.get("info").ok_or_else(|| {
            CoreError::ImportError("Missing 'info' object in Postman collection".to_string())
        })?;

        let col_id = info
            .get("_postman_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let name = info
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Imported Collection")
            .to_string();

        let description = extract_description(info);

        let mut collection = Collection::new(col_id, name);
        collection.description = description;

        // 2. Collection variables
        if let Some(vars) = root.get("variable").and_then(|v| v.as_array()) {
            for v in vars {
                if let Some(key) = v.get("key").and_then(|k| k.as_str()) {
                    let val = v.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    let disabled = v.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false);
                    let desc = extract_description(v);
                    let mut item = KeyValueItem::new(key, val);
                    item.enabled = !disabled;
                    item.description = desc;
                    collection.variables.push(item);
                }
            }
        }

        // 3. Collection-level auth
        if let Some(auth_val) = root.get("auth") {
            let (auth_config, auth_warn) = parse_auth(auth_val, &collection.name);
            collection.auth = auth_config;
            if let Some(w) = auth_warn {
                warnings.push(w);
            }
        }

        // 4. Collection-level scripts check
        check_scripts(root, &collection.name, &mut warnings);

        // 5. Items (folders and requests)
        if let Some(items) = root.get("item").and_then(|i| i.as_array()) {
            for item in items {
                process_item(item, &mut collection.folders, &mut collection.requests, &mut warnings);
            }
        }

        Ok(ImportResult {
            collection,
            warnings,
        })
    }
}

fn extract_description(val: &Value) -> Option<String> {
    if let Some(desc_val) = val.get("description") {
        if let Some(s) = desc_val.as_str() {
            return Some(s.to_string());
        } else if let Some(content) = desc_val.get("content").and_then(|c| c.as_str()) {
            return Some(content.to_string());
        }
    }
    None
}

fn parse_scripts(item: &Value) -> RequestScripts {
    let mut scripts = RequestScripts::default();
    if let Some(events) = item.get("event").and_then(|e| e.as_array()) {
        for event in events {
            let code = match event.get("script").and_then(|s| s.get("exec")) {
                Some(Value::Array(lines)) => lines
                    .iter()
                    .filter_map(|l| l.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
                Some(Value::String(s)) => s.clone(),
                _ => continue,
            };
            match event.get("listen").and_then(|l| l.as_str()) {
                Some("prerequest") => scripts.pre_request = code,
                Some("test") => scripts.post_response = code,
                _ => {}
            }
        }
    }
    scripts
}

fn check_scripts(val: &Value, name: &str, warnings: &mut Vec<ImportWarning>) {
    if let Some(events) = val.get("event").and_then(|e| e.as_array()) {
        for event in events {
            if let Some(listen) = event.get("listen").and_then(|l| l.as_str()) {
                if listen == "prerequest" || listen == "test" {
                    warnings.push(ImportWarning {
                        item_name: name.to_string(),
                        warning_type: "unsupported_script".to_string(),
                        message: format!(
                            "Postman '{}' script in '{}' is not supported and was omitted.",
                            listen, name
                        ),
                    });
                }
            }
        }
    }
}

fn parse_auth(auth_val: &Value, context_name: &str) -> (Option<AuthConfig>, Option<ImportWarning>) {
    let auth_type_str = match auth_val.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return (None, None),
    };

    match auth_type_str {
        "noauth" => (None, None),
        "bearer" => {
            let mut token = None;
            if let Some(params) = auth_val.get("bearer").and_then(|p| p.as_array()) {
                for p in params {
                    if p.get("key").and_then(|k| k.as_str()) == Some("token") {
                        token = p.get("value").and_then(|v| v.as_str()).map(|s| s.to_string());
                    }
                }
            }
            (
                Some(AuthConfig {
                    auth_type: AuthType::Bearer,
                    bearer_token: token,
                    ..Default::default()
                }),
                None,
            )
        }
        "basic" => {
            let mut username = None;
            let mut password = None;
            if let Some(params) = auth_val.get("basic").and_then(|p| p.as_array()) {
                for p in params {
                    match p.get("key").and_then(|k| k.as_str()) {
                        Some("username") => {
                            username = p.get("value").and_then(|v| v.as_str()).map(|s| s.to_string());
                        }
                        Some("password") => {
                            password = p.get("value").and_then(|v| v.as_str()).map(|s| s.to_string());
                        }
                        _ => {}
                    }
                }
            }
            (
                Some(AuthConfig {
                    auth_type: AuthType::Basic,
                    basic_username: username,
                    basic_password: password,
                    ..Default::default()
                }),
                None,
            )
        }
        "apikey" => {
            let mut key_name = None;
            let mut key_val = None;
            let mut location = ApiKeyLocation::Header;
            if let Some(params) = auth_val.get("apikey").and_then(|p| p.as_array()) {
                for p in params {
                    match p.get("key").and_then(|k| k.as_str()) {
                        Some("key") => {
                            key_name = p.get("value").and_then(|v| v.as_str()).map(|s| s.to_string());
                        }
                        Some("value") => {
                            key_val = p.get("value").and_then(|v| v.as_str()).map(|s| s.to_string());
                        }
                        Some("in") => {
                            if p.get("value").and_then(|v| v.as_str()) == Some("query") {
                                location = ApiKeyLocation::Query;
                            }
                        }
                        _ => {}
                    }
                }
            }
            (
                Some(AuthConfig {
                    auth_type: AuthType::ApiKey,
                    api_key_name: key_name,
                    api_key_value: key_val,
                    api_key_in: Some(location),
                    ..Default::default()
                }),
                None,
            )
        }
        other => (
            None,
            Some(ImportWarning {
                item_name: context_name.to_string(),
                warning_type: "unsupported_auth".to_string(),
                message: format!(
                    "Auth type '{}' in '{}' is not supported and was omitted.",
                    other, context_name
                ),
            }),
        ),
    }
}

fn process_item(
    item: &Value,
    folders: &mut Vec<Folder>,
    requests: &mut Vec<RequestItem>,
    warnings: &mut Vec<ImportWarning>,
) {
    let item_name = item
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled")
        .to_string();

    // Only request-level scripts are supported; folder-level ones are reported.
    if item.get("item").is_some() {
        check_scripts(item, &item_name, warnings);
    }

    // If item has a nested "item" array, it's a folder
    if let Some(child_items) = item.get("item").and_then(|i| i.as_array()) {
        let folder_id = item
            .get("id")
            .and_then(|i| i.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let mut folder = Folder::new(folder_id, &item_name);
        folder.description = extract_description(item);

        if let Some(auth_val) = item.get("auth") {
            let (auth, auth_w) = parse_auth(auth_val, &item_name);
            folder.auth = auth;
            if let Some(w) = auth_w {
                warnings.push(w);
            }
        }

        for child in child_items {
            process_item(child, &mut folder.folders, &mut folder.requests, warnings);
        }

        folders.push(folder);
    } else if let Some(req_val) = item.get("request") {
        // It's a request
        if let Some(mut parsed_req) = parse_request(item, req_val, warnings) {
            parsed_req.scripts = parse_scripts(item);
            requests.push(parsed_req);
        }
    }
}

fn parse_request(
    item_val: &Value,
    req_val: &Value,
    warnings: &mut Vec<ImportWarning>,
) -> Option<RequestItem> {
    let name = item_val
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Request")
        .to_string();

    let id = item_val
        .get("id")
        .and_then(|i| i.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let description = extract_description(req_val).or_else(|| extract_description(item_val));

    // HTTP Method
    let method = match req_val.get("method").and_then(|m| m.as_str()) {
        Some(m) => match m.to_uppercase().as_str() {
            "GET" => HttpMethod::GET,
            "POST" => HttpMethod::POST,
            "PUT" => HttpMethod::PUT,
            "PATCH" => HttpMethod::PATCH,
            "DELETE" => HttpMethod::DELETE,
            "HEAD" => HttpMethod::HEAD,
            "OPTIONS" => HttpMethod::OPTIONS,
            other => {
                warnings.push(ImportWarning {
                    item_name: name.clone(),
                    warning_type: "unsupported_method".to_string(),
                    message: format!("Method '{}' in '{}' defaulted to GET.", other, name),
                });
                HttpMethod::GET
            }
        },
        None => HttpMethod::GET,
    };

    // URL & Query Params
    let mut raw_url = String::new();
    let mut params = Vec::new();

    if let Some(url_val) = req_val.get("url") {
        if let Some(url_str) = url_val.as_str() {
            raw_url = url_str.to_string();
        } else if let Some(url_obj) = url_val.as_object() {
            if let Some(raw) = url_obj.get("raw").and_then(|r| r.as_str()) {
                raw_url = raw.to_string();
            }

            if let Some(query_arr) = url_obj.get("query").and_then(|q| q.as_array()) {
                for q in query_arr {
                    if let Some(k) = q.get("key").and_then(|k| k.as_str()) {
                        let v = q.get("value").and_then(|v| v.as_str()).unwrap_or("");
                        let disabled = q.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false);
                        let desc = extract_description(q);
                        let mut item = KeyValueItem::new(k, v);
                        item.enabled = !disabled;
                        item.description = desc;
                        params.push(item);
                    }
                }
            }
        }
    }

    // Headers
    let mut headers = Vec::new();
    if let Some(hdr_arr) = req_val.get("header").and_then(|h| h.as_array()) {
        for h in hdr_arr {
            if let Some(k) = h.get("key").and_then(|k| k.as_str()) {
                let v = h.get("value").and_then(|v| v.as_str()).unwrap_or("");
                let disabled = h.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false);
                let desc = extract_description(h);
                let mut item = KeyValueItem::new(k, v);
                item.enabled = !disabled;
                item.description = desc;
                headers.push(item);
            }
        }
    }

    // Auth
    let (auth, auth_w) = if let Some(auth_val) = req_val.get("auth") {
        parse_auth(auth_val, &name)
    } else {
        (None, None)
    };
    if let Some(w) = auth_w {
        warnings.push(w);
    }

    // Body
    let mut body_config = RequestBodyConfig::default();
    if let Some(body_val) = req_val.get("body") {
        if let Some(mode) = body_val.get("mode").and_then(|m| m.as_str()) {
            match mode {
                "raw" => {
                    let raw_content = body_val.get("raw").and_then(|r| r.as_str()).unwrap_or("");
                    let lang = body_val
                        .get("options")
                        .and_then(|o| o.get("raw"))
                        .and_then(|r| r.get("language"))
                        .and_then(|l| l.as_str());

                    if lang == Some("json") || raw_content.trim().starts_with('{') || raw_content.trim().starts_with('[') {
                        body_config.body_type = RequestBodyType::Json;
                    } else {
                        body_config.body_type = RequestBodyType::Text;
                    }
                    body_config.raw = Some(raw_content.to_string());
                }
                "urlencoded" => {
                    body_config.body_type = RequestBodyType::UrlEncoded;
                    let mut form_items = Vec::new();
                    if let Some(params) = body_val.get("urlencoded").and_then(|u| u.as_array()) {
                        for p in params {
                            if let Some(k) = p.get("key").and_then(|k| k.as_str()) {
                                let v = p.get("value").and_then(|v| v.as_str()).unwrap_or("");
                                let disabled = p.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false);
                                let desc = extract_description(p);
                                let mut item = KeyValueItem::new(k, v);
                                item.enabled = !disabled;
                                item.description = desc;
                                form_items.push(item);
                            }
                        }
                    }
                    body_config.url_encoded = Some(form_items);
                }
                "graphql" => {
                    body_config.body_type = RequestBodyType::GraphQL;
                    if let Some(graphql_obj) = body_val.get("graphql") {
                        if let Some(query) = graphql_obj.get("query").and_then(|q| q.as_str()) {
                            body_config.graphql_query = Some(query.to_string());
                        }
                        if let Some(variables) = graphql_obj.get("variables").and_then(|v| v.as_str()) {
                            body_config.graphql_variables = Some(variables.to_string());
                        }
                    }
                }
                other => {
                    warnings.push(ImportWarning {
                        item_name: name.clone(),
                        warning_type: "unsupported_body_mode".to_string(),
                        message: format!("Body mode '{}' in '{}' is not supported and was omitted.", other, name),
                    });
                }
            }
        }
    }

    let mut request_item = RequestItem::new(id, name, method, raw_url);
    request_item.description = description;
    request_item.params = params;
    request_item.headers = headers;
    request_item.auth = auth;
    request_item.body = body_config;

    Some(request_item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_postman_collection() {
        let json = r#"{
            "info": {
                "_postman_id": "test-col-1",
                "name": "Sample API",
                "description": "A sample collection",
                "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
            },
            "variable": [
                { "key": "baseUrl", "value": "https://api.example.com" }
            ],
            "auth": {
                "type": "bearer",
                "bearer": [
                    { "key": "token", "value": "my-secret-token" }
                ]
            },
            "event": [
                {
                    "listen": "prerequest",
                    "script": { "type": "text/javascript", "exec": ["console.log('hi');"] }
                }
            ],
            "item": [
                {
                    "name": "Auth Folder",
                    "description": "Folder with auth requests",
                    "item": [
                        {
                            "name": "Login",
                            "request": {
                                "method": "POST",
                                "url": {
                                    "raw": "{{baseUrl}}/auth/login",
                                    "query": [
                                        { "key": "source", "value": "app" }
                                    ]
                                },
                                "header": [
                                    { "key": "Accept", "value": "application/json" }
                                ],
                                "body": {
                                    "mode": "raw",
                                    "raw": "{\"username\":\"admin\",\"password\":\"pass\"}",
                                    "options": { "raw": { "language": "json" } }
                                }
                            }
                        }
                    ]
                },
                {
                    "name": "Get Profile",
                    "request": {
                        "method": "GET",
                        "url": "{{baseUrl}}/profile"
                    }
                }
            ]
        }"#;

        let result = PostmanImporter::import_json(json).expect("import succeeds");
        assert_eq!(result.collection.id, "test-col-1");
        assert_eq!(result.collection.name, "Sample API");
        assert_eq!(result.collection.variables.len(), 1);
        assert_eq!(result.collection.variables[0].key, "baseUrl");

        // Auth
        let auth = result.collection.auth.expect("has auth");
        assert_eq!(auth.auth_type, AuthType::Bearer);
        assert_eq!(auth.bearer_token, Some("my-secret-token".to_string()));

        // Folder & requests
        assert_eq!(result.collection.folders.len(), 1);
        assert_eq!(result.collection.folders[0].name, "Auth Folder");
        assert_eq!(result.collection.folders[0].requests.len(), 1);
        assert_eq!(result.collection.folders[0].requests[0].name, "Login");
        assert_eq!(result.collection.folders[0].requests[0].method, HttpMethod::POST);
        assert_eq!(result.collection.folders[0].requests[0].body.body_type, RequestBodyType::Json);

        assert_eq!(result.collection.requests.len(), 1);
        assert_eq!(result.collection.requests[0].name, "Get Profile");

        // Warnings for unsupported prerequest script
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].warning_type, "unsupported_script");
    }

    #[test]
    fn test_import_unsupported_auth_warning() {
        let json = r#"{
            "info": { "name": "Unsupported Auth Col" },
            "auth": {
                "type": "digest",
                "digest": []
            },
            "item": []
        }"#;

        let result = PostmanImporter::import_json(json).expect("import succeeds");
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].warning_type, "unsupported_auth");
    }

    #[test]
    fn test_import_sample_postman_collection_file() {
        let sample_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../examples/postman_collection_v2.1_sample.json"
        );
        let content = std::fs::read_to_string(sample_path)
            .expect("should read sample collection file");
        let result = PostmanImporter::import_json(&content).expect("import succeeds");

        assert_eq!(result.collection.name, "Sample REST API (Ezman Demo)");
        assert_eq!(result.collection.folders.len(), 3);

        // First folder: Health & Diagnostics
        let health_folder = &result.collection.folders[0];
        assert_eq!(health_folder.name, "Health & Diagnostics");
        assert_eq!(health_folder.requests.len(), 2);

        // Second folder: Users Management
        let users_folder = &result.collection.folders[1];
        assert_eq!(users_folder.name, "Users Management");
        assert_eq!(users_folder.requests.len(), 3);

        // Third folder: GraphQL API
        let gql_folder = &result.collection.folders[2];
        assert_eq!(gql_folder.name, "GraphQL API");
        assert_eq!(gql_folder.requests.len(), 3);
        assert_eq!(gql_folder.requests[0].body.body_type, RequestBodyType::GraphQL);
        assert!(gql_folder.requests[0].body.graphql_query.as_ref().unwrap().contains("query GetUsers"));

        // Request-level pre-request scripts are imported rather than dropped
        assert!(users_folder
            .requests
            .iter()
            .any(|r| !r.scripts.pre_request.trim().is_empty()));
    }

    #[test]
    fn test_import_graphql_request() {
        let json = r#"{
            "info": { "name": "GraphQL API" },
            "item": [
                {
                    "name": "Get User Query",
                    "request": {
                        "method": "POST",
                        "url": "https://api.example.com/graphql",
                        "body": {
                            "mode": "graphql",
                            "graphql": {
                                "query": "query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}",
                                "variables": "{\n  \"id\": \"123\"\n}"
                            }
                        }
                    }
                }
            ]
        }"#;

        let result = PostmanImporter::import_json(json).expect("import succeeds");
        assert_eq!(result.collection.requests.len(), 1);
        let req = &result.collection.requests[0];
        assert_eq!(req.name, "Get User Query");
        assert_eq!(req.body.body_type, RequestBodyType::GraphQL);
        assert!(req.body.graphql_query.as_ref().unwrap().contains("query GetUser"));
        assert!(req.body.graphql_variables.as_ref().unwrap().contains("\"id\": \"123\""));
        assert!(result.warnings.is_empty());
    }
}

