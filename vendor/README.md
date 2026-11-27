# Fingerprint upstreams

Retrieved 2026-11-27. Source files are unchanged; entry files expose the subset used by this site.

* ModelTrace: https://github.com/xqy2006/ModelTrace, revision `09a0ae5009d943aa6cb5dd3c914b83b7e70826ac`, MIT (see modeltrace/LICENSE). `data/trace-bank.json` is its unified bank, 22 GPT/Claude models. GPT samples were collected through Codex; Claude samples through OAIPro. These are upstream references, not a claim that all were collected from official APIs.
* llm-fingerprint-detector: https://github.com/ToseaAI/llm-fingerprint-detector, revision `94dc44686a553595581b6d06405c17f070df9b8d`, version 0.1.0, MIT (see llm-fingerprint-detector/LICENSE). The site reuses its battery, normalizer, statistics and comparison thresholds. Transport/scheduling use the site's existing credential proxy and worker budgets.
* `data/token-reference-samples.json`: unchanged bundled sample dataset from the latter project, CC-BY-4.0. Author: Tomáš Bruckner, *Single-token output distributions as behavioral fingerprints of large language models*, DOI https://doi.org/10.5281/zenodo.21278557; paper https://arxiv.org/abs/2607.10252. Collected via OpenRouter under the paper's protocol. The file's `source` retains the full attribution. This differs from `one-token/v1`: all resulting comparisons are indicative and cannot produce a formal match/mismatch identity verdict.

Rebuild static browser/worker bundles (Node 18+):

```powershell
npm install --prefix .local/fingerprint-build --ignore-scripts --no-audit --no-fund esbuild@0.25.12
node scripts/build-fingerprints.cjs .local/fingerprint-build/node_modules/esbuild
```

There is no CDN runtime dependency. A bank update must include its matching inference core. GPT/Claude always use ModelTrace; only the seven other bundled model IDs (or their exact provider-less IDs) use the single-token comparison. Versions are never inferred from a family prefix.
