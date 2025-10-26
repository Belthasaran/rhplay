# Test Suite for fetchpatches.js

## Overview

This directory contains test scripts for `fetchpatches.js` modes and functionality.

## Test Files

### `test_mode2.js`

Comprehensive test suite for Mode 2 (Find Attachment Data).

**Features:**
- Creates test database with full schema
- Creates test fixtures (sample files)
- Tests all Mode 2 options
- Validates implementation against spec
- Generates test report

**Usage:**
```bash
# Run all tests
cd tests
node test_mode2.js

# Tests will create:
# - tests/temp/test_patchbin.db (test database)
# - tests/fixtures/*.bin (test files)
```

## Test Results

The test suite validates:

✅ **Core Functionality**
- Database query logic
- Hash verification (SHA-256, SHA-224)
- File size parsing
- last_search ordering

✅ **Search Options**
- Option A: Local search
- Option B: Custom paths
- Option C: ArDrive (infrastructure)
- Option D: IPFS
- Option F: Download URLs

✅ **Parameters**
- --searchmax
- --maxfilesize
- --fetchdelay
- --ignorefilename
- --nosearchlocal
- --ipfsgateway

## Test Coverage

**Implementation: 18/23 features (78%)**

### Fully Implemented ✅
- Query attachments with NULL file_data
- Order by last_search ASC NULLS FIRST
- Secure hash verification
- Update file_data and last_search
- All basic search options
- Parameter parsing

### Not Implemented ❌
- Archive searching (needs libraries)
- Option E: --allardrive
- Option G: --apisearch
- donotsearch table support
- HTTP 403/603 handling

## Test Database

The test database includes:

**Tables:**
- `attachments` - Full schema from patchbin.sql
- `donotsearch` - For API rate limiting (future)
- `signers` - For signature verification (future)

**Test Data:**
- 5 test attachments
- Various scenarios (with/without data, searched/unsearched)
- Test fixtures with known hashes

## Test Fixtures

Located in `tests/fixtures/`:

1. **test_file_1.bin** (1,900 bytes)
   - Has file_data in database
   - Baseline test

2. **test_file_2.bin** (3,800 bytes)
   - Missing file_data
   - Should be found locally

3. **test_file_3.dat** (2,850 bytes)
   - Test file with different extension

Each fixture has calculated:
- SHA-224 hash
- SHA-256 hash
- SHA-1 hash
- MD5 hash
- File size

## Running Tests

### Prerequisites

```bash
# Ensure you're in the project root
cd /home/main/proj/rhtools

# Dependencies should already be installed
npm install
```

### Run Test Suite

```bash
cd tests
node test_mode2.js
```

### Expected Output

```
╔════════════════════════════════════════════════════════════════════╗
║               Mode 2 Test Suite                                    ║
╚════════════════════════════════════════════════════════════════════╝

======================================================================
Setting up test database
======================================================================
✓ Created test database with schema
✓ Created donotsearch table
✓ Created signers table

======================================================================
Creating test fixtures
======================================================================
✓ Created fixture: test_file_1.bin (1900 bytes)
✓ Created fixture: test_file_2.bin (3800 bytes)
✓ Created fixture: test_file_3.dat (2850 bytes)

... (more tests)

======================================================================
ALL TESTS COMPLETE
======================================================================
✓ Test database and fixtures remain in tests/temp/ for manual testing
ℹ Test database: /home/main/proj/rhtools/tests/temp/test_patchbin.db
ℹ Test fixtures: /home/main/proj/rhtools/tests/fixtures
```

## Manual Testing

After running the test suite, you can manually test Mode 2 with the test database:

```bash
# From project root
cd tests

# Test local search with fixtures
node ../fetchpatches.js mode2 --searchlocalpath=./fixtures --searchmax=3

# The test database is in tests/temp/test_patchbin.db
# Point to it if needed (requires code modification)
```

## Cleaning Up

```bash
# Remove test database
rm tests/temp/test_patchbin.db

# Remove test fixtures
rm tests/fixtures/*.bin
rm tests/fixtures/*.dat

# Or remove entire temp directory
rm -rf tests/temp/*
```

## Adding New Tests

To add new tests to `test_mode2.js`:

1. **Add test function:**
   ```javascript
   async function testNewFeature() {
     section('TEST: New Feature');
     // Test implementation
   }
   ```

2. **Call in main:**
   ```javascript
   async function runTests() {
     // ... existing tests
     await testNewFeature();
   }
   ```

3. **Update completeness check:**
   ```javascript
   const features = [
     // ... existing features
     { name: 'New feature', implemented: true }
   ];
   ```

## Test Database Schema

The test database includes additional tables not in production:

```sql
CREATE TABLE donotsearch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url VARCHAR(255) NOT NULL,
  reason VARCHAR(255),
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(url)
);

CREATE TABLE signers (
  signeruuid VARCHAR(255) PRIMARY KEY,
  public_key VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  authorized BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

These are for future Option G (API search) implementation.

## Continuous Integration

To integrate with CI/CD:

```yaml
# Example .github/workflows/test.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v2
    - uses: actions/setup-node@v2
    - run: npm install
    - run: cd tests && node test_mode2.js
```

## Related Documentation

- `../FETCHPATCHES_MODE2.md` - User documentation
- `../FETCHPATCHES_MODE2_SPEC.txt` - Original specification
- `../FETCHPATCHES_MODE2_IMPLEMENTATION_REVIEW.md` - Implementation review
- `../electron/sql/patchbin.sql` - Database schema

## Support

For issues or questions about tests:
1. Check test output for specific errors
2. Review implementation review document
3. Verify database schema matches
4. Check fixture files exist and are valid

