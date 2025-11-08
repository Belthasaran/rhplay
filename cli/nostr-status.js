#!/usr/bin/env node

const path = require('path');
const process = require('process');

const projectRoot = path.resolve(__dirname, '..');
const { DatabaseManager } = require(path.join(projectRoot, 'electron', 'database-manager'));
const { NostrRuntimeService } = require(path.join(projectRoot, 'electron', 'main', 'NostrRuntimeService'));

function printUsage() {
  console.log(`Nostr Runtime Status CLI

Usage:
  enode.sh cli/nostr-status.js [options]

Options:
  --json               Output raw JSON snapshot
  --limit <n>          Number of queued events to include in detailed snapshot (default: 50)
  --details            Include queue snapshot details (pending events, metadata)
  --help               Show this help message

Examples:
  enode.sh cli/nostr-status.js
  enode.sh cli/nostr-status.js --details
  enode.sh cli/nostr-status.js --json --limit 100
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (key === 'help') {
        args.help = true;
        i += 1;
        continue;
      }
      if (key === 'json') {
        args.json = true;
        i += 1;
        continue;
      }
      if (key === 'details') {
        args.details = true;
        i += 1;
        continue;
      }
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for option --${key}`);
      }
      args[key] = value;
      i += 2;
    } else {
      args._.push(token);
      i += 1;
    }
  }
  return args;
}

function formatTimestamp(ts) {
  if (!ts) {
    return 'n/a';
  }
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'n/a';
  }
  return date.toISOString();
}

function formatAgeSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return 'n/a';
  }
  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`;
  }
  if (seconds < 3600) {
    return `${(seconds / 60).toFixed(1)}m`;
  }
  if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  return `${(seconds / 86400).toFixed(1)}d`;
}

function printRelayHealth(relayHealth = []) {
  if (!relayHealth.length) {
    console.log('Relays: (no health data recorded)');
    return;
  }
  console.log('Relay Health:');
  relayHealth.forEach((info) => {
    const lastSuccess = info.lastSuccess ? formatTimestamp(info.lastSuccess / 1000) : 'n/a';
    const lastFailure = info.lastFailure ? formatTimestamp(info.lastFailure / 1000) : 'n/a';
    const cooldownSeconds = info.cooldownUntil
      ? Math.max(0, Math.round((info.cooldownUntil - Date.now()) / 1000))
      : 0;
    console.log(
      `  - ${info.relayUrl}\n` +
        `      status   : ${info.status || 'unknown'}\n` +
        `      failures : ${info.failureCount || 0}  successes: ${info.successCount || 0}\n` +
        `      last ok  : ${lastSuccess}\n` +
        `      last err : ${lastFailure} (${info.lastError || 'n/a'})\n` +
        `      cooldown : ${cooldownSeconds > 0 ? formatAgeSeconds(cooldownSeconds) : 'ready'}`
    );
  });
}

function printPrioritySummary(summary = {}) {
  const buckets = summary.buckets || {};
  const total = summary.total || 0;
  console.log(`Outgoing Priority Backlog: total=${total}`);
  const bucketNames = Object.keys(buckets);
  if (!bucketNames.length) {
    console.log('  (none)');
    return;
  }
  bucketNames.forEach((bucket) => {
    const stats = buckets[bucket];
    const oldest = stats.oldest ? formatTimestamp(stats.oldest) : 'n/a';
    const newest = stats.newest ? formatTimestamp(stats.newest) : 'n/a';
    console.log(
      `  - ${bucket.padEnd(9)} count=${String(stats.count).padStart(3)}  oldest=${oldest}  newest=${newest}`
    );
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
  }

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const jsonOutput = !!args.json;
  const includeDetails = !!args.details;
  const limit = args.limit ? Math.max(1, parseInt(args.limit, 10)) : 50;

  const dbManager = new DatabaseManager({ autoApplyMigrations: true });
  const service = new NostrRuntimeService(dbManager, { logger: console, autoConnect: false });

  try {
    service.refreshQueueStats();
    const status = service.getStatusSnapshot();
    const queueSnapshot = includeDetails ? service.getQueueSnapshot(limit) : null;

    if (jsonOutput) {
      const payload = {
        status,
        queueSnapshot: includeDetails ? queueSnapshot : undefined
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log('Nostr Runtime Status');
    console.log('---------------------');
    console.log(`Mode        : ${status.mode}`);
    console.log(`Online      : ${status.mode === 'online' ? 'yes' : 'no (manual start required)'}`);
    console.log(
      `Runtime     : running=${status.runtime.running} background=${status.runtime.background} connectedRelays=${status.runtime.connectedRelays}`
    );
    console.log(
      `Queue Stats : pending=${status.queueStats.outgoingPending} processing=${status.queueStats.outgoingProcessing} completed=${status.queueStats.outgoingCompleted} failed=${status.queueStats.outgoingFailed}`
    );
    console.log(
      `Incoming    : backlog=${status.queueStats.incomingBacklog} processedLastMin=${status.queueStats.outgoingSentLastMinute}`
    );

    printPrioritySummary(status.outgoingPriority || status.queueStats.outgoingPrioritySummary);
    printRelayHealth(status.relayHealth);

    if (includeDetails && queueSnapshot) {
      console.log('\nQueued Events (pending):');
      if (!queueSnapshot.outgoing.pending.length) {
        console.log('  (none)');
      } else {
        queueSnapshot.outgoing.pending.forEach((entry) => {
          console.log(
            `  - ${entry.id} kind=${entry.kind} created=${formatTimestamp(entry.createdAt)} table=${entry.tableName ||
              'n/a'}`
          );
        });
      }
    }
  } finally {
    service.shutdown({ keepBackground: false });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error && (error.code === 'ERR_DLOPEN_FAILED' || /Module did not self-register/.test(error.message || ''))) {
      console.error(
        'nostr-status failed: native SQLite bindings are not compatible with this Node runtime. ' +
          'Run via enode.sh or rebuild native modules with `npm rebuild`.'
      );
    } else {
      console.error('nostr-status failed:', error);
    }
    process.exit(1);
  });

