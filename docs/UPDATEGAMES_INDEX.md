# Updategames.js - Documentation Index

## 📚 Complete Documentation Guide

This index helps you find the right documentation for your needs.

---

## 🚀 Getting Started

### I want to use updategames.js
👉 **[UPDATEGAMES_QUICK_START.md](UPDATEGAMES_QUICK_START.md)**
- Installation steps
- Basic commands
- Common operations
- Troubleshooting

### I want to understand how it works
👉 **[UPDATEGAMES_README.md](UPDATEGAMES_README.md)**
- Complete user guide
- Workflow explanation
- All command-line options
- File structure

### I want to see the full specification
👉 **[NEW_UPDATE_SCRIPT_SPEC.md](NEW_UPDATE_SCRIPT_SPEC.md)**
- Original design specification
- Technical architecture
- Module descriptions
- Implementation phases

---

## 🔧 Implementation Details

### Phase 1 Core Implementation
👉 **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)**
- What was implemented
- Files created
- Installation steps
- Validation checklist

### Schema Compatibility Updates
👉 **[UPDATEGAMES_SCHEMA_COMPATIBILITY.md](UPDATEGAMES_SCHEMA_COMPATIBILITY.md)**
- Boolean normalization fix
- New schema fields (fields_type, raw_difficulty, combinedtype)
- Locked attributes system
- Feature parity matrix

### Quick Fixes Reference
👉 **[UPDATEGAMES_FIXES_SUMMARY.md](UPDATEGAMES_FIXES_SUMMARY.md)**
- Issues addressed
- Code changes
- Verification steps
- Quick reference

### Complete Implementation Status
👉 **[UPDATEGAMES_COMPLETE_IMPLEMENTATION.md](UPDATEGAMES_COMPLETE_IMPLEMENTATION.md)**
- Full feature list
- All files created
- Test results
- Success metrics

---

## 🧪 Testing

### Test Suite Documentation
👉 **[../tests/README_UPDATEGAMES_TESTS.md](../tests/README_UPDATEGAMES_TESTS.md)**
- How to run tests
- What tests verify
- Expected output
- Troubleshooting

### Running Tests
```bash
node tests/test_updategames.js
```

---

## 📊 Database Schema

### GameVersions Table Reference
👉 **[GAMEVERSIONS_TABLE_SCHEMA.md](GAMEVERSIONS_TABLE_SCHEMA.md)**
- Complete field reference
- Difficulty code mappings
- Query examples
- Schema evolution history

### Locked Attributes System
👉 **[LOCKED_ATTRIBUTES.md](LOCKED_ATTRIBUTES.md)**
- How locked attributes work
- Usage examples
- Curator guide
- SQL queries

---

## 🔄 Related loaddata.js Documentation

### Original Issues Fixed
👉 **[GV_BUGFIX_LOADDATA.md](GV_BUGFIX_LOADDATA.md)**
- Boolean type error
- Root cause analysis
- Solution details
- Testing results

### Schema Updates (loaddata.js)
👉 **[GV_SCHEMA_UPDATE_SUMMARY.md](GV_SCHEMA_UPDATE_SUMMARY.md)**
- v1.1 schema changes
- fields_type and raw_difficulty
- Environment variables
- Migration steps

### Combined Type Feature
👉 **[GV_COMBINEDTYPE_UPDATE.md](GV_COMBINEDTYPE_UPDATE.md)**
- v1.2 combinedtype addition
- Computation algorithm
- Use cases
- Query examples

### Locked Attributes Implementation
👉 **[GV_LOCKED_ATTRIBUTES_IMPLEMENTATION.md](GV_LOCKED_ATTRIBUTES_IMPLEMENTATION.md)**
- v1.3 locked attributes
- Feature details
- Implementation
- Best practices

### Complete loaddata.js Session
👉 **[GV_COMPLETE_SESSION_SUMMARY.md](GV_COMPLETE_SESSION_SUMMARY.md)**
- All loaddata.js enhancements
- Timeline
- Statistics
- Verification

---

## 🎯 Future Plans

