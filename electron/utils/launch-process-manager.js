/**
 * launch-process-manager.js - Stop tracked and external emulator processes before relaunch.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function resolveSafe(p) {
  try {
    return path.resolve(String(p || ''));
  } catch {
    return String(p || '');
  }
}

function pathsEquivalent(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (process.platform === 'win32') {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }
  return resolveSafe(a) === resolveSafe(b);
}

function getExcludedPids(extra = []) {
  const excluded = new Set([process.pid, process.ppid].filter(Boolean));
  for (const pid of extra) {
    if (pid) excluded.add(pid);
  }
  return excluded;
}

function processMatchesProgram(exePath, cmdlineBuf, program, normalized, basename) {
  const cmdline = Buffer.isBuffer(cmdlineBuf) ? cmdlineBuf.toString('utf8') : String(cmdlineBuf || '');
  const args = cmdline.split('\0').filter(Boolean);
  const arg0 = args[0] || '';

  if (exePath && pathsEquivalent(exePath, normalized)) return true;
  if (pathsEquivalent(arg0, normalized) || pathsEquivalent(arg0, program)) return true;

  if (args.some((arg) => pathsEquivalent(arg, normalized))) return true;

  if (normalized.endsWith('.AppImage')) {
    const appImageDir = path.dirname(normalized);
    if (arg0.endsWith(basename) && (pathsEquivalent(arg0, normalized) || arg0.includes(appImageDir))) {
      return true;
    }
    if (exePath && (pathsEquivalent(exePath, normalized) || exePath.endsWith(basename))) {
      return true;
    }
  }

  if (basename && exePath && path.basename(exePath) === basename) {
    if (path.isAbsolute(normalized) && pathsEquivalent(path.dirname(exePath), path.dirname(normalized))) {
      return true;
    }
  }

  return false;
}

function listLinuxProcEntries() {
  const entries = [];
  if (!fs.existsSync('/proc')) return entries;
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    let exePath = '';
    let cmdline = '';
    try {
      exePath = fs.readlinkSync(path.join('/proc', name, 'exe'));
    } catch (_err) {
      // permission denied or kernel thread
    }
    try {
      cmdline = fs.readFileSync(path.join('/proc', name, 'cmdline'));
    } catch (_err) {
      continue;
    }
    entries.push({ pid, exePath, cmdline });
  }
  return entries;
}

function listWindowsProcEntries() {
  const entries = [];
  try {
    const output = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const trimmed = String(output || '').trim();
    if (!trimmed) return entries;
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of list) {
      const pid = Number(row.ProcessId);
      if (!pid) continue;
      entries.push({
        pid,
        exePath: row.ExecutablePath || '',
        cmdline: row.CommandLine || '',
      });
    }
  } catch (_err) {
    // fallback below
  }
  return entries;
}

function listDarwinProcEntries() {
  const entries = [];
  try {
    const output = execSync('ps -ax -o pid=,command=', {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of String(output || '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+)\s+(.*)$/);
      if (!match) continue;
      entries.push({
        pid: Number(match[1]),
        exePath: '',
        cmdline: match[2],
      });
    }
  } catch (_err) {
    // ignore
  }
  return entries;
}

function listProcEntries() {
  if (process.platform === 'linux') return listLinuxProcEntries();
  if (process.platform === 'win32') return listWindowsProcEntries();
  if (process.platform === 'darwin') return listDarwinProcEntries();
  return [];
}

function findExternalProgramPids(program, { excludedPids, procEntries } = {}) {
  const normalized = normalizeLaunchProgram(program);
  if (!normalized) return [];
  const excluded = excludedPids || getExcludedPids();
  const basename = path.basename(normalized);
  const entries = procEntries || listProcEntries();
  const pids = [];

  for (const entry of entries) {
    const { pid, exePath, cmdline } = entry;
    if (!pid || excluded.has(pid)) continue;
    if (processMatchesProgram(exePath, cmdline, program, normalized, basename)) {
      pids.push(pid);
    }
  }

  return [...new Set(pids)];
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

function stopPids(pids, signal = 'SIGTERM') {
  let stopped = 0;
  for (const pid of pids) {
    if (!isPidRunning(pid)) continue;
    try {
      process.kill(pid, signal);
      stopped += 1;
    } catch (err) {
      if (err && err.code !== 'ESRCH') {
        console.warn(`[launch-process-manager] kill pid ${pid} failed:`, err.message || err);
      }
    }
  }
  return stopped;
}

function stopLaunchProgramInstances(sessions, program, { signal = 'SIGTERM' } = {}) {
  removeDeadSessions(sessions);
  const matches = getSessionsForProgram(sessions, program);
  const pids = matches.map((session) => session.pid).filter((pid) => isPidRunning(pid));
  return stopPids(pids, signal);
}

function stopExternalProgramInstances(program, { signal = 'SIGTERM', excludedPids, procEntries } = {}) {
  const pids = findExternalProgramPids(program, { excludedPids, procEntries });
  return stopPids(pids, signal);
}

function anyProgramInstancesRunning(sessions, program, { procEntries } = {}) {
  removeDeadSessions(sessions);
  const sessionRunning = getSessionsForProgram(sessions, program).some((session) => isPidRunning(session.pid));
  if (sessionRunning) return true;
  const externalPids = findExternalProgramPids(program, { procEntries });
  return externalPids.some((pid) => isPidRunning(pid));
}

async function ensureLaunchProgramStopped(
  sessions,
  program,
  { minWaitMs = 1000, timeoutMs = 8000, pollMs = 100, procEntries } = {}
) {
  const startedAt = Date.now();
  const sessionStopped = stopLaunchProgramInstances(sessions, program, { signal: 'SIGTERM' });
  const externalStopped = stopExternalProgramInstances(program, { signal: 'SIGTERM', procEntries });

  const elapsed = Date.now() - startedAt;
  if (elapsed < minWaitMs) {
    await sleep(minWaitMs - elapsed);
  }

  let forced = false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    removeDeadSessions(sessions);
    if (!anyProgramInstancesRunning(sessions, program, { procEntries })) {
      return {
        stopped: sessionStopped + externalStopped,
        sessionStopped,
        externalStopped,
        forced,
      };
    }
    await sleep(pollMs);
  }

  stopExternalProgramInstances(program, { signal: 'SIGKILL', procEntries });
  stopLaunchProgramInstances(sessions, program, { signal: 'SIGKILL' });
  forced = true;
  await sleep(200);
  removeDeadSessions(sessions);

  return {
    stopped: sessionStopped + externalStopped,
    sessionStopped,
    externalStopped,
    forced,
  };
}

module.exports = {
  normalizeLaunchProgram,
  processMatchesProgram,
  findExternalProgramPids,
  getSessionsForProgram,
  stopLaunchProgramInstances,
  stopExternalProgramInstances,
  ensureLaunchProgramStopped,
  anyProgramInstancesRunning,
  isPidRunning,
  sleep,
  listProcEntries,
};
