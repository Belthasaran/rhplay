#!/usr/bin/env node

/**
 * test_stage_feedback_save.js
 *
 * Verifies stage_feedback triplet key and extended columns.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { defaultPlaylevelPatchCode } = require('../electron/stage-test-resolution');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createTestClientdataDb(dbPath) {
  const root = path.join(__dirname, '../electron/sql/migrations');
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(path.join(root, '042_clientdata_stage_feedback.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(root, '043_clientdata_stage_feedback_extend.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(root, '067_clientdata_stage_feedback_test_fields.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(root, '068_clientdata_stage_feedback_triplet_key.sql'), 'utf8'));
  return db;
}

function saveStageFeedback(db, payload) {
  const playlevel = defaultPlaylevelPatchCode(payload.playlevel_patchcode);
  const existing = db.prepare(
    'SELECT feedback_uuid FROM stage_feedback WHERE gameid = ? AND levelnumber = ? AND playlevel_patchcode = ?'
  ).get(payload.gameid, payload.levelnumber, playlevel);

  const feedbackUuid = existing?.feedback_uuid || crypto.randomUUID();

  if (existing) {
    db.prepare(`
      UPDATE stage_feedback SET
        difficulty_feedback = ?,
        feedback_source = ?,
        test_result = ?,
        tag_feedback = ?,
        stage_uuid = ?,
        playlevel_patchcode = ?
      WHERE feedback_uuid = ?
    `).run(
      payload.difficulty_feedback,
      payload.feedback_source,
      payload.test_result,
      payload.tag_feedback,
      payload.stage_uuid,
      playlevel,
      feedbackUuid
    );
  } else {
    db.prepare(`
      INSERT INTO stage_feedback
        (feedback_uuid, gameid, levelnumber, difficulty_feedback,
         feedback_source, test_result, tag_feedback, stage_uuid, playlevel_patchcode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedbackUuid,
      payload.gameid,
      payload.levelnumber,
      payload.difficulty_feedback,
      payload.feedback_source,
      payload.test_result,
      payload.tag_feedback,
      payload.stage_uuid,
      playlevel
    );
  }

  return db.prepare('SELECT * FROM stage_feedback WHERE feedback_uuid = ?').get(feedbackUuid);
}

function testSaveWithTestFields() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-fb-save-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createTestClientdataDb(dbPath);

  const tagFeedback = JSON.stringify({ kaizo: true, water: false });
  const row = saveStageFeedback(db, {
    gameid: '99999',
    levelnumber: '10A',
    difficulty_feedback: 6,
    feedback_source: 'stage_test',
    test_result: 'accept',
    tag_feedback: tagFeedback,
    stage_uuid: 'stage-uuid-1',
    playlevel_patchcode: '2lvno',
  });

  assert(row.feedback_source === 'stage_test', 'Expected feedback_source');
  assert(row.test_result === 'accept', 'Expected test_result');
  assert(row.tag_feedback === tagFeedback, 'Expected tag_feedback');
  assert(row.playlevel_patchcode === '2lvno', 'Expected playlevel_patchcode');

  db.close();
}

function testTripletAllowsDifferentPlaylevel() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-fb-save-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createTestClientdataDb(dbPath);

  saveStageFeedback(db, {
    gameid: '100',
    levelnumber: '001',
    difficulty_feedback: 3,
    feedback_source: 'stage_test',
    test_result: 'accept',
    tag_feedback: null,
    stage_uuid: null,
    playlevel_patchcode: '2lvno',
  });

  const other = saveStageFeedback(db, {
    gameid: '100',
    levelnumber: '001',
    difficulty_feedback: 5,
    feedback_source: 'stage_test',
    test_result: 'accept',
    tag_feedback: null,
    stage_uuid: null,
    playlevel_patchcode: '1lvno',
  });

  const count = db.prepare('SELECT COUNT(*) AS c FROM stage_feedback WHERE gameid = ? AND levelnumber = ?').get('100', '001').c;
  assert(count === 2, 'Expected two rows for different playlevel codes');
  assert(other.playlevel_patchcode === '1lvno', 'Expected 1lvno row');

  db.close();
}

function testUpsertReplacesSameTriplet() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-fb-save-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createTestClientdataDb(dbPath);

  saveStageFeedback(db, {
    gameid: '100',
    levelnumber: '001',
    difficulty_feedback: 3,
    feedback_source: 'prepare_run',
    test_result: null,
    tag_feedback: null,
    stage_uuid: null,
    playlevel_patchcode: '2lvno',
  });

  const updated = saveStageFeedback(db, {
    gameid: '100',
    levelnumber: '001',
    difficulty_feedback: 4,
    feedback_source: 'stage_test',
    test_result: 'reject',
    tag_feedback: JSON.stringify({ troll: true }),
    stage_uuid: 's2',
    playlevel_patchcode: '2lvno',
  });

  const count = db.prepare('SELECT COUNT(*) AS c FROM stage_feedback').get().c;
  assert(count === 1, 'Expected single row after triplet upsert');
  assert(updated.difficulty_feedback === 4, 'Expected updated difficulty');
  assert(updated.test_result === 'reject', 'Expected reject on update');

  db.close();
}

function testNullPlaylevelBackfill() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-fb-save-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createTestClientdataDb(dbPath);

  const row = saveStageFeedback(db, {
    gameid: '200',
    levelnumber: '002',
    difficulty_feedback: 2,
    feedback_source: 'prepare_run',
    test_result: null,
    tag_feedback: null,
    stage_uuid: null,
    playlevel_patchcode: null,
  });

  assert(row.playlevel_patchcode === '2lvno', 'Expected default playlevel');

  db.close();
}

function main() {
  testSaveWithTestFields();
  testTripletAllowsDifferentPlaylevel();
  testUpsertReplacesSameTriplet();
  testNullPlaylevelBackfill();
  console.log('✅ test_stage_feedback_save passed');
}

main();
