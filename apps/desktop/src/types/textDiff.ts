export interface DiffOptions {
  ignore_case: boolean;
  trim_whitespace: boolean;
  ignore_empty: boolean;
  delimiter: string | null;
  ignore_columns: number[];
  trim_fields: boolean;
}

export type DiffKind = 'removed' | 'added' | 'unchanged';

export interface Cell {
  line: number;
  text: string;
  kind: DiffKind;
}

export interface SideBySideRow {
  left?: Cell | null;
  right?: Cell | null;
}

/** Mirrors `ezman_core::TextDiff`; the comparison itself runs in Rust. */
export interface DiffResult {
  rows: SideBySideRow[];
  removed: number;
  added: number;
  unchanged: number;
  changes_text: string;
}
