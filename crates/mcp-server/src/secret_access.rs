use base64::Engine;
use std::collections::BTreeMap;

use ezman_core::{
    ApiKeyLocation, AuthConfig, Collection, CoreError, Environment, Folder, KeyValueItem,
    RequestItem,
};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Default, PartialEq)]
struct ProtectedFields(BTreeMap<String, Value>);

fn sensitive_header(header: &KeyValueItem, auth: Option<&AuthConfig>) -> bool {
    let name = header.key.to_ascii_lowercase();
    header.secret
        || matches!(
            name.as_str(),
            "authorization" | "proxy-authorization" | "cookie" | "x-api-key" | "api-key"
        )
        || auth.is_some_and(|auth| {
            auth.custom_header_name
                .as_ref()
                .is_some_and(|key| key.eq_ignore_ascii_case(&name))
                || (auth.api_key_in.unwrap_or_default() == ApiKeyLocation::Header
                    && auth
                        .api_key_name
                        .as_ref()
                        .is_some_and(|key| key.eq_ignore_ascii_case(&name)))
        })
}

fn auth_values(auth: Option<&AuthConfig>) -> Vec<String> {
    let mut values: Vec<String> = auth
        .into_iter()
        .flat_map(|auth| {
            [
                &auth.bearer_token,
                &auth.basic_username,
                &auth.basic_password,
                &auth.api_key_value,
                &auth.custom_header_value,
            ]
        })
        .filter_map(|value| value.clone())
        .collect();
    if let Some(auth) = auth {
        if let Some(username) = &auth.basic_username {
            values.push(base64::engine::general_purpose::STANDARD.encode(format!(
                "{}:{}",
                username,
                auth.basic_password.as_deref().unwrap_or_default()
            )));
        }
    }
    values
}

impl ProtectedFields {
    fn auth(&mut self, id: &str, auth: Option<&AuthConfig>) {
        if !auth_values(auth).is_empty() {
            self.0.insert(format!("auth:{id}"), json!(auth));
        }
    }

    fn pairs(
        &mut self,
        id: &str,
        pairs: &[KeyValueItem],
        auth: Option<&AuthConfig>,
        headers: bool,
    ) {
        let protected: Vec<_> = pairs
            .iter()
            .filter(|item| item.secret || (headers && sensitive_header(item, auth)))
            .collect();
        if !protected.is_empty() {
            self.0.insert(id.to_string(), json!(protected));
        }
    }

    fn request(&mut self, request: &RequestItem, inherited_auth: Option<&AuthConfig>) {
        self.auth(&request.id, request.auth.as_ref());
        let auth = request
            .auth
            .as_ref()
            .filter(|auth| !matches!(auth.auth_type, ezman_core::AuthType::Inherit))
            .or(inherited_auth);
        self.pairs(
            &format!("headers:{}", request.id),
            &request.headers,
            auth,
            true,
        );
        self.pairs(
            &format!("params:{}", request.id),
            &request.params,
            None,
            false,
        );
        self.pairs(
            &format!("path:{}", request.id),
            &request.path_variables,
            None,
            false,
        );
        self.pairs(
            &format!("form:{}", request.id),
            request.body.url_encoded.as_deref().unwrap_or_default(),
            None,
            false,
        );
    }

    fn folder(&mut self, folder: &Folder, inherited_auth: Option<&AuthConfig>) {
        self.auth(&folder.id, folder.auth.as_ref());
        let auth = folder.auth.as_ref().or(inherited_auth);
        for request in &folder.requests {
            self.request(request, auth);
        }
        for folder in &folder.folders {
            self.folder(folder, auth);
        }
    }

    fn collection(collection: &Collection) -> Self {
        let mut fields = Self::default();
        fields.auth(&collection.id, collection.auth.as_ref());
        fields.pairs("variables", &collection.variables, None, false);
        for request in &collection.requests {
            fields.request(request, collection.auth.as_ref());
        }
        for folder in &collection.folders {
            fields.folder(folder, collection.auth.as_ref());
        }
        fields
    }

    fn environment(environment: &Environment) -> Self {
        let variables: Vec<_> = environment.variables.iter().filter(|v| v.secret).collect();
        let mut fields = Self::default();
        if !variables.is_empty() {
            fields.0.insert("variables".into(), json!(variables));
        }
        fields
    }
}

fn denied() -> CoreError {
    CoreError::ValidationError(
        "MCP secret access is disabled. Enable 'Allow MCP secret access' for this collection or environment in the desktop app to change secrets. Non-secret edits are still allowed.".into(),
    )
}

