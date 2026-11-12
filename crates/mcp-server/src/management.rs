use std::sync::Arc;

use crate::secret_access;
use ezman_core::{
    Collection, CoreError, Environment, EnvironmentVariable, Folder, HttpMethod, KeyValueItem,
    RequestItem, StorageManager,
};
use rmcp::model::{CallToolResult, ContentBlock, Tool, ToolAnnotations};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

type Arguments = Map<String, Value>;

fn object(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object", "properties": properties,
        "required": required, "additionalProperties": false
    })
}

fn fields(resource: &str) -> Value {
    let text = json!({"type": "string"});
    let nullable_text = json!({"type": ["string", "null"]});
    let name = json!({"type": "string", "minLength": 1});
    let key_value = object(
        json!({
            "key": text, "value": text, "enabled": {"type": "boolean"}, "secret": {"type": "boolean"},
            "description": nullable_text
        }),
        &["key", "value"],
    );
    let pairs = json!({"type": "array", "items": key_value});
    let mut auth = object(
        json!({
            "auth_type": {"type": "string", "enum": ["none", "inherit", "bearer", "basic", "apikey", "custom"]},
            "bearer_token": nullable_text, "basic_username": nullable_text,
            "basic_password": nullable_text, "api_key_name": nullable_text,
            "api_key_value": nullable_text,
            "api_key_in": {"type": ["string", "null"], "enum": ["header", "query", null]},
            "custom_header_name": nullable_text, "custom_header_value": nullable_text
        }),
        &[],
    );
    auth["type"] = json!(["object", "null"]);
    match resource {
        "collection" => json!({
            "name": name, "description": nullable_text, "variables": pairs, "auth": auth
        }),
        "folder" => json!({
            "name": name, "description": nullable_text, "auth": auth,
            "parent_folder_id": nullable_text
        }),
        "request" => json!({
            "name": name, "description": nullable_text,
            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]},
            "url": {"type": "string", "minLength": 1},
            "params": pairs, "path_variables": pairs, "headers": pairs, "auth": auth,
            "folder_id": nullable_text,
            "body": object(json!({
                "body_type": {"type": "string", "enum": ["none", "json", "text", "urlencoded", "graphql"]},
                "raw": nullable_text,
                "url_encoded": {"type": ["array", "null"], "items": key_value},
                "graphql_query": nullable_text, "graphql_variables": nullable_text
            }), &[]),
            "scripts": object(json!({"pre_request": text, "post_response": text}), &[])
        }),
        "environment" => json!({
            "name": name,
            "variables": {"type": "array", "items": object(json!({
                "key": text, "value": text, "enabled": {"type": "boolean"}, "secret": {"type": "boolean"}
            }), &["key", "value"])}
        }),
        _ => unreachable!(),
    }
}

