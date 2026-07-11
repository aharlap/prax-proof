// SPDX-License-Identifier: MIT
import type { Env } from "./env";
import { D1Storage } from "./storage/d1";

export async function runRetention(env: Env, maxBatches = 20): Promise<number> {
  const storage = new D1Storage(env.DB);
  const settings = await storage.getSettings();
  const cutoff = new Date(Date.now() - settings.retentionDays * 86400000).toISOString();
  let total = 0;
  for (let batch = 0; batch < Math.max(1, Math.min(20, maxBatches)); batch++) {
    const deleted = await storage.deleteExpiredStatements(cutoff, 1000);
    total += deleted;
    if (deleted < 1000) break;
  }
  await storage.cleanupRetention(cutoff);
  return total;
}
