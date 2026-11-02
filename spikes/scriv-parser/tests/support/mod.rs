//! Test-only helpers shared by the scriv-parser integration tests.
//!
//! Each test crate includes this module with `mod support;` and uses only part
//! of it, hence the `dead_code` allowance.
#![allow(dead_code)]

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use inkspark_spike_scriv::BinderItem;

/// Fixtures that must parse and have a `<name>.expected.json` golden.
pub const GOLDEN_FIXTURES: &[&str] = &[
    "minimal",
    "nested",
    "unicode",
    "formatting",
    "missing-content",
];

/// Every fixture package under `fixtures/`, including the ones that must fail.
pub const ALL_FIXTURES: &[&str] = &[
    "minimal",
    "nested",
    "unicode",
    "formatting",
    "missing-content",
    "malformed",
];

pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// `fixtures/<name>.scriv`
pub fn fixture(name: &str) -> PathBuf {
    fixtures_dir().join(format!("{name}.scriv"))
}

/// `fixtures/<name>.scriv/<name>.scrivx`
pub fn fixture_scrivx(name: &str) -> PathBuf {
    fixture(name).join(format!("{name}.scrivx"))
}

/// `fixtures/<name>.expected.json`
pub fn expected_json(name: &str) -> PathBuf {
    fixtures_dir().join(format!("{name}.expected.json"))
}

/// A fresh, empty, uniquely named directory under Cargo's per-target test tmp dir.
/// Never inside `fixtures/`. Directories are not cleaned up, so a read-only copy
/// left behind by one run cannot break the next one.
pub fn scratch_dir(label: &str) -> PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("scriv-parser-tests")
        .join(format!("{label}-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

/// Writes `bytes` to `path` (test scratch files only; never a fixture).
pub fn write_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.flush()
}

/// Recursively copies `from` into `to` (which is created).
pub fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    let mut entries = fs::read_dir(from)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Binder items in pre-order (an item, then its children, then the next sibling).
pub fn preorder(items: &[BinderItem]) -> Vec<&BinderItem> {
    fn walk<'a>(items: &'a [BinderItem], out: &mut Vec<&'a BinderItem>) {
        for item in items {
            out.push(item);
            walk(&item.children, out);
        }
    }
    let mut out = Vec::new();
    walk(items, &mut out);
    out
}

/// Small deterministic PRNG (xorshift64*), so the generator needs no dependency.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng((seed ^ 0x9E37_79B9_7F4A_7C15) | 1)
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform-ish value in `0..n` (`n > 0`).
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
}

const WORDS: &[&str] = &[
    "the",
    "harbour",
    "lantern",
    "quiet",
    "morning",
    "letters",
    "rain",
    "tide",
    "market",
    "salt",
    "kites",
    "ferry",
    "dusk",
    "she",
    "counted",
    "nobody",
    "came",
    "and",
    "with",
    "of",
    "a",
    "window",
    "stairs",
    "old",
    "map",
    "coast",
    "river",
    "bridge",
    "smoke",
    "bread",
    "winter",
    "silver",
    "whispered",
    "carried",
    "under",
    "between",
    "never",
    "almost",
    "until",
    "again",
];

/// A pseudo-random UUID in Scrivener's upper-case form. `tag` and `index` make it unique.
fn uuid(rng: &mut Rng, tag: u16, index: u32) -> String {
    format!(
        "{:08X}-{:04X}-4{:03X}-A{:03X}-{:04X}{:08X}",
        rng.next_u64() as u32,
        rng.next_u64() as u16,
        rng.below(0x1000),
        rng.below(0x1000),
        tag,
        index
    )
}

/// The body of one generated document: plain words with occasional bold,
/// italic, cp1252 escapes and `\u` escapes, in 3 to 8 paragraphs.
fn rtf_body(rng: &mut Rng) -> String {
    let mut body = String::new();
    let paragraphs = 3 + rng.below(6);
    for _ in 0..paragraphs {
        let words = 20 + rng.below(100);
        for w in 0..words {
            if w > 0 {
                body.push(' ');
            }
            let word = WORDS[rng.below(WORDS.len() as u64) as usize];
            match rng.below(40) {
                0 => body.push_str(&format!("{{\\b {word}}}")),
                1 => body.push_str(&format!("{{\\i {word}}}")),
                2 => body.push_str(&format!("caf\\'e9 {word}")),
                3 => body.push_str(&format!("{word}\\u{}?", 8212)),
                _ => body.push_str(word),
            }
        }
        body.push_str(".\\par\n");
    }
    body
}

fn rtf_file(body: &str) -> String {
    format!(
        "{{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761\n\
         \\cocoatextscaling0\\cocoaplatform0{{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}}\n\
         {{\\colortbl;\\red255\\green255\\blue255;}}\n\
         {{\\*\\expandedcolortbl;;}}\n\
         \\pard\\tx720\\tx1440\\pardirnatural\\partightenfactor0\n\n\
         \\f0\\fs24 \\cf0 {body}}}\n"
    )
}