pub fn tools() -> Vec<Tool> {
    let mut tools = Vec::new();
    for resource in ["collection", "folder", "request", "environment"] {
        for action in ["get", "create", "update", "delete"] {
            if action == "get" && matches!(resource, "folder" | "request") {
                continue;
            }
            let id_key = format!("{resource}_id");
            let mut properties = Map::new();
            let mut required = Vec::new();
            if matches!(resource, "folder" | "request") {
                properties.insert(
                    "collection_id".into(),
                    json!({"type": "string", "minLength": 1}),
                );
                required.push("collection_id");
            }
            if action != "create" {
                properties.insert(id_key.clone(), json!({"type": "string", "minLength": 1}));
                required.push(id_key.as_str());
            }
            let description = match action {
                "create" => {
                    properties.extend(fields(resource).as_object().unwrap().clone());
                    required.push("name");
                    if resource == "request" {
                        required.push("url");
                    }
                    format!("Create a local {resource} with a generated ID. For folders/requests, omit the parent/folder ID to place at collection root. Secret writes require the user to enable MCP secret access for the containing resource in the desktop app; new collections/environments default to denied. Does not execute HTTP requests.")
                }
                "update" => {
                    properties.insert("changes".into(), object(fields(resource), &[]));
                    required.push("changes");
                    format!("Update a local {resource}. Only supplied fields change; nested auth/body/scripts fields merge, arrays replace in full. Secret changes require user-enabled MCP secret access in the desktop app. Omit credentials to preserve them; never send [REDACTED] back. Null clears nullable fields; null parent_folder_id/folder_id moves to collection root. Does not execute HTTP requests.")
                }
                "delete" => format!("Permanently delete a local {resource}. Deleting a collection or folder recursively deletes its contents. Deletion is blocked if it removes secrets without user-enabled MCP secret access. Does not affect remote APIs."),
                _ => format!("Read a local {resource}, including nested contents and editable fields. Secrets are hidden unless the user enabled MCP secret access for this resource in the desktop app. Agents cannot change that permission."),
            };
            let schema = object(Value::Object(properties), &required);
            tools.push(
                Tool::new(
                    format!("{action}_{resource}"),
                    description,
                    Arc::new(schema.as_object().unwrap().clone()),
                )
                .with_annotations(
                    ToolAnnotations::new()
                        .read_only(action == "get")
                        .destructive(matches!(action, "update" | "delete")),
                ),
            );
        }
    }
    for action in ["set", "delete"] {
        let mut properties = json!({
            "resource": {"type": "string", "enum": ["collection", "environment"]},
            "resource_id": {"type": "string", "minLength": 1},
            "key": {"type": "string", "minLength": 1}
        });
        if action == "set" {
            properties.as_object_mut().unwrap().extend(json!({
                "value": {"type": "string"},
                "enabled": {"type": "boolean"},
                "secret": {"type": "boolean", "description": "Mark a variable as secret. Changing secrets requires user-enabled MCP secret access."},
                "description": {"type": ["string", "null"], "description": "Collection variables only."}
            }).as_object().unwrap().clone());
        }
        let schema = object(properties, &["resource", "resource_id", "key"]);
        tools.push(Tool::new(
            format!("{action}_variable"),
            if action == "set" {
                "Create or partially update one collection/environment variable by key without replacing other variables or secrets. Value is required for a new key; omitted fields on an existing key are preserved."
            } else {
                "Permanently remove one collection/environment variable by key, preserving all other variables."
            },
            Arc::new(schema.as_object().unwrap().clone()),
        ).with_annotations(ToolAnnotations::new().read_only(false).destructive(true)));
    }
    tools
}

// Keep direct calls subject to the same contract as MCP clients using tools/list.
fn validate(value: &Value, schema: &Value, path: &str) -> Result<(), String> {
    let kind = match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    };
    let types = &schema["type"];
    if types != kind
        && !types
            .as_array()
            .is_some_and(|types| types.iter().any(|t| t == kind))
    {
        return Err(format!("Invalid type for '{path}'"));
    }
    if let Some(choices) = schema["enum"].as_array() {
        if !choices.contains(value) {
            return Err(format!("Invalid choice for '{path}'"));
        }
    }
    if let Some(text) = value.as_str() {
        if schema["minLength"].as_u64().is_some() && text.trim().is_empty() {
            return Err(format!("'{path}' must not be blank"));
        }
    }
    if let Some(values) = value.as_array() {
        for item in values {
            validate(item, &schema["items"], path)?;
        }
    }
    if let Some(values) = value.as_object() {
        let properties = schema["properties"].as_object().unwrap();
        for key in schema["required"].as_array().into_iter().flatten() {
            let key = key.as_str().unwrap();
            if !values.contains_key(key) {
                return Err(format!("Missing required argument: '{path}.{key}'"));
            }
        }
        for (key, value) in values {
            let field = properties
                .get(key)
                .ok_or_else(|| format!("Unknown field '{path}.{key}'"))?;
            validate(value, field, &format!("{path}.{key}"))?;
        }
    }
    Ok(())
}

fn reject_redacted(value: &Value) -> Result<(), String> {
    match value {
        Value::String(s) if s == "[REDACTED]" => {
            Err("Do not write [REDACTED] placeholders; omit unchanged secrets instead".into())
        }
        Value::Object(values) => values.values().try_for_each(reject_redacted),
        Value::Array(values) => values.iter().try_for_each(reject_redacted),
        _ => Ok(()),
    }
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("IDs must contain only ASCII letters, digits, '-' or '_'".into());
    }
    Ok(())
}