### Phase 2 Specification
👉 **[NEW_UPDATE_SCRIPT_PHASE2_SPEC.md](NEW_UPDATE_SCRIPT_PHASE2_SPEC.md)**
- Change detection for existing games
- Statistics tracking (gameversion_stats table)
- Smart update classification
- Major vs minor changes

---

## 📖 By Use Case

### I'm a User
1. Start: [UPDATEGAMES_QUICK_START.md](UPDATEGAMES_QUICK_START.md)
2. Learn: [UPDATEGAMES_README.md](UPDATEGAMES_README.md)
3. Troubleshoot: Check troubleshooting sections in above docs

### I'm a Curator
1. Schema: [GAMEVERSIONS_TABLE_SCHEMA.md](GAMEVERSIONS_TABLE_SCHEMA.md)
2. Locked Attributes: [LOCKED_ATTRIBUTES.md](LOCKED_ATTRIBUTES.md)
3. SQL Examples: Check "SQL Examples" sections in above docs

### I'm a Developer
1. Specification: [NEW_UPDATE_SCRIPT_SPEC.md](NEW_UPDATE_SCRIPT_SPEC.md)
2. Implementation: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
3. Tests: [../tests/README_UPDATEGAMES_TESTS.md](../tests/README_UPDATEGAMES_TESTS.md)
4. Source Code: `updategames.js` and `lib/*.js` files

### I'm Debugging
1. Fixes: [UPDATEGAMES_FIXES_SUMMARY.md](UPDATEGAMES_FIXES_SUMMARY.md)
2. Compatibility: [UPDATEGAMES_SCHEMA_COMPATIBILITY.md](UPDATEGAMES_SCHEMA_COMPATIBILITY.md)
3. Tests: Run `node tests/test_updategames.js`
4. Schema: [GAMEVERSIONS_TABLE_SCHEMA.md](GAMEVERSIONS_TABLE_SCHEMA.md)

---

## 📑 By Topic

