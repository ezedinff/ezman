//! Ephemeral per-call overrides for a saved request (variables, path params,
//! query, headers, body). Nothing here touches storage.

use std::collections::BTreeSet;

use regex::Regex;
use serde_json::{Map, Value};

use crate::env::VariableResolver;
use crate::error::{CoreError, Result};
use crate::model::{Collection, Environment, KeyValueItem, RequestBodyType, RequestItem};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BodyMode {
    #[default]
    Replace,
    MergeJson,
}

#[derive(Debug, Clone, Default)]
pub struct RequestOverrides {
    pub variables: Vec<(String, String)>,
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub path_params: Vec<(String, String)>,
    pub body: Option<Value>,
    pub body_mode: BodyMode,
}

#[derive(Debug, Clone)]
pub struct OverriddenRequest {
    pub request: RequestItem,
    /// Override keys that were supplied and used.
    pub applied: Vec<&'static str>,
    pub warnings: Vec<String>,
}

fn string_map(args: &Map<String, Value>, key: &str) -> Result<Vec<(String, String)>> {
    let Some(value) = args.get(key) else { return Ok(vec![]) };
    match value {
        Value::Null => Ok(vec![]),
        Value::Object(map) => map
            .iter()
            .map(|(k, v)| match v {
                Value::String(s) => Ok((k.clone(), s.clone())),
                Value::Number(n) => Ok((k.clone(), n.to_string())),
                Value::Bool(b) => Ok((k.clone(), b.to_string())),
                // A null/object/array value is ambiguous, so it is rejected rather than guessed.
                _ => Err(CoreError::ValidationError(format!(
                    "'{}.{}' must be a string (null, objects and arrays are not allowed; use \"\" for an empty value)",
                    key, k
                ))),
            })
            .collect(),
        _ => Err(CoreError::ValidationError(format!("'{}' must be an object of string values", key))),
    }
}

impl RequestOverrides {
    /// Parse MCP-style arguments. Unrelated keys are ignored.
    pub fn from_args(args: &Map<String, Value>) -> Result<Self> {
        let body_mode = match args.get("body_mode") {
            None | Some(Value::Null) => BodyMode::Replace,
            Some(Value::String(s)) if s == "replace" => BodyMode::Replace,
            Some(Value::String(s)) if s == "merge_json" => BodyMode::MergeJson,
            Some(_) => {
                return Err(CoreError::ValidationError(
                    "'body_mode' must be \"replace\" or \"merge_json\"".into(),
                ))
            }
        };
        let body = match args.get("body") {
            None | Some(Value::Null) => None,
            Some(v @ (Value::String(_) | Value::Object(_))) => Some(v.clone()),
            Some(_) => {
                return Err(CoreError::ValidationError("'body' must be a string or a JSON object".into()))
            }
        };
        Ok(Self {
            variables: string_map(args, "variables")?,
            query: string_map(args, "query")?,
            headers: string_map(args, "headers")?,
            path_params: string_map(args, "path_params")?,
            body,
            body_mode,
        })
    }

    pub fn is_empty(&self) -> bool {
        self.variables.is_empty()
            && self.query.is_empty()
            && self.headers.is_empty()
            && self.path_params.is_empty()
            && self.body.is_none()
    }
}

