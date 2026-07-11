// SPDX-License-Identifier: MIT
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 30) return "<1 min";
  return `${Math.max(1, Math.round(sec / 60))} min`;
}

export function humanizeStep(id: string): string {
  const label = id.replace(/[-_:]+/g, " ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_UUID_RE = /\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ANONYMOUS_HASH_RE = /^anonymous:([0-9a-f]{64})$/i;

function anonymousLabel(uuid: string): string {
  return `Anonymous · ${uuid.slice(0, 4)}`;
}

export function displayLabel(label: string): string {
  if (UUID_RE.test(label)) return anonymousLabel(label);
  const anonymousHash = ANONYMOUS_HASH_RE.exec(label);
  if (anonymousHash) return `Anonymous · ${anonymousHash[1].slice(0, 4)}`;
  const match = ACCOUNT_UUID_RE.exec(label);
  return match ? anonymousLabel(match[1]) : label;
}
