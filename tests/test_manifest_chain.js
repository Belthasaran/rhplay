#!/usr/bin/env node

const assert = require('assert');
const {
  getEffectiveChain,
  resolveChainEntry,
  resolveChainView,
  hasLightChainInManifest,
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
  sqlpatches: [{ file_name: 'pbin13_to14.sql.xz', version_before: '13' }],
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

const legacyView = resolveChainView(sampleTarget, { provisionedEntry: { version: '14' } });
assert.strictEqual(legacyView.effectiveChain, CHAIN_FULL);
assert.strictEqual(legacyView.storeChain, null);

const lightView = resolveChainView(sampleTarget, { requestedChain: CHAIN_LIGHT });
assert.strictEqual(lightView.storeChain, CHAIN_LIGHT);

assert.throws(() => resolveChainEntry({ version: '1', base: {} }, CHAIN_LIGHT));

assert.ok(hasLightChainInManifest(sampleTarget));
assert.strictEqual(parseDbChainArg('light'), CHAIN_LIGHT);
assert.strictEqual(parseDbChainArg('full'), CHAIN_FULL);

console.log('✓ manifest-chain resolution');
