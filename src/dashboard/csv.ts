// SPDX-License-Identifier: MIT
const DANGEROUS_PREFIX = /^[=+\-@]/;

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  const stripped = s.replace(/^[\s\x00-\x1f]+/, "");
  if (DANGEROUS_PREFIX.test(stripped)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || s.startsWith("'")) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
