// SPDX-License-Identifier: MIT
import type { Storage } from "../storage/types";
import { activityName, extractColumns, extractPage, learnerIdentity } from "./extract";
import { parseStatements } from "./validate";

export async function ingestStatements(
  storage: Storage,
  body: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const parsed = parseStatements(body);
  if (!parsed.ok) return parsed;

  const stored = now.toISOString();
  const ids: string[] = [];
  const rows = [];

  for (const stmt of parsed.statements) {
    const id = stmt.id ?? crypto.randomUUID();
    ids.push(id);

    const columns = extractColumns(stmt, id, stored);
    if (columns.activityIri) {
      await storage.upsertActivity(columns.activityIri, activityName(stmt), extractPage(stmt));
    }
    const { identity, displayName } = learnerIdentity(stmt.actor);
    const learnerId = await storage.upsertLearner(identity, displayName);

    rows.push({
      ...columns,
      learnerId,
      raw: JSON.stringify({ ...stmt, id, stored }),
    });
  }

  await storage.insertStatements(rows);
  return { ok: true, ids };
}
