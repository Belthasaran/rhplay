/**
 * launch-process-manager.js - Stop tracked emulator launch processes before relaunch.
 */

const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidRunning(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeLaunchProgram(program) {
  const raw = String(program || '').trim();
  if (!raw) return '';
  try {
    if (path.isAbsolute(raw) && fs.existsSync(raw)) {
      return path.resolve(raw);
    }
  } catch (_err) {
    // ignore fs errors
  }
  return raw;
}

function getSessionsForProgram(sessions, program) {
  const key = normalizeLaunchProgram(program);
  if (!key) return [];
  const out = [];
  for (const [sessionId, session] of sessions.entries()) {
    if (normalizeLaunchProgram(session.program) === key) {
      out.push({ sessionId, ...session });
    }
  }
  return out;
}

function removeDeadSessions(sessions) {
  for (const [sessionId, session] of sessions.entries()) {
    if (!isPidRunning(session.pid)) {
      sessions.delete(sessionId);
    }
  }
}

function stopLaunchProgramInstances(sessions, program, { signal = 'SIGTERM' } = {}) {
  removeDeadSessions(sessions);
  const matches = getSessionsForProgram(sessions, program);
  let stopped = 0;
  for (const { sessionId, pid } of matches) {
    if (!isPidRunning(pid)) {
      sessions.delete(sessionId);
      continue;
    }
    try {
      process.kill(pid, signal);
      stopped += 1;
    } catch (err) {
      if (err && err.code === 'ESRCH') {
        sessions.delete(sessionId);
      }
    }
  }
  return stopped;
}

async function ensureLaunchProgramStopped(
  sessions,
  program,
  { minWaitMs = 1000, timeoutMs = 8000, pollMs = 100 } = {}
) {
  const startedAt = Date.now();
  const initialStopped = stopLaunchProgramInstances(sessions, program, { signal: 'SIGTERM' });

  const elapsed = Date.now() - startedAt;
  if (elapsed < minWaitMs) {
    await sleep(minWaitMs - elapsed);
  }

  let forced = false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    removeDeadSessions(sessions);
    const stillRunning = getSessionsForProgram(sessions, program).some((s) => isPidRunning(s.pid));
    if (!stillRunning) {
      return { stopped: initialStopped, forced };
    }
    await sleep(pollMs);
  }

  stopLaunchProgramInstances(sessions, program, { signal: 'SIGKILL' });
  forced = true;
  await sleep(200);
  removeDeadSessions(sessions);

  return { stopped: initialStopped, forced };
}

module.exports = {
  normalizeLaunchProgram,
  getSessionsForProgram,
  stopLaunchProgramInstances,
  ensureLaunchProgramStopped,
  isPidRunning,
  sleep,
};
