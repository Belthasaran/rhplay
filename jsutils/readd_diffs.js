#!/usr/bin/env node

/**
 * Rebuild attachment file_data blobs by exporting UPDATE statements in batches.
 *
 * This script compares two patchbin SQLite databases (an "original" stripped
 * version and a "target" version with full attachment blobs) and emits SQL
 * files containing UPDATE statements that can be applied to the original
 * database to restore the file_data column contents.
 *
 * Usage:
 *   readd_diffs.js [options] <original.db> <target.db>
 *
 * Options:
 *   --original=<path>       Path to stripped/original database (positional arg 1)
 *   --target=<path>         Path to target database with blobs (positional arg 2)
 *   --output-dir=<dir>      Directory to store generated SQL files
 *   --output-prefix=<name>  Prefix for generated SQL filenames (default: patchset)
 *   --batchsize=<sizeMB>    Max file size per batch in megabytes (default: 300MB)
 *   --help                  Show usage information
 *
 * Environment variable overrides:
 *   PATCHBIN_DB_PATH             Fallback for --original
 *   PATCHBIN_TARGET_DB_PATH      Fallback for --target
 *
 * Example:
 *   enode.sh electron/db_temp/readd_diffs.js \
 *     /path/to/original.db \
 *     /path/to/target.db \
 *     --output-dir=/tmp/patches \
 *     --output-prefix=patchXX \
 *     --batchsize=250MB
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const HELP_TEXT = `
Usage:
  readd_diffs.js [options] <original.db> <target.db>

Options:
  --original=<path>        Path to stripped/original patchbin database.
  --target=<path>          Path to target database containing file_data blobs.
  --output-dir=<dir>       Directory where SQL files will be written. Required.
  --output-prefix=<name>   Prefix for SQL filenames. Default: patchset
  --batchsize=<sizeMB>     Max size (in MB) per SQL file. Default: 300MB
  --help                   Show this help message.

Environment variable overrides:
  PATCHBIN_DB_PATH             Provides default value for --original
  PATCHBIN_TARGET_DB_PATH      Provides default value for --target

Notes:
  - At least one of positional arguments or the corresponding environment
    variables must supply both database paths.
  - Generated files wrap statements in BEGIN/COMMIT transactions.
  - Statements are skipped when the target and original file_data already match.
`;

function exitWithError(message) {
  console.error(`[readd_diffs] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    original: undefined,
    target: undefined,
    outputDir: undefined,
    outputPrefix: 'patchset',
    batchSizeMb: 300,
  };

  const positional = [];

  argv.forEach((arg) => {
    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
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

  if (!options.original) {
    options.original = positional.shift() || process.env.PATCHBIN_DB_PATH;
  }
  if (!options.target) {
    options.target = positional.shift() || process.env.PATCHBIN_TARGET_DB_PATH;
  }
  if (!options.outputDir) {
    options.outputDir = positional.shift();
  }

  if (!options.original) {
    exitWithError('Missing original database path. Provide positional argument, --original, or PATCHBIN_DB_PATH.');
  }
  if (!options.target) {
    exitWithError('Missing target database path. Provide positional argument, --target, or PATCHBIN_TARGET_DB_PATH.');
  }
  if (!options.outputDir) {
    exitWithError('Missing output directory. Provide positional argument or --output-dir.');
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

function sanitizeUuid(value) {
  if (typeof value !== 'string') {
    exitWithError(`Encountered unsupported attachment auuid value "${value}". Expected string UUID.`);
  }
  const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidPattern.test(value)) {
    exitWithError(`Attachment auuid "${value}" is not in canonical UUID format.`);
  }
  return value;
}

function formatUpdateStatement(id, blobBuffer) {
  let literal;
  if (blobBuffer === null || blobBuffer === undefined) {
    literal = 'NULL';
  } else if (blobBuffer.length === 0) {
    literal = "X''";
  } else {
    literal = `X'${blobBuffer.toString('hex')}'`;
  }
  const auuid = sanitizeUuid(id);
  return `UPDATE attachments SET file_data = ${literal} WHERE auuid = '${auuid}';\n`;
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

function buildUpdateStatements(originalDb, targetDb) {
  const warnings = {
    missingInOriginal: new Set(),
  };

  function* generator() {
    const targetRows = targetDb
      .prepare(
        `SELECT auuid, file_data
         FROM attachments
         ORDER BY
           COALESCE(import_time, updated_time) ASC,
           updated_time ASC,
           auuid ASC`
      )
      .iterate();
    const originalStmt = originalDb.prepare('SELECT file_data FROM attachments WHERE auuid = ?');

    for (const row of targetRows) {
      const { auuid, file_data: targetBlob } = row;
      const originalRow = originalStmt.get(auuid);
      if (!originalRow) {
        if (!warnings.missingInOriginal.has(auuid)) {
          warnings.missingInOriginal.add(auuid);
          console.warn(
            `[readd_diffs] Skipping attachment auuid ${auuid}: not present in original database.`
          );
        }
        continue;
      }

      const originalBlob = originalRow.file_data;

      if (targetBlob === null || targetBlob === undefined) {
        if (originalBlob === null || originalBlob === undefined) {
          continue;
        }
        yield formatUpdateStatement(auuid, null);
        continue;
      }

      if (!(targetBlob instanceof Buffer)) {
        exitWithError(
          `Attachments row ${auuid} has unsupported file_data type "${typeof targetBlob}" in target database.`
        );
      }

      if (bufferEquals(targetBlob, originalBlob)) {
        continue;
      }
      yield formatUpdateStatement(auuid, targetBlob);
    }
  }

  return {
    iterator: generator(),
    warnings,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
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
    const { iterator: statementIterator, warnings } = buildUpdateStatements(originalDb, targetDb);
    const stats = writeBatchedStatements(
      statementIterator,
      resolvedPaths.outputDir,
      options.outputPrefix,
      batchSizeBytes
    );

    if (stats.totalStatements === 0) {
      console.log('[readd_diffs] No differing attachment file_data rows found. No files written.');
      return;
    }

    console.log(
      `[readd_diffs] Generated ${stats.totalStatements} UPDATE statements across ${stats.outputFiles.length} file(s).`
    );

    stats.outputFiles.forEach((file, index) => {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      console.log(
        `  [${index + 1}] ${file.filePath} (${mb} MB, ${file.statements} statements)`
      );
    });

    if (stats.oversizedStatements > 0) {
      console.warn(
        `[readd_diffs] Warning: ${stats.oversizedStatements} statement(s) exceeded the specified batch size. ` +
          'They were written to their own files which may be larger than requested.'
      );
    }

    console.log(
      `[readd_diffs] Maximum output file size: ${(stats.maxFileBytes / (1024 * 1024)).toFixed(2)} MB.`
    );

    if (warnings.missingInOriginal.size > 0) {
      console.warn(
        `[readd_diffs] Notice: ${warnings.missingInOriginal.size} attachment id(s) were present in the target database but missing from the original and were therefore skipped.`
      );
    }
  } finally {
    originalDb.close();
    targetDb.close();
  }
}

main();

