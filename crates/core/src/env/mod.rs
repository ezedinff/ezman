pub mod overrides;

use std::collections::HashMap;
use regex::Regex;
use crate::model::{Collection, Environment, KeyValueItem, RequestItem, AuthConfig, RequestBodyConfig, RequestBodyType};

#[derive(Debug, Clone, Default)]
pub struct VariableResolver {
    variables: HashMap<String, String>,
}

impl VariableResolver {
    pub fn new() -> Self {
        Self {
            variables: HashMap::new(),
        }
    }

    /// Build resolver with precedence: Environment variables override Collection variables.
    pub fn from_collection_and_environment(
        collection: Option<&Collection>,
        environment: Option<&Environment>,
    ) -> Self {
        let mut map = HashMap::new();

        // 1. First add collection-level variables (lower precedence)
        if let Some(col) = collection {
            for var in &col.variables {
                if var.enabled {
                    map.insert(var.key.clone(), var.value.clone());
                }
            }
        }

        // 2. Override with environment variables (higher precedence)
        if let Some(env) = environment {
            for var in &env.variables {
                if var.enabled {
                    map.insert(var.key.clone(), var.value.clone());
                }
            }
        }

        Self { variables: map }
    }

    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.variables.insert(key.into(), value.into());
    }

    pub fn get(&self, key: &str) -> Option<&String> {
        self.variables.get(key)
    }

    /// Resolve `{{variable}}` templates in the input string.
    /// Supports up to 5 iterations for nested variables (e.g. `{{host}}` inside `{{baseUrl}}`).
    pub fn resolve_string(&self, input: &str) -> String {
        if !input.contains("{{") {
            return input.to_string();
        }

        let re = Regex::new(r"\{\{([a-zA-Z0-9_\-\.\$]+)\}\}").unwrap();
        let mut current = input.to_string();

        for _ in 0..5 {
            let mut changed = false;
            let next = re.replace_all(&current, |caps: &regex::Captures| {
                let var_name = &caps[1];
                if let Some(val) = self.variables.get(var_name) {
                    changed = true;
                    val.clone()
                } else {
                    caps[0].to_string()
                }
            }).to_string();

            current = next;
            if !changed {
                break;
            }
        }

        current
    }

    pub fn resolve_key_value_items(&self, items: &[KeyValueItem]) -> Vec<KeyValueItem> {
        items
            .iter()
            .map(|item| KeyValueItem {
                key: self.resolve_string(&item.key),
                value: self.resolve_string(&item.value),
                enabled: item.enabled,
                secret: item.secret,
                description: item.description.clone(),
            })
            .collect()
    }

    pub fn resolve_auth(&self, auth: &AuthConfig) -> AuthConfig {
        AuthConfig {
            auth_type: auth.auth_type,
            bearer_token: auth.bearer_token.as_ref().map(|s| self.resolve_string(s)),
            basic_username: auth.basic_username.as_ref().map(|s| self.resolve_string(s)),
            basic_password: auth.basic_password.as_ref().map(|s| self.resolve_string(s)),
            api_key_name: auth.api_key_name.as_ref().map(|s| self.resolve_string(s)),
            api_key_value: auth.api_key_value.as_ref().map(|s| self.resolve_string(s)),
            api_key_in: auth.api_key_in,
            custom_header_name: auth.custom_header_name.as_ref().map(|s| self.resolve_string(s)),
            custom_header_value: auth.custom_header_value.as_ref().map(|s| self.resolve_string(s)),
        }
    }

    pub fn resolve_body(&self, body: &RequestBodyConfig) -> RequestBodyConfig {
        match body.body_type {
            RequestBodyType::None => RequestBodyConfig::default(),
            RequestBodyType::Json | RequestBodyType::Text => RequestBodyConfig {
                body_type: body.body_type,
                raw: body.raw.as_ref().map(|s| self.resolve_string(s)),
                url_encoded: None,
                graphql_query: None,
                graphql_variables: None,
            },
            RequestBodyType::UrlEncoded => RequestBodyConfig {
                body_type: RequestBodyType::UrlEncoded,
                raw: None,
                url_encoded: body.url_encoded.as_ref().map(|items| self.resolve_key_value_items(items)),
                graphql_query: None,
                graphql_variables: None,
            },
            RequestBodyType::GraphQL => RequestBodyConfig {
                body_type: RequestBodyType::GraphQL,
                raw: None,
                url_encoded: None,
                graphql_query: body.graphql_query.as_ref().map(|s| self.resolve_string(s)),
                graphql_variables: body.graphql_variables.as_ref().map(|s| self.resolve_string(s)),
            },
        }
    }

    /// Resolve all fields of a RequestItem
    pub fn resolve_request(&self, request: &RequestItem) -> RequestItem {
        let mut resolved = request.clone();
        resolved.url = self.resolve_string(&request.url);
        let saved: Vec<(String, String)> = request
            .path_variables
            .iter()
            .filter(|p| p.enabled && !p.key.is_empty() && !p.value.is_empty())
            .map(|p| (p.key.clone(), self.resolve_string(&p.value)))
            .collect();
        if !saved.is_empty() {
            resolved.url = overrides::apply_path_params(&resolved.url, &saved).0;
        }
        resolved.params = self.resolve_key_value_items(&request.params);
        resolved.headers = self.resolve_key_value_items(&request.headers);
        if let Some(auth) = &request.auth {
            resolved.auth = Some(self.resolve_auth(auth));
        }
        resolved.body = self.resolve_body(&request.body);
        resolved
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EnvironmentVariable, HttpMethod};

    #[test]
    fn test_variable_resolution_precedence() {
        let mut collection = Collection::new("c1", "Test Collection");
        collection.variables.push(KeyValueItem::new("baseUrl", "http://collection.example.com"));
        collection.variables.push(KeyValueItem::new("port", "8080"));

        let mut env = Environment::new("e1", "Dev Env");
        env.variables.push(EnvironmentVariable::new("baseUrl", "http://localhost:3000", false));

        let resolver = VariableResolver::from_collection_and_environment(Some(&collection), Some(&env));

        // Environment overrides collection
        assert_eq!(resolver.resolve_string("{{baseUrl}}/api"), "http://localhost:3000/api");
        // Collection variable is retained if not in environment
        assert_eq!(resolver.resolve_string("Port is {{port}}"), "Port is 8080");
        // Unknown variable remains untouched
        assert_eq!(resolver.resolve_string("{{unknown}}"), "{{unknown}}");
    }

    #[test]
    fn test_nested_variable_resolution() {
        let mut resolver = VariableResolver::new();
        resolver.insert("host", "api.example.com");
        resolver.insert("version", "v1");
        resolver.insert("baseUrl", "https://{{host}}/{{version}}");

        let resolved = resolver.resolve_string("{{baseUrl}}/users");
        assert_eq!(resolved, "https://api.example.com/v1/users");
    }

    #[test]
    fn test_resolve_request_item() {
        let mut resolver = VariableResolver::new();
        resolver.insert("token", "secret123");
        resolver.insert("userId", "42");

        let mut req = RequestItem::new("r1", "Get User", HttpMethod::GET, "https://api.example.com/users/{{userId}}");
        req.headers.push(KeyValueItem::new("Authorization", "Bearer {{token}}"));

        let resolved = resolver.resolve_request(&req);
        assert_eq!(resolved.url, "https://api.example.com/users/42");
        assert_eq!(resolved.headers[0].value, "Bearer secret123");
    }

    #[test]
    fn test_resolve_graphql_body() {
        let mut resolver = VariableResolver::new();
        resolver.insert("targetId", "usr_99");
        resolver.insert("role", "admin");

        let mut req = RequestItem::new("r_gql", "GraphQL Query", HttpMethod::POST, "https://api.example.com/graphql");
        req.body = RequestBodyConfig {
            body_type: RequestBodyType::GraphQL,
            raw: None,
            url_encoded: None,
            graphql_query: Some("query GetUser { user(id: \"{{targetId}}\") { id name role } }".to_string()),
            graphql_variables: Some("{\"roleFilter\": \"{{role}}\"}".to_string()),
        };

        let resolved = resolver.resolve_request(&req);
        assert_eq!(resolved.body.body_type, RequestBodyType::GraphQL);
        assert_eq!(
            resolved.body.graphql_query.unwrap(),
            "query GetUser { user(id: \"usr_99\") { id name role } }"
        );
        assert_eq!(
            resolved.body.graphql_variables.unwrap(),
            "{\"roleFilter\": \"admin\"}"
        );
    }
}
