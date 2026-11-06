use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    PATCH,
    DELETE,
    HEAD,
    OPTIONS,
}

impl Default for HttpMethod {
    fn default() -> Self {
        HttpMethod::GET
    }
}

impl HttpMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            HttpMethod::GET => "GET",
            HttpMethod::POST => "POST",
            HttpMethod::PUT => "PUT",
            HttpMethod::PATCH => "PATCH",
            HttpMethod::DELETE => "DELETE",
            HttpMethod::HEAD => "HEAD",
            HttpMethod::OPTIONS => "OPTIONS",
        }
    }

    pub fn is_mutating(&self) -> bool {
        matches!(
            self,
            HttpMethod::POST | HttpMethod::PUT | HttpMethod::PATCH | HttpMethod::DELETE
        )
    }
}

impl std::fmt::Display for HttpMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyValueItem {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_true() -> bool {
    true
}

impl KeyValueItem {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            value: value.into(),
            enabled: true,
            description: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestBodyType {
    None,
    Json,
    Text,
    UrlEncoded,
    GraphQL,
}

impl Default for RequestBodyType {
    fn default() -> Self {
        RequestBodyType::None
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestBodyConfig {
    #[serde(default)]
    pub body_type: RequestBodyType,
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub url_encoded: Option<Vec<KeyValueItem>>,
    #[serde(default)]
    pub graphql_query: Option<String>,
    #[serde(default)]
    pub graphql_variables: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    None,
    Inherit,
    Bearer,
    Basic,
    ApiKey,
    Custom,
}

impl Default for AuthType {
    fn default() -> Self {
        AuthType::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiKeyLocation {
    Header,
    Query,
}

impl Default for ApiKeyLocation {
    fn default() -> Self {
        ApiKeyLocation::Header
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthConfig {
    #[serde(default)]
    pub auth_type: AuthType,
    #[serde(default)]
    pub bearer_token: Option<String>,
    #[serde(default)]
    pub basic_username: Option<String>,
    #[serde(default)]
    pub basic_password: Option<String>,
    #[serde(default)]
    pub api_key_name: Option<String>,
    #[serde(default)]
    pub api_key_value: Option<String>,
    #[serde(default)]
    pub api_key_in: Option<ApiKeyLocation>,
    #[serde(default)]
    pub custom_header_name: Option<String>,
    #[serde(default)]
    pub custom_header_value: Option<String>,
}

impl AuthConfig {
    pub fn sanitize_secrets(&self) -> Self {
        let mut sanitized = self.clone();
        if sanitized.bearer_token.is_some() {
            sanitized.bearer_token = Some("[REDACTED]".to_string());
        }
        if sanitized.basic_password.is_some() {
            sanitized.basic_password = Some("[REDACTED]".to_string());
        }
        if sanitized.api_key_value.is_some() {
            sanitized.api_key_value = Some("[REDACTED]".to_string());
        }
        if sanitized.custom_header_value.is_some() {
            sanitized.custom_header_value = Some("[REDACTED]".to_string());
        }
        sanitized
    }
}

/// JavaScript run by the client before sending and after receiving a response.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestScripts {
    #[serde(default)]
    pub pre_request: String,
    #[serde(default)]
    pub post_response: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub method: HttpMethod,
    pub url: String,
    #[serde(default)]
    pub params: Vec<KeyValueItem>,
    #[serde(default)]
    pub headers: Vec<KeyValueItem>,
    #[serde(default)]
    pub auth: Option<AuthConfig>,
    #[serde(default)]
    pub body: RequestBodyConfig,
    #[serde(default)]
    pub scripts: RequestScripts,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl RequestItem {
    pub fn new(id: impl Into<String>, name: impl Into<String>, method: HttpMethod, url: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: id.into(),
            name: name.into(),
            description: None,
            method,
            url: url.into(),
            params: Vec::new(),
            headers: Vec::new(),
            auth: None,
            body: RequestBodyConfig::default(),
            scripts: RequestScripts::default(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn sanitize_secrets(&self) -> Self {
        let mut sanitized = self.clone();
        if let Some(auth) = &sanitized.auth {
            sanitized.auth = Some(auth.sanitize_secrets());
        }
        sanitized
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub requests: Vec<RequestItem>,
    #[serde(default)]
    pub auth: Option<AuthConfig>,
}

impl Folder {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: None,
            folders: Vec::new(),
            requests: Vec::new(),
            auth: None,
        }
    }

    pub fn sanitize_secrets(&self) -> Self {
        let mut sanitized = self.clone();
        if let Some(auth) = &sanitized.auth {
            sanitized.auth = Some(auth.sanitize_secrets());
        }
        sanitized.folders = sanitized.folders.into_iter().map(|f| f.sanitize_secrets()).collect();
        sanitized.requests = sanitized.requests.into_iter().map(|r| r.sanitize_secrets()).collect();
        sanitized
    }

    pub fn find_request(&self, request_id: &str) -> Option<&RequestItem> {
        if let Some(req) = self.requests.iter().find(|r| r.id == request_id) {
            return Some(req);
        }
        for sub in &self.folders {
            if let Some(req) = sub.find_request(request_id) {
                return Some(req);
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub variables: Vec<KeyValueItem>,
    #[serde(default)]
    pub auth: Option<AuthConfig>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub requests: Vec<RequestItem>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Collection {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: id.into(),
            name: name.into(),
            description: None,
            variables: Vec::new(),
            auth: None,
            folders: Vec::new(),
            requests: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn sanitize_secrets(&self) -> Self {
        let mut sanitized = self.clone();
        if let Some(auth) = &sanitized.auth {
            sanitized.auth = Some(auth.sanitize_secrets());
        }
        sanitized.folders = sanitized.folders.into_iter().map(|f| f.sanitize_secrets()).collect();
        sanitized.requests = sanitized.requests.into_iter().map(|r| r.sanitize_secrets()).collect();
        sanitized
    }

    pub fn find_request(&self, request_id: &str) -> Option<&RequestItem> {
        if let Some(req) = self.requests.iter().find(|r| r.id == request_id) {
            return Some(req);
        }
        for folder in &self.folders {
            if let Some(req) = folder.find_request(request_id) {
                return Some(req);
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvironmentVariable {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub secret: bool,
}

impl EnvironmentVariable {
    pub fn new(key: impl Into<String>, value: impl Into<String>, secret: bool) -> Self {
        Self {
            key: key.into(),
            value: value.into(),
            enabled: true,
            secret,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub variables: Vec<EnvironmentVariable>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Environment {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: id.into(),
            name: name.into(),
            variables: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn sanitize_secrets(&self) -> Self {
        let mut sanitized = self.clone();
        for var in &mut sanitized.variables {
            if var.secret {
                var.value = "[REDACTED]".to_string();
            }
        }
        sanitized
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportWarning {
    pub item_name: String,
    pub warning_type: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportResult {
    pub collection: Collection,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppPreferences {
    #[serde(default)]
    pub active_environment_id: Option<String>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub open_tabs: Vec<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    "dark".to_string()
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            active_environment_id: None,
            active_tab_id: None,
            open_tabs: Vec::new(),
            theme: default_theme(),
        }
    }
}
