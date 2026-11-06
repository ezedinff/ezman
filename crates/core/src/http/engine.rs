use std::time::{Duration, Instant};
use reqwest::{Client, Method, redirect::Policy};
use crate::auth::apply_auth;
use crate::error::{CoreError, Result};
use crate::model::{AuthConfig, AuthType, HttpMethod, HttpResponse, RequestBodyType, RequestItem};

#[derive(Debug, Clone)]
pub struct HttpEngineConfig {
    pub timeout: Duration,
    pub max_redirects: usize,
    pub danger_accept_invalid_certs: bool,
}

impl Default for HttpEngineConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
            max_redirects: 10,
            danger_accept_invalid_certs: false,
        }
    }
}

pub struct HttpEngine {
    client: Client,
    pub config: HttpEngineConfig,
}

impl HttpEngine {
    pub fn new() -> Result<Self> {
        Self::with_config(HttpEngineConfig::default())
    }

    pub fn with_config(config: HttpEngineConfig) -> Result<Self> {
        let mut builder = Client::builder()
            .timeout(config.timeout)
            .redirect(Policy::limited(config.max_redirects));

        if config.danger_accept_invalid_certs {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let client = builder.build().map_err(CoreError::Http)?;
        Ok(Self { client, config })
    }

    pub async fn execute(
        &self,
        request: &RequestItem,
        inherited_auth: Option<&AuthConfig>,
    ) -> HttpResponse {
        let start_time = Instant::now();

        // Map HTTP method
        let method = match request.method {
            HttpMethod::GET => Method::GET,
            HttpMethod::POST => Method::POST,
            HttpMethod::PUT => Method::PUT,
            HttpMethod::PATCH => Method::PATCH,
            HttpMethod::DELETE => Method::DELETE,
            HttpMethod::HEAD => Method::HEAD,
            HttpMethod::OPTIONS => Method::OPTIONS,
        };

        let mut req_builder = self.client.request(method, &request.url);

        // Add query parameters
        let query_params: Vec<(&str, &str)> = request
            .params
            .iter()
            .filter(|p| p.enabled && !p.key.trim().is_empty())
            .map(|p| (p.key.as_str(), p.value.as_str()))
            .collect();

        if !query_params.is_empty() {
            req_builder = req_builder.query(&query_params);
        }

        // Add headers
        for h in &request.headers {
            if h.enabled && !h.key.trim().is_empty() {
                req_builder = req_builder.header(&h.key, &h.value);
            }
        }

        // Apply auth: prefer request-level auth if set, otherwise inherited auth
        let effective_auth = match &request.auth {
            Some(a) if a.auth_type != AuthType::None && a.auth_type != AuthType::Inherit => Some(a),
            _ => inherited_auth,
        };

        if let Some(auth) = effective_auth {
            req_builder = apply_auth(req_builder, auth);
        }

        // Add body if method supports it
        match request.body.body_type {
            RequestBodyType::None => {}
            RequestBodyType::Json => {
                if let Some(raw) = &request.body.raw {
                    req_builder = req_builder
                        .header(reqwest::header::CONTENT_TYPE, "application/json")
                        .body(raw.clone());
                }
            }
            RequestBodyType::Text => {
                if let Some(raw) = &request.body.raw {
                    req_builder = req_builder
                        .header(reqwest::header::CONTENT_TYPE, "text/plain")
                        .body(raw.clone());
                }
            }
            RequestBodyType::UrlEncoded => {
                if let Some(items) = &request.body.url_encoded {
                    let form_items: Vec<(&str, &str)> = items
                        .iter()
                        .filter(|p| p.enabled && !p.key.trim().is_empty())
                        .map(|p| (p.key.as_str(), p.value.as_str()))
                        .collect();
                    req_builder = req_builder.form(&form_items);
                }
            }
            RequestBodyType::GraphQL => {
                let mut map = serde_json::Map::new();
                let query_str = request.body.graphql_query.clone().unwrap_or_default();
                map.insert("query".to_string(), serde_json::Value::String(query_str));

                if let Some(vars) = &request.body.graphql_variables {
                    let trimmed = vars.trim();
                    if !trimmed.is_empty() {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            map.insert("variables".to_string(), parsed);
                        } else {
                            map.insert("variables".to_string(), serde_json::Value::String(trimmed.to_string()));
                        }
                    }
                }

                let payload = serde_json::Value::Object(map).to_string();
                req_builder = req_builder
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(payload);
            }
        }

        // Execute request
        match req_builder.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let status_text = resp
                    .status()
                    .canonical_reason()
                    .unwrap_or("Unknown")
                    .to_string();

                let mut response_headers = Vec::new();
                for (k, v) in resp.headers() {
                    let val_str = v.to_str().unwrap_or("").to_string();
                    response_headers.push((k.to_string(), val_str));
                }

                let duration_ms = start_time.elapsed().as_millis() as u64;

                match resp.text().await {
                    Ok(body) => {
                        let size_bytes = body.len();
                        HttpResponse {
                            status,
                            status_text,
                            headers: response_headers,
                            body,
                            duration_ms,
                            size_bytes,
                            error: None,
                        }
                    }
                    Err(e) => HttpResponse {
                        status,
                        status_text,
                        headers: response_headers,
                        body: String::new(),
                        duration_ms,
                        size_bytes: 0,
                        error: Some(format!("Failed to read response body: {}", e)),
                    },
                }
            }
            Err(e) => {
                let duration_ms = start_time.elapsed().as_millis() as u64;
                let status = e.status().map(|s| s.as_u16()).unwrap_or(0);
                let status_text = if e.is_timeout() {
                    "Request Timeout".to_string()
                } else if e.is_connect() {
                    "Connection Failed".to_string()
                } else {
                    "Error".to_string()
                };

                HttpResponse {
                    status,
                    status_text,
                    headers: Vec::new(),
                    body: String::new(),
                    duration_ms,
                    size_bytes: 0,
                    error: Some(e.to_string()),
                }
            }
        }
    }
}
