/**
 * Resolve rhplay repo modules when prepare_databases runs from app.asar.unpacked.
 * Relative ../../lib/... misses modules that live inside app.asar in packaged builds.
 */

const path = require('path');

function rhplayModuleCandidates(relativePath) {
  const norm = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const candidates = [];
  if (process.env.RHPLAY_ROOT) {
    candidates.push(path.join(process.env.RHPLAY_ROOT, norm));
  }
  candidates.push(path.join(__dirname, '..', '..', norm));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar', norm));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', norm));
  }
  return candidates;
}

function requireRhplayModule(relativePath) {
  const tried = [];
  for (const base of rhplayModuleCandidates(relativePath)) {
    for (const candidate of [base, `${base}.js`]) {
      tried.push(candidate);
      try {
        return require(candidate);
      } catch (err) {
        const missing = err && (err.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(err.message));
        if (!missing) throw err;
      }
    }
  }
  throw new Error(`Cannot find rhplay module "${relativePath}" (tried: ${tried.join(', ')})`);
}

module.exports = {
  rhplayModuleCandidates,
  requireRhplayModule
};
