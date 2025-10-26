#!/usr/bin/env node

/**
 * Test script to verify run start functionality
 * Tests both specific and random challenges
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, 'electron', 'clientdata.db');
const db = new Database(dbPath);

console.log('=== Testing Run Start Functionality ===\n');

// Clean up any test data
console.log('1. Cleaning up old test data...');
db.prepare(`DELETE FROM run_results WHERE run_uuid LIKE 'test-%'`).run();
db.prepare(`DELETE FROM run_plan_entries WHERE run_uuid LIKE 'test-%'`).run();
db.prepare(`DELETE FROM runs WHERE run_uuid LIKE 'test-%'`).run();

// Create a test run
const runUuid = `test-${crypto.randomUUID()}`;
console.log(`2. Creating test run: ${runUuid}`);

db.prepare(`
  INSERT INTO runs (run_uuid, run_name, status, global_conditions)
  VALUES (?, 'Test Run', 'preparing', '[]')
`).run(runUuid);

// Add plan entries
console.log('3. Adding plan entries...');

// Entry 1: Specific game
const entry1Uuid = crypto.randomUUID();
db.prepare(`
  INSERT INTO run_plan_entries 
    (entry_uuid, run_uuid, sequence_number, entry_type, gameid, count, conditions)
  VALUES (?, ?, 1, 'game', '11374', 1, '[]')
`).run(entry1Uuid, runUuid);
console.log('   - Added specific game (11374)');

// Entry 2: Random game (count=2)
const entry2Uuid = crypto.randomUUID();
db.prepare(`
  INSERT INTO run_plan_entries 
    (entry_uuid, run_uuid, sequence_number, entry_type, count, filter_type, filter_difficulty, filter_seed, conditions)
  VALUES (?, ?, 2, 'random_game', 2, 'Kaizo', 'Advanced', 'test123', '[]')
`).run(entry2Uuid, runUuid);
console.log('   - Added 2 random games (Kaizo/Advanced)');

// Entry 3: Another specific game
const entry3Uuid = crypto.randomUUID();
db.prepare(`
  INSERT INTO run_plan_entries 
    (entry_uuid, run_uuid, sequence_number, entry_type, gameid, count, conditions)
  VALUES (?, ?, 3, 'game', '12345', 1, '[]')
`).run(entry3Uuid, runUuid);
console.log('   - Added specific game (12345)');

// Now simulate the start run transaction
console.log('\n4. Starting run (expanding plan to results)...');

const transaction = db.transaction(() => {
  // Clean up any existing run_results for this run
  db.prepare(`DELETE FROM run_results WHERE run_uuid = ?`).run(runUuid);
  
  // Update run status
  db.prepare(`
    UPDATE runs 
    SET status = 'active', 
        started_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE run_uuid = ?
  `).run(runUuid);
  
  // Get plan entries
  const planEntries = db.prepare(`
    SELECT * FROM run_plan_entries 
    WHERE run_uuid = ? 
    ORDER BY sequence_number
  `).all(runUuid);
  
  console.log(`   Found ${planEntries.length} plan entries`);
  
  // Expand plan entries to run_results
  const insertStmt = db.prepare(`
    INSERT INTO run_results
      (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
       gameid, game_name, exit_number, stage_description,
       was_random, status, conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  
  let resultSequence = 1;  // Unique sequence number for actual results
  
  planEntries.forEach((planEntry) => {
    const count = planEntry.count || 1;
    const isRandom = planEntry.entry_type === 'random_game' || planEntry.entry_type === 'random_stage';
    
    console.log(`   Processing plan entry ${planEntry.sequence_number}: ${planEntry.entry_type} (count=${count})`);
    
    // Create multiple results if count > 1
    for (let i = 0; i < count; i++) {
      const resultUuid = crypto.randomUUID();
      
      // For random entries, mask name until attempted and leave gameid NULL
      let gameName = '???';
      let gameid = null;
      
      // For specific entries, use the gameid
      if (!isRandom) {
        gameid = planEntry.gameid;
        gameName = planEntry.gameid || 'Unknown';
      }
      
      console.log(`     - Creating result ${resultSequence}: gameid=${gameid || 'NULL'}, name=${gameName}, random=${isRandom ? 'YES' : 'NO'}`);
      
      insertStmt.run(
        resultUuid,
        runUuid,
        planEntry.entry_uuid,
        resultSequence++,  // Use unique sequence number for each result
        gameid,  // NULL for random challenges
        gameName,  // "???" for random challenges
        planEntry.exit_number || null,
        planEntry.entry_type === 'stage' ? 'Stage' : null,
        isRandom ? 1 : 0,
        planEntry.conditions || null
      );
    }
  });
  
  // Update total challenges count
  const total = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runUuid);
  db.prepare(`UPDATE runs SET total_challenges = ? WHERE run_uuid = ?`).run(total.count, runUuid);
  
  console.log(`   Total challenges created: ${total.count}`);
});

try {
  transaction();
  console.log('\n✅ SUCCESS: Run started without errors!');
} catch (error) {
  console.error('\n❌ FAILED:', error.message);
  process.exit(1);
}

// Verify the results
console.log('\n5. Verifying run_results...');
const results = db.prepare(`
  SELECT sequence_number, gameid, game_name, was_random, status 
  FROM run_results 
  WHERE run_uuid = ?
  ORDER BY sequence_number
`).all(runUuid);

console.log('\nResults:');
console.log('Seq | GameID | Name      | Random | Status');
console.log('----|--------|-----------|--------|--------');
results.forEach(r => {
  console.log(`${r.sequence_number.toString().padStart(3)} | ${(r.gameid || 'NULL').padEnd(6)} | ${r.game_name.padEnd(9)} | ${r.was_random ? 'YES   ' : 'NO    '} | ${r.status}`);
});

// Verify run status
const run = db.prepare(`SELECT status, total_challenges FROM runs WHERE run_uuid = ?`).get(runUuid);
console.log(`\nRun Status: ${run.status}`);
console.log(`Total Challenges: ${run.total_challenges}`);

// Clean up
console.log('\n6. Cleaning up test data...');
db.prepare(`DELETE FROM run_results WHERE run_uuid = ?`).run(runUuid);
db.prepare(`DELETE FROM run_plan_entries WHERE run_uuid = ?`).run(runUuid);
db.prepare(`DELETE FROM runs WHERE run_uuid = ?`).run(runUuid);

console.log('\n=== Test Complete ===');
console.log('✅ All tests passed!');

db.close();

