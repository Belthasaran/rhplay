/**
 * Migration: Restore fairness and challenge quality columns if missing
 * Date: 2025-01-XX
 * Database: clientdata.db
 * Purpose: Restore user_fairness_rating, user_fairness_comment, user_challenge_quality_rating,
 *          and user_challenge_quality_comment columns if they were accidentally removed
 *          by migration 057 before it was fixed.
 */

const path = require('path');
const Database = require('better-sqlite3');

function columnExists(db, tableName, columnName) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some(col => col.name === columnName);
  } catch (error) {
    return false;
  }
}

function run(dbPath) {
  const db = new Database(dbPath);
  
  try {
    // Add columns to user_game_annotations if missing
    if (!columnExists(db, 'user_game_annotations', 'user_fairness_rating')) {
      console.log('Adding user_fairness_rating to user_game_annotations...');
      db.exec('ALTER TABLE user_game_annotations ADD COLUMN user_fairness_rating INTEGER');
    }
    
    if (!columnExists(db, 'user_game_annotations', 'user_fairness_comment')) {
      console.log('Adding user_fairness_comment to user_game_annotations...');
      db.exec('ALTER TABLE user_game_annotations ADD COLUMN user_fairness_comment TEXT');
    }
    
    if (!columnExists(db, 'user_game_annotations', 'user_challenge_quality_rating')) {
      console.log('Adding user_challenge_quality_rating to user_game_annotations...');
      db.exec('ALTER TABLE user_game_annotations ADD COLUMN user_challenge_quality_rating INTEGER');
    }
    
    if (!columnExists(db, 'user_game_annotations', 'user_challenge_quality_comment')) {
      console.log('Adding user_challenge_quality_comment to user_game_annotations...');
      db.exec('ALTER TABLE user_game_annotations ADD COLUMN user_challenge_quality_comment TEXT');
    }
    
    // Add columns to user_game_version_annotations if missing
    if (!columnExists(db, 'user_game_version_annotations', 'user_fairness_rating')) {
      console.log('Adding user_fairness_rating to user_game_version_annotations...');
      db.exec('ALTER TABLE user_game_version_annotations ADD COLUMN user_fairness_rating INTEGER');
    }
    
    if (!columnExists(db, 'user_game_version_annotations', 'user_fairness_comment')) {
      console.log('Adding user_fairness_comment to user_game_version_annotations...');
      db.exec('ALTER TABLE user_game_version_annotations ADD COLUMN user_fairness_comment TEXT');
    }
    
    if (!columnExists(db, 'user_game_version_annotations', 'user_challenge_quality_rating')) {
      console.log('Adding user_challenge_quality_rating to user_game_version_annotations...');
      db.exec('ALTER TABLE user_game_version_annotations ADD COLUMN user_challenge_quality_rating INTEGER');
    }
    
    if (!columnExists(db, 'user_game_version_annotations', 'user_challenge_quality_comment')) {
      console.log('Adding user_challenge_quality_comment to user_game_version_annotations...');
      db.exec('ALTER TABLE user_game_version_annotations ADD COLUMN user_challenge_quality_comment TEXT');
    }
    
    console.log('Migration 058 completed successfully.');
    console.log('Restored fairness and challenge quality columns if they were missing.');
    
  } finally {
    db.close();
  }
}

module.exports = { run };

