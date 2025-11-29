/**
 * Runview Generator
 * 
 * Generates runview.html file that displays current run status in a compact format
 * for display in external web browsers or signage.
 */

const fs = require('fs');
const path = require('path');

/**
 * Get runview settings from database
 * @param {Object} dbManager - Database manager
 * @returns {Object} Settings object with runviewcount and runviewwidth
 */
function getRunviewSettings(dbManager) {
  const db = dbManager.getConnection('clientdata');
  
  // Get runviewcount (default: 4, minimum: 1)
  const countRow = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('runviewcount');
  const runviewcount = countRow ? Math.max(1, parseInt(countRow.csetting_value, 10) || 4) : 4;
  
  // Get runviewwidth (default: 500, range: 500-600)
  const widthRow = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('runviewwidth');
  let runviewwidth = widthRow ? parseInt(widthRow.csetting_value, 10) : 500;
  if (isNaN(runviewwidth) || runviewwidth < 500) runviewwidth = 500;
  if (runviewwidth > 600) runviewwidth = 600;
  
  return { runviewcount, runviewwidth };
}

/**
 * Format time duration in HH:MM:SS format
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted time string
 */
function formatDuration(milliseconds) {
  if (!milliseconds || milliseconds < 0) return '00:00:00';
  
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Determine which challenges to display based on priority
 * @param {Array} results - All run results
 * @param {number} currentIndex - Index of current challenge
 * @param {number} maxCount - Maximum number of challenges to display
 * @returns {Array} Array of result indices to display
 */
function selectChallengesToDisplay(results, currentIndex, maxCount) {
  const total = results.length;
  const indices = [];
  
  // Priority 1: Current challenge (always included)
  indices.push(currentIndex);
  
  if (maxCount <= 1) return indices;
  
  // Priority 2: Next and previous challenges
  if (currentIndex < total - 1) {
    indices.push(currentIndex + 1); // Next
  }
  if (currentIndex > 0) {
    indices.unshift(currentIndex - 1); // Previous
  }
  
  if (maxCount <= indices.length) {
    return indices.slice(0, maxCount);
  }
  
  // Priority 3: Final challenge (if not already included)
  const finalIndex = total - 1;
  if (finalIndex !== currentIndex && !indices.includes(finalIndex)) {
    indices.push(finalIndex);
  }
  
  if (maxCount <= indices.length) {
    return indices.slice(0, maxCount);
  }
  
  // Priority 4: Upcoming challenges (after current, before final)
  let nextIndex = currentIndex + 2;
  while (indices.length < maxCount && nextIndex < finalIndex) {
    if (!indices.includes(nextIndex)) {
      indices.push(nextIndex);
    }
    nextIndex++;
  }
  
  if (maxCount <= indices.length) {
    return indices.slice(0, maxCount);
  }
  
  // Priority 5: Earlier past challenges (before current)
  let prevIndex = currentIndex - 2;
  while (indices.length < maxCount && prevIndex >= 0) {
    if (!indices.includes(prevIndex)) {
      indices.unshift(prevIndex);
    }
    prevIndex--;
  }
  
  return indices.slice(0, maxCount);
}

/**
 * Generate runview.html file
 * @param {Object} params
 * @param {Object} params.dbManager - Database manager
 * @param {string} params.runUuid - Run UUID
 * @param {string} params.userDataPath - App user data path
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function generateRunview(params) {
  const { dbManager, runUuid, userDataPath } = params;
  
  try {
    const clientdataDb = dbManager.getConnection('clientdata');
    
    // Get run information
    const run = clientdataDb.prepare(`
      SELECT run_uuid, run_name, status, started_at_ms, pause_milliseconds, pause_start_ms,
             total_challenges, completed_challenges
      FROM runs
      WHERE run_uuid = ?
    `).get(runUuid);
    
    if (!run) {
      return { success: false, error: 'Run not found' };
    }
    
    // Get all run results with author information
    // Join with run_plan_entries to get entry_type
    const rhdataDb = dbManager.getConnection('rhdata');
    const results = clientdataDb.prepare(`
      SELECT 
        rr.result_uuid, 
        rr.sequence_number, 
        rr.gameid, 
        rr.game_name, 
        rr.exit_number,
        rr.stage_description,
        rr.levelnumber, 
        rr.levelname,
        rr.status, 
        rr.started_at_ms, 
        rr.completed_at_ms, 
        rr.duration_milliseconds, 
        rr.pause_milliseconds,
        rr.was_random,
        COALESCE(rpe.entry_type, 
          CASE 
            WHEN rr.exit_number IS NOT NULL OR rr.levelnumber IS NOT NULL THEN 'stage'
            ELSE 'game'
          END
        ) as entry_type
      FROM run_results rr
      LEFT JOIN run_plan_entries rpe ON rr.plan_entry_uuid = rpe.entry_uuid
      WHERE rr.run_uuid = ?
      ORDER BY rr.sequence_number
    `).all(runUuid);
    
    // Get author information for each game
    const gameAuthors = new Map();
    if (results.length > 0) {
      const gameids = [...new Set(results.map(r => r.gameid).filter(Boolean))];
      if (gameids.length > 0) {
        const placeholders = gameids.map(() => '?').join(',');
        const authorRows = rhdataDb.prepare(`
          SELECT gameid, author
          FROM gameversions
          WHERE gameid IN (${placeholders})
            AND version = (SELECT MAX(version) FROM gameversions gv2 WHERE gv2.gameid = gameversions.gameid)
        `).all(...gameids);
        authorRows.forEach(row => {
          gameAuthors.set(row.gameid, row.author || '');
        });
      }
    }
    
    // If no results yet, still generate a basic runview (run might not be staged yet)
    if (results.length === 0) {
      // Generate minimal runview with just run name and status
      const { runviewwidth } = getRunviewSettings(dbManager);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Run View - ${escapeHtml(run.run_name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 10px;
      display: flex;
      justify-content: center;
    }
    .runview-container {
      width: ${runviewwidth}px;
      min-height: 200px;
      background: #2a2a2a;
      border: 2px solid #444;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    .run-name {
      font-size: 20px;
      font-weight: bold;
      color: #fff;
      margin-bottom: 10px;
    }
    .status {
      color: #888;
    }
  </style>
</head>
<body>
  <div class="runview-container">
    <div class="run-name">${escapeHtml(run.run_name)}</div>
    <div class="status">Status: ${escapeHtml(run.status)}</div>
    <div class="status" style="margin-top: 10px;">Run not staged yet</div>
  </div>
  <script>
    setTimeout(() => { window.location.reload(); }, 10000);
  </script>
</body>
</html>`;
      const runviewPath = path.join(userDataPath, 'runview.html');
      fs.writeFileSync(runviewPath, html, 'utf8');
      return { success: true };
    }
    
    // Find current challenge (first pending or in-progress)
    let currentIndex = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'pending' || (results[i].started_at_ms && !results[i].completed_at_ms)) {
        currentIndex = i;
        break;
      }
    }
    // If all completed, current is the last one
    if (currentIndex === 0 && results[results.length - 1].status !== 'pending') {
      currentIndex = results.length - 1;
    }
    
    const currentChallenge = results[currentIndex];
    const currentChallengeNum = currentIndex + 1;
    const totalChallenges = results.length;
    
    // Get runview settings
    const { runviewcount, runviewwidth } = getRunviewSettings(dbManager);
    
    // Select which challenges to display
    const displayIndices = selectChallengesToDisplay(results, currentIndex, runviewcount);
    
    // Calculate current running time
    const now = Date.now();
    let runElapsedMs = 0;
    let currentChallengeElapsedMs = 0;
    
    if (run.started_at_ms) {
      runElapsedMs = now - run.started_at_ms;
      if (run.pause_milliseconds) {
        runElapsedMs -= run.pause_milliseconds;
      }
      // If currently paused, subtract current pause time
      if (run.pause_start_ms) {
        const currentPauseMs = now - run.pause_start_ms;
        runElapsedMs -= currentPauseMs;
      }
    }
    
    if (currentChallenge.started_at_ms) {
      currentChallengeElapsedMs = now - currentChallenge.started_at_ms;
      if (currentChallenge.pause_milliseconds) {
        currentChallengeElapsedMs -= currentChallenge.pause_milliseconds;
      }
    }
    
    // Calculate minimum height (300px base + ~40px per challenge)
    const minHeight = Math.max(300, 300 + (displayIndices.length * 40));
    
    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Run View - ${run.run_name}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 10px;
      display: flex;
      justify-content: center;
    }
    .runview-container {
      width: ${runviewwidth}px;
      min-height: ${minHeight}px;
      background: #2a2a2a;
      border: 2px solid #444;
      border-radius: 8px;
      padding: 15px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .run-header {
      text-align: center;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #444;
    }
    .run-name {
      font-size: 20px;
      font-weight: bold;
      color: #fff;
      margin-bottom: 5px;
    }
    .run-progress {
      font-size: 14px;
      color: #aaa;
    }
    .timer-section {
      text-align: center;
      margin: 15px 0;
      padding: 10px;
      background: #1e1e1e;
      border-radius: 6px;
    }
    .timer-label {
      font-size: 12px;
      color: #888;
      margin-bottom: 5px;
    }
    .timer-value {
      font-size: 24px;
      font-weight: bold;
      color: #4CAF50;
      font-family: 'Courier New', monospace;
    }
    .challenges-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    .challenges-table th {
      background: #333;
      color: #fff;
      padding: 8px 4px;
      text-align: left;
      font-size: 11px;
      font-weight: bold;
      border-bottom: 2px solid #555;
    }
    .challenges-table td {
      padding: 6px 4px;
      font-size: 11px;
      border-bottom: 1px solid #333;
    }
    .challenges-table tr.current {
      background: #3a4a3a;
      border-left: 3px solid #4CAF50;
    }
    .challenges-table tr.completed {
      opacity: 0.7;
    }
    .challenges-table tr.skipped {
      opacity: 0.5;
      color: #888;
    }
    .entry-type {
      font-weight: bold;
      color: #4CAF50;
    }
    .game-id {
      font-family: monospace;
      color: #888;
      font-size: 10px;
    }
    .game-name {
      color: #fff;
      font-weight: 500;
    }
    .stage-info {
      color: #aaa;
      font-size: 10px;
    }
    .author {
      color: #888;
      font-size: 10px;
    }
    .status {
      font-weight: bold;
    }
    .status.done {
      color: #4CAF50;
    }
    .status.skip {
      color: #ff9800;
    }
    .status.pending {
      color: #2196F3;
    }
    .time {
      font-family: 'Courier New', monospace;
      color: #aaa;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="runview-container">
    <div class="run-header">
      <div class="run-name">${escapeHtml(run.run_name)}</div>
      <div class="run-progress">Challenge ${currentChallengeNum} of ${totalChallenges}</div>
    </div>
    
    <div class="timer-section">
      <div class="timer-label">Running Time</div>
      <div class="timer-value" id="run-timer">00:00:00</div>
    </div>
    
    <div class="timer-section">
      <div class="timer-label">Current Challenge Time</div>
      <div class="timer-value" id="challenge-timer">00:00:00</div>
    </div>
    
    <table class="challenges-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Game</th>
          <th>Stage</th>
          <th>Author</th>
          <th>Status</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
${displayIndices.map(idx => {
  const result = results[idx];
  const isCurrent = idx === currentIndex;
  const isCompleted = result.status === 'success' || result.status === 'ok';
  const isSkipped = result.status === 'skipped';
  
  const rowClass = isCurrent ? 'current' : (isCompleted ? 'completed' : (isSkipped ? 'skipped' : ''));
  
  const entryType = result.entry_type === 'random_game' ? 'Random Game' :
                    result.entry_type === 'random_stage' ? 'Random Stage' :
                    result.entry_type === 'stage' ? 'Stage' : 'Game';
  
  const gameName = result.game_name || result.gameid || '???';
  // Use levelnumber/levelname if available, otherwise use exit_number/stage_description
  const stageInfo = (result.levelnumber && result.levelname) 
    ? `${result.levelnumber} - ${result.levelname}`
    : result.levelnumber 
    ? result.levelnumber 
    : (result.exit_number && result.stage_description)
    ? `${result.exit_number} - ${result.stage_description}`
    : result.exit_number
    ? result.exit_number
    : result.stage_description
    ? result.stage_description
    : '';
  
  // Get author from gameversions
  const author = result.gameid ? (gameAuthors.get(result.gameid) || '') : '';
  
  let statusText = '';
  let statusClass = '';
  if (isCurrent && !result.completed_at_ms) {
    statusText = 'Running';
    statusClass = 'pending';
  } else if (isCompleted) {
    statusText = 'Done';
    statusClass = 'done';
  } else if (isSkipped) {
    statusText = 'Skip';
    statusClass = 'skip';
  } else {
    statusText = 'Pending';
    statusClass = 'pending';
  }
  
  let timeText = '';
  if (isCurrent && !result.completed_at_ms && result.started_at_ms) {
    // Current challenge - will be updated by JS
    const startMs = result.started_at_ms || 0;
    const pauseMs = result.pause_milliseconds || 0;
    timeText = `<span class="time" data-start-ms="${startMs}" data-pause-ms="${pauseMs}">00:00:00</span>`;
  } else if (result.duration_milliseconds) {
    timeText = escapeHtml(formatDuration(result.duration_milliseconds));
  } else {
    timeText = '—';
  }
  
  return `        <tr class="${rowClass}">
          <td><span class="entry-type">${escapeHtml(entryType)}</span></td>
          <td>
            <span class="game-id">${escapeHtml(result.gameid || '—')}</span><br>
            <span class="game-name">${escapeHtml(gameName)}</span>
          </td>
          <td><span class="stage-info">${escapeHtml(stageInfo || '—')}</span></td>
          <td><span class="author">${escapeHtml(author || '—')}</span></td>
          <td><span class="status ${statusClass}">${escapeHtml(statusText)}</span></td>
          <td>${timeText}</td>
        </tr>`;
}).join('\n')}
      </tbody>
    </table>
  </div>
  
  <script>
    // Run timer data
    const runStartMs = ${run.started_at_ms || 0};
    const runPauseMs = ${run.pause_milliseconds || 0};
    const runPauseStartMs = ${run.pause_start_ms || 0};
    
    // Current challenge timer data
    const challengeStartMs = ${currentChallenge.started_at_ms || 0};
    const challengePauseMs = ${currentChallenge.pause_milliseconds || 0};
    
    function updateTimers() {
      const now = Date.now();
      
      // Update run timer
      if (runStartMs) {
        let runElapsed = now - runStartMs - runPauseMs;
        if (runPauseStartMs) {
          runElapsed -= (now - runPauseStartMs);
        }
        if (runElapsed < 0) runElapsed = 0;
        document.getElementById('run-timer').textContent = formatTime(runElapsed);
      }
      
      // Update current challenge timer
      if (challengeStartMs) {
        let challengeElapsed = now - challengeStartMs - challengePauseMs;
        if (challengeElapsed < 0) challengeElapsed = 0;
        document.getElementById('challenge-timer').textContent = formatTime(challengeElapsed);
      }
      
      // Update challenge row timers
      document.querySelectorAll('.time[data-start-ms]').forEach(el => {
        const startMs = parseInt(el.getAttribute('data-start-ms'), 10);
        const pauseMs = parseInt(el.getAttribute('data-pause-ms'), 10) || 0;
        if (startMs) {
          const elapsed = now - startMs - pauseMs;
          if (elapsed >= 0) {
            el.textContent = formatTime(elapsed);
          }
        }
      });
    }
    
    function formatTime(milliseconds) {
      const totalSeconds = Math.floor(milliseconds / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return \`\${String(hours).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:\${String(seconds).padStart(2, '0')}\`;
    }
    
    // Update timers immediately and then every second
    updateTimers();
    setInterval(updateTimers, 1000);
    
    // Auto-refresh page every 10 seconds to get updates
    setTimeout(() => {
      window.location.reload();
    }, 10000);
  </script>
</body>
</html>`;
    
    // Write to file
    const runviewPath = path.join(userDataPath, 'runview.html');
    fs.writeFileSync(runviewPath, html, 'utf8');
    
    return { success: true };
  } catch (error) {
    console.error('[generateRunview] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  generateRunview,
  getRunviewSettings
};

