#!/usr/bin/env node

/**
 * Rebuild database blob columns by exporting UPDATE statements in batches.
 *
 * This script compares two SQLite databases (an "original" stripped
 * version and a "target" version with full blob data) and emits SQL
 * files containing UPDATE statements that can be applied to the original
 * database to restore the specified column contents.
 *
 * Usage:
 *   readd_general.js --table=<table> --column=<column> [options] <original.db> <target.db>
 *
 * Required Options:
 *   --table=<name>          Table name to patch (e.g., res_screenshots, attachments)
 *   --column=<name>         Database blob column name to create patches for (e.g., encrypted_data, file_data)
 *
 * Options:
 *   --original=<path>       Path to stripped/original database (positional arg 1)
 *   --target=<path>         Path to target database with blobs (positional arg 2)
 *   --output-dir=<dir>      Directory to store generated SQL files
 *   --output-prefix=<name>  Prefix for generated SQL filenames (default: patchset)
 *   --batchsize=<sizeMB>    Max file size per batch in megabytes (default: 300MB)
 *   --primary-key=<name>    Primary key column name (default: auto-detect from table schema)
 *   --help                  Show usage information
 *
 * Example:
 *   enode.sh jsutils/readd_general.js \
 *     --table=res_screenshots \
 *     --column=encrypted_data \
 *     --output-prefix=sspatch \
 *     --batchsize=90 \
 *     screenshot-stripped.db \
 *     screenshot-hydrated.db
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const HELP_TEXT = `
Usage:
  readd_general.js --table=<table> --column=<column> [options] <original.db> <target.db>

Required Options:
  --table=<name>          Table name to patch (e.g., res_screenshots, attachments)
  --column=<name>         Database blob column name to create patches for (e.g., encrypted_data, file_data)

Options:
  --original=<path>        Path to stripped/original database.
  --target=<path>          Path to target database containing blob data.
  --output-dir=<dir>       Directory where SQL files will be written. Default: current directory
  --output-prefix=<name>   Prefix for SQL filenames. Default: patchset
  --batchsize=<sizeMB>     Max size (in MB) per SQL file. Default: 300MB
  --primary-key=<name>     Primary key column name. Default: auto-detect from table schema
  --help                   Show this help message.

Examples:
  # Create patches for res_screenshots.encrypted_data
  enode.sh jsutils/readd_general.js \\
    --table=res_screenshots \\
    --column=encrypted_data \\
    --output-prefix=sspatch \\
    --batchsize=90 \\
    screenshot-stripped.db \\
    screenshot-hydrated.db

  # Create patches for attachments.file_data
  enode.sh jsutils/readd_general.js \\
    --table=attachments \\
    --column=file_data \\
    --output-prefix=attpatch \\
    --batchsize=250 \\
    patchbin-stripped.db \\
    patchbin-hydrated.db

Notes:
  - At least one of positional arguments or --original/--target options must supply both database paths.
  - Generated files wrap statements in BEGIN/COMMIT transactions.
  - Statements are skipped when the target and original blob data already match.
  - Primary key column is auto-detected from the table schema if not specified.
`;

function exitWithError(message) {
  console.error(`[readd_general] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    table: undefined,
    column: undefined,
    original: undefined,
    target: undefined,
    outputDir: undefined,
    outputPrefix: 'patchset',
    batchSizeMb: 300,
    primaryKey: undefined,
  };

  const positional = [];

  argv.forEach((arg) => {
    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg.startsWith('--table=')) {
      options.table = arg.substring('--table='.length);
    } else if (arg.startsWith('--column=')) {
      options.column = arg.substring('--column='.length);
    } else if (arg.startsWith('--original=')) {
      options.original = arg.substring('--original='.length);
    } else if (arg.startsWith('--target=')) {
      options.target = arg.substring('--target='.length);
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.substring('--output-dir='.length);
    } else if (arg.startsWith('--output-prefix=')) {
      options.outputPrefix = arg.substring('--output-prefix='.length);
    } else if (arg.startsWith('--batchsize=')) {
      const value = arg.substring('--batchsize='.length).trim();
      const normalized = value.toUpperCase().endsWith('MB')
        ? value.slice(0, -2)
        : value;
      const parsed = Number.parseFloat(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError(`Invalid --batchsize value "${value}". Expected positive number (e.g. 250 or 250MB).`);
      }
      options.batchSizeMb = parsed;
    } else if (arg.startsWith('--primary-key=')) {
      options.primaryKey = arg.substring('--primary-key='.length);
    } else if (arg === '--') {
      // Treat remaining args as positional without parsing.
      const remaining = argv.slice(argv.indexOf(arg) + 1);
      positional.push(...remaining);
    } else if (arg.startsWith('-')) {
      exitWithError(`Unrecognized option "${arg}". Use --help to view usage.`);
    } else {
      positional.push(arg);
    }
  });

  // Get positional arguments
  if (!options.original) {
    options.original = positional.shift();
  }
  if (!options.target) {
    options.target = positional.shift();
  }
  if (!options.outputDir) {
    options.outputDir = positional.shift();
  }

  // Validate required options
  if (!options.table) {
    console.error('[readd_general] Error: --table option is required.');
    console.log(HELP_TEXT);
    process.exit(1);
  }
  if (!options.column) {
    console.error('[readd_general] Error: --column option is required.');
    console.log(HELP_TEXT);
    process.exit(1);
  }
  if (!options.original) {
    exitWithError('Missing original database path. Provide positional argument or --original.');
  }
  if (!options.target) {
    exitWithError('Missing target database path. Provide positional argument or --target.');
  }
  if (!options.outputDir) {
    options.outputDir = process.cwd();
    console.log(`[readd_general] No output directory specified, using current directory: ${options.outputDir}`);
  }

  return options;
}

function ensureFileExists(filePath, purpose) {
  if (!fs.existsSync(filePath)) {
    exitWithError(`Cannot access ${purpose} at "${filePath}". File does not exist.`);
  }
  if (!fs.statSync(filePath).isFile()) {
    exitWithError(`Expected ${purpose} "${filePath}" to be a file.`);
  }
}

function resolvePaths(options) {
  return {
    original: path.resolve(options.original),
    target: path.resolve(options.target),
    outputDir: path.resolve(options.outputDir),
  };
}

function createOutputDirectory(outputDir) {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    exitWithError(`Failed to create output directory "${outputDir}": ${err.message}`);
  }
}

function openDatabase(dbPath, label) {
  try {
    return new Database(dbPath, { readonly: true });
  } catch (err) {
    exitWithError(`Failed to open ${label} database "${dbPath}": ${err.message}`);
  }
}

function detectPrimaryKey(db, tableName) {
  try {
    // Get table info to find primary key
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const pkColumn = tableInfo.find(col => col.pk === 1);
    if (pkColumn) {
      return pkColumn.name;
    }
    // If no explicit PK, check for a column named after the table pattern
    // Common patterns: {table}_uuid, {table}id, id
    const commonPatterns = [
      `${tableName.replace(/s$/, '')}_uuid`, // e.g., res_screenshots -> res_screenshot_uuid
      `${tableName}_uuid`,
      `${tableName.replace(/s$/, '')}id`, // e.g., attachments -> attachmentid
      'id',
      'uuid',
    ];
    for (const pattern of commonPatterns) {
      if (tableInfo.some(col => col.name === pattern)) {
        return pattern;
      }
    }
    exitWithError(`Could not detect primary key for table "${tableName}". Please specify --primary-key.`);
  } catch (err) {
    exitWithError(`Failed to detect primary key for table "${tableName}": ${err.message}`);
  }
}

function verifyTableAndColumn(db, tableName, columnName, label) {
  try {
    // Check if table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    
    if (!tableExists) {
      exitWithError(`Table "${tableName}" does not exist in ${label} database.`);
    }

    // Check if column exists
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const columnExists = tableInfo.some(col => col.name === columnName);
    
    if (!columnExists) {
      exitWithError(`Column "${columnName}" does not exist in table "${tableName}" in ${label} database.`);
    }
  } catch (err) {
    exitWithError(`Failed to verify table/column in ${label} database: ${err.message}`);
  }
}

function bufferEquals(a, b) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.compare(b) === 0;
}

function sanitizeId(value, primaryKey) {
  if (typeof value === 'string') {
    // Check if it looks like a UUID
    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (uuidPattern.test(value)) {
      return value;
    }
    // For non-UUID strings, escape single quotes
    return value.replace(/'/g, "''");
  }
  if (typeof value === 'number') {
    return value;
  }
  exitWithError(`Encountered unsupported primary key value "${value}" (type: ${typeof value}). Expected string or number.`);
}

function formatUpdateStatement(tableName, primaryKey, primaryKeyValue, columnName, blobBuffer) {
  let literal;
  if (blobBuffer === null || blobBuffer === undefined) {
    literal = 'NULL';
  } else if (blobBuffer.length === 0) {
    literal = "X''";
  } else {
    literal = `X'${blobBuffer.toString('hex')}'`;
  }
  const id = sanitizeId(primaryKeyValue, primaryKey);
  const idLiteral = typeof id === 'string' ? `'${id}'` : id;
  return `UPDATE ${tableName} SET ${columnName} = ${literal} WHERE ${primaryKey} = ${idLiteral};\n`;
}

function writeBatchedStatements(statementsIterator, outputDir, outputPrefix, batchSizeBytes) {
  const header = 'BEGIN TRANSACTION;\n';
  const footer = 'COMMIT;\n';
  const headerSize = Buffer.byteLength(header);
  const footerSize = Buffer.byteLength(footer);

  let currentStatements = [];
  let statementsBytes = 0;
  let fileIndex = 0;
  const outputFiles = [];
  let totalStatements = 0;
  let maxFileBytes = 0;
  let oversizedStatements = 0;

  function flush() {
    if (!currentStatements.length) {
      statementsBytes = 0;
      return;
    }
    const content = header + currentStatements.join('') + footer;
    const fileName = `${outputPrefix}${String(fileIndex + 1).padStart(3, '0')}.sql`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, content);
    const fileBytes = Buffer.byteLength(content);
    maxFileBytes = Math.max(maxFileBytes, fileBytes);
    outputFiles.push({ filePath, size: fileBytes, statements: currentStatements.length });
    fileIndex += 1;
    currentStatements = [];
    statementsBytes = 0;
  }

  for (const statement of statementsIterator) {
    const statementSize = Buffer.byteLength(statement);
    const projectedSize = headerSize + statementsBytes + statementSize + footerSize;
    if (currentStatements.length > 0 && projectedSize > batchSizeBytes) {
      flush();
    }
    if (headerSize + statementSize + footerSize > batchSizeBytes) {
      oversizedStatements += 1;
    }
    currentStatements.push(statement);
    statementsBytes += statementSize;
    totalStatements += 1;
  }

  flush();

  return {
    outputFiles,
    totalStatements,
    maxFileBytes,
    oversizedStatements,
  };
}

function buildUpdateStatements(originalDb, targetDb, tableName, columnName, primaryKey) {
  const warnings = {
    missingInOriginal: new Set(),
  };

  function* generator() {
    // Get all rows from target database, ordered by primary key
    const targetRows = targetDb
      .prepare(
        `SELECT ${primaryKey}, ${columnName}
         FROM ${tableName}
         ORDER BY ${primaryKey} ASC`
      )
      .iterate();
    const originalStmt = originalDb.prepare(`SELECT ${columnName} FROM ${tableName} WHERE ${primaryKey} = ?`);

    for (const row of targetRows) {
      const primaryKeyValue = row[primaryKey];
      const targetBlob = row[columnName];
      
      const originalRow = originalStmt.get(primaryKeyValue);
      if (!originalRow) {
        if (!warnings.missingInOriginal.has(primaryKeyValue)) {
          warnings.missingInOriginal.add(primaryKeyValue);
          console.warn(
            `[readd_general] Skipping ${tableName} ${primaryKey} ${primaryKeyValue}: not present in original database.`
          );
        }
        continue;
      }

      const originalBlob = originalRow[columnName];

      if (targetBlob === null || targetBlob === undefined) {
        if (originalBlob === null || originalBlob === undefined) {
          continue;
        }
        yield formatUpdateStatement(tableName, primaryKey, primaryKeyValue, columnName, null);
        continue;
      }

      if (!(targetBlob instanceof Buffer)) {
        exitWithError(
          `${tableName} row ${primaryKeyValue} has unsupported ${columnName} type "${typeof targetBlob}" in target database.`
        );
      }

      if (bufferEquals(targetBlob, originalBlob)) {
        continue;
      }
      yield formatUpdateStatement(tableName, primaryKey, primaryKeyValue, columnName, targetBlob);
    }
  }

  return {
    iterator: generator(),
    warnings,
  };
}

function main() {
  options = parseArguments(process.argv.slice(2));
  const resolvedPaths = resolvePaths(options);
  ensureFileExists(resolvedPaths.original, 'original database');
  ensureFileExists(resolvedPaths.target, 'target database');
  createOutputDirectory(resolvedPaths.outputDir);

  const batchSizeBytes = Math.round(options.batchSizeMb * 1024 * 1024);
  if (batchSizeBytes <= 0) {
    exitWithError('Batch size must be greater than zero.');
  }

  const originalDb = openDatabase(resolvedPaths.original, 'original');
  const targetDb = openDatabase(resolvedPaths.target, 'target');

  try {
    // Verify tables and columns exist in both databases
    verifyTableAndColumn(originalDb, options.table, options.column, 'original');
    verifyTableAndColumn(targetDb, options.table, options.column, 'target');

    // Detect or use specified primary key
    let primaryKey = options.primaryKey;
    if (!primaryKey) {
      primaryKey = detectPrimaryKey(targetDb, options.table);
      console.log(`[readd_general] Auto-detected primary key: ${primaryKey}`);
    } else {
      // Verify primary key column exists
      verifyTableAndColumn(targetDb, options.table, primaryKey, 'target');
      console.log(`[readd_general] Using specified primary key: ${primaryKey}`);
    }

    const { iterator: statementIterator, warnings } = buildUpdateStatements(
      originalDb,
      targetDb,
      options.table,
      options.column,
      primaryKey
    );
    const stats = writeBatchedStatements(
      statementIterator,
      resolvedPaths.outputDir,
      options.outputPrefix,
      batchSizeBytes
    );

    if (stats.totalStatements === 0) {
      console.log(`[readd_general] No differing ${options.table}.${options.column} rows found. No files written.`);
      return;
    }

    console.log(
      `[readd_general] Generated ${stats.totalStatements} UPDATE statements across ${stats.outputFiles.length} file(s).`
    );

    stats.outputFiles.forEach((file, index) => {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      console.log(
        `  [${index + 1}] ${file.filePath} (${mb} MB, ${file.statements} statements)`
      );
    });

    if (stats.oversizedStatements > 0) {
      console.warn(
        `[readd_general] Warning: ${stats.oversizedStatements} statement(s) exceeded the specified batch size. ` +
          'They were written to their own files which may be larger than requested.'
      );
    }

    console.log(
      `[readd_general] Maximum output file size: ${(stats.maxFileBytes / (1024 * 1024)).toFixed(2)} MB.`
    );

    if (warnings.missingInOriginal.size > 0) {
      console.warn(
        `[readd_general] Notice: ${warnings.missingInOriginal.size} ${options.table} ${primaryKey}(s) were present in the target database but missing from the original and were therefore skipped.`
      );
    }
  } finally {
    originalDb.close();
    targetDb.close();
  }
}

main();

