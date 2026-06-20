/**
 * Migration 074: stage_feedback patch identity columns
 */

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

module.exports = function applyMigration074(db) {
  const cols = [
    ['pat_sha224', 'TEXT'],
    ['pat_sha1', 'TEXT'],
    ['result_sha1', 'TEXT'],
    ['result_sha224', 'TEXT'],
    ['patchdb_template_hashes', 'TEXT']
  ];
  for (const [name, type] of cols) {
    if (!columnExists(db, 'stage_feedback', name)) {
      db.exec(`ALTER TABLE stage_feedback ADD COLUMN ${name} ${type}`);
    }
  }
};
