#!/usr/bin/env node

/**
 * test_launch_process_manager.js - Tests for electron/utils/launch-process-manager.js
 * Run: node tests/test_launch_process_manager.js
 */

const launchProcessManager = require('../electron/utils/launch-process-manager');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`✗ ${message}`);
    return false;
  }
  passed += 1;
  console.log(`✓ ${message}`);
  return true;
}

const programA = '/tmp/rhtools-launch-test/retroarch.AppImage';
const programB = '/tmp/rhtools-launch-test/bizhawk/EmuHawk';

assert(
  launchProcessManager.normalizeLaunchProgram('  /usr/bin/retroarch  ') === '/usr/bin/retroarch',
  'normalizeLaunchProgram trims whitespace'
);

const sessions = new Map();
sessions.set('session-a', { pid: process.pid, program: programA, filePath: '/rom/a.sfc', startedAt: Date.now() });
sessions.set('session-b', { pid: process.pid + 999999, program: programB, filePath: '/rom/b.sfc', startedAt: Date.now() });

const matchesA = launchProcessManager.getSessionsForProgram(sessions, programA);
assert(matchesA.length === 1, 'getSessionsForProgram finds matching program session');
assert(matchesA[0].sessionId === 'session-a', 'getSessionsForProgram returns correct session id');

const stopped = launchProcessManager.stopLaunchProgramInstances(sessions, programA, { signal: 0 });
assert(stopped >= 0, 'stopLaunchProgramInstances runs without throwing for tracked session');

(async () => {
  const testSessions = new Map();
  const fakePid = process.pid;
  testSessions.set('fake', {
    pid: fakePid,
    program: '/opt/RetroArch/retroarch',
    filePath: '/game.sfc',
    startedAt: Date.now(),
  });

  const originalKill = process.kill.bind(process);
  let killCalls = 0;
  process.kill = (pid, signal) => {
    if (pid === fakePid && signal === 'SIGTERM') {
      killCalls += 1;
      const err = new Error('ESRCH');
      err.code = 'ESRCH';
      throw err;
    }
    return originalKill(pid, signal);
  };

  const started = Date.now();
  const result = await launchProcessManager.ensureLaunchProgramStopped(
    testSessions,
    '/opt/RetroArch/retroarch',
    { minWaitMs: 1000, timeoutMs: 1500, pollMs: 50 }
  );
  const elapsed = Date.now() - started;

  process.kill = originalKill;

  assert(elapsed >= 1000, 'ensureLaunchProgramStopped waits at least minWaitMs');
  assert(killCalls >= 1, 'ensureLaunchProgramStopped sends SIGTERM to matching process');
  assert(!testSessions.has('fake'), 'ensureLaunchProgramStopped removes exited session');
  assert(result.stopped >= 0, 'ensureLaunchProgramStopped returns stopped count');

  const untouched = new Map();
  untouched.set('other', {
    pid: process.pid,
    program: programB,
    filePath: '/other.sfc',
    startedAt: Date.now(),
  });
  untouched.set('dead', {
    pid: process.pid + 999999,
    program: programA,
    filePath: '/dead.sfc',
    startedAt: Date.now(),
  });

  await launchProcessManager.ensureLaunchProgramStopped(untouched, programA, {
    minWaitMs: 1000,
    timeoutMs: 1500,
    pollMs: 50,
  });
  assert(untouched.has('other'), 'ensureLaunchProgramStopped does not remove other program sessions');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