fn id<'a>(args: &'a Arguments, key: &str) -> Result<&'a str, String> {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing required argument: '{key}'"))?;
    valid_id(value)?;
    Ok(value)
}

fn merge(target: &mut Value, changes: &Value) {
    if let (Some(target), Some(changes)) = (target.as_object_mut(), changes.as_object()) {
        for (key, value) in changes {
            if value.is_object() {
                let entry = target.entry(key).or_insert_with(|| json!({}));
                if !entry.is_object() {
                    *entry = json!({});
                }
                merge(entry, value);
            } else {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

fn patch<T: Serialize + DeserializeOwned>(
    target: &mut T,
    changes: &Arguments,
) -> Result<(), String> {
    let mut value = serde_json::to_value(&*target).map_err(|e| e.to_string())?;
    merge(&mut value, &Value::Object(changes.clone()));
    *target = serde_json::from_value(value)
        .map_err(|_| "Invalid fields for this resource".to_string())?;
    Ok(())
}

fn response(value: impl Serialize) -> Result<CallToolResult, String> {
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
}

fn folder_mut<'a>(folders: &'a mut [Folder], id: &str) -> Option<&'a mut Folder> {
    for folder in folders {
        if folder.id == id {
            return Some(folder);
        }
        if let Some(found) = folder_mut(&mut folder.folders, id) {
            return Some(found);
        }
    }
    None
}

fn take_folder(folders: &mut Vec<Folder>, id: &str) -> Option<Folder> {
    if let Some(index) = folders.iter().position(|f| f.id == id) {
        return Some(folders.remove(index));
    }
    for folder in folders {
        if let Some(found) = take_folder(&mut folder.folders, id) {
            return Some(found);
        }
    }
    None
}

fn take_request(collection: &mut Collection, id: &str) -> Option<RequestItem> {
    fn take(
        requests: &mut Vec<RequestItem>,
        folders: &mut [Folder],
        id: &str,
    ) -> Option<RequestItem> {
        if let Some(index) = requests.iter().position(|r| r.id == id) {
            return Some(requests.remove(index));
        }
        for folder in folders {
            if let Some(found) = take(&mut folder.requests, &mut folder.folders, id) {
                return Some(found);
            }
        }
        None
    }
    take(&mut collection.requests, &mut collection.folders, id)
}

fn request_mut<'a>(
    requests: &'a mut [RequestItem],
    folders: &'a mut [Folder],
    id: &str,
) -> Option<&'a mut RequestItem> {
    if let Some(request) = requests.iter_mut().find(|r| r.id == id) {
        return Some(request);
    }
    for folder in folders {
        if let Some(request) = request_mut(&mut folder.requests, &mut folder.folders, id) {
            return Some(request);
        }
    }
    None
}

fn destination<'a>(
    collection: &'a mut Collection,
    parent: Option<&str>,
) -> Result<(&'a mut Vec<Folder>, &'a mut Vec<RequestItem>), String> {
    match parent {
        None => Ok((&mut collection.folders, &mut collection.requests)),
        Some(id) => {
            valid_id(id)?;
            let folder = folder_mut(&mut collection.folders, id).ok_or_else(|| {
                "Destination folder not found (or would create a folder cycle)".to_string()
            })?;
            Ok((&mut folder.folders, &mut folder.requests))
        }
    }
}

fn edit_variable<T: Serialize + DeserializeOwned>(
    variables: &mut Vec<T>,
    key: &str,
    action: &str,
    changes: &Arguments,
    new: impl FnOnce() -> T,
) -> Result<(), String> {
    let mut index = None;
    for (position, variable) in variables.iter().enumerate() {
        let value = serde_json::to_value(variable).map_err(|e| e.to_string())?;
        if value["key"] == key {
            index = Some(position);
            break;
        }
    }
    match (action, index) {
        ("delete", Some(index)) => {
            variables.remove(index);
        }
        ("delete", None) => return Err("Variable not found".into()),
        (_, Some(index)) => patch(&mut variables[index], changes)?,
        (_, None) => {
            if !changes.contains_key("value") {
                return Err("A value is required when creating a variable".into());
            }
            let mut variable = new();
            patch(&mut variable, changes)?;
            variables.push(variable);
        }
    }
    Ok(())
}

