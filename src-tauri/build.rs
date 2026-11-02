#![forbid(unsafe_code)]

use std::path::PathBuf;

fn main() {
    // tauri-build embeds the Windows app manifest only into [[bin]] targets. Test and example
    // executables that link Tauri then fail to start (STATUS_ENTRYPOINT_NOT_FOUND) because
    // comctl32 v6 is missing. Embed one manifest into every target instead (ADR 007).
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    if let Err(error) = tauri_build::try_build(attributes) {
        println!("cargo:warning=tauri-build failed: {error:#}");
        std::process::exit(1);
    }

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