pub fn guard_collection(before: &Collection, after: Option<&Collection>) -> ezman_core::Result<()> {
    if !before.mcp_allow_secrets
        && ProtectedFields::collection(before)
            != after.map(ProtectedFields::collection).unwrap_or_default()
    {
        return Err(denied());
    }
    Ok(())
}

pub fn guard_environment(
    before: &Environment,
    after: Option<&Environment>,
) -> ezman_core::Result<()> {
    if !before.mcp_allow_secrets
        && ProtectedFields::environment(before)
            != after.map(ProtectedFields::environment).unwrap_or_default()
    {
        return Err(denied());
    }
    Ok(())
}

pub fn request_secrets(request: &RequestItem, inherited_auth: Option<&AuthConfig>) -> Vec<String> {
    let mut secrets = auth_values(request.auth.as_ref());
    let auth = request
        .auth
        .as_ref()
        .filter(|auth| !matches!(auth.auth_type, ezman_core::AuthType::Inherit))
        .or(inherited_auth);
    secrets.extend(
        request
            .headers
            .iter()
            .filter(|header| sensitive_header(header, auth))
            .map(|header| header.value.clone()),
    );
    secrets.extend(
        request
            .params
            .iter()
            .chain(&request.path_variables)
            .chain(request.body.url_encoded.iter().flatten())
            .filter(|item| item.secret)
            .map(|item| item.value.clone()),
    );
    secrets
}

pub fn collection_secrets(collection: &Collection) -> Vec<String> {
    fn folder_secrets(
        folder: &Folder,
        inherited_auth: Option<&AuthConfig>,
        secrets: &mut Vec<String>,
    ) {
        secrets.extend(auth_values(folder.auth.as_ref()));
        let auth = folder.auth.as_ref().or(inherited_auth);
        for request in &folder.requests {
            secrets.extend(request_secrets(request, auth));
        }
        for folder in &folder.folders {
            folder_secrets(folder, auth, secrets);
        }
    }
    let mut secrets = auth_values(collection.auth.as_ref());
    secrets.extend(
        collection
            .variables
            .iter()
            .filter(|v| v.secret)
            .map(|v| v.value.clone()),
    );
    for request in &collection.requests {
        secrets.extend(request_secrets(request, collection.auth.as_ref()));
    }
    for folder in &collection.folders {
        folder_secrets(folder, collection.auth.as_ref(), &mut secrets);
    }
    secrets
}

pub fn environment_secrets(environment: &Environment) -> Vec<String> {
    environment
        .variables
        .iter()
        .filter(|v| v.secret)
        .map(|v| v.value.clone())
        .collect()
}

pub fn redact_text(text: &str, secrets: &[String]) -> String {
    let mut text = text.to_string();
    // Replace longer values first so overlapping secrets cannot leave a suffix exposed.
    let mut secrets: Vec<String> = secrets
        .iter()
        .filter(|s| !s.is_empty())
        .flat_map(|secret| {
            let encoded = ezman_core::env::overrides::percent_encode(secret);
            [secret.clone(), encoded.replace("%20", "+"), encoded]
        })
        .collect();
    secrets.sort();
    secrets.dedup();
    secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
    for secret in secrets {
        text = text.replace(&secret, "[REDACTED]");
    }
    text
}

pub fn redact(value: &mut Value, secrets: &[String]) {
    match value {
        Value::String(text) => {
            *text = redact_text(text, secrets);
        }
        Value::Array(values) => values.iter_mut().for_each(|v| redact(v, secrets)),
        Value::Object(values) => {
            for (key, value) in values {
                // Keep resource identifiers and schema enums usable for follow-up calls.
                if key != "id"
                    && !key.ends_with("_id")
                    && !matches!(
                        key.as_str(),
                        "method" | "auth_type" | "body_type" | "api_key_in" | "key"
                    )
                {
                    redact(value, secrets);
                }
            }
        }
        _ => {}
    }
}

pub fn collection_view(collection: &Collection, data: impl Serialize) -> Result<Value, String> {
    let mut value = serde_json::to_value(data).map_err(|e| e.to_string())?;
    if !collection.mcp_allow_secrets {
        redact(&mut value, &collection_secrets(collection));
    }
    Ok(value)
}

pub fn environment_view(environment: &Environment) -> Result<Value, String> {
    let mut value = serde_json::to_value(environment).map_err(|e| e.to_string())?;
    if !environment.mcp_allow_secrets {
        redact(&mut value, &environment_secrets(environment));
    }
    Ok(value)
}
