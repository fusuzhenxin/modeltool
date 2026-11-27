// Build-only dependency: esbuild 0.25.12. No npm packages are needed at runtime.
const path = require('node:path');
const esbuild = require(process.argv[2] ? path.resolve(process.argv[2]) : 'esbuild');
for (const [entry, globalName, output] of [
  ['modeltrace/entry.js', 'ModelTraceCore', 'modeltrace-core.js'],
  ['llm-fingerprint-detector/entry.ts', 'TokenFingerprintCore', 'token-fingerprint-core.js']
]) {
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '../vendor', entry)], bundle: true,
    format: 'iife', globalName, platform: 'browser', target: 'es2020',
    outfile: path.join(__dirname, '../js/vendor', output),
    banner: { js: '// Generated from vendored MIT sources. See vendor/README.md. Do not edit.' }
  });
}
