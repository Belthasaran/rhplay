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
  const runviewcount = countRow ? Math.max(1, parseInt(countRow.csetting_value, 10) || 3) : 3;
  
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
 * Abbreviate text according to rules
 * @param {string} text - Text to abbreviate
 * @param {number} maxLength - Maximum length (default 15)
 * @returns {string} Abbreviated text
 */
function abbreviateText(text, maxLength = 15) {
  if (!text) return '';
  
  let result = text;
  
  // Handle "Super Mario World" -> "SMW.."
  if (result.startsWith('Super Mario World')) {
    result = 'SMW..' + result.substring('Super Mario World'.length);
  }
  // Handle "Super Mario" -> "SM.."
  else if (result.startsWith('Super Mario')) {
    result = 'SM..' + result.substring('Super Mario'.length);
  }
  // Handle "Super" at start (if there are other words)
  else if (result.startsWith('Super ') && result.length > 6) {
    result = result.substring(6); // Remove "Super "
  }
  
  // Truncate if longer than maxLength
  if (result.length > maxLength) {
    result = result.substring(0, maxLength - 2) + '..';
  }
  
  return result;
}

/**
 * Get difficulty mnemonic from numeric difficulty (0-7)
 * @param {number} difficulty - Numeric difficulty
 * @returns {string} Mnemonic
 */
function getDifficultyMnemonic(difficulty) {
  if (difficulty === null || difficulty === undefined) return '';
  const map = {
    0: 'Ne',
    1: 'Casual',
    2: 'Med',
    3: 'Adv',
    4: 'Exp',
    5: 'Master',
    6: 'GM',
    7: 'GM+'
  };
  return map[difficulty] || '';
}

/**
 * Get game mnemonics from combinedtype and tags
 * @param {string} combinedtype - Combined type string
 * @param {string} tags - Tags string (comma-separated)
 * @returns {Array<string>} Array of unique mnemonics
 */
function getGameMnemonics(combinedtype, tags) {
  const mnemonics = new Set();
  const searchText = ((combinedtype || '') + ' ' + (tags || '')).toLowerCase();
  
  // Check for keywords (order matters - more specific first)
  if (searchText.includes('tool-assisted')) mnemonics.add('tas-only');
  if (searchText.includes('very hard')) mnemonics.add('master');
  if (searchText.includes('kaizo')) mnemonics.add('kaizo');
  if (searchText.includes('puzzle')) mnemonics.add('puzzle');
  if (searchText.includes('troll')) mnemonics.add('troll');
  if (searchText.includes('cape')) mnemonics.add('cape');
  if (searchText.includes('maze')) mnemonics.add('maze');
  // Check for "hard" before "expert" to avoid duplicates
  // "Hard" maps to "expert", but if "expert" is already in text, use that
  if (searchText.includes('hard') && !searchText.includes('expert')) {
    mnemonics.add('expert');
  }
  if (searchText.includes('expert')) mnemonics.add('expert');
  if (searchText.includes('master')) mnemonics.add('master');
  if (searchText.includes('easy')) mnemonics.add('ez');
  if (searchText.includes('beginner')) mnemonics.add('ez');
  if (searchText.includes('casual')) mnemonics.add('ez');
  
  return Array.from(mnemonics);
}

/**
 * Get stage mnemonics from flags and tags
 * @param {Object} stage - Stage object with flags and tags
 * @returns {Array<string>} Array of mnemonics (with - prefix)
 */
function getStageMnemonics(stage) {
  const mnemonics = [];
  
  if (stage.boss === 1) mnemonics.push('-boss');
  if (stage.ghouse === 1) mnemonics.push('-ghost');
  if (stage.water === 1) mnemonics.push('-water');
  if (stage.castle === 1) mnemonics.push('-castle');
  if (stage.spalace === 1) mnemonics.push('-switch');
  
  // Check stagetags
  if (stage.stagetags) {
    const tags = stage.stagetags.toLowerCase();
    if (tags.includes('kaizo')) mnemonics.push('-kaizo');
    if (tags.includes('cape')) mnemonics.push('-cape');
    if (tags.includes('autoscroller') || tags.includes('scroller')) {
      mnemonics.push('-scroller');
    }
  }
  
  return mnemonics;
}

