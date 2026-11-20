//! Order-independent comparison of text files, treating every line as a key.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TextDiffOptions {
    pub ignore_case: bool,
    pub trim_whitespace: bool,
    pub ignore_empty: bool,
    /// `None` compares whole lines; `Some(c)` builds the key from `c`-separated fields.
    pub delimiter: Option<char>,
    /// 0-based field indexes left out of the key (only with a delimiter).
    pub ignore_columns: Vec<usize>,
    /// Trim each field before joining the key (only with a delimiter).
    pub trim_fields: bool,
}

impl Default for TextDiffOptions {
    fn default() -> Self {
        Self {
            ignore_case: false,
            trim_whitespace: true,
            ignore_empty: true,
            delimiter: None,
            ignore_columns: Vec::new(),
            trim_fields: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffKind {
    Removed,
    Added,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffCell {
    /// 1-based line number in its own file.
    pub line: usize,
    pub text: String,
    pub kind: DiffKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiffRow {
    pub left: Option<DiffCell>,
    pub right: Option<DiffCell>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TextDiff {
    pub rows: Vec<DiffRow>,
    pub removed: usize,
    pub added: usize,
    pub unchanged: usize,
    /// Only real changes (`- ` removed, `+ ` added).
    pub changes_text: String,
}

struct Entry<'a> {
    line: usize,
    text: &'a str,
    key: String,
}

fn entries<'a>(text: &'a str, opts: &TextDiffOptions) -> Vec<Entry<'a>> {
    text.lines()
        .enumerate()
        .filter(|(_, t)| !(opts.ignore_empty && t.trim().is_empty()))
        .map(|(i, t)| {
            let base = if opts.trim_whitespace { t.trim() } else { t };
            let k = match opts.delimiter {
                None => base.to_string(),
                Some(d) => base
                    .split(d)
                    .enumerate()
                    .filter(|(idx, _)| !opts.ignore_columns.contains(idx))
                    .map(|(_, f)| if opts.trim_fields { f.trim() } else { f })
                    .collect::<Vec<_>>()
                    .join(&d.to_string()),
            };
            let key = if opts.ignore_case { k.to_lowercase() } else { k };
            Entry { line: i + 1, text: t, key }
        })
        .collect()
}

/// Every entry is a key matched between the files regardless of position (duplicates
/// are matched in order). Matched entries are always "unchanged", whatever their
/// position; unmatched ones are "removed" (only in A) or "added" (only in B).
pub fn diff_texts(a: &str, b: &str, opts: &TextDiffOptions) -> TextDiff {
    let ea = entries(a, opts);
    let eb = entries(b, opts);

    let mut queues: HashMap<&str, Vec<usize>> = HashMap::new();
    for (j, e) in eb.iter().enumerate() {
        queues.entry(e.key.as_str()).or_default().push(j);
    }
    let mut cursor: HashMap<&str, usize> = HashMap::new();

    let mut match_of_a: Vec<Option<usize>> = vec![None; ea.len()];
    let mut match_of_b: Vec<Option<usize>> = vec![None; eb.len()];
    for (i, e) in ea.iter().enumerate() {
        if let Some(q) = queues.get(e.key.as_str()) {
            let c = cursor.entry(e.key.as_str()).or_insert(0);
            if *c < q.len() {
                let j = q[*c];
                match_of_a[i] = Some(j);
                match_of_b[j] = Some(i);
                *c += 1;
            }
        }
    }

    let cell = |e: &Entry, kind: DiffKind| DiffCell { line: e.line, text: e.text.to_string(), kind };

    // Matched pairs first (in A order), then leftover removed/added zipped side by side.
    let mut rows = Vec::new();
    let mut unmatched_a = Vec::new();
    for (i, m) in match_of_a.iter().enumerate() {
        match m {
            Some(j) => rows.push(DiffRow {
                left: Some(cell(&ea[i], DiffKind::Unchanged)),
                right: Some(cell(&eb[*j], DiffKind::Unchanged)),
            }),
            None => unmatched_a.push(i),
        }
    }
    let unchanged = rows.len();
    let unmatched_b: Vec<usize> = (0..eb.len()).filter(|&j| match_of_b[j].is_none()).collect();
    for k in 0..unmatched_a.len().max(unmatched_b.len()) {
        rows.push(DiffRow {
            left: unmatched_a.get(k).map(|&i| cell(&ea[i], DiffKind::Removed)),
            right: unmatched_b.get(k).map(|&j| cell(&eb[j], DiffKind::Added)),
        });
    }

    let mut changes_text = String::new();
    let mut removed = 0;
    for (i, e) in ea.iter().enumerate() {
        if match_of_a[i].is_none() {
            removed += 1;
            changes_text.push_str(&format!("- {}\n", e.text));
        }
    }
    let mut added = 0;
    for (j, e) in eb.iter().enumerate() {
        if match_of_b[j].is_none() {
            added += 1;
            changes_text.push_str(&format!("+ {}\n", e.text));
        }
    }

    TextDiff {
        rows,
        removed,
        added,
        unchanged,
        changes_text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reorder_is_unchanged() {
        let d = diff_texts("a\nb\nc\nd\ne\n", "a\nc\nb\nd\nx\n", &TextDiffOptions::default());
        assert_eq!((d.removed, d.added, d.unchanged), (1, 1, 4));
        assert_eq!(d.changes_text, "- e\n+ x\n");
    }

    #[test]
    fn duplicates_are_counted() {
        let d = diff_texts("a\nb\nb\n", "b\nb\nb\na\n", &TextDiffOptions::default());
        assert_eq!((d.removed, d.added), (0, 1));
        assert_eq!(d.changes_text, "+ b\n");
    }

    #[test]
    fn options_normalize_keys() {
        let o = TextDiffOptions { ignore_case: true, ..Default::default() };
        let d = diff_texts("  Foo\n\nbar\n", "foo\nbar\n", &o);
        assert_eq!((d.removed, d.added), (0, 0));
    }

    #[test]
    fn ignored_column_does_not_affect_match() {
        let o = TextDiffOptions { delimiter: Some('|'), ignore_columns: vec![0], ..Default::default() };
        let a = "SERIAL|NAME|X\n001|foo  |1\n002|bar|2\n";
        let b = "SERIAL|NAME|X\n900|bar|2\n901|foo|1\n";
        let d = diff_texts(a, b, &o);
        assert_eq!((d.removed, d.added, d.unchanged), (0, 0, 3));
        assert_eq!(d.rows.iter().filter_map(|r| r.left.as_ref()).any(|c| c.text == "001|foo  |1"), true);
    }

    #[test]
    fn delimiter_without_ignored_columns_matches_full_fields() {
        let o = TextDiffOptions { delimiter: Some(','), ..Default::default() };
        let d = diff_texts("1,a\n2,b\n", "9,a\n2,b\n", &o);
        assert_eq!((d.removed, d.added, d.unchanged), (1, 1, 1));
    }

    #[test]
    fn comma_ignore_second_column() {
        let o = TextDiffOptions { delimiter: Some(','), ignore_columns: vec![1], ..Default::default() };
        let d = diff_texts("a,1,x\n", "a,2,x\n", &o);
        assert_eq!((d.removed, d.added, d.unchanged), (0, 0, 1));
    }
}
