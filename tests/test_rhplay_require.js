#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { rhplayModuleCandidates, requireRhplayModule } = require('../electron/installer/rhplay-require');

function testCandidates() {
  const prev = process.resourcesPath;
  process.resourcesPath = '/tmp/resources';
  try {
    const candidates = rhplayModuleCandidates('lib/provision-bundle');
    assert.ok(candidates.some((p) => p.includes('app.asar/lib/provision-bundle')));
    assert.ok(candidates.some((p) => p.endsWith(path.join('lib', 'provision-bundle'))));
  } finally {
    if (prev === undefined) delete process.resourcesPath;
    else process.resourcesPath = prev;
  }
}

function testRequireDev() {
  const mod = requireRhplayModule('lib/provision-bundle');
  assert.strictEqual(typeof mod.isBundleSpec, 'function');
}

testCandidates();
testRequireDev();
console.log('✓ rhplay-require');
