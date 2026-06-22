#!/usr/bin/env node

const assert = require('assert');
const {
  getEffectiveChain,
  resolveChainEntry,
  resolveChainView,
  hasLightChainInManifest,
  hasConfiguredLightBase,
  isDivergentLightChain,
  parseDbChainArg,
  CHAIN_FULL_IMPLICIT,
  CHAIN_LIGHT,
  CHAIN_FULL
} = require('../electron/utils/manifest-chain');

const sampleTarget = {
  version: '14',
  'version:light': '3',
  base: { file_name: 'patchbin-full.tar.xz', sha256: 'aaa' },
  'base:light': { file_name: 'patchbin.db.light.initial.xz', sha256: 'bbb' },
  sqlpatches: [{ file_name: 'pbin13_to_14.sql.xz', version_before: '13' }],
  'sqlpatches:light': [{ file_name: 'pbinL2_to_3.sql.xz', version_before: '2' }]
};

assert.strictEqual(getEffectiveChain(null), CHAIN_FULL_IMPLICIT);
assert.strictEqual(getEffectiveChain({}), CHAIN_FULL_IMPLICIT);
assert.strictEqual(getEffectiveChain({ chain: 'full' }), CHAIN_FULL);
assert.strictEqual(getEffectiveChain({ chain: 'light' }), CHAIN_LIGHT);

const fullResolved = resolveChainEntry(sampleTarget, CHAIN_FULL);
assert.strictEqual(fullResolved.version, '14');
assert.strictEqual(fullResolved.base.file_name, 'patchbin-full.tar.xz');
assert.strictEqual(fullResolved.sqlpatches.length, 1);

const lightResolved = resolveChainEntry(sampleTarget, CHAIN_LIGHT);
assert.strictEqual(lightResolved.version, '3');
assert.strictEqual(lightResolved.base.file_name, 'patchbin.db.light.initial.xz');
assert.strictEqual(lightResolved.sqlpatches[0].file_name, 'pbinL2_to_3.sql.xz');
assert.strictEqual(lightResolved.sharedChainShortcut, false);

const legacyView = resolveChainView(sampleTarget, { provisionedEntry: { version: '14' } });
assert.strictEqual(legacyView.effectiveChain, CHAIN_FULL);
assert.strictEqual(legacyView.storeChain, null);

const lightView = resolveChainView(sampleTarget, { requestedChain: CHAIN_LIGHT });
assert.strictEqual(lightView.storeChain, CHAIN_LIGHT);

// rhdata-style: only full-chain fields — light uses shared shortcut
const rhdataTarget = {
  version: '14',
  base: { file_name: 'rhdata-202602019.tar.xz', sha256: 'abc123' },
  sqlpatches: []
};
const rhdataLight = resolveChainEntry(rhdataTarget, CHAIN_LIGHT);
assert.strictEqual(rhdataLight.version, '14');
assert.strictEqual(rhdataLight.base.file_name, 'rhdata-202602019.tar.xz');
assert.strictEqual(rhdataLight.sqlpatches.length, 0);
assert.strictEqual(rhdataLight.sharedChainShortcut, true);
assert.strictEqual(isDivergentLightChain(rhdataTarget), false);

// divergent without sqlpatches:light — no thick patch fallback
const divergentNoLightPatches = {
  version: '14',
  base: { file_name: 'full.tar.xz', sha256: 'aaa' },
  'base:light': { file_name: 'light.xz', sha256: 'bbb' },
  sqlpatches: [{ file_name: 'thick.sql.xz', version_before: '13' }]
};
const divResolved = resolveChainEntry(divergentNoLightPatches, CHAIN_LIGHT);
assert.strictEqual(divResolved.sqlpatches.length, 0);
assert.strictEqual(divResolved.sharedChainShortcut, false);

// explicit empty sqlpatches:light on divergent target
const divergentEmptyPatches = {
  version: '14',
  base: { file_name: 'full.tar.xz', sha256: 'aaa' },
  'base:light': { file_name: 'light.xz', sha256: 'bbb' },
  sqlpatches: [{ file_name: 'thick.sql.xz', version_before: '13' }],
  'sqlpatches:light': []
};
assert.strictEqual(resolveChainEntry(divergentEmptyPatches, CHAIN_LIGHT).sqlpatches.length, 0);

// base:light: {} treated as shortcut
const emptyLightBase = {
  version: '14',
  base: { file_name: 'shared.tar.xz', sha256: 'aaa' },
  'base:light': {},
  sqlpatches: [{ file_name: 'p.sql.xz', version_before: '13' }]
};
const emptyLbResolved = resolveChainEntry(emptyLightBase, CHAIN_LIGHT);
assert.strictEqual(emptyLbResolved.base.file_name, 'shared.tar.xz');
assert.strictEqual(emptyLbResolved.sqlpatches.length, 1);
assert.strictEqual(emptyLbResolved.sharedChainShortcut, true);

// hasConfiguredLightBase requires both file_name and sha256
assert.strictEqual(hasConfiguredLightBase({ 'base:light': { file_name: 'x.xz' } }), false);
assert.strictEqual(hasConfiguredLightBase({ 'base:light': { sha256: 'abc' } }), false);
assert.strictEqual(hasConfiguredLightBase({ 'base:light': { file_name: 'x.xz', sha256: 'abc' } }), true);

// version aliases on divergent chain when version:light missing
const divergentSharedVersion = {
  version: '14',
  base: { file_name: 'full.tar.xz', sha256: 'aaa' },
  'base:light': { file_name: 'light.xz', sha256: 'bbb' }
};
assert.strictEqual(resolveChainEntry(divergentSharedVersion, CHAIN_LIGHT).version, '14');

// only throw when no resolvable base and no patches
assert.throws(() => resolveChainEntry({ version: '1' }, CHAIN_LIGHT));
assert.throws(() => resolveChainEntry({ version: '1', base: {} }, CHAIN_LIGHT));
assert.doesNotThrow(() => resolveChainEntry({ version: '1', base: { file_name: 'x.db', sha256: 'abc' } }, CHAIN_LIGHT));

// shortcut with explicit sqlpatches:light override
const shortcutLightPatches = {
  version: '14',
  base: { file_name: 'shared.tar.xz', sha256: 'aaa' },
  sqlpatches: [{ file_name: 'thick.sql.xz', version_before: '13' }],
  'sqlpatches:light': [{ file_name: 'light.sql.xz', version_before: '13' }]
};
const slpResolved = resolveChainEntry(shortcutLightPatches, CHAIN_LIGHT);
assert.strictEqual(slpResolved.sqlpatches[0].file_name, 'light.sql.xz');
assert.strictEqual(slpResolved.sharedChainShortcut, true);

assert.ok(hasLightChainInManifest(sampleTarget));
assert.strictEqual(hasLightChainInManifest(rhdataTarget), false);
assert.strictEqual(parseDbChainArg('light'), CHAIN_LIGHT);
assert.strictEqual(parseDbChainArg('full'), CHAIN_FULL);

console.log('✓ manifest-chain resolution');