/**
 * Map difficulty string to numeric value (0-7)
 * @param {string} difficulty - Difficulty string
 * @returns {number|null} Numeric difficulty or null
 */
function mapDifficultyToNumber(difficulty) {
  if (!difficulty) return null;
  const lower = difficulty.toLowerCase();
  const map = {
    'newcomer': 0,
    'casual': 1,
    'intermediate': 2,
    'skilled': 2,
    'advanced': 3,
    'hard': 3,
    'expert': 4,
    'master': 5,
    'grandmaster': 6,
    'grandmaster plus': 7,
    'tool-assisted': 8
  };
  return map[lower] ?? null;
}

/**
 * Abbreviate stage tags (comma-separated list)
 * @param {string} tags - Comma-separated tags
 * @returns {string} Abbreviated tags
 */
function abbreviateStageTags(tags) {
  if (!tags) return '';
  const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
  if (tagList.length === 0) return '';
  
  // Abbreviate each tag to 3 characters max
  const abbreviated = tagList.map(tag => {
    if (tag.length <= 3) return tag;
    return tag.substring(0, 3);
  });
  
  return abbreviated.join(',');
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
             completed_at_ms, total_challenges, completed_challenges
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
        rr.revealed_early,
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
    
    // Get author information, game difficulty, combinedtype, tags for each game
    const gameInfo = new Map();
    if (results.length > 0) {
      const gameids = [...new Set(results.map(r => r.gameid).filter(Boolean))];
      if (gameids.length > 0) {
        const placeholders = gameids.map(() => '?').join(',');
        const gameRows = rhdataDb.prepare(`
          SELECT gameid, author, difficulty, combinedtype, tags
          FROM gameversions
          WHERE gameid IN (${placeholders})
            AND version = (SELECT MAX(version) FROM gameversions gv2 WHERE gv2.gameid = gameversions.gameid)
        `).all(...gameids);
        gameRows.forEach(row => {
          const numDifficulty = mapDifficultyToNumber(row.difficulty);
          const difficultyMnemonic = numDifficulty !== null ? getDifficultyMnemonic(numDifficulty) : '';
          const gameMnemonics = getGameMnemonics(row.combinedtype || '', row.tags || '');
          gameInfo.set(row.gameid, {
            author: row.author || '',
            difficulty: row.difficulty || '',
            difficultyMnemonic: difficultyMnemonic,
            gameMnemonics: gameMnemonics
          });
        });
      }
    }
    
    // Get stage information (difficulty, tags, flags) for each stage
    const stageInfo = new Map();
    if (results.length > 0) {
      const stageKeys = results
        .filter(r => r.gameid && (r.levelnumber || r.exit_number))
        .map(r => ({ gameid: r.gameid, levelnumber: r.levelnumber || r.exit_number }));
      
      if (stageKeys.length > 0) {
        for (const stageKey of stageKeys) {
          const stageRow = rhdataDb.prepare(`
            SELECT difficulty, stagetags, boss, ghouse, water, castle, spalace
            FROM gamestages
            WHERE gameid = ? AND levelnumber = ?
            LIMIT 1
          `).get(stageKey.gameid, stageKey.levelnumber);
          
          if (stageRow) {
            const key = `${stageKey.gameid}-${stageKey.levelnumber}`;
            const difficultyMnemonic = stageRow.difficulty !== null && stageRow.difficulty !== undefined
              ? getDifficultyMnemonic(stageRow.difficulty)
              : '';
            const stageMnemonics = getStageMnemonics(stageRow);
            stageInfo.set(key, {
              difficulty: stageRow.difficulty !== null && stageRow.difficulty !== undefined ? stageRow.difficulty : 0,
              difficultyMnemonic: difficultyMnemonic,
              tags: stageRow.stagetags || '',
              stageMnemonics: stageMnemonics
            });
          }
        }
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
      text-shadow: 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px 0 0 #000;

      /* background: #1a1a1a;  */
      background: transparent;
      /* color: #e0e0e0; */
      color: black;
      padding: 10px;
      display: flex;
      justify-content: center;
    }
    .runview-container {
      width: ${runviewwidth}px;
      min-height: 200px;
      /* background: #2a2a2a; */
      background: transparent;
      border: none; /* 2px solid #444; */
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
    
    // Get current challenge details
    const currentGameInfo = currentChallenge.gameid ? gameInfo.get(currentChallenge.gameid) : null;
    const currentStageKey = currentChallenge.gameid && (currentChallenge.levelnumber || currentChallenge.exit_number)
      ? `${currentChallenge.gameid}-${currentChallenge.levelnumber || currentChallenge.exit_number}`
      : null;
    const currentStageInfo = currentStageKey ? stageInfo.get(currentStageKey) : null;
    
    // Check if run is finished (completed status or all challenges done)
    const allChallengesDone = results.length > 0 && results.every(r => r.status === 'success' || r.status === 'ok' || r.status === 'skipped');
    const isRunFinished = run.status === 'completed' || allChallengesDone;
    
    // Check if run hasn't started yet
    const isRunNotStarted = run.status === 'preparing' || !run.started_at_ms;
    
    // Calculate current running time
    const now = Date.now();
    let runElapsedMs = 0;
    let currentChallengeElapsedMs = 0;
    let finalRunTimeMs = null;
    
    if (isRunFinished && run.started_at_ms) {
      // Run is finished - calculate final time from completed_at or use last challenge's completed_at
      const completedAt = run.completed_at_ms || 
        (results.length > 0 && results[results.length - 1].completed_at_ms) || 
        null;
      
      if (completedAt) {
        finalRunTimeMs = completedAt - run.started_at_ms;
        if (run.pause_milliseconds) {
          finalRunTimeMs -= run.pause_milliseconds;
        }
        if (finalRunTimeMs < 0) finalRunTimeMs = 0;
      }
    } else if (!isRunNotStarted && run.started_at_ms) {
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
    
    // Calculate current challenge elapsed time
    // Challenge start time should be when the previous challenge was completed (or run start for first challenge)
    let actualChallengeStartMs = null;
    if (!isRunNotStarted && !isRunFinished) {
      if (currentIndex > 0) {
        // Use previous challenge's completion time as this challenge's start time
        const previousChallenge = results[currentIndex - 1];
        actualChallengeStartMs = previousChallenge.completed_at_ms;
      } else {
        // First challenge starts when the run starts
        actualChallengeStartMs = run.started_at_ms;
      }
      
      // Only use challenge's started_at_ms if it's significantly different from run start
      // (meaning it was explicitly set when the challenge became current)
      if (currentChallenge.started_at_ms && run.started_at_ms) {
        const timeDiff = Math.abs(currentChallenge.started_at_ms - run.started_at_ms);
        // If challenge start is more than 1 second different from run start, use it
        if (timeDiff > 1000) {
          actualChallengeStartMs = currentChallenge.started_at_ms;
        }
      }
      
      if (actualChallengeStartMs) {
        currentChallengeElapsedMs = now - actualChallengeStartMs;
        if (currentChallenge.pause_milliseconds) {
          currentChallengeElapsedMs -= currentChallenge.pause_milliseconds;
        }
      }
    }
    
    // Calculate minimum height (300px base + ~40px per challenge)
    const minHeight = Math.max(300, 300 + (displayIndices.length * 40));
    
    // Format current challenge details
    const entryType = currentChallenge.entry_type === 'random_game' ? 'Random Game' :
                      currentChallenge.entry_type === 'random_stage' ? 'Random Stage' :
                      currentChallenge.entry_type === 'stage' ? 'Stage' : 'Game';
    
    const currentGameName = currentChallenge.game_name || currentChallenge.gameid || '???';
    const currentAuthor = currentGameInfo ? (currentGameInfo.author || '') : '';
    const currentGameDifficulty = currentGameInfo ? (currentGameInfo.difficulty || '') : '';
    const currentGameDifficultyMnemonic = currentGameInfo ? (currentGameInfo.difficultyMnemonic || '') : '';
    const currentGameMnemonics = currentGameInfo ? (currentGameInfo.gameMnemonics || []) : [];
    
    const currentStageId = currentChallenge.levelnumber || currentChallenge.exit_number || '';
    const currentStageName = currentChallenge.levelname || currentChallenge.stage_description || '';
    const currentStageDifficulty = currentStageInfo ? (currentStageInfo.difficulty || '') : '';
    const currentStageDifficultyMnemonic = currentStageInfo ? (currentStageInfo.difficultyMnemonic || '') : '';
    const currentStageTags = currentStageInfo ? (currentStageInfo.tags || '') : '';
    const currentStageMnemonics = currentStageInfo ? (currentStageInfo.stageMnemonics || []) : [];
    
    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Run View - ${escapeHtml(run.run_name)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      text-shadow: 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px 0 0 #000;

      /* background: #1a1a1a; */
      background: transparent;
      color: #e0e0e0;
      padding: 10px;
      display: flex;
      justify-content: center;
    }
    .runview-container {
      width: ${runviewwidth}px;
      min-height: ${minHeight}px;
      /* background: #2a2a2a; */
      background: transparent;
      /* border: 2px solid #444; */
      border: none;
      border-radius: 8px;
      padding: 4px; /* 12px; -> 4px */
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .run-header {
      text-align: center;
      margin-bottom: 2px;
      padding-bottom: 1px;
      border-bottom: 1px solid #444;
    }
    .run-name {
      font-size: 18px;
      font-weight: bold;
      color: #fff;
    }
    .timer-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 6px /* 10px */  0;
      padding: 4px; /* 8px; */
      /* background: #1e1e1e; */
      background: transparent;
      border-radius: 6px;
    }
    .run-timer {
      font-size: 64px;
      font-weight: bold;
      color: #4CAF50;
      font-family: 'Courier New', monospace;
    }
    .run-timer.finished {
      color: #FFD700;
    }
    .challenge-timer {
      font-size: 28px;
      font-weight: bold;
      color: #4CAF50;
      font-family: 'Courier New', monospace;
    }
    .finished-label {
      font-size: 24px;
      font-weight: bold;
      color: #FFD700;
      text-align: center;
      padding: 10px;
    }
    .not-started-label {
      font-size: 18px;
      font-weight: bold;
      color: #888;
      text-align: center;
      padding: 10px;
    }
    .current-challenge-details {
      /* background: #1e1e1e; */
      background: transparent;
      border-radius: 6px;
      padding: 3px;
      margin: 1px 0;
      font-size: 15px;
      line-height: 1.6;
    }
    .challenge-entry-time {
      color: #4CAF50;
      font-size: 18px;
    }
    .current-challenge-details .entry-type {
      font-size: 18px;
      font-weight: bold;
      color: #4CAF50;
    }
    .current-challenge-details .game-line {
      margin-bottom: 4px;
    }
    .current-challenge-details .stage-line {
      margin-bottom: 4px;
    }
    .current-challenge-details .tags-line {
      color: /*#888*/ white;
      font-size: 11px;
    }
    .challenges-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1px;
      font-size: 14px;
    }
    .challenges-table thead {
      display: none;
    }
    .challenges-table th {
      /* background: #333; */
      background: transparent;
      color: #fff;
      /* padding: 6px 4px; */
      padding: 3px 2px; 
      text-align: left;
      font-size: 10px;
      font-weight: bold;
      border-bottom: 2px solid #555;
    }
    .challenges-table td {
      padding: 3px 2px; 
      /* padding: 6px 4px; */
      font-size: 13px;
      border-bottom: 1px solid #333;
    }
    /* .challenges-table tr.current {
      background: #3a4a3a;
      border-left: 3px solid #4CAF50;
    }*/
    .challenges-table tr.current {
      /*background: #3a4a3a;*/
            background: #283233; /* #3a494a; */
      border-left: 3px solid #4ca8af; /* #4CAF50;*/
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
      color: /*#888*/ lightgray;
      font-size: 11px;
    }
    .game-name {
      color: white;
      font-weight: 500;
      font-size: 13px;
    }
    .stage-info {
      color: white;
      font-size: 12px;
    }
    .author {
      color: #888;
      font-size: 10px;
    }

    .current-challenge-details .game-id {
       font-size: 16px;
       color: lightred;
    }
    .current-challenge-details .game-name {
       font-size: 20px;
       color: white;
    }
    .current-challenge-details .stage-info {
       font-size: 18px;
       color: white;
    }
    .current-challenge-details .author {
       font-size: 20px;
       color: lightgray;
    }
    .current-challenge-details .author-line {
        font-size: 18px;
	color: lightgray;
    }


    .status-icon {
      font-size: 18px;
      display: inline-block;
      width: 20px;
      text-align: center;
    }
    .status-icon.done {
      color: #4CAF50;
    }
    .status-icon.skip {
      color: #ff0000;
    }
    .status-icon.early {
      color: #ffaa00;
    }
    .time {
      font-family: 'Courier New', monospace;
      color: #4CAF50;
      background: black;
      font-size: 16px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="runview-container">
    <div class="run-header">
      <div class="run-name">${escapeHtml(run.run_name)} (${currentChallengeNum}/${totalChallenges})</div>
    </div>
    
    ${isRunNotStarted ? `
    <div class="not-started-label">Challenge not started yet</div>
    ` : isRunFinished ? `
    <div class="timer-row">
      <div class="run-timer finished" id="run-timer">${finalRunTimeMs !== null ? escapeHtml(formatDuration(finalRunTimeMs)) : '00:00:00'}</div>
      <div class="finished-label">Finished</div>
    </div>
    ` : `
    <div class="timer-row">
      <div class="run-timer" id="run-timer">00:00:00</div>
      <div class="challenge-timer" id="challenge-timer">00:00:00</div>
    </div>
    `}
    
    <div class="current-challenge-details">
      <div class="game-line">
        <span class="entry-type">${escapeHtml(entryType)}</span> 
        <span class="game-id">${escapeHtml(currentChallenge.gameid || '—')}</span> - 
        <span class="game-name">${escapeHtml(abbreviateText(currentGameName))}</span>
        ${currentGameDifficulty ? `<span class="author">(${escapeHtml(currentGameDifficulty)}${currentGameDifficultyMnemonic ? ' ' + escapeHtml(currentGameDifficultyMnemonic) : ''}${currentGameMnemonics.length > 0 ? ' ' + escapeHtml(currentGameMnemonics.join(' ')) : ''})</span>` : ''}
      </div>
      ${currentStageId ? `
      <div class="stage-line">
        <span class="stage-info">${escapeHtml(currentStageId)}</span>
        ${currentStageName ? ` <span class="stage-info">${escapeHtml(abbreviateText(currentStageName))}</span>` : ''}
        ${(currentStageDifficulty !== null && currentStageDifficulty !== undefined && currentStageDifficulty !== '') || currentStageDifficultyMnemonic || currentStageMnemonics.length > 0 ? `<span class="author">(${currentStageDifficulty !== null && currentStageDifficulty !== undefined && currentStageDifficulty !== '' ? escapeHtml(String(currentStageDifficulty)) : ''}${currentStageDifficultyMnemonic ? (currentStageDifficulty !== null && currentStageDifficulty !== undefined && currentStageDifficulty !== '' ? ' ' : '') + escapeHtml(currentStageDifficultyMnemonic) : ''}${currentStageMnemonics.length > 0 ? ((currentStageDifficulty !== null && currentStageDifficulty !== undefined && currentStageDifficulty !== '') || currentStageDifficultyMnemonic ? ' ' : '') + escapeHtml(currentStageMnemonics.join('')) : ''})</span>` : ''}
      ` : ''}

      ${currentStageTags ? `
      <span class="tags-line">
        ${escapeHtml(abbreviateStageTags(currentStageTags))}
      </span>
      ` : ''}

      ${currentAuthor ? `
      <span class="author-line">
        <span class="author">By: ${escapeHtml(abbreviateText(currentAuthor,21))}</span>
      </span>
      ` : ''}
    </div>
    
    <table class="challenges-table">
      <!-- Column headers (hidden from display but documented):
           Column 1: Status (icon) - Green checkmark for done, Red X for skipped, Yellow ! for early reveal
           Column 2: Type - Abbreviated entry type (RNG-S, RNG-G, Stage, Game)
           Column 3: Game - Game ID and Game Name
           Column 4: Stage - Stage ID and Stage Name
           Column 5: Time - Duration or current timer
      -->
      <thead style="display: none;">
        <tr>
          <th>Status</th>
          <th>Type</th>
          <th>Game</th>
          <th>Stage</th>
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
  
  // Abbreviate entry type
  let entryTypeAbbrev = '';
  if (result.entry_type === 'random_game') {
    entryTypeAbbrev = 'RNG-G';
  } else if (result.entry_type === 'random_stage') {
    entryTypeAbbrev = 'RNG-S';
  } else if (result.entry_type === 'stage') {
    entryTypeAbbrev = 'Stage';
  } else {
    entryTypeAbbrev = 'Game';
  }
  
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
  const gameInfoForResult = result.gameid ? gameInfo.get(result.gameid) : null;
  const author = gameInfoForResult ? (gameInfoForResult.author || '') : '';
  
  // Status icon - only show for done, skipped, or early reveal
  let statusIcon = '';
  if (isCompleted) {
    statusIcon = '<span class="status-icon done">✓</span>';
  } else if (isSkipped) {
    statusIcon = '<span class="status-icon skip">✗</span>';
  } else if (result.revealed_early) {
    statusIcon = '<span class="status-icon early">!</span>';
  } else {
    // Pending or Running - no icon displayed
    statusIcon = '<span class="status-icon"></span>';
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
          <td>${statusIcon}</td>
          <td><span class="entry-type">${escapeHtml(entryTypeAbbrev)}</span></td>
          <td>
            <span class="game-id">${escapeHtml(result.gameid || '—')}</span>
            <span class="game-name">${escapeHtml(abbreviateText(gameName))}</span>
            <span class="stage-info">${escapeHtml(abbreviateText(stageInfo || '—'))}</span></td>
          <td><span class="challenge-entry-time">${timeText}</span></td>
        </tr>`;
}).join('\n')}
      </tbody>
    </table>
  </div>
  
  <script>
    const isRunFinished = ${isRunFinished};
    const isRunNotStarted = ${isRunNotStarted};
    const finalRunTimeMs = ${finalRunTimeMs !== null ? finalRunTimeMs : 'null'};
    
    // Run timer data
    const runStartMs = ${run.started_at_ms || 0};
    const runPauseMs = ${run.pause_milliseconds || 0};
    const runPauseStartMs = ${run.pause_start_ms || 0};
    
    // Current challenge timer data
    // Use the actual challenge start time calculated on the server
    const challengeStartMs = ${actualChallengeStartMs || 0};
    const challengePauseMs = ${currentChallenge.pause_milliseconds || 0};
    
    function formatTime(milliseconds) {
      const totalSeconds = Math.floor(milliseconds / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return \`\${String(hours).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:\${String(seconds).padStart(2, '0')}\`;
    }
    
    function updateTimers() {
      // Don't update timers if run is finished or not started
      if (isRunFinished || isRunNotStarted) {
        return;
      }
      
      const now = Date.now();
      
      // Update run timer
      if (runStartMs) {
        let runElapsed = now - runStartMs - runPauseMs;
        if (runPauseStartMs) {
          runElapsed -= (now - runPauseStartMs);
        }
        if (runElapsed < 0) runElapsed = 0;
        const runTimerEl = document.getElementById('run-timer');
        if (runTimerEl) {
          runTimerEl.textContent = formatTime(runElapsed);
        }
      }
      
      // Update current challenge timer
      // Challenge time = (now - challenge start) - accumulated pause time - current pause time (if paused)
      if (challengeStartMs) {
        let challengeElapsed = now - challengeStartMs - challengePauseMs;
        // If run is currently paused, subtract the current pause time from challenge timer too
        if (runPauseStartMs) {
          const currentPauseMs = now - runPauseStartMs;
          challengeElapsed -= currentPauseMs;
        }
        if (challengeElapsed < 0) challengeElapsed = 0;
        const challengeTimerEl = document.getElementById('challenge-timer');
        if (challengeTimerEl) {
          challengeTimerEl.textContent = formatTime(challengeElapsed);
        }
      }
      
      // Update challenge row timers (for current challenge in table)
      document.querySelectorAll('.time[data-start-ms]').forEach(el => {
        const startMs = parseInt(el.getAttribute('data-start-ms'), 10);
        const pauseMs = parseInt(el.getAttribute('data-pause-ms'), 10) || 0;
        if (startMs) {
          let elapsed = now - startMs - pauseMs;
          // If run is currently paused, subtract the current pause time
          if (runPauseStartMs) {
            const currentPauseMs = now - runPauseStartMs;
            elapsed -= currentPauseMs;
          }
          if (elapsed >= 0) {
            el.textContent = formatTime(elapsed);
          }
        }
      });
    }
    
    // Update timers immediately and then every second (only if run is active)
    if (!isRunFinished && !isRunNotStarted) {
      updateTimers();
      setInterval(updateTimers, 1000);
    }
    
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
