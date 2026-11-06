use reqwest::RequestBuilder;
use crate::model::{AuthConfig, AuthType, ApiKeyLocation};

pub fn apply_auth(mut builder: RequestBuilder, auth: &AuthConfig) -> RequestBuilder {
    match auth.auth_type {
        AuthType::None | AuthType::Inherit => builder,
        AuthType::Bearer => {
            if let Some(token) = &auth.bearer_token {
                builder = builder.bearer_auth(token);
            }
            builder
        }
        AuthType::Basic => {
            if let (Some(user), Some(pass)) = (&auth.basic_username, &auth.basic_password) {
                builder = builder.basic_auth(user, Some(pass));
            } else if let Some(user) = &auth.basic_username {
                builder = builder.basic_auth(user, Option::<&str>::None);
            }
            builder
        }
        AuthType::ApiKey => {
            if let (Some(name), Some(val)) = (&auth.api_key_name, &auth.api_key_value) {
                match auth.api_key_in.unwrap_or(ApiKeyLocation::Header) {
                    ApiKeyLocation::Header => {
                        builder = builder.header(name, val);
                    }
                    ApiKeyLocation::Query => {
                        builder = builder.query(&[(name, val)]);
                    }
                }
            }
            builder
        }
        AuthType::Custom => {
            if let (Some(name), Some(val)) = (&auth.custom_header_name, &auth.custom_header_value) {
                builder = builder.header(name, val);
            }
            builder
        }
    }
}
