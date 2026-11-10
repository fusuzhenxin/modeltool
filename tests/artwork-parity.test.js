const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

test("后台作品题组与前台提示词、结构评分和提取结果一致", () => {
  const root = path.join(__dirname, "..");
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "js/data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "js/engine.js"), "utf8"), ctx);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "data/pelican-modes.json"), "utf8"));
  const expected = vm.runInContext("DATA.pelicanModes", ctx);
  for (const item of expected) assert.equal(JSON.stringify(modes[item.id]), JSON.stringify({ name: item.name, system: item.system, prompt: item.prompt }));
  const samples = [
    "no artwork", "```svg\n<svg><circle/><path/></svg>\n```",
    '<html><body><svg><circle/><path/></svg><style>@keyframes x{}</style>' + "鹈鹕😀".repeat(210) + '</body></html>',
    '<!DOCTYPE html><html><body><canvas></canvas><script>requestAnimationFrame(draw);</script></body></html>'
  ];
  const output = execFileSync("python", ["-X", "utf8", "-c", "import sys,json;from backend.artwork import extract_artwork,artwork_checks;print(json.dumps([{'html':extract_artwork(s),'checks':artwork_checks(extract_artwork(s))} for s in json.load(sys.stdin)],ensure_ascii=True))"], { cwd: root, input: JSON.stringify(samples), encoding: "utf8" });
  const actual = JSON.parse(output);
  const api = vm.runInContext("Api", ctx);
  for (let i = 0; i < samples.length; i++) {
    const html = api.extractArtwork(samples[i]);
    assert.equal(actual[i].html, html);
    assert.equal(JSON.stringify(actual[i].checks), JSON.stringify(api.artworkChecks(html)));
  }
});
