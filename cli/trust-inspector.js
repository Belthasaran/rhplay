#!/usr/bin/env node

const path = require('path');
const process = require('process');

const projectRoot = path.resolve(__dirname, '..');
const DatabaseManager = require(path.join(projectRoot, 'electron', 'database-manager'));
const TrustManager = require(path.join(projectRoot, 'electron', 'utils', 'TrustManager'));

function printUsage() {
  console.log(`Trust Inspector CLI

Usage:
  enode.sh cli/trust-inspector.js trust-level --pubkey <pubkey>
  enode.sh cli/trust-inspector.js inspect --pubkey <pubkey>
  enode.sh cli/trust-inspector.js assignments [--pubkey <pubkey>]
  enode.sh cli/trust-inspector.js permissions --pubkey <pubkey>

Options:
  --pubkey <value>   Nostr public key (hex or npub)
  --json             Output in JSON format
  --help             Show this help message
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

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
  }

  if (args.help || args._.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args._[0];
  const pubkey = args.pubkey;
  const outputJson = !!args.json;

  const dbManager = new DatabaseManager({ autoApplyMigrations: true });
  const trustManager = new TrustManager(dbManager, { logger: console });

  try {
    if (command === 'trust-level') {
      if (!pubkey) {
        throw new Error('trust-level requires --pubkey');
      }
      const level = trustManager.getTrustLevel(pubkey);
      const tier = trustManager.mapTrustLevelToTier(level);
      if (outputJson) {
        console.log(JSON.stringify({ pubkey, trust_level: level, trust_tier: tier }, null, 2));
      } else {
        console.log(`Public Key : ${pubkey}`);
        console.log(`Trust Level: ${level}`);
        console.log(`Trust Tier : ${tier}`);
      }
    } else if (command === 'inspect') {
      if (!pubkey) {
        throw new Error('inspect requires --pubkey');
      }
      const details = trustManager.inspectTrust(pubkey);
      if (outputJson) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        console.log(`Public Key : ${details.pubkey}`);
        console.log(`Variants   : ${details.variants.join(', ')}`);
        console.log(`Trust Level: ${details.trust_level}`);
        console.log(`Trust Tier : ${details.trust_tier}`);
        if (details.admin_level !== null && details.admin_level !== undefined) {
          console.log(`Admin Level: ${details.admin_level}`);
        }
        if (details.declaration_level !== null && details.declaration_level !== undefined) {
          console.log(`Declaration Level: ${details.declaration_level}`);
        }
        if (details.declaration_trust_limit !== null && details.declaration_trust_limit !== undefined) {
          console.log(`Declaration Trust Limit: ${details.declaration_trust_limit}`);
        }
        if (details.assignments.length) {
          console.log('\nActive Trust Assignments:');
          details.assignments.forEach((assignment) => {
            console.log(`  - Level: ${assignment.assigned_trust_level ?? 'n/a'}  Limit: ${assignment.trust_limit ?? 'n/a'}  Assigned By: ${assignment.assigned_by_pubkey || 'n/a'}  Scope: ${assignment.scope || 'n/a'}  Expires: ${assignment.expires_at || 'never'}`);
          });
        } else {
          console.log('\nActive Trust Assignments: none');
        }
        if (details.declarations.length) {
          console.log('\nMatching Trust Declarations:');
          details.declarations.forEach((decl) => {
            console.log(`  - UUID: ${decl.declaration_uuid}`);
            console.log(`    Declared Level: ${decl.declared_trust_level ?? 'n/a'}  Derived Level: ${decl.derived_trust_level ?? 'n/a'}  Trust Limit: ${decl.trust_limit ?? 'n/a'}`);
            if (decl.scopes && decl.scopes.length) {
              const scopes = decl.scopes.map((scope) => `${scope.type || 'global'}:${(scope.targets || []).join(',') || '*'}`).join(' | ');
              console.log(`    Scopes: ${scopes}`);
            }
            if (decl.valid_from || decl.valid_until) {
              console.log(`    Validity: ${decl.valid_from || 'immediate'} to ${decl.valid_until || 'none'}`);
            }
            if (decl.permissions) {
              const perms = Object.keys(decl.permissions).filter((key) => decl.permissions[key]);
              if (perms.length) {
                console.log(`    Permissions: ${perms.join(', ')}`);
              }
            }
          });
        } else {
          console.log('\nMatching Trust Declarations: none');
        }
      }
    } else if (command === 'assignments') {
      const rows = trustManager.listTrustAssignments(pubkey);
      if (outputJson) {
        console.log(JSON.stringify({ assignments: rows }, null, 2));
      } else {
        if (!rows.length) {
          console.log('No trust assignments found.');
        } else {
          rows.forEach((row) => {
            console.log(`Assignment #${row.assignment_id}:`);
            console.log(`  Pubkey            : ${row.pubkey}`);
            console.log(`  Assigned Level    : ${row.assigned_trust_level}`);
            console.log(`  Trust Limit       : ${row.trust_limit ?? 'none'}`);
            console.log(`  Assigned By       : ${row.assigned_by_pubkey || 'n/a'} (level ${row.assigned_by_trust_level ?? 'n/a'})`);
            console.log(`  Scope             : ${row.scope || 'global'}`);
            console.log(`  Source            : ${row.source || 'manual'}`);
            console.log(`  Reason            : ${row.reason || 'n/a'}`);
            console.log(`  Expires At        : ${row.expires_at || 'never'}`);
            console.log(`  Created At        : ${row.created_at || 'unknown'}`);
            console.log('');
          });
        }
      }
    } else if (command === 'permissions') {
      if (!pubkey) {
        throw new Error('permissions requires --pubkey');
      }
      const details = trustManager.getEffectivePermissions(pubkey);
      if (outputJson) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        console.log(`Public Key : ${details.pubkey}`);
        console.log(`Trust Level: ${details.trust_level}`);
        console.log(`Trust Tier : ${details.trust_tier}`);
        if (!details.permissions.length) {
          console.log('No permissions granted via trust declarations.');
        } else {
          console.log('\nEffective Permissions:');
          details.permissions.forEach((entry, index) => {
            const scopeType = entry.scope.type || 'global';
            const targets = (entry.scope.targets || []).join(', ') || '*';
            console.log(`  [${index + 1}] Scope: ${scopeType} -> ${targets}`);
            const perms = entry.permissions || {};
            const enabled = Object.entries(perms).filter(([, value]) => value).map(([key]) => key);
            if (enabled.length) {
              console.log(`      Permissions: ${enabled.join(', ')}`);
            } else {
              console.log('      Permissions: none flagged true');
            }
            if (entry.trust_limit !== null && entry.trust_limit !== undefined) {
              console.log(`      Trust Limit: ${entry.trust_limit}`);
            }
            if (entry.valid_from || entry.valid_until) {
              console.log(`      Validity: ${entry.valid_from || 'immediate'} to ${entry.valid_until || 'none'}`);
            }
            if (entry.declaration_uuid) {
              console.log(`      Declaration UUID: ${entry.declaration_uuid}`);
            }
          });
        }
      }
    } else {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }
  } finally {
    if (dbManager && typeof dbManager.closeAll === 'function') {
      dbManager.closeAll();
    }
  }
}

main().catch((error) => {
  console.error('Trust Inspector encountered an error:', error);
  process.exit(1);
});
