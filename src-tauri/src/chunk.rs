//! Pure text normalization + chunking. No I/O, fully unit-testable.

/// Collapse whitespace, drop empty/duplicate consecutive lines, trim.
/// Accessibility trees emit a lot of blank/duplicate strings; this keeps
/// the vault clean and the embeddings meaningful.
pub fn normalize(raw: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut prev: Option<String> = None;
    for line in raw.lines() {
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            continue;
        }
        if prev.as_deref() == Some(line.as_str()) {
            continue; // skip consecutive duplicates
        }
        prev = Some(line.clone());
        out.push(line);
    }
    out.join("\n")
}

/// Split normalized text into chunks of roughly `target` chars, breaking on
/// line boundaries, with a small overlap so context isn't lost at the seams.
pub fn chunk(text: &str, target: usize, overlap: usize) -> Vec<String> {
    let target = target.max(64);
    let overlap = overlap.min(target / 2);
    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();

    for line in text.lines() {
        // A single oversized line is hard-split.
        if line.len() > target {
            if !cur.is_empty() {
                chunks.push(std::mem::take(&mut cur));
            }
            for piece in hard_split(line, target) {
                chunks.push(piece);
            }
            continue;
        }
        if cur.len() + line.len() + 1 > target && !cur.is_empty() {
            chunks.push(std::mem::take(&mut cur));
            if overlap > 0 {
                cur = tail(chunks.last().unwrap(), overlap);
                if !cur.is_empty() {
                    cur.push('\n');
                }
            }
        }
        if !cur.is_empty() {
            cur.push('\n');
        }
        cur.push_str(line);
    }
    if !cur.trim().is_empty() {
        chunks.push(cur);
    }
    chunks
}

fn hard_split(s: &str, target: usize) -> Vec<String> {
    let mut out = Vec::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let end = (i + target).min(chars.len());
        out.push(chars[i..end].iter().collect());
        i = end;
    }
    out
}

/// Last `n` chars of `s`, snapped to a char boundary.
fn tail(s: &str, n: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    let start = chars.len().saturating_sub(n);
    chars[start..].iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_and_dedups() {
        let raw = "  Hello   world \n\n\nHello world\nFoo\tbar  ";
        assert_eq!(normalize(raw), "Hello world\nFoo bar");
    }

    #[test]
    fn chunk_respects_target_and_covers_text() {
        let text = (0..50)
            .map(|i| format!("line number {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let chunks = chunk(&text, 120, 20);
        assert!(chunks.len() > 1);
        for c in &chunks {
            // overlap can push slightly over; allow generous bound
            assert!(c.len() <= 200, "chunk too big: {}", c.len());
        }
        // First and last content present somewhere.
        assert!(chunks.iter().any(|c| c.contains("line number 0")));
        assert!(chunks.iter().any(|c| c.contains("line number 49")));
    }

    #[test]
    fn chunk_hard_splits_oversized_line() {
        let line = "x".repeat(500);
        let chunks = chunk(&line, 100, 10);
        assert!(chunks.len() >= 5);
        assert!(chunks.iter().all(|c| c.len() <= 100));
    }

    #[test]
    fn empty_text_yields_no_chunks() {
        assert!(chunk("", 100, 10).is_empty());
        assert!(chunk("   \n  \n", 100, 10).is_empty());
    }
}
