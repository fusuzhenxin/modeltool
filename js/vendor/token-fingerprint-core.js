// Generated from vendored MIT sources. See vendor/README.md. Do not edit.
var TokenFingerprintCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // vendor/llm-fingerprint-detector/entry.ts
  var entry_exports = {};
  __export(entry_exports, {
    CELL_PRIORITY_ORDER: () => CELL_PRIORITY_ORDER,
    PROBE_PROTOCOL: () => PROBE_PROTOCOL,
    buildCellDistribution: () => buildCellDistribution,
    buildComparisonResult: () => buildComparisonResult,
    compareCellSets: () => compareCellSets,
    getSystemPrompt: () => getSystemPrompt,
    getTaskSpec: () => getTaskSpec,
    normalizeAnswer: () => normalizeAnswer,
    pickParaphrase: () => pickParaphrase,
    splitHalfJsd: () => splitHalfJsd
  });

  // vendor/llm-fingerprint-detector/src/battery.ts
  var SYSTEM_PROMPTS = {
    en: "Answer with exactly one word. No punctuation, no explanation.",
    zh: "\u53EA\u56DE\u7B54\u4E00\u4E2A\u8BCD\uFF0C\u4E0D\u8981\u6807\u70B9\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002"
  };
  var PROBE_TASKS = {
    "random-number-1-100": {
      id: "random-number-1-100",
      domain: { kind: "int", min: 1, max: 100 },
      paraphrases: {
        en: [
          "Name a random number between 1 and 100.",
          "Pick a random number from 1 to 100.",
          "Give me a random number between 1 and 100.",
          "Choose any number between 1 and 100 at random."
        ],
        zh: [
          "\u8BF4\u4E00\u4E2A 1 \u5230 100 \u4E4B\u95F4\u7684\u968F\u673A\u6570\u3002",
          "\u968F\u673A\u6311\u4E00\u4E2A 1 \u5230 100 \u7684\u6570\u5B57\u3002",
          "\u7ED9\u6211\u4E00\u4E2A 1 \u81F3 100 \u4E4B\u95F4\u7684\u968F\u673A\u6570\u5B57\u3002",
          "\u4ECE 1 \u5230 100 \u91CC\u968F\u4FBF\u9009\u4E00\u4E2A\u6570\u3002"
        ]
      }
    },
    "random-number-1-10": {
      id: "random-number-1-10",
      domain: { kind: "int", min: 1, max: 10 },
      paraphrases: {
        en: [
          "Name a random number between 1 and 10.",
          "Pick a random number from 1 to 10.",
          "Give me a random number between 1 and 10."
        ],
        zh: [
          "\u8BF4\u4E00\u4E2A 1 \u5230 10 \u4E4B\u95F4\u7684\u968F\u673A\u6570\u3002",
          "\u968F\u673A\u6311\u4E00\u4E2A 1 \u5230 10 \u7684\u6570\u5B57\u3002",
          "\u4ECE 1 \u5230 10 \u91CC\u968F\u4FBF\u9009\u4E00\u4E2A\u6570\u3002"
        ]
      }
    },
    "random-letter": {
      id: "random-letter",
      domain: { kind: "letter" },
      paraphrases: {
        en: [
          "Name a random letter of the alphabet.",
          "Pick a random letter from A to Z.",
          "Give me one random letter."
        ],
        zh: [
          "\u8BF4\u4E00\u4E2A\u968F\u673A\u7684\u82F1\u6587\u5B57\u6BCD\u3002",
          "\u4ECE A \u5230 Z \u91CC\u968F\u4FBF\u6311\u4E00\u4E2A\u5B57\u6BCD\u3002",
          "\u968F\u673A\u7ED9\u6211\u4E00\u4E2A\u82F1\u6587\u5B57\u6BCD\u3002"
        ]
      }
    },
    "random-color": {
      id: "random-color",
      domain: { kind: "color" },
      paraphrases: {
        en: [
          "Name a random color.",
          "Pick a color at random.",
          "Give me one random color."
        ],
        zh: [
          "\u8BF4\u4E00\u4E2A\u968F\u673A\u7684\u989C\u8272\u3002",
          "\u968F\u4FBF\u8BF4\u4E00\u79CD\u989C\u8272\u3002",
          "\u968F\u673A\u6311\u4E00\u4E2A\u989C\u8272\u544A\u8BC9\u6211\u3002"
        ]
      }
    },
    "coin-flip": {
      id: "coin-flip",
      domain: { kind: "coin" },
      paraphrases: {
        en: [
          "Flip a coin. Answer heads or tails.",
          "Toss a coin and tell me the result: heads or tails.",
          "Imagine flipping a coin. Which side came up, heads or tails?"
        ],
        zh: [
          "\u629B\u4E00\u679A\u786C\u5E01\uFF0C\u56DE\u7B54\u6B63\u9762\u8FD8\u662F\u53CD\u9762\u3002",
          "\u63B7\u4E00\u6B21\u786C\u5E01\uFF0C\u544A\u8BC9\u6211\u7ED3\u679C\uFF1A\u6B63\u9762\u6216\u53CD\u9762\u3002",
          "\u60F3\u8C61\u629B\u786C\u5E01\uFF0C\u843D\u5730\u662F\u6B63\u9762\u8FD8\u662F\u53CD\u9762\uFF1F"
        ]
      }
    },
    "random-animal": {
      id: "random-animal",
      domain: { kind: "word" },
      paraphrases: {
        en: [
          "Name a random animal.",
          "Pick an animal at random.",
          "Give me one random animal."
        ],
        zh: [
          "\u8BF4\u4E00\u4E2A\u968F\u673A\u7684\u52A8\u7269\u3002",
          "\u968F\u4FBF\u8BF4\u4E00\u79CD\u52A8\u7269\u3002",
          "\u968F\u673A\u6311\u4E00\u4E2A\u52A8\u7269\u544A\u8BC9\u6211\u3002"
        ]
      }
    },
    "random-city": {
      id: "random-city",
      domain: { kind: "word" },
      paraphrases: {
        en: [
          "Name a random city.",
          "Pick a city at random.",
          "Give me the name of one random city."
        ],
        zh: [
          "\u8BF4\u4E00\u4E2A\u968F\u673A\u7684\u57CE\u5E02\u3002",
          "\u968F\u4FBF\u8BF4\u4E00\u5EA7\u57CE\u5E02\u3002",
          "\u968F\u673A\u6311\u4E00\u4E2A\u57CE\u5E02\u544A\u8BC9\u6211\u3002"
        ]
      }
    },
    "favorite-number": {
      id: "favorite-number",
      domain: { kind: "int", min: 0, max: 1e4 },
      paraphrases: {
        en: [
          "What is your favorite number?",
          "Tell me your favourite number.",
          "If you had to pick a favorite number, what would it be?"
        ],
        zh: [
          "\u4F60\u6700\u559C\u6B22\u7684\u6570\u5B57\u662F\u4EC0\u4E48\uFF1F",
          "\u8BF4\u8BF4\u4F60\u6700\u7231\u7684\u6570\u5B57\u3002",
          "\u5982\u679C\u5FC5\u987B\u9009\u4E00\u4E2A\u6700\u559C\u6B22\u7684\u6570\u5B57\uFF0C\u4F60\u9009\u54EA\u4E2A\uFF1F"
        ]
      }
    }
  };
  function parseCellId(cellId) {
    const idx = cellId.lastIndexOf(":");
    return {
      task: cellId.slice(0, idx),
      lang: cellId.slice(idx + 1)
    };
  }
  var CELL_PRIORITY_ORDER = [
    "random-number-1-100:en",
    "random-number-1-100:zh",
    "random-color:en",
    "random-animal:en",
    "random-number-1-10:en",
    "random-letter:en",
    "random-color:zh",
    "coin-flip:en",
    "favorite-number:en",
    "random-city:en",
    "random-number-1-10:zh",
    "coin-flip:zh",
    "random-letter:zh",
    "random-animal:zh",
    "random-city:zh",
    "favorite-number:zh"
  ];
  function getTaskSpec(cellId) {
    return PROBE_TASKS[parseCellId(cellId).task];
  }
  function getSystemPrompt(cellId) {
    return SYSTEM_PROMPTS[parseCellId(cellId).lang];
  }
  function pickParaphrase(cellId, random = Math.random) {
    const { task, lang } = parseCellId(cellId);
    const pool = PROBE_TASKS[task].paraphrases[lang];
    return pool[Math.floor(random() * pool.length)] ?? pool[0];
  }

  // vendor/llm-fingerprint-detector/src/normalizer.ts
  var REFUSAL_PATTERNS = [
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
    /作为(?:一个)?(?:AI|人工智能)/i
  ];
  function stripPunctuation(value) {
    return value.replace(/[^\p{L}\p{N}\s]/gu, "");
  }
  function normalizeDigitScript(value) {
    return value.replace(/[\uFF10-\uFF19\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 65296 && code <= 65305) return String(code - 65296);
      if (code >= 1632 && code <= 1641) return String(code - 1632);
      return String(code - 1776);
    });
  }
  var CN_DIGITS = {
    \u96F6: 0,
    "\u3007": 0,
    \u4E00: 1,
    \u4E8C: 2,
    \u4E24: 2,
    \u4E09: 3,
    \u56DB: 4,
    \u4E94: 5,
    \u516D: 6,
    \u4E03: 7,
    \u516B: 8,
    \u4E5D: 9
  };
  var CN_UNITS = { \u5341: 10, \u767E: 100, \u5343: 1e3 };
  function parseChineseNumeral(value) {
    if (!value || !/^[零〇一二两三四五六七八九十百千]+$/.test(value)) return null;
    let total = 0;
    let current = 0;
    for (const ch of value) {
      if (ch in CN_DIGITS) {
        current = CN_DIGITS[ch];
      } else {
        const unit = CN_UNITS[ch];
        total += (current === 0 ? 1 : current) * unit;
        current = 0;
      }
    }
    return total + current;
  }
  var EN_ONES = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19
  };
  var EN_TENS = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90
  };
  function parseEnglishNumberWord(value) {
    const word = value.toLowerCase();
    if (word in EN_ONES) return EN_ONES[word];
    if (word in EN_TENS) return EN_TENS[word];
    if (word === "hundred" || word === "onehundred") return 100;
    for (const [tens, tensValue] of Object.entries(EN_TENS)) {
      if (word.startsWith(tens)) {
        const rest = word.slice(tens.length);
        if (rest in EN_ONES && EN_ONES[rest] >= 1 && EN_ONES[rest] <= 9) {
          return tensValue + EN_ONES[rest];
        }
      }
    }
    return null;
  }
  function parseAnyNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const cn = parseChineseNumeral(value);
    if (cn !== null) return cn;
    return parseEnglishNumberWord(value);
  }
  var EN_LETTER_NAMES = {
    bee: "b",
    cee: "c",
    dee: "d",
    gee: "g",
    jay: "j",
    kay: "k",
    el: "l",
    ell: "l",
    em: "m",
    en: "n",
    oh: "o",
    pee: "p",
    cue: "q",
    queue: "q",
    ar: "r",
    es: "s",
    ess: "s",
    tee: "t",
    vee: "v",
    ex: "x",
    why: "y",
    zee: "z",
    zed: "z"
  };
  var EN_COLOR_ALIASES = {
    grey: "gray",
    aqua: "cyan"
  };
  function normalizeColorWord(word) {
    if (EN_COLOR_ALIASES[word]) return EN_COLOR_ALIASES[word];
    if (/^[\u4e00-\u9fff]{2,}$/.test(word) && word.endsWith("\u8272")) {
      return word.slice(0, -1);
    }
    return word;
  }
  var COIN_HEADS = /* @__PURE__ */ new Set(["heads", "head", "\u6B63", "\u6B63\u9762", "\u5B57"]);
  var COIN_TAILS = /* @__PURE__ */ new Set(["tails", "tail", "\u53CD", "\u53CD\u9762", "\u82B1"]);
  function normalizeCoinWord(word) {
    if (COIN_HEADS.has(word)) return "heads";
    if (COIN_TAILS.has(word)) return "tails";
    if (/^正面?/.test(word)) return "heads";
    if (/^反面?/.test(word)) return "tails";
    return null;
  }
  function normalizeAnswer(raw, domain) {
    const nfc = (raw ?? "").normalize("NFC").trim();
    if (!nfc) return { normalized: null, category: "empty" };
    if (REFUSAL_PATTERNS.some((pattern) => pattern.test(nfc))) {
      return { normalized: null, category: "refusal" };
    }
    const cleaned = normalizeDigitScript(stripPunctuation(nfc)).toLowerCase().trim();
    if (!cleaned) return { normalized: null, category: "empty" };
    const firstWord = cleaned.split(/\s+/)[0];
    if (!firstWord) return { normalized: null, category: "empty" };
    switch (domain.kind) {
      case "int": {
        const num = parseAnyNumber(firstWord);
        if (num === null) return { normalized: firstWord, category: "invalid" };
        if (num < domain.min || num > domain.max) {
          return { normalized: String(num), category: "invalid" };
        }
        return { normalized: String(num), category: "valid" };
      }
      case "letter": {
        const mapped = EN_LETTER_NAMES[firstWord] ?? firstWord;
        if (/^[a-z]$/.test(mapped)) return { normalized: mapped, category: "valid" };
        return { normalized: firstWord, category: "invalid" };
      }
      case "color": {
        const color = normalizeColorWord(firstWord);
        if (/^(?:[a-z]+|[\u4e00-\u9fff]{1,4})$/.test(color)) {
          return { normalized: color, category: "valid" };
        }
        return { normalized: firstWord, category: "invalid" };
      }
      case "coin": {
        const coin = normalizeCoinWord(firstWord);
        if (coin) return { normalized: coin, category: "valid" };
        return { normalized: firstWord, category: "invalid" };
      }
      case "word": {
        if (/^(?:[a-z]+|[\u4e00-\u9fff]{1,6})$/.test(firstWord)) {
          return { normalized: firstWord, category: "valid" };
        }
        return { normalized: firstWord, category: "invalid" };
      }
    }
  }

  // vendor/llm-fingerprint-detector/src/constants.ts
  var JSD_MATCH_THRESHOLD = 0.25;
  var JSD_MISMATCH_THRESHOLD = 0.35;
  var JSD_BASELINE_SELF = 0.14;
  var JSD_BASELINE_CROSS_PROVIDER = 0.227;
  var JSD_BASELINE_DIFFERENT_MODEL = 0.463;
  var MIN_VALID_SAMPLES_PER_CELL = 10;
  var MIN_COMPARABLE_CELLS = 4;
  var MIN_SPLIT_HALF_SAMPLES = 5;
  var PROBE_PROTOCOL = "one-token/v1";

  // vendor/llm-fingerprint-detector/src/stats.ts
  function shannonEntropyBits(counts) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total <= 0) return 0;
    let entropy = 0;
    for (const n of Object.values(counts)) {
      if (n <= 0) continue;
      const p = n / total;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }
  function domainSize(domain) {
    switch (domain.kind) {
      case "int":
        return Math.max(2, domain.max - domain.min + 1);
      case "letter":
        return 26;
      case "coin":
        return 2;
      case "color":
        return 30;
      case "word":
        return 50;
    }
  }
  function jensenShannonDivergence(countsP, countsQ) {
    const totalP = Object.values(countsP).reduce((sum, n) => sum + n, 0);
    const totalQ = Object.values(countsQ).reduce((sum, n) => sum + n, 0);
    if (totalP <= 0 || totalQ <= 0) return 0;
    const support = /* @__PURE__ */ new Set([...Object.keys(countsP), ...Object.keys(countsQ)]);
    let hM = 0;
    let hP = 0;
    let hQ = 0;
    for (const key of support) {
      const p = (countsP[key] ?? 0) / totalP;
      const q = (countsQ[key] ?? 0) / totalQ;
      const m = (p + q) / 2;
      if (m > 0) hM -= m * Math.log2(m);
      if (p > 0) hP -= p * Math.log2(p);
      if (q > 0) hQ -= q * Math.log2(q);
    }
    const jsd = hM - (hP + hQ) / 2;
    return Math.min(1, Math.max(0, jsd));
  }
  function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  function buildCellDistribution(cellId, samples, domain) {
    const counts = {};
    let validCount = 0;
    let invalidCount = 0;
    let refusalCount = 0;
    let emptyCount = 0;
    let errorCount = 0;
    const latenciesMs = [];
    let completionTokensSum = 0;
    let completionTokensN = 0;
    let reasoningTokensSum = 0;
    let reasoningTokensN = 0;
    for (const sample of samples) {
      switch (sample.category) {
        case "valid":
          validCount += 1;
          if (sample.normalized !== null) {
            counts[sample.normalized] = (counts[sample.normalized] ?? 0) + 1;
          }
          break;
        case "invalid":
          invalidCount += 1;
          break;
        case "refusal":
          refusalCount += 1;
          break;
        case "empty":
          emptyCount += 1;
          break;
        case "error":
          errorCount += 1;
          break;
      }
      if (sample.category !== "error") {
        latenciesMs.push(sample.latencyMs);
        if (sample.usage?.completionTokens != null) {
          completionTokensSum += sample.usage.completionTokens;
          completionTokensN += 1;
        }
        if (sample.usage?.reasoningTokens != null) {
          reasoningTokensSum += sample.usage.reasoningTokens;
          reasoningTokensN += 1;
        }
      }
    }
    const entropyBits = shannonEntropyBits(counts);
    const size = domainSize(domain);
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
      meanReasoningTokens: reasoningTokensN > 0 ? reasoningTokensSum / reasoningTokensN : null
    };
  }
  function compareCellSets(cellsA, cellsB, minValidSamples = MIN_VALID_SAMPLES_PER_CELL) {
    const entries = [];
    for (const cellId of Object.keys(cellsA)) {
      const a = cellsA[cellId];
      const b = cellsB[cellId];
      if (!a || !b) continue;
      if (a.validCount < minValidSamples || b.validCount < minValidSamples) continue;
      entries.push({
        cellId,
        jsd: jensenShannonDivergence(a.counts, b.counts),
        validA: a.validCount,
        validB: b.validCount
      });
    }
    entries.sort((x, y) => y.jsd - x.jsd);
    const meanJsd = entries.length > 0 ? entries.reduce((sum, entry) => sum + entry.jsd, 0) / entries.length : null;
    return { entries, meanJsd };
  }
  function splitHalfJsd(samplesByCell, minPerHalf = MIN_SPLIT_HALF_SAMPLES) {
    const cellJsds = [];
    for (const samples of samplesByCell.values()) {
      const even = {};
      const odd = {};
      let evenN = 0;
      let oddN = 0;
      for (const sample of samples) {
        if (sample.category !== "valid" || sample.normalized === null) continue;
        if (sample.arrivalIndex % 2 === 0) {
          even[sample.normalized] = (even[sample.normalized] ?? 0) + 1;
          evenN += 1;
        } else {
          odd[sample.normalized] = (odd[sample.normalized] ?? 0) + 1;
          oddN += 1;
        }
      }
      if (evenN >= minPerHalf && oddN >= minPerHalf) {
        cellJsds.push(jensenShannonDivergence(even, odd));
      }
    }
    if (cellJsds.length === 0) return null;
    return cellJsds.reduce((sum, jsd) => sum + jsd, 0) / cellJsds.length;
  }

  // vendor/llm-fingerprint-detector/src/verdict.ts
  function decideVerdict(meanJsd, comparableCellCount) {
    if (meanJsd === null || comparableCellCount < MIN_COMPARABLE_CELLS) return "insufficient";
    if (meanJsd <= JSD_MATCH_THRESHOLD) return "match";
    if (meanJsd <= JSD_MISMATCH_THRESHOLD) return "uncertain";
    return "mismatch";
  }
  function buildComparisonResult(entries, meanJsd, protocolMismatch) {
    const cells = entries.map((entry) => ({
      cellId: entry.cellId,
      jsd: entry.jsd,
      validA: entry.validA,
      validB: entry.validB
    }));
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
        differentModel: JSD_BASELINE_DIFFERENT_MODEL
      }
    };
  }
  return __toCommonJS(entry_exports);
})();