fn binder_item(uuid: &str, kind: &str, title: &str, meta: &str, children: &str) -> String {
    let children = if children.is_empty() {
        String::new()
    } else {
        format!("<Children>\n{children}</Children>\n")
    };
    format!(
        "<BinderItem UUID=\"{uuid}\" Type=\"{kind}\" Created=\"2024-01-01 00:00:00 +0000\" \
         Modified=\"2024-01-02 00:00:00 +0000\">\n<Title>{title}</Title>\n\
         <MetaData>\n{meta}</MetaData>\n{children}</BinderItem>\n"
    )
}

/// Writes a synthetic Scrivener 3 package at `dir` (created if needed) with
/// `docs` text documents grouped into folders of 10 under the Draft, plus empty
/// Research and Trash folders. The `.scrivx` is named after `dir`'s file stem.
/// Every text has a `content.rtf`; every 3rd has a `synopsis.txt` and every 5th
/// a `notes.rtf`. The same `seed` always produces the same bytes.
///
/// Test-only: call it with a scratch directory, never a fixture or user path.
pub fn generate_large_project(dir: &Path, docs: u32, seed: u64) -> io::Result<()> {
    let mut rng = Rng::new(seed);
    let stem = dir
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Large")
        .to_owned();
    fs::create_dir_all(dir.join("Files").join("Data"))?;
    write_file(&dir.join("Files").join("version.txt"), b"23\n")?;

    let data = dir.join("Files").join("Data");
    let mut folders = String::new();
    let mut folder_index = 0u32;
    let mut doc_index = 0u32;
    while doc_index < docs {
        let folder_uuid = uuid(&mut rng, 0xF01D, folder_index);
        let mut texts = String::new();
        for _ in 0..10 {
            if doc_index >= docs {
                break;
            }
            let text_uuid = uuid(&mut rng, 0x7E47, doc_index);
            let label = rng.below(6) as i64 - 1;
            let status = rng.below(6) as i64 - 1;
            let meta = format!(
                "<LabelID>{label}</LabelID>\n<StatusID>{status}</StatusID>\n\
                 <IncludeInCompile>Yes</IncludeInCompile>\n"
            );
            texts.push_str(&binder_item(
                &text_uuid,
                "Text",
                &format!("Scene {}", doc_index + 1),
                &meta,
                "",
            ));
            let item_dir = data.join(&text_uuid);
            write_file(
                &item_dir.join("content.rtf"),
                rtf_file(&rtf_body(&mut rng)).as_bytes(),
            )?;
            if doc_index.is_multiple_of(3) {
                let synopsis = format!("Synopsis for scene {}.\n", doc_index + 1);
                write_file(&item_dir.join("synopsis.txt"), synopsis.as_bytes())?;
            }
            if doc_index.is_multiple_of(5) {
                let notes = rtf_file("Check continuity with the previous scene.\\par\n");
                write_file(&item_dir.join("notes.rtf"), notes.as_bytes())?;
            }
            doc_index += 1;
        }
        folders.push_str(&binder_item(
            &folder_uuid,
            "Folder",
            &format!("Chapter {}", folder_index + 1),
            "<IncludeInCompile>Yes</IncludeInCompile>\n",
            &texts,
        ));
        folder_index += 1;
    }

    let draft = binder_item(
        &uuid(&mut rng, 0xD4AF, 0),
        "DraftFolder",
        "Draft",
        "<IncludeInCompile>Yes</IncludeInCompile>\n",
        &folders,
    );
    let research = binder_item(
        &uuid(&mut rng, 0x4E5E, 0),
        "ResearchFolder",
        "Research",
        "",
        "",
    );
    let trash = binder_item(&uuid(&mut rng, 0x7A54, 0), "TrashFolder", "Trash", "", "");
    let scrivx = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <ScrivenerProject Template=\"No\" Version=\"2.0\" Creator=\"SCRMAC-3.3.6-17410\">\n\
         <Binder>\n{draft}{research}{trash}</Binder>\n\
         <LabelSettings>\n<Title>Label</Title>\n<DefaultLabelID>-1</DefaultLabelID>\n<Labels>\n\
         <Label ID=\"-1\">No Label</Label>\n<Label ID=\"0\">Concept</Label>\n\
         <Label ID=\"1\">Chapter</Label>\n<Label ID=\"2\">Scene</Label>\n\
         <Label ID=\"3\">Idea</Label>\n<Label ID=\"4\">Notes</Label>\n</Labels>\n</LabelSettings>\n\
         <StatusSettings>\n<Title>Status</Title>\n<DefaultStatusID>-1</DefaultStatusID>\n<StatusItems>\n\
         <Status ID=\"-1\">No Status</Status>\n<Status ID=\"0\">To Do</Status>\n\
         <Status ID=\"1\">First Draft</Status>\n<Status ID=\"2\">Revised Draft</Status>\n\
         <Status ID=\"3\">Final Draft</Status>\n<Status ID=\"4\">Done</Status>\n\
         </StatusItems>\n</StatusSettings>\n</ScrivenerProject>\n"
    );
    write_file(&dir.join(format!("{stem}.scrivx")), scrivx.as_bytes())
}