fn variable_tool(
    storage: &StorageManager,
    action: &str,
    args: &Arguments,
) -> Result<CallToolResult, String> {
    let resource_id = id(args, "resource_id")?;
    let key = args["key"].as_str().unwrap();
    let mut changes = args.clone();
    for field in ["resource", "resource_id", "key"] {
        changes.remove(field);
    }
    if args["resource"] == "collection" {
        update_collection(storage, resource_id, |collection| {
            edit_variable(&mut collection.variables, key, action, &changes, || {
                KeyValueItem::new(key, "")
            })
            .map_err(CoreError::ValidationError)
        })?;
    } else {
        if changes.contains_key("description") {
            return Err("Only collection variables support 'description'".into());
        }
        update_environment(storage, resource_id, |environment| {
            edit_variable(&mut environment.variables, key, action, &changes, || {
                EnvironmentVariable::new(key, "", false)
            })
            .map_err(CoreError::ValidationError)
        })?;
    }
    response(
        json!({"resource": args["resource"], "resource_id": resource_id, "key": key, "deleted": action == "delete"}),
    )
}

fn update_collection(
    storage: &StorageManager,
    id: &str,
    edit: impl FnOnce(&mut Collection) -> ezman_core::Result<()>,
) -> Result<Collection, String> {
    storage
        .update_collection(id, |collection| {
            let before = collection.clone();
            edit(collection)?;
            secret_access::guard_collection(&before, Some(collection))
        })
        .map_err(|e| e.to_string())
}

fn update_environment(
    storage: &StorageManager,
    id: &str,
    edit: impl FnOnce(&mut Environment) -> ezman_core::Result<()>,
) -> Result<Environment, String> {
    storage
        .update_environment(id, |environment| {
            let before = environment.clone();
            edit(environment)?;
            secret_access::guard_environment(&before, Some(environment))
        })
        .map_err(|e| e.to_string())
}

