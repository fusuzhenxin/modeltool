/**
 * Verdict: meanJsd → three-way conclusion (match / uncertain / mismatch),
 * or `insufficient` when too few cells are comparable.
 *
 * Threshold provenance (see constants.ts): the paper reports a same-model
 * cross-provider median distance of ≈ 0.227 and a different-model median of
 * ≈ 0.463; the cut points 0.25 / 0.35 sit between those with a deliberate
 * uncertainty band. Verdicts are statistical evidence, not proof.
 */

import {
  JSD_BASELINE_CROSS_PROVIDER,
  JSD_BASELINE_DIFFERENT_MODEL,
  JSD_BASELINE_SELF,
  JSD_MATCH_THRESHOLD,
  JSD_MISMATCH_THRESHOLD,
  MIN_COMPARABLE_CELLS,
} from './constants.js'
import type { CellJsdEntry } from './stats.js'
import type { CellComparison, ComparisonResult, VerdictLevel } from './types.js'

export function decideVerdict(meanJsd: number | null, comparableCellCount: number): VerdictLevel {
  if (meanJsd === null || comparableCellCount < MIN_COMPARABLE_CELLS) return 'insufficient'
  if (meanJsd <= JSD_MATCH_THRESHOLD) return 'match'
  if (meanJsd <= JSD_MISMATCH_THRESHOLD) return 'uncertain'
  return 'mismatch'
}

export function buildComparisonResult(
  entries: CellJsdEntry[],
  meanJsd: number | null,
  protocolMismatch: boolean,
): ComparisonResult {
  const cells: CellComparison[] = entries.map((entry) => ({
    cellId: entry.cellId,
    jsd: entry.jsd,
    validA: entry.validA,
    validB: entry.validB,
  }))
  return {
    meanJsd,
    verdict: decideVerdict(meanJsd, entries.length),
    cells,
    comparableCellCount: entries.length,
    protocolMismatch,
    thresholds: { match: JSD_MATCH_THRESHOLD, mismatch: JSD_MISMATCH_THRESHOLD },
    baselines: {
      sameModelSelf: JSD_BASELINE_SELF,
      sameModelCrossProvider: JSD_BASELINE_CROSS_PROVIDER,
      differentModel: JSD_BASELINE_DIFFERENT_MODEL,
    },
  }
}
