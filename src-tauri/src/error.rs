//! The typed error every InkSpark command returns (M0 §3.3).
//!
//! It serializes as `{ "kind": "notFound" | "invalid" | "io", "message": string }`, so the
//! frontend can branch on `kind` and show `message` calmly.

/// An error surfaced to the frontend through a command's `Result`.
#[derive(Debug, thiserror::Error, serde::Serialize, specta::Type)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AppError {
    /// The requested item does not exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// The caller passed input that failed validation.
    #[error("invalid input: {0}")]
    Invalid(String),
    /// A filesystem or other I/O operation failed.
    #[error("io: {0}")]
    Io(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn serializes_as_kind_and_message() {
        let json = serde_json::to_value(AppError::NotFound("scene-1".to_owned()))
            .unwrap_or_else(|err| panic!("AppError failed to serialize: {err}"));
        assert_eq!(
            json,
            serde_json::json!({ "kind": "notFound", "message": "scene-1" })
        );
    }

    #[test]
    fn displays_a_readable_message() {
        assert_eq!(
            AppError::Invalid("empty title".to_owned()).to_string(),
            "invalid input: empty title"
        );
    }

    #[test]
    fn converts_io_errors() {
        let err = AppError::from(std::io::Error::other("disk full"));
        assert_eq!(err.to_string(), "io: disk full");
    }
}