pub fn execute(
    storage: &StorageManager,
    name: &str,
    args: Arguments,
) -> Result<CallToolResult, String> {
    let tool = tools()
        .into_iter()
        .find(|t| t.name == name)
        .ok_or_else(|| format!("Unknown tool: {name}"))?;
    validate(
        &Value::Object(args.clone()),
        &Value::Object((*tool.input_schema).clone()),
        name,
    )?;
    let (action, resource) = name.split_once('_').unwrap();
    if matches!(action, "create" | "update" | "set") {
        reject_redacted(&Value::Object(args.clone()))?;
    }
    if resource == "variable" {
        return variable_tool(storage, action, &args);
    }
    let id_key = format!("{resource}_id");
    let resource_id = if action == "create" {
        Uuid::new_v4().to_string()
    } else {
        id(&args, &id_key)?.to_string()
    };
    if action == "get" {
        return match resource {
            "collection" => {
                let collection = storage
                    .get_collection(&resource_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Collection not found".to_string())?;
                response(secret_access::collection_view(&collection, &collection)?)
            }
            "environment" => {
                let environment = storage
                    .get_environment(&resource_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Environment not found".to_string())?;
                response(secret_access::environment_view(&environment)?)
            }
            _ => unreachable!(),
        };
    }
    let mut changes = if action == "update" {
        args["changes"].as_object().unwrap().clone()
    } else if action == "create" {
        args.clone()
    } else {
        Map::new()
    };
    changes.remove("collection_id");
    if resource == "environment" {
        return match action {
            "create" => {
                let mut env = Environment::new(&resource_id, "");
                patch(&mut env, &changes)?;
                secret_access::guard_environment(&Environment::new(&resource_id, ""), Some(&env))
                    .map_err(|e| e.to_string())?;
                storage.save_environment(&env).map_err(|e| e.to_string())?;
                response(secret_access::environment_view(&env)?)
            }
            "update" => {
                let env = update_environment(storage, &resource_id, |env| {
                    patch(env, &changes).map_err(CoreError::ValidationError)
                })?;
                response(secret_access::environment_view(&env)?)
            }
            "delete" => {
                if !storage
                    .delete_environment_if(&resource_id, |env| {
                        secret_access::guard_environment(env, None)
                    })
                    .map_err(|e| e.to_string())?
                {
                    return Err("Environment not found".into());
                }
                response(json!({"deleted": true, "environment_id": resource_id}))
            }
            _ => unreachable!(),
        };
    }
    if resource == "collection" {
        return match action {
            "create" => {
                let mut collection = Collection::new(&resource_id, "");
                patch(&mut collection, &changes)?;
                secret_access::guard_collection(
                    &Collection::new(&resource_id, ""),
                    Some(&collection),
                )
                .map_err(|e| e.to_string())?;
                storage
                    .save_collection(&collection)
                    .map_err(|e| e.to_string())?;
                response(secret_access::collection_view(&collection, &collection)?)
            }
            "update" => {
                let collection = update_collection(storage, &resource_id, |collection| {
                    patch(collection, &changes).map_err(CoreError::ValidationError)
                })?;
                response(secret_access::collection_view(&collection, &collection)?)
            }
            "delete" => {
                if !storage
                    .delete_collection_if(&resource_id, |collection| {
                        secret_access::guard_collection(collection, None)
                    })
                    .map_err(|e| e.to_string())?
                {
                    return Err("Collection not found".into());
                }
                response(json!({"deleted": true, "collection_id": resource_id}))
            }
            _ => unreachable!(),
        };
    }
    let collection_id = id(&args, "collection_id")?;
    let mut output = Value::Null;
    let collection = update_collection(storage, collection_id, |collection| {
        let mut edit = || -> Result<Value, String> {
            let parent_key = if resource == "folder" {
                "parent_folder_id"
            } else {
                "folder_id"
            };
            let parent_change = changes.remove(parent_key);
            let parent = parent_change.as_ref().and_then(Value::as_str);
            if resource == "folder" {
                if action == "update" && parent_change.is_none() {
                    let folder = folder_mut(&mut collection.folders, &resource_id)
                        .ok_or_else(|| "Folder not found".to_string())?;
                    patch(folder, &changes)?;
                    return serde_json::to_value(folder).map_err(|e| e.to_string());
                }
                let mut folder = if action == "create" {
                    Folder::new(&resource_id, "")
                } else {
                    take_folder(&mut collection.folders, &resource_id)
                        .ok_or_else(|| "Folder not found".to_string())?
                };
                if action == "delete" {
                    return Ok(json!({"deleted": true, "folder_id": resource_id}));
                }
                patch(&mut folder, &changes)?;
                let output = serde_json::to_value(&folder).map_err(|e| e.to_string())?;
                destination(collection, parent)?.0.push(folder);
                Ok(output)
            } else {
                if action == "update" && parent_change.is_none() {
                    let request = request_mut(
                        &mut collection.requests,
                        &mut collection.folders,
                        &resource_id,
                    )
                    .ok_or_else(|| "Request not found".to_string())?;
                    patch(request, &changes)?;
                    request.updated_at = chrono::Utc::now();
                    return serde_json::to_value(request).map_err(|e| e.to_string());
                }
                let mut request = if action == "create" {
                    RequestItem::new(&resource_id, "", HttpMethod::GET, "")
                } else {
                    take_request(collection, &resource_id)
                        .ok_or_else(|| "Request not found".to_string())?
                };
                if action == "delete" {
                    return Ok(json!({"deleted": true, "request_id": resource_id}));
                }
                patch(&mut request, &changes)?;
                request.updated_at = chrono::Utc::now();
                let output = serde_json::to_value(&request).map_err(|e| e.to_string())?;
                destination(collection, parent)?.1.push(request);
                Ok(output)
            }
        };
        output = edit().map_err(CoreError::ValidationError)?;
        Ok(())
    })?;
    response(secret_access::collection_view(
        &collection,
        json!({"collection_id": collection_id, resource: output}),
    )?)
}