/// Resolve a saved request with overrides.
///
/// Precedence for `{{var}}`: collection < environment < per-call `variables`.
/// Order: variables → resolve request → path params (on the resolved URL path)
/// → query/headers merge → body override. Override values may use `{{var}}`.
pub fn resolve_with_overrides(
    collection: Option<&Collection>,
    environment: Option<&Environment>,
    request: &RequestItem,
    overrides: &RequestOverrides,
) -> Result<OverriddenRequest> {
    let mut resolver = VariableResolver::from_collection_and_environment(collection, environment);
    for (k, v) in &overrides.variables {
        resolver.insert(k.clone(), v.clone());
    }

    // Per-call path_params win over path variables saved on the request.
    let mut base = request.clone();
    base.path_variables.retain(|p| !overrides.path_params.iter().any(|(k, _)| k == &p.key));
    let mut resolved = resolver.resolve_request(&base);
    let mut applied = Vec::new();
    let mut warnings = Vec::new();

    if !overrides.variables.is_empty() {
        applied.push("variables");
    }

    if !overrides.path_params.is_empty() {
        let params: Vec<(String, String)> = overrides
            .path_params
            .iter()
            .map(|(k, v)| (k.clone(), resolver.resolve_string(v)))
            .collect();
        let (url, unused) = apply_path_params(&resolved.url, &params);
        resolved.url = url;
        for key in unused {
            warnings.push(format!("path_params '{}' did not match any ':{}' or '{{{}}}' placeholder in the URL path", key, key, key));
        }
        applied.push("path_params");
    }

    if !overrides.query.is_empty() {
        let pairs: Vec<(String, String)> = overrides
            .query
            .iter()
            .map(|(k, v)| (k.clone(), resolver.resolve_string(v)))
            .collect();
        apply_query(&mut resolved, &pairs);
        applied.push("query");
    }

    if !overrides.headers.is_empty() {
        for (key, value) in &overrides.headers {
            let value = resolver.resolve_string(value);
            match resolved.headers.iter_mut().find(|h| h.enabled && h.key.eq_ignore_ascii_case(key)) {
                Some(existing) => {
                    existing.key = key.clone();
                    existing.value = value;
                }
                None => resolved.headers.push(KeyValueItem::new(key.clone(), value)),
            }
        }
        applied.push("headers");
    }

    if let Some(body) = &overrides.body {
        apply_body(&mut resolved, &resolver, body, overrides.body_mode)?;
        applied.push("body");
    }

    Ok(OverriddenRequest { request: resolved, applied, warnings })
}

fn is_unreserved(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
}

pub fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        if is_unreserved(b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// Byte range of the path inside a URL (after `scheme://host`, before `?`/`#`).
fn path_range(url: &str) -> (usize, usize) {
    let start = match url.find("://") {
        Some(i) => url[i + 3..].find('/').map(|p| i + 3 + p).unwrap_or(url.len()),
        None => 0,
    };
    let end = url[start..].find(['?', '#']).map(|p| start + p).unwrap_or(url.len());
    (start, end)
}

/// Replace whole `:key` segments and `{key}` placeholders (not `{{key}}`) in the URL path.
/// Returns the new URL and the keys that matched nothing.
pub fn apply_path_params(url: &str, params: &[(String, String)]) -> (String, Vec<String>) {
    let (start, end) = path_range(url);
    let mut used = vec![false; params.len()];
    let segments: Vec<String> = url[start..end]
        .split('/')
        .map(|segment| {
            if let Some(name) = segment.strip_prefix(':') {
                if let Some(i) = params.iter().position(|(k, _)| k == name) {
                    used[i] = true;
                    return percent_encode(&params[i].1);
                }
                return segment.to_string();
            }
            let mut seg = segment.to_string();
            for (i, (k, v)) in params.iter().enumerate() {
                let token = format!("{{{}}}", k);
                let mut search_from = 0;
                while let Some(pos) = seg[search_from..].find(&token).map(|p| p + search_from) {
                    let before_brace = seg[..pos].ends_with('{');
                    let after_brace = seg[pos + token.len()..].starts_with('}');
                    if before_brace || after_brace {
                        search_from = pos + token.len();
                        continue;
                    }
                    let encoded = percent_encode(v);
                    seg.replace_range(pos..pos + token.len(), &encoded);
                    search_from = pos + encoded.len();
                    used[i] = true;
                }
            }
            seg
        })
        .collect();
    let new_url = format!("{}{}{}", &url[..start], segments.join("/"), &url[end..]);
    let unused = params
        .iter()
        .zip(used)
        .filter(|(_, u)| !u)
        .map(|((k, _), _)| k.clone())
        .collect();
    (new_url, unused)
}

/// Query keys are case-sensitive. Keys already in the URL query string are
/// replaced there; otherwise the enabled params list is updated or appended to.
fn apply_query(request: &mut RequestItem, pairs: &[(String, String)]) {
    for (key, value) in pairs {
        if let Some(url) = replace_in_url_query(&request.url, key, value) {
            request.url = url;
            continue;
        }
        match request.params.iter_mut().find(|p| p.enabled && &p.key == key) {
            Some(existing) => existing.value = value.clone(),
            None => request.params.push(KeyValueItem::new(key.clone(), value.clone())),
        }
    }
}

fn replace_in_url_query(url: &str, key: &str, value: &str) -> Option<String> {
    let q = url.find('?')?;
    let (base, rest) = url.split_at(q + 1);
    let (query, fragment) = match rest.find('#') {
        Some(h) => rest.split_at(h),
        None => (rest, ""),
    };
    let mut found = false;
    let parts: Vec<String> = query
        .split('&')
        .map(|part| {
            let name = part.split('=').next().unwrap_or("");
            if name == key {
                found = true;
                format!("{}={}", name, percent_encode(value))
            } else {
                part.to_string()
            }
        })
        .collect();
    found.then(|| format!("{}{}{}", base, parts.join("&"), fragment))
}

fn resolve_json_strings(resolver: &VariableResolver, value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(resolver.resolve_string(s)),
        Value::Array(a) => Value::Array(a.iter().map(|v| resolve_json_strings(resolver, v)).collect()),
        Value::Object(o) => Value::Object(
            o.iter().map(|(k, v)| (k.clone(), resolve_json_strings(resolver, v))).collect(),
        ),
        other => other.clone(),
    }
}

