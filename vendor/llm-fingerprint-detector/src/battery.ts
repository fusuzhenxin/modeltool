/**
 * Probe battery: 8 tasks × 2 languages = 16 cells.
 *
 * Design (arXiv:2607.10252):
 *  - ≥3 paraphrases per task per language, drawn at random per request — every
 *    probe is a plain semantic question, so gateways cannot keyword-filter them;
 *  - a fixed minimal system prompt forces a one-word answer; max_tokens=16
 *    truncates stragglers;
 *  - cells are ordered by empirical discriminativeness (random-number tasks
 *    separate models best); presets take a prefix of that order.
 */

import type {
  CellId,
  ProbeLang,
  ProbePreset,
  ProbePresetId,
  ProbeTaskId,
  ProbeTaskSpec,
} from './types.js'

/**
 * Fixed minimal system prompt — a critical invariant.
 *
 * The reference fingerprint and the endpoint under test MUST be collected
 * under the *same* system prompt. Swapping only the system prompt (all else
 * equal) can shift a model's fingerprint by JSD ≈ 0.44–0.46 — the same
 * magnitude as swapping the model itself — which would turn a prompt
 * difference into a false "different model" verdict.
 */
export const SYSTEM_PROMPTS: Record<ProbeLang, string> = {
  en: 'Answer with exactly one word. No punctuation, no explanation.',
  zh: '只回答一个词，不要标点，不要解释。',
}

export const PROBE_TASKS: Record<ProbeTaskId, ProbeTaskSpec> = {
  'random-number-1-100': {
    id: 'random-number-1-100',
    domain: { kind: 'int', min: 1, max: 100 },
    paraphrases: {
      en: [
        'Name a random number between 1 and 100.',
        'Pick a random number from 1 to 100.',
        'Give me a random number between 1 and 100.',
        'Choose any number between 1 and 100 at random.',
      ],
      zh: [
        '说一个 1 到 100 之间的随机数。',
        '随机挑一个 1 到 100 的数字。',
        '给我一个 1 至 100 之间的随机数字。',
        '从 1 到 100 里随便选一个数。',
      ],
    },
  },
  'random-number-1-10': {
    id: 'random-number-1-10',
    domain: { kind: 'int', min: 1, max: 10 },
    paraphrases: {
      en: [
        'Name a random number between 1 and 10.',
        'Pick a random number from 1 to 10.',
        'Give me a random number between 1 and 10.',
      ],
      zh: [
        '说一个 1 到 10 之间的随机数。',
        '随机挑一个 1 到 10 的数字。',
        '从 1 到 10 里随便选一个数。',
      ],
    },
  },
  'random-letter': {
    id: 'random-letter',
    domain: { kind: 'letter' },
    paraphrases: {
      en: [
        'Name a random letter of the alphabet.',
        'Pick a random letter from A to Z.',
        'Give me one random letter.',
      ],
      zh: [
        '说一个随机的英文字母。',
        '从 A 到 Z 里随便挑一个字母。',
        '随机给我一个英文字母。',
      ],
    },
  },
  'random-color': {
    id: 'random-color',
    domain: { kind: 'color' },
    paraphrases: {
      en: [
        'Name a random color.',
        'Pick a color at random.',
        'Give me one random color.',
      ],
      zh: [
        '说一个随机的颜色。',
        '随便说一种颜色。',
        '随机挑一个颜色告诉我。',
      ],
    },
  },
  'coin-flip': {
    id: 'coin-flip',
    domain: { kind: 'coin' },
    paraphrases: {
      en: [
        'Flip a coin. Answer heads or tails.',
        'Toss a coin and tell me the result: heads or tails.',
        'Imagine flipping a coin. Which side came up, heads or tails?',
      ],
      zh: [
        '抛一枚硬币，回答正面还是反面。',
        '掷一次硬币，告诉我结果：正面或反面。',
        '想象抛硬币，落地是正面还是反面？',
      ],
    },
  },
  'random-animal': {
    id: 'random-animal',
    domain: { kind: 'word' },
    paraphrases: {
      en: [
        'Name a random animal.',
        'Pick an animal at random.',
        'Give me one random animal.',
      ],
      zh: [
        '说一个随机的动物。',
        '随便说一种动物。',
        '随机挑一个动物告诉我。',
      ],
    },
  },
  'random-city': {
    id: 'random-city',
    domain: { kind: 'word' },
    paraphrases: {
      en: [
        'Name a random city.',
        'Pick a city at random.',
        'Give me the name of one random city.',
      ],
      zh: [
        '说一个随机的城市。',
        '随便说一座城市。',
        '随机挑一个城市告诉我。',
      ],
    },
  },
  'favorite-number': {
    id: 'favorite-number',
    domain: { kind: 'int', min: 0, max: 10_000 },
    paraphrases: {
      en: [
        'What is your favorite number?',
        'Tell me your favourite number.',
        'If you had to pick a favorite number, what would it be?',
      ],
      zh: [
        '你最喜欢的数字是什么？',
        '说说你最爱的数字。',
        '如果必须选一个最喜欢的数字，你选哪个？',
      ],
    },
  },
}

export function makeCellId(task: ProbeTaskId, lang: ProbeLang): CellId {
  return `${task}:${lang}`
}

export function parseCellId(cellId: CellId): { task: ProbeTaskId; lang: ProbeLang } {
  const idx = cellId.lastIndexOf(':')
  return {
    task: cellId.slice(0, idx) as ProbeTaskId,
    lang: cellId.slice(idx + 1) as ProbeLang,
  }
}

export function isCellId(value: string): value is CellId {
  const idx = value.lastIndexOf(':')
  if (idx <= 0) return false
  const task = value.slice(0, idx)
  const lang = value.slice(idx + 1)
  return task in PROBE_TASKS && (lang === 'en' || lang === 'zh')
}

/**
 * All 16 cells, ordered by discriminativeness (random-number tasks first,
 * per the paper and our own cross-model measurements). Presets take a prefix.
 */
export const CELL_PRIORITY_ORDER: CellId[] = [
  'random-number-1-100:en',
  'random-number-1-100:zh',
  'random-color:en',
  'random-animal:en',
  'random-number-1-10:en',
  'random-letter:en',
  'random-color:zh',
  'coin-flip:en',
  'favorite-number:en',
  'random-city:en',
  'random-number-1-10:zh',
  'coin-flip:zh',
  'random-letter:zh',
  'random-animal:zh',
  'random-city:zh',
  'favorite-number:zh',
]

export const PROBE_PRESETS: Record<ProbePresetId, ProbePreset> = {
  quick: { id: 'quick', cellCount: 4, samplesPerCell: 15 },
  standard: { id: 'standard', cellCount: 8, samplesPerCell: 25 },
  strict: { id: 'strict', cellCount: 16, samplesPerCell: 25 },
}

export function getCellsForPreset(preset: ProbePresetId): CellId[] {
  return CELL_PRIORITY_ORDER.slice(0, PROBE_PRESETS[preset].cellCount)
}

export function getTaskSpec(cellId: CellId): ProbeTaskSpec {
  return PROBE_TASKS[parseCellId(cellId).task]
}

export function getSystemPrompt(cellId: CellId): string {
  return SYSTEM_PROMPTS[parseCellId(cellId).lang]
}

export function pickParaphrase(cellId: CellId, random: () => number = Math.random): string {
  const { task, lang } = parseCellId(cellId)
  const pool = PROBE_TASKS[task].paraphrases[lang]
  return pool[Math.floor(random() * pool.length)] ?? pool[0]
}