### SMWC Integration
- Rate limiting: [NEW_UPDATE_SCRIPT_SPEC.md](NEW_UPDATE_SCRIPT_SPEC.md#smwc-metadata-fetcher)
- Metadata format: [UPDATEGAMES_README.md](UPDATEGAMES_README.md#workflow)

### Patch Processing
- Scoring: [NEW_UPDATE_SCRIPT_SPEC.md](NEW_UPDATE_SCRIPT_SPEC.md#patch-processor-module)
- All patches: [UPDATEGAMES_README.md](UPDATEGAMES_README.md#all-patches-mode)

### Blob Encryption
- Format: [NEW_UPDATE_SCRIPT_SPEC.md](NEW_UPDATE_SCRIPT_SPEC.md#blob-creator-module)
- Deduplication: [UPDATEGAMES_README.md](UPDATEGAMES_README.md#workflow)

### Database Schema
- Fields: [GAMEVERSIONS_TABLE_SCHEMA.md](GAMEVERSIONS_TABLE_SCHEMA.md)
- Boolean handling: [GV_BUGFIX_LOADDATA.md](GV_BUGFIX_LOADDATA.md)
- New fields: [GV_SCHEMA_UPDATE_SUMMARY.md](GV_SCHEMA_UPDATE_SUMMARY.md)
- combinedtype: [GV_COMBINEDTYPE_UPDATE.md](GV_COMBINEDTYPE_UPDATE.md)
- Locked attributes: [LOCKED_ATTRIBUTES.md](LOCKED_ATTRIBUTES.md)

### Testing
- Updategames tests: [../tests/README_UPDATEGAMES_TESTS.md](../tests/README_UPDATEGAMES_TESTS.md)
- Running tests: `node tests/test_updategames.js`

---

## 🗂️ File Organization

```
docs/
├── UPDATEGAMES_INDEX.md (📍 You are here)
│
├── Quick Start & User Guides
│   ├── UPDATEGAMES_QUICK_START.md ⭐ Start here
│   ├── UPDATEGAMES_README.md
│   └── UPDATEGAMES_FINAL_STATUS.md
│
├── Specifications
│   ├── NEW_UPDATE_SCRIPT_SPEC.md (Phase 1)
│   └── NEW_UPDATE_SCRIPT_PHASE2_SPEC.md (Future)
│
├── Implementation Summaries
│   ├── IMPLEMENTATION_SUMMARY.md (Phase 1)
│   ├── UPDATEGAMES_COMPLETE_IMPLEMENTATION.md (Full status)
│   ├── UPDATEGAMES_SCHEMA_COMPATIBILITY.md (Compatibility)
│   └── UPDATEGAMES_FIXES_SUMMARY.md (Quick fixes)
│
├── Database Schema
│   ├── GAMEVERSIONS_TABLE_SCHEMA.md (Complete reference)
│   └── LOCKED_ATTRIBUTES.md (Locked attributes guide)
│
└── loaddata.js Related (For context)
    ├── GV_BUGFIX_LOADDATA.md (Boolean fix)
    ├── GV_SCHEMA_UPDATE_SUMMARY.md (v1.1)
    ├── GV_COMBINEDTYPE_UPDATE.md (v1.2)
    ├── GV_LOCKED_ATTRIBUTES_IMPLEMENTATION.md (v1.3)
    └── GV_COMPLETE_SESSION_SUMMARY.md (Full session)

tests/
└── README_UPDATEGAMES_TESTS.md (Test documentation)
```

---

## 🎯 Common Questions

### Q: Where do I start?
**A**: [UPDATEGAMES_QUICK_START.md](UPDATEGAMES_QUICK_START.md)

### Q: What's the difference between loaddata.js and updategames.js?
**A**: 
- `loaddata.js`: Loads JSON files into database (manual)
- `updategames.js`: Complete automated workflow (fetch + download + process + load)
- Both handle schema the same way (100% feature parity)

### Q: Do I still need loaddata.js?
**A**: Yes, for manual JSON file imports. Use `updategames.js` for automated SMWC updates.

### Q: What are locked attributes?
**A**: [LOCKED_ATTRIBUTES.md](LOCKED_ATTRIBUTES.md) - Fields that persist across version updates.

### Q: What is combinedtype?
**A**: [GV_COMBINEDTYPE_UPDATE.md](GV_COMBINEDTYPE_UPDATE.md) - Computed field combining all type/difficulty info.

### Q: How do I run tests?
**A**: `node tests/test_updategames.js` - See [../tests/README_UPDATEGAMES_TESTS.md](../tests/README_UPDATEGAMES_TESTS.md)

### Q: Where are the migration SQL files?
**A**: `electron/sql/rhdata_phase1_migration.sql` and older migration files

### Q: How long does it take?
**A**: ~2-3 minutes per game + metadata fetch time (rate limited)

### Q: Can I resume if interrupted?
**A**: Yes! Use `npm run updategames:resume`

---

## 📞 Support Path

```
Issue?
  ↓
Check UPDATEGAMES_QUICK_START.md troubleshooting
  ↓
Run node tests/test_updategames.js
  ↓
Review UPDATEGAMES_README.md
  ↓
Check specific topic docs above
  ↓
Review source code in lib/
```

---

## ✅ Status Summary

| Component | Status | Tests | Docs |
|-----------|--------|-------|------|
| Core implementation | ✅ | ✅ | ✅ |
| Schema compatibility | ✅ | ✅ | ✅ |
| Boolean normalization | ✅ | ✅ | ✅ |
| New schema fields | ✅ | ✅ | ✅ |
| combinedtype | ✅ | ✅ | ✅ |
| Locked attributes | ✅ | ✅ | ✅ |
| CLI interface | ✅ | ✅ | ✅ |
| Resume capability | ✅ | - | ✅ |
| All patches mode | ✅ | - | ✅ |

**Overall**: ✅ **COMPLETE** (8/8 tests passing)

---

## 🎉 Ready to Use!

Start here: **[UPDATEGAMES_QUICK_START.md](UPDATEGAMES_QUICK_START.md)**

Then run:
```bash
npm run updategames:test
```

---

*Documentation Index - v1.0*  
*October 12, 2025*  
*All documentation complete*