/// Objects merge recursively; every other value (including arrays) is replaced.
pub fn deep_merge(base: &mut Value, over: &Value) {
    match (base, over) {
        (Value::Object(b), Value::Object(o)) => {
            for (k, v) in o {
                match b.get_mut(k) {
                    Some(existing) => deep_merge(existing, v),
                    None => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (b, o) => *b = o.clone(),
    }
}

fn apply_body(
    request: &mut RequestItem,
    resolver: &VariableResolver,
    body: &Value,
    mode: BodyMode,
) -> Result<()> {
    let invalid = |msg: &str| Err(CoreError::ValidationError(msg.to_string()));

    if request.body.body_type == RequestBodyType::GraphQL {
        return apply_graphql_body(request, resolver, body, mode);
    }

    match body {
        Value::String(s) => {
            if mode == BodyMode::MergeJson {
                return invalid("body_mode 'merge_json' requires 'body' to be a JSON object, not a string");
            }
            let raw = resolver.resolve_string(s);
            let keeps_type = matches!(request.body.body_type, RequestBodyType::Json | RequestBodyType::Text);
            if !keeps_type {
                request.body.body_type = if serde_json::from_str::<Value>(&raw).is_ok() {
                    RequestBodyType::Json
                } else {
                    RequestBodyType::Text
                };
            }
            request.body.raw = Some(raw);
            request.body.url_encoded = None;
        }
        Value::Object(_) => {
            let over = resolve_json_strings(resolver, body);
            let result = match mode {
                BodyMode::Replace => over,
                BodyMode::MergeJson => {
                    if request.body.body_type != RequestBodyType::Json {
                        return invalid("body_mode 'merge_json' requires the saved request to have a JSON body");
                    }
                    let mut saved: Value = match request
                        .body
                        .raw
                        .as_deref()
                        .map(|r| serde_json::from_str::<Value>(r))
                    {
                        Some(Ok(v @ Value::Object(_))) => v,
                        _ => return invalid("body_mode 'merge_json' requires the saved JSON body to be a JSON object"),
                    };
                    deep_merge(&mut saved, &over);
                    saved
                }
            };
            request.body.body_type = RequestBodyType::Json;
            request.body.raw = Some(serde_json::to_string(&result).unwrap_or_default());
            request.body.url_encoded = None;
        }
        _ => return invalid("'body' must be a string or a JSON object"),
    }
    Ok(())
}

fn apply_graphql_body(
    request: &mut RequestItem,
    resolver: &VariableResolver,
    body: &Value,
    mode: BodyMode,
) -> Result<()> {
    match body {
        Value::String(s) => {
            request.body.graphql_query = Some(resolver.resolve_string(s));
        }
        Value::Object(map) => {
            if !map.contains_key("query") && !map.contains_key("variables") {
                return Err(CoreError::ValidationError(
                    "GraphQL 'body' object must contain 'query' and/or 'variables'".into(),
                ));
            }
            if let Some(q) = map.get("query") {
                let q = q.as_str().ok_or_else(|| {
                    CoreError::ValidationError("GraphQL 'body.query' must be a string".into())
                })?;
                request.body.graphql_query = Some(resolver.resolve_string(q));
            }
            if let Some(vars) = map.get("variables") {
                let over = resolve_json_strings(resolver, vars);
                let merged = if mode == BodyMode::MergeJson {
                    let mut saved = request
                        .body
                        .graphql_variables
                        .as_deref()
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        .filter(|v| v.is_object())
                        .unwrap_or_else(|| Value::Object(Map::new()));
                    deep_merge(&mut saved, &over);
                    saved
                } else {
                    over
                };
                request.body.graphql_variables = Some(serde_json::to_string(&merged).unwrap_or_default());
            }
        }
        _ => {
            return Err(CoreError::ValidationError("'body' must be a string or a JSON object".into()));
        }
    }
    Ok(())
}

/// Names used as `{{name}}` in the URL, params, headers and body of a saved request.
pub fn detected_variables(request: &RequestItem) -> Vec<String> {
    let re = Regex::new(r"\{\{([a-zA-Z0-9_\-\.\$]+)\}\}").unwrap();
    let mut texts: Vec<&str> = vec![&request.url];
    for kv in request.params.iter().chain(request.headers.iter()) {
        texts.push(&kv.key);
        texts.push(&kv.value);
    }
    if let Some(raw) = &request.body.raw {
        texts.push(raw);
    }
    if let Some(items) = &request.body.url_encoded {
        for kv in items {
            texts.push(&kv.key);
            texts.push(&kv.value);
        }
    }
    for s in [&request.body.graphql_query, &request.body.graphql_variables].into_iter().flatten() {
        texts.push(s);
    }
    let names: BTreeSet<String> = texts
        .into_iter()
        .flat_map(|t| re.captures_iter(t).map(|c| c[1].to_string()).collect::<Vec<_>>())
        .collect();
    names.into_iter().collect()
}

/// Path placeholders (`:id`, `{id}`) in a URL template, excluding `{{vars}}`.
pub fn path_placeholders(url: &str) -> Vec<String> {
    let (start, end) = path_range(url);
    let re = Regex::new(r"(?:^|[^{])\{([a-zA-Z0-9_\-\.]+)\}(?:[^}]|$)").unwrap();
    let mut out = Vec::new();
    for segment in url[start..end].split('/') {
        if let Some(name) = segment.strip_prefix(':') {
            if !name.is_empty() {
                out.push(name.to_string());
            }
        } else {
            for c in re.captures_iter(segment) {
                out.push(c[1].to_string());
            }
        }
    }
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{HttpMethod, EnvironmentVariable};
    use serde_json::json;

    fn req(url: &str) -> RequestItem {
        RequestItem::new("r", "r", HttpMethod::GET, url)
    }

    fn ov(v: Value) -> RequestOverrides {
        RequestOverrides::from_args(v.as_object().unwrap()).unwrap()
    }

    #[test]
    fn variables_have_highest_precedence() {
        let mut env = Environment::new("e", "Dev");
        env.variables.push(EnvironmentVariable::new("id", "env", false));
        let r = req("http://h/u/{{id}}");
        let out = resolve_with_overrides(None, Some(&env), &r, &ov(json!({"variables": {"id": "call"}}))).unwrap();
        assert_eq!(out.request.url, "http://h/u/call");
        assert_eq!(out.applied, vec!["variables"]);
        let out = resolve_with_overrides(None, Some(&env), &r, &ov(json!({}))).unwrap();
        assert_eq!(out.request.url, "http://h/u/env");
    }

    #[test]
    fn variable_value_rules() {
        let err = RequestOverrides::from_args(json!({"variables": {"a": null}}).as_object().unwrap());
        assert!(err.is_err());
        let o = ov(json!({"variables": {"a": "", "n": 5}}));
        let out = resolve_with_overrides(None, None, &req("http://h/{{a}}x/{{n}}"), &o).unwrap();
        assert_eq!(out.request.url, "http://h/x/5");
    }

    #[test]
    fn path_params_only_touch_path_segments() {
        let (u, unused) = apply_path_params(
            "http://localhost:3000/users/:id/posts/{pid}?id=:id",
            &[("id".into(), "1 2".into()), ("pid".into(), "9".into()), ("zzz".into(), "x".into())],
        );
        assert_eq!(u, "http://localhost:3000/users/1%202/posts/9?id=:id");
        assert_eq!(unused, vec!["zzz"]);
        let (u, _) = apply_path_params("{{baseUrl}}/a/:id", &[("baseUrl".into(), "x".into()), ("id".into(), "7".into())]);
        assert_eq!(u, "{{baseUrl}}/a/7");
    }

    #[test]
    fn query_and_headers_merge() {
        let mut r = req("http://h/p?a=1");
        r.params.push(KeyValueItem::new("b", "2"));
        r.headers.push(KeyValueItem::new("X-Test", "old"));
        let o = ov(json!({"query": {"a": "9", "b": "8", "c": "7"}, "headers": {"x-test": "new", "X-New": "1"}}));
        let out = resolve_with_overrides(None, None, &r, &o).unwrap().request;
        assert_eq!(out.url, "http://h/p?a=9");
        assert_eq!(out.params.iter().map(|p| (p.key.as_str(), p.value.as_str())).collect::<Vec<_>>(), vec![("b", "8"), ("c", "7")]);
        assert_eq!(out.headers.len(), 2);
        assert_eq!(out.headers[0].value, "new");
        // the saved request is untouched
        assert_eq!(r.headers[0].value, "old");
    }

    #[test]
    fn body_replace_and_merge() {
        let mut r = req("http://h");
        r.body.body_type = RequestBodyType::Json;
        r.body.raw = Some(r#"{"a":{"x":1,"y":2},"l":[1]}"#.into());
        let out = resolve_with_overrides(None, None, &r, &ov(json!({"body": {"a": {"x": 9}}}))).unwrap().request;
        assert_eq!(out.body.raw.unwrap(), r#"{"a":{"x":9}}"#);
        let out = resolve_with_overrides(None, None, &r, &ov(json!({"body": {"a": {"x": 9}, "l": [2]}, "body_mode": "merge_json"}))).unwrap().request;
        let v: Value = serde_json::from_str(&out.body.raw.unwrap()).unwrap();
        assert_eq!(v, json!({"a": {"x": 9, "y": 2}, "l": [2]}));
        let out = resolve_with_overrides(None, None, &r, &ov(json!({"body": "plain"}))).unwrap().request;
        assert_eq!(out.body.raw.unwrap(), "plain");
        assert!(resolve_with_overrides(None, None, &req("http://h"), &ov(json!({"body": {"a": 1}, "body_mode": "merge_json"}))).is_err());
    }

    #[test]
    fn graphql_body_override() {
        let mut r = req("http://h");
        r.body.body_type = RequestBodyType::GraphQL;
        r.body.graphql_query = Some("{ a }".into());
        r.body.graphql_variables = Some(r#"{"x":1,"y":2}"#.into());
        let o = ov(json!({"body": {"variables": {"x": 5}}, "body_mode": "merge_json"}));
        let out = resolve_with_overrides(None, None, &r, &o).unwrap().request;
        assert_eq!(out.body.graphql_query.unwrap(), "{ a }");
        let v: Value = serde_json::from_str(&out.body.graphql_variables.unwrap()).unwrap();
        assert_eq!(v, json!({"x": 5, "y": 2}));
    }

    #[test]
    fn saved_path_variables_apply_and_overrides_win() {
        let mut r = req("http://h/u/:id/p/:pid");
        r.path_variables.push(KeyValueItem::new("id", "saved"));
        r.path_variables.push(KeyValueItem::new("pid", "{{p}}"));
        let o = ov(json!({"variables": {"p": "5"}}));
        assert_eq!(resolve_with_overrides(None, None, &r, &o).unwrap().request.url, "http://h/u/saved/p/5");
        let o = ov(json!({"path_params": {"id": "call"}, "variables": {"p": "6"}}));
        let out = resolve_with_overrides(None, None, &r, &o).unwrap();
        assert_eq!(out.request.url, "http://h/u/call/p/6");
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn discovery_helpers() {
        let mut r = req("{{baseUrl}}/users/:id/p/{pid}");
        r.headers.push(KeyValueItem::new("A", "{{token}}"));
        assert_eq!(detected_variables(&r), vec!["baseUrl", "token"]);
        assert_eq!(path_placeholders(&r.url), vec!["id", "pid"]);
    }
}
