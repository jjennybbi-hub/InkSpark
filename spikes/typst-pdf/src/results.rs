//! Shared spike result format (M0 §3.9): `spikes/<name>/results/<os>.json`, not committed.
//! Duplicated per spike crate on purpose; dependency-free apart from serde_json.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value, json};

/// The spike name written to `"spike"`.
const SPIKE: &str = "typst-pdf";

/// The engine string written to `"engine"`.
fn engine() -> String {
    String::from("typst 0.15.1")
}

/// How a measured value is compared with its threshold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Comparator {
    /// `"<="`
    Le,
    /// `"<"`
    Lt,
    /// `">="`
    Ge,
    /// `">"`
    Gt,
}

impl Comparator {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Le => "<=",
            Self::Lt => "<",
            Self::Ge => ">=",
            Self::Gt => ">",
        }
    }

    /// Whether `value` meets `threshold` under this comparator. NaN never passes.
    pub fn check(self, value: f64, threshold: f64) -> bool {
        match self {
            Self::Le => value <= threshold,
            Self::Lt => value < threshold,
            Self::Ge => value >= threshold,
            Self::Gt => value > threshold,
        }
    }
}

/// One measured metric with its go/no-go threshold.
#[derive(Debug, Clone, PartialEq)]
pub struct Metric {
    pub name: String,
    pub value: f64,
    pub unit: String,
    pub threshold: f64,
    pub comparator: Comparator,
    pub pass: bool,
}

impl Metric {
    /// A metric whose `pass` is computed from the comparator.
    pub fn new(name: &str, value: f64, unit: &str, threshold: f64, comparator: Comparator) -> Self {
        Self {
            name: name.to_owned(),
            value,
            unit: unit.to_owned(),
            threshold,
            comparator,
            pass: comparator.check(value, threshold),
        }
    }
}

/// Writes the results JSON (schemaVersion 1) for `metrics` to `path`.
pub fn write_results(path: &Path, metrics: &[Metric]) -> std::io::Result<()> {
    write_results_with_notes(path, metrics, &[])
}

/// Like [`write_results`], with free-form `notes`.
pub fn write_results_with_notes(
    path: &Path,
    metrics: &[Metric],
    notes: &[String],
) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(&results_json(metrics, notes))
        .map_err(std::io::Error::other)?;
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    // Spike measurement output (not a user file); the storage module arrives in M1.
    #[allow(clippy::disallowed_methods)]
    std::fs::write(path, text + "\n")
}

fn results_json(metrics: &[Metric], notes: &[String]) -> Value {
    let mut map = Map::new();
    for m in metrics {
        // JSON has no NaN/inf: non-finite values are written as null.
        let value = serde_json::Number::from_f64(m.value).map_or(Value::Null, Value::Number);
        map.insert(
            m.name.clone(),
            json!({
                "value": value,
                "unit": m.unit,
                "threshold": m.threshold,
                "comparator": m.comparator.as_str(),
                "pass": m.pass,
            }),
        );
    }
    json!({
        "schemaVersion": 1,
        "spike": SPIKE,
        "os": os_label(),
        "arch": std::env::consts::ARCH,
        "commit": commit(),
        "timestamp": rfc3339_now(),
        "engine": engine(),
        "metrics": map,
        "notes": notes,
    })
}

/// The CI runner label (e.g. `macos-15`) when set by spikes.yml, else the Rust OS name.
fn os_label() -> String {
    ["SPIKE_OS", "RUNNER_OS_LABEL"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(|| std::env::consts::OS.to_owned())
}

fn commit() -> String {
    if let Ok(sha) = std::env::var("GITHUB_SHA")
        && !sha.is_empty()
    {
        return sha;
    }
    std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| String::from("unknown"))
}

/// UTC now as RFC 3339 (`YYYY-MM-DDTHH:MM:SSZ`), without a date crate.
fn rfc3339_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let days = i64::try_from(secs / 86_400).unwrap_or_default();
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's days-to-civil algorithm (proleptic Gregorian).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_454), (2026, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn comparators() {
        assert!(Comparator::Le.check(1.0, 1.0));
        assert!(!Comparator::Lt.check(1.0, 1.0));
        assert!(Comparator::Ge.check(2.0, 1.0));
        assert!(!Comparator::Gt.check(f64::NAN, 1.0));
    }

    #[test]
    fn json_shape() {
        let v = results_json(
            &[Metric::new("cold_ms", 12.5, "ms", 4000.0, Comparator::Le)],
            &[String::from("n")],
        );
        assert_eq!(v["schemaVersion"], 1);
        assert_eq!(v["spike"], SPIKE);
        assert_eq!(v["metrics"]["cold_ms"]["comparator"], "<=");
        assert_eq!(v["metrics"]["cold_ms"]["pass"], true);
        assert_eq!(v["notes"][0], "n");
    }
}
