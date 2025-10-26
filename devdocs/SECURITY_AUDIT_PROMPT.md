# Security Audit Prompt - Reusable Repository Scanner

## Purpose

This document contains a comprehensive prompt/checklist for conducting security audits on the RHTools repository. Use this when you need to check for accidentally committed sensitive data, credentials, or inappropriate content.

---

## Quick Audit Prompt

Copy and paste this prompt to an AI assistant or use as a checklist:

```
Please perform a comprehensive security audit of the RHTools repository. 
Search all tracked files for:

1. CREDENTIALS & SECRETS
   - Hardcoded passwords, API keys, tokens, secrets
   - AWS keys (AKIA*, ASIA*), GitHub tokens (ghp_*, gho_*), OpenAI keys (sk-*)
   - Private keys, certificates, or encryption keys
   - Database connection strings with credentials

2. PERSONAL & SENSITIVE INFORMATION
   - Email addresses (excluding examples and third-party library authors)
   - Phone numbers, addresses, real names
   - Personal identification numbers
   - Private user data

3. DATABASE & DATA FILES
   - Production database files (.db, .sqlite, .db3)
   - Database temporary files (.db-shm, .db-wal, .db-journal)
   - RHMD data files (rhad.dat, rhmd_sample*.dat)
   - Backup files with data (.bak, .old containing databases)

4. GAME DATA & METADATA
   - Game ROM files (.sfc, .smc, .bin in root or inappropriate locations)
   - Real game patches outside of tests/ directory
   - Production patch metadata (pat_meta/* except test.txt)
   - Real game files in hacks/* directory (except documented examples)

5. BINARY & CONFIGURATION FILES
   - Compiled executables not intended for distribution
   - Configuration files with secrets (.env with real values, config with passwords)
   - SSL/TLS certificates and private keys

For each category, provide:
- Files found (if any)
- Assessment (safe/concern/remove)
- Recommended action

Then create a summary with:
- Total files scanned
- Issues found by severity (critical/high/medium/low)
- Immediate actions needed
- Recommended .gitignore additions
```

---

## Detailed Search Commands

### 1. Hardcoded Credentials Check

```bash
# Search for hardcoded secrets in source files
git grep -iE '(password|passwd|pwd|secret|api_key|apikey|access_key|token|auth)\s*[:=]\s*["\047][^"\047]{8,}' \
  -- '*.js' '*.py' '*.json' '*.ts' '*.vue' '*.env*' '*.config.*' \
  | grep -v node_modules \
  | grep -v test \
  | grep -v example

# Search for AWS keys
git grep -E '(AKIA|ASIA)[0-9A-Z]{16}' -- . | grep -v node_modules

# Search for GitHub tokens
git grep -E '(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}' -- . | grep -v node_modules

# Search for OpenAI API keys
git grep -E 'sk-[a-zA-Z0-9]{20,}' -- . | grep -v node_modules

# Search for private keys
git grep -iE '(BEGIN.*PRIVATE KEY|BEGIN RSA PRIVATE KEY)' -- .

# Search for bearer tokens
git grep -iE 'Bearer [a-zA-Z0-9\-_\.]{20,}' -- . | grep -v node_modules
```

### 2. Personal Information Check

```bash
# Search for email addresses
git grep -iE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' -- . \
  | grep -v node_modules \
  | grep -v 'example@' \
  | grep -v 'user@' \
  | grep -v 'test@' \
  | grep -v 'admin@example' \
  | grep -v 'mailto:'

# Search for phone numbers (various formats)
git grep -E '\b[0-9]{3}[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b' -- . \
  | grep -v node_modules \
  | grep -v test

# Search for SSN patterns (if applicable)
git grep -E '\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b' -- .

# Search for credit card patterns
git grep -E '\b[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}\b' -- .
```

### 3. Database Files Check

