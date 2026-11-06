use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP client error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Collection not found: {0}")]
    CollectionNotFound(String),

    #[error("Request not found: {0}")]
    RequestNotFound(String),

    #[error("Environment not found: {0}")]
    EnvironmentNotFound(String),

    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    #[error("Import error: {0}")]
    ImportError(String),

    #[error("Storage error: {0}")]
    StorageError(String),

    #[error("Lock error: {0}")]
    LockError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
