//! The Idea Shelf (`ideas/<id>.md`, one short note each) and the prompt dealer, which never
//! repeats a prompt (seen hashes live in `.inkspark-seen.json`).
//!
//! Every write goes through [`atomic_write`] in the `storage` module.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::error::AppError;
use crate::storage::atomic_write;

const SEEN_FILE: &str = ".inkspark-seen.json";

/// One note on the shelf.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    /// File stem of `ideas/<id>.md`; ids sort oldest first.
    pub id: String,
    /// The note text.
    pub text: String,
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Lists the shelf, newest first. A missing `ideas` folder is an empty shelf.
///
/// # Errors
///
/// Fails when the folder exists but cannot be read.
pub fn list_ideas(root: &Path) -> Result<Vec<Idea>, AppError> {
    let dir = root.join("ideas");
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut ideas: Vec<Idea> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".md")?.to_owned();
            let text = fs::read_to_string(entry.path()).ok()?;
            Some(Idea { id, text })
        })
        .collect();
    ideas.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(ideas)
}

/// Adds a note to the shelf.
///
/// # Errors
///
/// `Invalid` for blank text; otherwise fails when the file cannot be written.
pub fn add_idea(root: &Path, text: &str) -> Result<Idea, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::Invalid("an idea cannot be empty".to_owned()));
    }
    let dir = root.join("ideas");
    fs::create_dir_all(&dir)?;
    let mut stamp = now_millis();
    let id = loop {
        let candidate = format!("i{stamp:016}");
        if !dir.join(format!("{candidate}.md")).exists() {
            break candidate;
        }
        stamp += 1;
    };
    atomic_write(&dir.join(format!("{id}.md")), text.as_bytes())?;
    Ok(Idea {
        id,
        text: text.to_owned(),
    })
}

const TEMPLATES: [&str; 6] = [
    "Write about {a} {n}.",
    "A {a} {n} turns up where it should not be. What happens next?",
    "Describe {a} {n} without saying what it is for.",
    "Someone is looking for {a} {n}. Write the scene.",
    "Begin with {a} {n} and end somewhere unexpected.",
    "Write a letter that mentions {a} {n}.",
];

const ADJECTIVES: [&str; 12] = [
    "an old",
    "a broken",
    "a borrowed",
    "a hidden",
    "a quiet",
    "a forgotten",
    "a crooked",
    "a distant",
    "a stolen",
    "a small",
    "an unfinished",
    "a familiar",
];

const NOUNS: [&str; 14] = [
    "key",
    "bridge",
    "window",
    "recipe",
    "map",
    "clock",
    "garden",
    "photograph",
    "staircase",
    "umbrella",
    "train ticket",
    "lantern",
    "coat",
    "promise",
];

/// 64-bit FNV-1a, so the stored hashes are stable across runs and builds.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn render(index: usize) -> String {
    let n = NOUNS.len();
    let a = ADJECTIVES.len();
    let noun = NOUNS[index % n];
    let adjective = ADJECTIVES[(index / n) % a];
    let template = TEMPLATES[(index / (n * a)) % TEMPLATES.len()];
    template.replace("{a}", adjective).replace("{n}", noun)
}

fn read_seen(root: &Path) -> Result<BTreeSet<String>, AppError> {
    match fs::read_to_string(root.join(SEEN_FILE)) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|err| AppError::Invalid(format!("{SEEN_FILE} is unreadable: {err}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(BTreeSet::new()),
        Err(err) => Err(err.into()),
    }
}

/// Deals one prompt that this project has not been shown before and records it as seen.
///
/// # Errors
///
/// `NotFound` once every prompt has been seen; otherwise fails on I/O or a corrupt seen file.
pub fn next_prompt(root: &Path) -> Result<String, AppError> {
    let mut seen = read_seen(root)?;
    let total = NOUNS.len() * ADJECTIVES.len() * TEMPLATES.len();
    // Start at a time-based spot and walk forward to the first unseen prompt.
    let start = usize::try_from(now_millis() % total as u128).unwrap_or(0);
    let found = (0..total)
        .map(|step| render((start + step) % total))
        .find_map(|text| {
            let hash = format!("{:016x}", fnv1a(&text));
            (!seen.contains(&hash)).then_some((text, hash))
        });
    let Some((text, hash)) = found else {
        return Err(AppError::NotFound("every prompt has been used".to_owned()));
    };
    seen.insert(hash);
    let json = serde_json::to_string_pretty(&seen)
        .map_err(|err| AppError::Io(format!("could not encode {SEEN_FILE}: {err}")))?;
    atomic_write(&root.join(SEEN_FILE), json.as_bytes())?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("inkspark-ideas-{name}-{}", now_millis()));
        fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
        dir
    }

    #[test]
    fn ideas_round_trip_newest_first() {
        let root = temp_root("ideas");
        assert!(list_ideas(&root).unwrap_or_default().is_empty());
        add_idea(&root, "first").unwrap_or_else(|e| panic!("{e}"));
        add_idea(&root, " second ").unwrap_or_else(|e| panic!("{e}"));
        let texts: Vec<_> = list_ideas(&root)
            .unwrap_or_default()
            .into_iter()
            .map(|i| i.text)
            .collect();
        assert_eq!(texts, ["second", "first"]);
        assert!(add_idea(&root, "  ").is_err());
    }

    #[test]
    fn prompts_never_repeat_until_exhausted() {
        let root = temp_root("prompts");
        let total = NOUNS.len() * ADJECTIVES.len() * TEMPLATES.len();
        let mut dealt = BTreeSet::new();
        for _ in 0..total {
            let p = next_prompt(&root).unwrap_or_else(|e| panic!("{e}"));
            assert!(dealt.insert(p));
        }
        assert!(next_prompt(&root).is_err());
    }
}
