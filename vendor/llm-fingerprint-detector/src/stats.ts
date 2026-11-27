/**
 * Statistics: Shannon entropy, Jensen-Shannon divergence (base 2, not
 * square-rooted, so per-cell values live in [0, 1] bit), distribution
 * aggregation and the split-half self check.
 *
 * Distance between two fingerprints (arXiv:2607.10252): the mean of per-cell
 * JSD over all cells where both sides have enough valid samples.
 */

import { MIN_SPLIT_HALF_SAMPLES, MIN_VALID_SAMPLES_PER_CELL } from './constants.js'
import type { AnswerDomain, CellDistribution, CellId, SampleResult } from './types.js'

export type CountMap = Record<string, number>

/** Shannon entropy in bits. */
export function shannonEntropyBits(counts: CountMap): number {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  if (total <= 0) return 0
  let entropy = 0
  for (const n of Object.values(counts)) {
    if (n <= 0) continue
    const p = n / total
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/** Nominal domain size (denominator log2(size) for normalized entropy). */
export function domainSize(domain: AnswerDomain): number {
  switch (domain.kind) {
    case 'int':
      return Math.max(2, domain.max - domain.min + 1)
    case 'letter':
      return 26
    case 'coin':
      return 2
    case 'color':
      return 30
    case 'word':
      return 50
  }
}

/**
 * Jensen-Shannon divergence, base 2: JSD(P,Q) = H(M) − (H(P)+H(Q))/2 with
 * M = (P+Q)/2, over the union of both supports. Range [0, 1] bit.
 */
export function jensenShannonDivergence(countsP: CountMap, countsQ: CountMap): number {
  const totalP = Object.values(countsP).reduce((sum, n) => sum + n, 0)
  const totalQ = Object.values(countsQ).reduce((sum, n) => sum + n, 0)
  if (totalP <= 0 || totalQ <= 0) return 0

  const support = new Set([...Object.keys(countsP), ...Object.keys(countsQ)])
  let hM = 0
  let hP = 0
  let hQ = 0
  for (const key of support) {
    const p = (countsP[key] ?? 0) / totalP
    const q = (countsQ[key] ?? 0) / totalQ
    const m = (p + q) / 2
    if (m > 0) hM -= m * Math.log2(m)
    if (p > 0) hP -= p * Math.log2(p)
    if (q > 0) hQ -= q * Math.log2(q)
  }
  const jsd = hM - (hP + hQ) / 2
  // Clamp numerical noise.
  return Math.min(1, Math.max(0, jsd))
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Aggregate raw samples into one cell's distribution. */
export function buildCellDistribution(
  cellId: CellId,
  samples: SampleResult[],
  domain: AnswerDomain,
): CellDistribution {
  const counts: CountMap = {}
  let validCount = 0
  let invalidCount = 0
  let refusalCount = 0
  let emptyCount = 0
  let errorCount = 0
  const latenciesMs: number[] = []
  let completionTokensSum = 0
  let completionTokensN = 0
  let reasoningTokensSum = 0
  let reasoningTokensN = 0

  for (const sample of samples) {
    switch (sample.category) {
      case 'valid':
        validCount += 1
        if (sample.normalized !== null) {
          counts[sample.normalized] = (counts[sample.normalized] ?? 0) + 1
        }
        break
      case 'invalid':
        invalidCount += 1
        break
      case 'refusal':
        refusalCount += 1
        break
      case 'empty':
        emptyCount += 1
        break
      case 'error':
        errorCount += 1
        break
    }
    if (sample.category !== 'error') {
      latenciesMs.push(sample.latencyMs)
      if (sample.usage?.completionTokens != null) {
        completionTokensSum += sample.usage.completionTokens
        completionTokensN += 1
      }
      if (sample.usage?.reasoningTokens != null) {
        reasoningTokensSum += sample.usage.reasoningTokens
        reasoningTokensN += 1
      }
    }
  }

  const entropyBits = shannonEntropyBits(counts)
  const size = domainSize(domain)

  return {
    cellId,
    counts,
    validCount,
    invalidCount,
    refusalCount,
    emptyCount,
    errorCount,
    totalCount: samples.length,
    entropyBits,
    normalizedEntropy: size > 1 ? Math.min(1, entropyBits / Math.log2(size)) : 0,
    medianLatencyMs: median(latenciesMs),
    meanCompletionTokens: completionTokensN > 0 ? completionTokensSum / completionTokensN : null,
    meanReasoningTokens: reasoningTokensN > 0 ? reasoningTokensSum / reasoningTokensN : null,
  }
}

export interface CellJsdEntry {
  cellId: CellId
  jsd: number
  validA: number
  validB: number
}

/**
 * Distance between two fingerprint cell sets: mean JSD over cells where both
 * sides have ≥ minValidSamples valid samples. Returns per-cell details sorted
 * by descending JSD.
 */
export function compareCellSets(
  cellsA: Partial<Record<CellId, { counts: CountMap; validCount: number }>>,
  cellsB: Partial<Record<CellId, { counts: CountMap; validCount: number }>>,
  minValidSamples: number = MIN_VALID_SAMPLES_PER_CELL,
): { entries: CellJsdEntry[]; meanJsd: number | null } {
  const entries: CellJsdEntry[] = []
  for (const cellId of Object.keys(cellsA) as CellId[]) {
    const a = cellsA[cellId]
    const b = cellsB[cellId]
    if (!a || !b) continue
    if (a.validCount < minValidSamples || b.validCount < minValidSamples) continue
    entries.push({
      cellId,
      jsd: jensenShannonDivergence(a.counts, b.counts),
      validA: a.validCount,
      validB: b.validCount,
    })
  }
  entries.sort((x, y) => y.jsd - x.jsd)
  const meanJsd =
    entries.length > 0
      ? entries.reduce((sum, entry) => sum + entry.jsd, 0) / entries.length
      : null
  return { entries, meanJsd }
}

/**
 * Split-half self check: split each cell's valid samples by arrival parity
 * and measure the JSD between the halves. Values far above the same-model
 * baseline (≈ 0.14) indicate the endpoint itself is unstable — a hint that an
 * aggregator is rotating between different backends.
 */
export function splitHalfJsd(
  samplesByCell: Map<CellId, SampleResult[]>,
  minPerHalf: number = MIN_SPLIT_HALF_SAMPLES,
): number | null {
  const cellJsds: number[] = []
  for (const samples of samplesByCell.values()) {
    const even: CountMap = {}
    const odd: CountMap = {}
    let evenN = 0
    let oddN = 0
    for (const sample of samples) {
      if (sample.category !== 'valid' || sample.normalized === null) continue
      if (sample.arrivalIndex % 2 === 0) {
        even[sample.normalized] = (even[sample.normalized] ?? 0) + 1
        evenN += 1
      } else {
        odd[sample.normalized] = (odd[sample.normalized] ?? 0) + 1
        oddN += 1
      }
    }
    if (evenN >= minPerHalf && oddN >= minPerHalf) {
      cellJsds.push(jensenShannonDivergence(even, odd))
    }
  }
  if (cellJsds.length === 0) return null
  return cellJsds.reduce((sum, jsd) => sum + jsd, 0) / cellJsds.length
}
