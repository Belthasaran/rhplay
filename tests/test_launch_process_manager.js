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

const alivePids = new Set();
const originalKill = process.kill.bind(process);

process.kill = (pid, signal) => {
  if (signal === 0) {
    if (!alivePids.has(pid)) {
      const err = new Error('ESRCH');
      err.code = 'ESRCH';
      throw err;
    }
    return;
  }
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    if (alivePids.has(pid)) {
      alivePids.delete(pid);
    }
    return;
  }
  return originalKill(pid, signal);
};

assert(
  launchProcessManager.normalizeLaunchProgram('  /usr/bin/retroarch  ') === '/usr/bin/retroarch',
  'normalizeLaunchProgram trims whitespace'
);

const sessions = new Map();
sessions.set('session-a', { pid: 888002, program: programA, filePath: '/rom/a.sfc', startedAt: Date.now() });
sessions.set('session-b', { pid: 888003, program: programB, filePath: '/rom/b.sfc', startedAt: Date.now() });

const matchesA = launchProcessManager.getSessionsForProgram(sessions, programA);
assert(matchesA.length === 1, 'getSessionsForProgram finds matching program session');
assert(matchesA[0].sessionId === 'session-a', 'getSessionsForProgram returns correct session id');

alivePids.add(888002);
const stopped = launchProcessManager.stopLaunchProgramInstances(sessions, programA, { signal: 'SIGTERM' });
assert(stopped === 1, 'stopLaunchProgramInstances stops tracked session pid');
assert(!alivePids.has(888002), 'stopLaunchProgramInstances removes pid from alive set');

assert(
  launchProcessManager.processMatchesProgram(
    '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage',
    '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage\0rom.sfc',
    '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage',
    '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage',
    'RetroArch-Linux-x86_64.AppImage'
  ),
  'processMatchesProgram matches AppImage exe and cmdline'
);

assert(
  launchProcessManager.processMatchesProgram(
    '/usr/bin/retroarch',
    '/usr/bin/retroarch\0-L\0core.so\0game.sfc',
    '/usr/bin/retroarch',
    '/usr/bin/retroarch',
    'retroarch'
  ),
  'processMatchesProgram matches system retroarch path'
);

assert(
  !launchProcessManager.processMatchesProgram(
    '/usr/bin/bash',
    '/usr/bin/bash\0-c\0retroarch',
    '/usr/bin/retroarch',
    '/usr/bin/retroarch',
    'retroarch'
  ),
  'processMatchesProgram does not match unrelated process by substring'
);

const mockProcEntries = [
  {
    pid: 4242,
    exePath: '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage',
    cmdline: '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage\0-L\0core.so\0game.sfc',
  },
  {
    pid: 5150,
    exePath: '/usr/bin/other',
    cmdline: '/usr/bin/other\0--help',
  },
];

const externalPids = launchProcessManager.findExternalProgramPids(
  '/home/user/.config/Electron/RetroArch-Linux-x86_64.AppImage',
  { excludedPids: new Set([process.pid]), procEntries: mockProcEntries }
);
assert(externalPids.length === 1 && externalPids[0] === 4242, 'findExternalProgramPids finds matching external process');

(async () => {
  const fakePid = 888001;
  alivePids.add(fakePid);
  const testSessions = new Map();
  testSessions.set('fake', {
    pid: fakePid,
    program: '/opt/RetroArch/retroarch',
    filePath: '/game.sfc',
    startedAt: Date.now(),
  });

  const started = Date.now();
  const result = await launchProcessManager.ensureLaunchProgramStopped(
    testSessions,
    '/opt/RetroArch/retroarch',
    { minWaitMs: 200, timeoutMs: 500, pollMs: 25, procEntries: [] }
  );
  const elapsed = Date.now() - started;

  assert(elapsed >= 200, 'ensureLaunchProgramStopped waits at least minWaitMs');
  assert(!alivePids.has(fakePid), 'ensureLaunchProgramStopped stops tracked session pid');
  assert(!testSessions.has('fake'), 'ensureLaunchProgramStopped removes exited session');
  assert(result.stopped >= 1, 'ensureLaunchProgramStopped returns stopped count');

  alivePids.add(777002);
  const untouched = new Map();
  untouched.set('other', {
    pid: 777002,
    program: programB,
    filePath: '/other.sfc',
    startedAt: Date.now(),
  });
  untouched.set('dead', {
    pid: 999999,
    program: programA,
    filePath: '/dead.sfc',
    startedAt: Date.now(),
  });

  await launchProcessManager.ensureLaunchProgramStopped(untouched, programA, {
    minWaitMs: 200,
    timeoutMs: 500,
    pollMs: 25,
    procEntries: [],
  });
  assert(untouched.has('other'), 'ensureLaunchProgramStopped does not remove other program sessions');
  assert(alivePids.has(777002), 'ensureLaunchProgramStopped leaves other program pid running');
  alivePids.delete(777002);

  const externalPid = 9001;
  alivePids.add(externalPid);
  const externalOnlySessions = new Map();
  const externalProcEntries = [
    {
      pid: externalPid,
      exePath: '/opt/RetroArch/retroarch',
      cmdline: '/opt/RetroArch/retroarch\0game.sfc',
    },
  ];

  await launchProcessManager.ensureLaunchProgramStopped(externalOnlySessions, '/opt/RetroArch/retroarch', {
    minWaitMs: 200,
    timeoutMs: 500,
    pollMs: 25,
    procEntries: externalProcEntries,
  });
  assert(!alivePids.has(externalPid), 'ensureLaunchProgramStopped stops untracked external emulator process');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
