#!/usr/bin/env node
'use strict';

/**
 * test_game_difficulty_level.js
 *
 * Tests getGameDifficultyLevel mapping (used by db:game:get-difficulty-level IPC).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const {
  getGameDifficultyLevel,
  parseRawDifficulty,
} = require('../electron/utils/difficulty-mapper');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createRhdataDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE gameversions (
      gameid TEXT,
      version INTEGER,
      difficulty TEXT,
      raw_difficulty TEXT,
      legacy_type TEXT,
      combinedtype TEXT,
      PRIMARY KEY (gameid, version)
    );
    CREATE TABLE game_difficulty_map (
      map_type TEXT NOT NULL,
      map_string TEXT NOT NULL,
      difficulty_number INTEGER NOT NULL,
      PRIMARY KEY (map_type, map_string)
    );
  `);
  db.close();
}

function makeDbQueryFn(dbPath) {
  const db = new Database(dbPath);
  const stmt = db.prepare(`
    SELECT difficulty_number FROM game_difficulty_map
    WHERE map_type = ? AND map_string = ?
    LIMIT 1
  `);
  return (mapType, mapString) => {
    const row = stmt.get(mapType, mapString);
    return row ? row.difficulty_number : null;
  };
}

function testParseRawDifficulty() {
  assert(parseRawDifficulty('diff_4') === 4, 'diff_4 should parse to 4');
  assert(parseRawDifficulty('invalid') === null, 'invalid raw should be null');
}

function testRawDifficultyMapping() {
  const level = getGameDifficultyLevel({ raw_difficulty: 'diff_4' }, null, 2);
  assert(level === 4, `expected 4 from raw_difficulty, got ${level}`);
}

function testDifficultyStringMapping() {
  const level = getGameDifficultyLevel({ difficulty: 'Casual' }, null, 2);
  assert(level === 2, `Casual should map to 2, got ${level}`);
}

function testLegacyTypeDbLookup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'game-diff-'));
  const dbPath = path.join(tmp, 'rhdata.db');
  createRhdataDb(dbPath);

  const setup = new Database(dbPath);
  setup.prepare(`
    INSERT INTO game_difficulty_map (map_type, map_string, difficulty_number)
    VALUES ('legacytype', 'Custom Legacy Type', 5)
  `).run();
  setup.close();

  const dbQueryFn = makeDbQueryFn(dbPath);
  const level = getGameDifficultyLevel(
    { legacy_type: 'Custom Legacy Type' },
    dbQueryFn,
    2
  );
  assert(level === 5, `DB legacy_type lookup should return 5, got ${level}`);
}

function testUnknownFallback() {
  const level = getGameDifficultyLevel({}, null, 2);
  assert(level === 2, `unknown game should fallback to 2, got ${level}`);

  const levelDefault = getGameDifficultyLevel({});
  assert(levelDefault === 3, `unknown game with default fallback should be 3, got ${levelDefault}`);
}

function main() {
  testParseRawDifficulty();
  testRawDifficultyMapping();
  testDifficultyStringMapping();
  testLegacyTypeDbLookup();
  testUnknownFallback();
  console.log('test_game_difficulty_level: ok');
}

main();
