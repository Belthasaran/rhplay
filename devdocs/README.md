# Developer Documentation

This directory contains internal developer documentation for maintaining the RHTools codebase.

## 📋 Contents

### Security & Git Hygiene

- **[GIT_DATA_HYGIENE.md](GIT_DATA_HYGIENE.md)** - Complete security audit findings and recommendations
  - Results from Oct 13, 2025 repository audit
  - Analysis of 1,238 tracked files
  - Assessment of past 48 hours of commits
  - Recommendations for database protection and .gitignore updates

- **[SECURITY_AUDIT_PROMPT.md](SECURITY_AUDIT_PROMPT.md)** - Reusable security audit procedures
  - Copy-paste audit prompts for future use
  - Comprehensive search commands for credentials, PII, and sensitive data
  - Risk assessment matrix
  - Remediation procedures
  - Compliance checklist

### Git Workflow

- **[IMPORTANT_GIT_UPDATE_TRACKING.txt](IMPORTANT_GIT_UPDATE_TRACKING.txt)** - Git usage reminders

## 🔍 Quick Security Audit

To perform a security audit on recent commits:

```bash
# Search for credentials in recent commits (past 7 days)
git log --since="7 days ago" --name-only | sort -u | \
  xargs git grep -iE '(password|api_key|secret|token)\s*[:=]\s*["\047]'

# Check for database files in recent commits
git log --since="7 days ago" --name-only | grep -E '\.(db|dat)$'

# Check for game data in recent commits
git log --since="7 days ago" --name-only | grep -E '^(hacks|pat_meta)/'
```

For complete audit procedures, see **[SECURITY_AUDIT_PROMPT.md](SECURITY_AUDIT_PROMPT.md)**.

## 🛡️ Protected Files

To protect database files from accidental commits while keeping them in the repository:

```bash
# Protect files (local changes won't show in git status)
git update-index --skip-worktree electron/rhdata.db
git update-index --skip-worktree electron/patchbin.db

# Verify protection
git ls-files -v | grep '^S'
```

## 📝 Key Findings (October 2025 Audit)

### ✅ Clean Repository
- **0 critical issues** found
- No hardcoded credentials
- No personal information exposed
- No production data in recent commits
- Test files appropriately scoped

### ⚠️ Recommendations
1. Protect database files with `--skip-worktree`
2. Review and apply .gitignore additions (see GIT_DATA_HYGIENE.md)
3. Add pre-commit hooks to prevent database commits (optional)

## 🔄 When to Run Security Audits

Run security audits:
- ✅ Before major releases
- ✅ After adding new developers to the team
- ✅ When adding new data storage/handling features
- ✅ After discovering any security incident
- ✅ Quarterly as routine maintenance

## 📚 Additional Resources

### Related Documentation
- User documentation: `../docs/`
- Database schemas: `../electron/sql/`
- Migration scripts: `../electron/sql/migrations/`

### External Tools
- [git-secrets](https://github.com/awslabs/git-secrets) - Prevent committing secrets
- [BFG Repo Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) - Remove sensitive data from history
- [git-filter-repo](https://github.com/newren/git-filter-repo) - Clean git history

---

**Last Updated**: October 13, 2025

