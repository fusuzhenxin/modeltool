/**
 * Thresholds and statistical constants, centralized for calibration.
 *
 * Baselines from Bruckner, "One Token Is Enough" (arXiv:2607.10252):
 *  - same model, split-half distance (median)        ≈ 0.140
 *  - same model served by different providers (median) ≈ 0.227
 *  - different models (median)                        ≈ 0.463
 *  - equal error rate: ≈ 10.6% with 8 cells, ≈ 7.3% with 40 cells
 *
 * The match/mismatch cut points below sit between those baselines and leave a
 * deliberate "uncertain" band; they are heuristics, not proofs.
 */

/** meanJsd ≤ this → `match` (paper same-model cross-provider median 0.227, plus margin). */
export const JSD_MATCH_THRESHOLD = 0.25

/**
 * meanJsd > this → `mismatch` (paper different-model median 0.463; impostor
 * distances rarely fall below ≈ 0.3). Between the two thresholds → `uncertain`.
 */
export const JSD_MISMATCH_THRESHOLD = 0.35

/** Paper baseline anchors, exposed for result interpretation. */
export const JSD_BASELINE_SELF = 0.14
export const JSD_BASELINE_CROSS_PROVIDER = 0.227
export const JSD_BASELINE_DIFFERENT_MODEL = 0.463

/** A cell participates in the distance only when both sides have ≥ this many valid samples. */
export const MIN_VALID_SAMPLES_PER_CELL = 10

/** Fewer comparable cells than this → verdict `insufficient`. */
export const MIN_COMPARABLE_CELLS = 4

/** Split-half self check: a cell participates only when each half has ≥ this many valid samples. */
export const MIN_SPLIT_HALF_SAMPLES = 5

/** Split-half JSD above this suggests unstable routing (multi-backend aggregator). */
export const SPLIT_HALF_WARN_THRESHOLD = 0.25

/** Probe request parameters (paper protocol). */
export const PROBE_TEMPERATURE = 1.0
export const PROBE_MAX_TOKENS = 16
/** Fallback max_tokens when reasoning cannot be disabled (post-reasoning channel). */
export const POST_REASONING_MAX_TOKENS = 1024

/** Sampler defaults. */
export const DEFAULT_SAMPLES_PER_CELL = 25
export const DEFAULT_CELL_COUNT = 8
export const DEFAULT_CONCURRENCY = 4
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_RETRIES = 2
/** Abort the run after this many consecutive transport-level failures. */
export const CONSECUTIVE_NETWORK_ERROR_LIMIT = 8

/** Fingerprint artifact identifiers. */
export const FINGERPRINT_FORMAT_VERSION = 1 as const
/** Protocol id for fingerprints collected by this package's battery. */
export const PROBE_PROTOCOL = 'one-token/v1'
/** Protocol id for samples derived from the paper's Zenodo dataset. */
export const ZENODO_PROTOCOL = 'bruckner-zenodo-2026'
