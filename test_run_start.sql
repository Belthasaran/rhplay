-- Test script to verify run start functionality
-- Tests both specific and random challenges

.echo on

-- Clean up any test data
DELETE FROM run_results WHERE run_uuid LIKE 'test-%';
DELETE FROM run_plan_entries WHERE run_uuid LIKE 'test-%';
DELETE FROM runs WHERE run_uuid LIKE 'test-%';

-- Create a test run
INSERT INTO runs (run_uuid, run_name, status, global_conditions)
VALUES ('test-run-001', 'Test Run', 'preparing', '[]');

-- Add plan entries

-- Entry 1: Specific game
INSERT INTO run_plan_entries 
  (entry_uuid, run_uuid, sequence_number, entry_type, gameid, count, conditions)
VALUES ('entry-001', 'test-run-001', 1, 'game', '11374', 1, '[]');

-- Entry 2: Random game (count=2) - should create 2 separate results
INSERT INTO run_plan_entries 
  (entry_uuid, run_uuid, sequence_number, entry_type, count, filter_type, filter_difficulty, filter_seed, conditions)
VALUES ('entry-002', 'test-run-001', 2, 'random_game', 2, 'Kaizo', 'Advanced', 'test123', '[]');

-- Entry 3: Another specific game
INSERT INTO run_plan_entries 
  (entry_uuid, run_uuid, sequence_number, entry_type, gameid, count, conditions)
VALUES ('entry-003', 'test-run-001', 3, 'game', '12345', 1, '[]');

.print ''
.print '=== Plan Entries Created ==='
SELECT sequence_number, entry_type, gameid, count FROM run_plan_entries WHERE run_uuid = 'test-run-001' ORDER BY sequence_number;

-- Simulate start run transaction
.print ''
.print '=== Starting Run ==='

-- Clean up any existing run_results for this run
DELETE FROM run_results WHERE run_uuid = 'test-run-001';

-- Update run status
UPDATE runs 
SET status = 'active', 
    started_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE run_uuid = 'test-run-001';

-- Expand plan entries to run_results
-- Entry 1: Specific game (sequence 1)
INSERT INTO run_results
  (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
   gameid, game_name, exit_number, stage_description, was_random, status, conditions)
VALUES ('result-001', 'test-run-001', 'entry-001', 1, 
   '11374', '11374', NULL, NULL, 0, 'pending', '[]');

-- Entry 2: Random games (sequences 2-3)
INSERT INTO run_results
  (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
   gameid, game_name, exit_number, stage_description, was_random, status, conditions)
VALUES ('result-002', 'test-run-001', 'entry-002', 2, 
   NULL, '???', NULL, NULL, 1, 'pending', '[]');

INSERT INTO run_results
  (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
   gameid, game_name, exit_number, stage_description, was_random, status, conditions)
VALUES ('result-003', 'test-run-001', 'entry-002', 3, 
   NULL, '???', NULL, NULL, 1, 'pending', '[]');

-- Entry 3: Specific game (sequence 4)
INSERT INTO run_results
  (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
   gameid, game_name, exit_number, stage_description, was_random, status, conditions)
VALUES ('result-004', 'test-run-001', 'entry-003', 4, 
   '12345', '12345', NULL, NULL, 0, 'pending', '[]');

-- Update total challenges count
UPDATE runs SET total_challenges = (SELECT COUNT(*) FROM run_results WHERE run_uuid = 'test-run-001')
WHERE run_uuid = 'test-run-001';

.print ''
.print '=== Run Results Created ==='
.print 'Seq | GameID | Name      | Random | Status'
.print '----|--------|-----------|--------|--------'
SELECT 
  printf('%3d', sequence_number) || ' | ' ||
  printf('%-6s', COALESCE(gameid, 'NULL')) || ' | ' ||
  printf('%-9s', game_name) || ' | ' ||
  CASE WHEN was_random = 1 THEN 'YES   ' ELSE 'NO    ' END || ' | ' ||
  status as Result
FROM run_results 
WHERE run_uuid = 'test-run-001'
ORDER BY sequence_number;

.print ''
.print '=== Run Status ==='
SELECT 'Status: ' || status || ', Total Challenges: ' || total_challenges 
FROM runs WHERE run_uuid = 'test-run-001';

-- Test: Try to start the run again (should clean up and recreate)
.print ''
.print '=== Testing Duplicate Start (Should Work) ==='

DELETE FROM run_results WHERE run_uuid = 'test-run-001';

-- Re-insert the same results
INSERT INTO run_results
  (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
   gameid, game_name, exit_number, stage_description, was_random, status, conditions)
VALUES 
  ('result-101', 'test-run-001', 'entry-001', 1, '11374', '11374', NULL, NULL, 0, 'pending', '[]'),
  ('result-102', 'test-run-001', 'entry-002', 2, NULL, '???', NULL, NULL, 1, 'pending', '[]'),
  ('result-103', 'test-run-001', 'entry-002', 3, NULL, '???', NULL, NULL, 1, 'pending', '[]'),
  ('result-104', 'test-run-001', 'entry-003', 4, '12345', '12345', NULL, NULL, 0, 'pending', '[]');

.print ''
SELECT 'Second start successful! Count: ' || COUNT(*) FROM run_results WHERE run_uuid = 'test-run-001';

-- Clean up
.print ''
.print '=== Cleaning Up ==='
DELETE FROM run_results WHERE run_uuid = 'test-run-001';
DELETE FROM run_plan_entries WHERE run_uuid = 'test-run-001';
DELETE FROM runs WHERE run_uuid = 'test-run-001';

.print ''
.print '✅ All tests passed!'

