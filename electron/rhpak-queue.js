let pendingRhpaks = [];

function normalizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }
  let normalized = filePath.trim();
  if (!normalized) {
    return null;
  }
  // Remove wrapping quotes if present
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function queueRhpakPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return;
  }
  pendingRhpaks.push(normalized);
}

function drainRhpakQueue() {
  const current = pendingRhpaks.slice();
  pendingRhpaks = [];
  return current;
}

module.exports = {
  queueRhpakPath,
  drainRhpakQueue,
};

