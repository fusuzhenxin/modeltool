/**
 * Answer normalization pipeline (pure functions):
 *
 *   NFC → trim → refusal detection → strip punctuation/quotes/emoji
 *     → case fold → take first word
 *     → digit unification (Chinese numerals / English number words /
 *       full-width and Arabic-Indic digits → Latin digits)
 *     → color canonicalization (蓝色→蓝, grey→gray)
 *     → coin folding (正/正面/heads → heads)
 *
 * Categories: valid (inside the cell's answer domain) / invalid / refusal /
 * empty. Models frequently answer "seven", "四十二" or "forty-two" instead of
 * "7"/"42", so variants must be folded before distributions are compared.
 */

import type { AnswerDomain, SampleCategory } from './types.js'

const REFUSAL_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\bi (?:cannot|can't|can not|won't|will not)\b/i,
  /\bi'?m (?:unable|not able|sorry)\b/i,
  /\bsorry,? (?:i|but)\b/i,
  /\bcannot (?:comply|assist|help)\b/i,
  /我不能/,
  /我无法/,
  /无法回答/,
  /不能回答/,
  /抱歉/,
  /对不起/,
  /作为(?:一个)?(?:AI|人工智能)/i,
]

/**
 * Remove everything that is not a letter, digit or whitespace (quotes,
 * punctuation, emoji). In-word hyphens are removed too: forty-seven → fortyseven.
 */
function stripPunctuation(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s]/gu, '')
}

/** Full-width and Arabic-Indic digits → Latin digits. */
function normalizeDigitScript(value: string): string {
  return value.replace(/[\uFF10-\uFF19\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0)
    if (code >= 0xff10 && code <= 0xff19) return String(code - 0xff10)
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
    return String(code - 0x06f0)
  })
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** Chinese numerals (一二三…百/千, incl. 两) → number; null when not a pure numeral. */
export function parseChineseNumeral(value: string): number | null {
  if (!value || !/^[零〇一二两三四五六七八九十百千]+$/.test(value)) return null
  let total = 0
  let current = 0
  for (const ch of value) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch]
    } else {
      const unit = CN_UNITS[ch]
      // A leading 十 (十, 十五) counts as 1 × 10.
      total += (current === 0 ? 1 : current) * unit
      current = 0
    }
  }
  return total + current
}

const EN_ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
}
const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
}

/**
 * English number words → number, including de-hyphenated compounds
 * (fortyseven, onehundred). Null when unparseable.
 */
export function parseEnglishNumberWord(value: string): number | null {
  const word = value.toLowerCase()
  if (word in EN_ONES) return EN_ONES[word]
  if (word in EN_TENS) return EN_TENS[word]
  if (word === 'hundred' || word === 'onehundred') return 100
  for (const [tens, tensValue] of Object.entries(EN_TENS)) {
    if (word.startsWith(tens)) {
      const rest = word.slice(tens.length)
      if (rest in EN_ONES && EN_ONES[rest] >= 1 && EN_ONES[rest] <= 9) {
        return tensValue + EN_ONES[rest]
      }
    }
  }
  return null
}

/** Any-format number parsing: Latin digits / Chinese numerals / English words. */
export function parseAnyNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const cn = parseChineseNumeral(value)
  if (cn !== null) return cn
  return parseEnglishNumberWord(value)
}

/** English letter names → letter (zee/kay/queue and friends show up in the wild). */
const EN_LETTER_NAMES: Record<string, string> = {
  bee: 'b', cee: 'c', dee: 'd', gee: 'g', jay: 'j', kay: 'k',
  el: 'l', ell: 'l', em: 'm', en: 'n', oh: 'o', pee: 'p',
  cue: 'q', queue: 'q', ar: 'r', es: 's', ess: 's', tee: 't',
  vee: 'v', ex: 'x', why: 'y', zee: 'z', zed: 'z',
}

/** Color variant folding (within a language). */
const EN_COLOR_ALIASES: Record<string, string> = {
  grey: 'gray',
  aqua: 'cyan',
}

function normalizeColorWord(word: string): string {
  if (EN_COLOR_ALIASES[word]) return EN_COLOR_ALIASES[word]
  // Chinese: 蓝色→蓝, 青色→青 (multi-character names keep their stem; 靛蓝/蔚蓝 unchanged).
  if (/^[\u4e00-\u9fff]{2,}$/.test(word) && word.endsWith('色')) {
    return word.slice(0, -1)
  }
  return word
}

const COIN_HEADS = new Set(['heads', 'head', '正', '正面', '字'])
const COIN_TAILS = new Set(['tails', 'tail', '反', '反面', '花'])

function normalizeCoinWord(word: string): string | null {
  if (COIN_HEADS.has(word)) return 'heads'
  if (COIN_TAILS.has(word)) return 'tails'
  if (/^正面?/.test(word)) return 'heads'
  if (/^反面?/.test(word)) return 'tails'
  return null
}

export interface NormalizedAnswer {
  normalized: string | null
  category: Exclude<SampleCategory, 'error'>
}

/** Main entry point: raw completion text + the cell's answer domain → normalized answer + category. */
export function normalizeAnswer(raw: string, domain: AnswerDomain): NormalizedAnswer {
  const nfc = (raw ?? '').normalize('NFC').trim()
  if (!nfc) return { normalized: null, category: 'empty' }

  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(nfc))) {
    return { normalized: null, category: 'refusal' }
  }

  const cleaned = normalizeDigitScript(stripPunctuation(nfc)).toLowerCase().trim()
  if (!cleaned) return { normalized: null, category: 'empty' }

  // First whitespace-separated word (Chinese text without spaces is one word).
  const firstWord = cleaned.split(/\s+/)[0]
  if (!firstWord) return { normalized: null, category: 'empty' }

  switch (domain.kind) {
    case 'int': {
      const num = parseAnyNumber(firstWord)
      if (num === null) return { normalized: firstWord, category: 'invalid' }
      if (num < domain.min || num > domain.max) {
        return { normalized: String(num), category: 'invalid' }
      }
      return { normalized: String(num), category: 'valid' }
    }
    case 'letter': {
      const mapped = EN_LETTER_NAMES[firstWord] ?? firstWord
      if (/^[a-z]$/.test(mapped)) return { normalized: mapped, category: 'valid' }
      return { normalized: firstWord, category: 'invalid' }
    }
    case 'color': {
      const color = normalizeColorWord(firstWord)
      if (/^(?:[a-z]+|[\u4e00-\u9fff]{1,4})$/.test(color)) {
        return { normalized: color, category: 'valid' }
      }
      return { normalized: firstWord, category: 'invalid' }
    }
    case 'coin': {
      const coin = normalizeCoinWord(firstWord)
      if (coin) return { normalized: coin, category: 'valid' }
      return { normalized: firstWord, category: 'invalid' }
    }
    case 'word': {
      // Word tasks (animal/city): a single Latin word or a CJK word of ≤6 chars.
      if (/^(?:[a-z]+|[\u4e00-\u9fff]{1,6})$/.test(firstWord)) {
        return { normalized: firstWord, category: 'valid' }
      }
      return { normalized: firstWord, category: 'invalid' }
    }
  }
}
