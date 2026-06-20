#!/usr/bin/env node

/**
 * test_asar_patch_result.js
 *
 * Unit tests for ASAR stderr/exit classification used during extrapatch builds.
 */

const {
  classifyAsarStderr,
  shouldFailAsarOutput,
} = require('../lib/asar-patch-result');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sampleWarningStderr = [
  '/tmp/asar_mtlvno1.asm:136: warning: (Wfeature_deprecated): DEPRECATION NOTIFICATION',
  '/tmp/asar_mtlvno1.asm:92: warning: (Wfreespace_leaked): This freespace appears to be leaked.',
].join('\n');

function testWarningOnlyStderrIgnoredWhenFlagSet() {
  const decision = shouldFailAsarOutput({
    ignoreWarnings: true,
    exitCode: 0,
    stderr: sampleWarningStderr,
    stdout: '',
    romModified: true,
  });
  assert(decision.fail === false, 'Warning-only stderr should pass when ignoreWarnings is true');
  assert(decision.ignoredWarnings?.length === 2, 'Expected two ignored warning lines');
}

function testWarningOnlyStderrFailsWhenFlagUnset() {
  const decision = shouldFailAsarOutput({
    ignoreWarnings: false,
    exitCode: 0,
    stderr: sampleWarningStderr,
    stdout: '',
    romModified: true,
  });
  assert(decision.fail === true, 'Warning-only stderr should fail when ignoreWarnings is false');
  assert(decision.error?.includes('ASAR reported an error'), 'Expected ASAR reported an error message');
}

function testNonZeroExitFailsWhenIgnoringWarnings() {
  const decision = shouldFailAsarOutput({
    ignoreWarnings: true,
    exitCode: 1,
    stderr: sampleWarningStderr,
    stdout: '',
    romModified: true,
  });
  assert(decision.fail === true, 'Non-zero exit should fail even when ignoring warnings');
  assert(decision.error?.includes('ASAR exited with code 1'), 'Expected exit code error');
}

function testUnmodifiedRomFailsWhenIgnoringWarnings() {
  const decision = shouldFailAsarOutput({
    ignoreWarnings: true,
    exitCode: 0,
    stderr: sampleWarningStderr,
    stdout: '',
    romModified: false,
  });
  assert(decision.fail === true, 'Unmodified ROM should fail when ignoreWarnings is true');
  assert(decision.error?.includes('did not modify'), 'Expected ROM not modified error');
}

function testClassifyAsarStderrSeparatesWarningsAndErrors() {
  const stderr = [
    '/tmp/test.asm:10: warning: (Wfeature_deprecated): old syntax',
    '/tmp/test.asm:20: error: (Eunknown): bad opcode',
  ].join('\n');
  const info = classifyAsarStderr(stderr);
  assert(info.hasWarnings === true, 'Expected warnings detected');
  assert(info.hasErrors === true, 'Expected errors detected');
  assert(info.warningLines.length === 1, 'Expected one warning line');
  assert(info.errorLines.length === 1, 'Expected one error line');
}

function main() {
  testWarningOnlyStderrIgnoredWhenFlagSet();
  testWarningOnlyStderrFailsWhenFlagUnset();
  testNonZeroExitFailsWhenIgnoringWarnings();
  testUnmodifiedRomFailsWhenIgnoringWarnings();
  testClassifyAsarStderrSeparatesWarningsAndErrors();
  console.log('✅ test_asar_patch_result passed');
}

main();
