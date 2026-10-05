/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS validator loader. */
// Use the application's actual validators in the offline importer, without a
// second copy of the question rules. These modules contain no server state.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  if (cache.has(filename)) return cache.get(filename);
  const localRequire = Module.createRequire(filename);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const target = { exports: {} };
  const resolver = (name) => name.startsWith('.')
    ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name + '.ts')))
    : localRequire(name);
  new Function('require', 'module', 'exports', source)(resolver, target, target.exports);
  cache.set(filename, target.exports);
  return target.exports;
}
module.exports = {
  ...load('src/lib/question-types.ts'),
  ...load('src/lib/practice-scoring.ts'),
  ...load('src/lib/official-resources.ts'),
};