```bash
# List all database files tracked
git ls-files | grep -E '\.(db|sqlite|sqlite3|db3)$'

# Check for database temporary files
git ls-files | grep -E '\.(db-shm|db-wal|db-journal)$'

# Check for RHMD data files
git ls-files | grep -E '\.(dat|rhmd)$' | grep -v test

# Check recent commits for database changes
git log --since="7 days ago" --name-only --oneline | grep -E '\.(db|dat)$'
```

### 4. Game Data & Metadata Check

```bash
# Check for ROM files in inappropriate locations
git ls-files | grep -E '\.(sfc|smc|bin|rom)$' | grep -v test

# Check for real game files
git ls-files | grep -E '^hacks/[0-9]+$' | head -20

# Check for patch metadata
git ls-files | grep -E '^pat_meta/' | grep -v 'test.txt'

# Check for patch files outside tests
git ls-files | grep -E '\.(ips|bps|ups)$' | grep -v test

# Check recent additions of game data
git log --since="7 days ago" --diff-filter=A --name-only | grep -E '^(hacks|pat_meta)/'
```

### 5. Configuration & Secrets Files Check

```bash
# Check for environment files with secrets
git ls-files | grep -E '\.env$|\.env\.'

# Check for config files
git ls-files | grep -iE 'secret|credential|password|token' | grep -v node_modules | grep -v '\.md$'

# Check for certificate files
git ls-files | grep -E '\.(pem|key|crt|cer|p12|pfx)$'

# Check for JWT tokens
git grep -E 'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*' -- . | grep -v node_modules
```

---

## Recent Commits Audit

### Check Last N Commits

```bash
# Last 7 days of commits with file names
git log --since="7 days ago" --name-status --oneline

# Files added in last 7 days (check for concerning additions)
git log --since="7 days ago" --diff-filter=A --name-only

# Large files added recently (may indicate data files)
git log --since="7 days ago" --name-only --diff-filter=A | \
  xargs -I {} sh -c 'test -f "{}" && du -h "{}" | awk "\$1 ~ /[0-9]+M/ || \$1 ~ /[0-9]+G/"'

# Check specific file types in recent commits
git log --since="7 days ago" --name-only | grep -E '\.(db|dat|sfc|ips|bps)$' | sort -u
```

### Full Repository Scan

```bash
# Count total files tracked
git ls-files | wc -l

# Breakdown by extension
git ls-files | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -20

# Find large files in repository (> 1MB)
git ls-files | xargs -I {} sh -c 'test -f "{}" && du -h "{}" | awk "\$1 ~ /[0-9]+M/ || \$1 ~ /[0-9]+G/"'

# Check for files that should be in .gitignore
git ls-files | grep -E '(node_modules|\.env|\.db$|temp|tmp|cache|dist|build)'
```

---

## Risk Assessment Matrix

### Critical Risk 🔴
- Hardcoded API keys, passwords, tokens
- Production database files with real data
- Private keys or certificates
- Personal identifiable information (PII)

**Action**: Remove immediately, rotate credentials, update .gitignore

### High Risk 🟠
- Configuration files with sensitive data
- Real game data or copyrighted content
- Database backups with user data
- OAuth tokens or session IDs

**Action**: Remove from repository, add to .gitignore, verify no sensitive data exposed

### Medium Risk 🟡
- Example credentials that could be confused for real
- Old/obsolete sensitive files
- Large binary files that shouldn't be tracked
- Test data that resembles real data

**Action**: Review and remove if not needed, document if kept

### Low Risk 🟢
- Test fixtures with clearly fake data
- Example configuration templates (no real values)
- Public API data (Twitch tags, etc.)
- Third-party library author info

**Action**: Document and monitor, generally safe to keep

---

## Automated Audit Script

Save this as `devdocs/scripts/audit-repo.sh`:

