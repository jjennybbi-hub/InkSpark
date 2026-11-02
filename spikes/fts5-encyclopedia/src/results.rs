//! Shared spike result format (M0 §3.9): `spikes/<name>/results/<os>.json`, not committed.
//! Duplicated per spike crate on purpose; dependency-free apart from serde_json.

use std::path::Path;

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

/// Writes the results JSON (schemaVersion 1) for `metrics` to `path`.
// stub: removed by implementer
#[allow(unused_variables)]
pub fn write_results(path: &Path, metrics: &[Metric]) -> std::io::Result<()> {
    todo!("M0 track C")
}
