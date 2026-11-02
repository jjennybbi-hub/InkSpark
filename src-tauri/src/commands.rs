//! Tauri commands exposed to the frontend. Types here are exported to
//! `src/contracts/bindings.ts` by tauri-specta (M0 §3.3).

/// Basic facts about the running build of the app.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Always `"InkSpark"`.
    pub name: String,
    /// The crate version (equal to `package.json` and `tauri.conf.json`).
    pub version: String,
    /// The operating system the app was compiled for.
    pub os: OsKind,
    /// The CPU architecture, as in `std::env::consts::ARCH`.
    pub arch: String,
    /// The Tauri runtime version.
    pub tauri_version: String,
}

/// The operating system family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum OsKind {
    Macos,
    Linux,
    Windows,
    Other,
}

impl OsKind {
    /// The OS this binary was compiled for.
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Other
        }
    }
}

/// Returns static information about this build of InkSpark.
#[tauri::command]
#[specta::specta]
#[must_use]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "InkSpark".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        os: OsKind::current(),
        arch: std::env::consts::ARCH.to_owned(),
        tauri_version: tauri::VERSION.to_owned(),
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
