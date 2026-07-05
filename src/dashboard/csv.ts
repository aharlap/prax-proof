// SPDX-License-Identifier: MIT
const FORMULA_PREFIX = /^[=+\-@]/;

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || s.startsWith("'")) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