```bash
#!/bin/bash
# RHTools Repository Security Audit Script
# Usage: ./devdocs/scripts/audit-repo.sh

echo "🔍 RHTools Security Audit"
echo "========================="
echo ""

echo "📊 Repository Statistics"
echo "Total files tracked: $(git ls-files | wc -l)"
echo "Recent commits (7 days): $(git log --since='7 days ago' --oneline | wc -l)"
echo ""

echo "🔐 Searching for credentials..."
CREDS=$(git grep -iE '(password|api_key|secret|token)\s*[:=]\s*["\047][^"\047]{10,}' -- '*.js' '*.py' '*.json' | grep -v node_modules | grep -v test | wc -l)
echo "Potential credentials found: $CREDS"
echo ""

echo "📧 Searching for email addresses..."
EMAILS=$(git grep -iE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' | grep -v node_modules | grep -v 'example@' | grep -v 'test@' | wc -l)
echo "Email addresses found: $EMAILS"
echo ""

echo "💾 Checking for database files..."
DBS=$(git ls-files | grep -E '\.(db|sqlite|dat)$' | wc -l)
echo "Database files tracked: $DBS"
git ls-files | grep -E '\.(db|sqlite|dat)$' | head -10
echo ""

echo "🎮 Checking for game data..."
GAMES=$(git ls-files | grep -E '^(hacks|pat_meta)/' | wc -l)
echo "Game data files: $GAMES"
echo ""

echo "📝 Recent file additions (7 days)..."
git log --since="7 days ago" --diff-filter=A --name-only | sort -u | head -20
echo ""

echo "✅ Audit complete. Review output above for concerns."
```

---

## Remediation Steps

### If Credentials Found:

1. **Immediate Actions**:
   ```bash
   # Remove from current commit
   git rm --cached <file>
   
   # Rotate compromised credentials immediately
   # Update all services using those credentials
   ```

2. **Clean Git History** (if committed previously):
   ```bash
   # Use git-filter-repo or BFG Repo Cleaner
   git filter-repo --path <sensitive-file> --invert-paths
   
   # Force push (DANGEROUS - coordinate with team)
   git push --force --all
   ```

3. **Prevent Future Issues**:
   ```bash
   # Add to .gitignore
   echo "<pattern>" >> .gitignore
   
   # Commit .gitignore
   git add .gitignore
   git commit -m "chore: prevent <type> files from being committed"
   ```

### If Personal Data Found:

1. **Assess Impact**: Determine if data is public or private
2. **Remove**: Use `git rm --cached` or `git filter-repo`
3. **Notify**: If personal data was exposed, follow data breach protocols
4. **Document**: Record what was found and actions taken

### If Database/Game Data Found:

1. **Use `--skip-worktree`** for files needed in repo but local changes ignored:
   ```bash
   git update-index --skip-worktree <file>
   ```

2. **Remove entirely** if not needed:
   ```bash
   git rm --cached <file>
   ```

3. **Update .gitignore** to prevent re-adding

---

## Compliance Checklist

Before each major commit or release:

- [ ] Run credential search (no hardcoded secrets)
- [ ] Check for personal information (emails, names, IDs)
- [ ] Verify no production databases committed
- [ ] Confirm no real game data outside tests/
- [ ] Review recent commits (past 7 days) for concerns
- [ ] Validate .gitignore covers sensitive files
- [ ] Test that protected files (--skip-worktree) work correctly
- [ ] Document any intentional exceptions

---

## Audit History Log

Maintain a log of audits performed:

| Date | Auditor | Commits Reviewed | Issues Found | Actions Taken |
|------|---------|-----------------|--------------|---------------|
| 2025-10-13 | AI Assistant | 76 (48 hours) | 0 critical | Created audit docs |
| | | | | |

---

## Contact & Escalation

If critical issues are found:

1. **Stop**: Do not push commits
2. **Document**: Record exactly what was found
3. **Rotate**: Change any exposed credentials immediately
4. **Clean**: Remove from repository
5. **Review**: Audit recent clones/forks
6. **Update**: Enhance .gitignore and audit procedures

---

## References

- Git Secrets: https://github.com/awslabs/git-secrets
- BFG Repo Cleaner: https://rtyley.github.io/bfg-repo-cleaner/
- git-filter-repo: https://github.com/newren/git-filter-repo
- GitHub Secret Scanning: https://docs.github.com/en/code-security/secret-scanning

**Last Updated**: October 13, 2025

