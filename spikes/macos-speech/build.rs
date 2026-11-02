//! Embeds `macos/Info.plist` into every linked macOS target (the `speech-spike` bin and the test
//! binaries) as the `__TEXT,__info_plist` section. Without it, TCC aborts a process that asks for
//! speech-recognition or microphone access (M0 risk R6). Other targets are untouched.
#![forbid(unsafe_code)]

use std::env;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=macos/Info.plist");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_owned());
    let plist = Path::new(&manifest_dir).join("macos").join("Info.plist");
    let plist = plist.display().to_string();
    // `-Wl,` splits on commas, so such a path cannot be passed through it. Fail the build
    // rather than produce a binary that TCC would abort.
    assert!(
        !plist.contains(','),
        "cannot embed Info.plist from a path that contains a comma: {plist}"
    );
    println!("cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{plist}");
}
