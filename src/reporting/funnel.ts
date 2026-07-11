// SPDX-License-Identifier: MIT
import type { FunnelStep } from "../storage/types";

export interface ReportingFunnelRow {
  step: string;
  label: string;
  learners: number;
  retention: number | null;
  dropOff: number;
}

export function buildFunnelRows(
  participants: number,
  completions: number,
  participantDropOff: number,
  steps: FunnelStep[],
  labels: Record<string, string>,
  humanize: (step: string) => string,
): ReportingFunnelRow[] {
  if (steps.length === 0) return [];
  const retention = (learners: number) => participants > 0 ? learners / participants : null;
  return [
    {
      step: "__participants__",
      label: "Participants",
      learners: participants,
      retention: retention(participants),
      dropOff: participantDropOff,
    },
    ...steps.map((row) => ({
      step: row.step,
      label: labels[row.step] ?? humanize(row.step),
      learners: row.learners,
      retention: retention(row.learners),
      dropOff: row.dropOff,
    })),
    {
      step: "__finished__",
      label: "Finished",
      learners: completions,
      retention: retention(completions),
      dropOff: 0,
    },
  ];
}
