# Level Name Extractor 2 - Quick Reference
**Script:** `levelname_extractor2.py`

---

## Quick Start

### Basic extraction
```bash
python levelname_extractor2.py --romfile myrom.sfc
```

### Filter vanilla names (NO ROM FILE NEEDED!)
```bash
python levelname_extractor2.py --romfile myrom.sfc --novanilla
```

### Show only edited levels (compares actual data)
```bash
python levelname_extractor2.py --romfile myrom.sfc --editedonly --vanilla-rom smw.sfc
```

### Filter message boxes
```bash
python levelname_extractor2.py --romfile myrom.sfc --levelsonly
```

### Ultimate clean output
```bash
python levelname_extractor2.py --romfile myrom.sfc \
  --editedonly --vanilla-rom smw.sfc \
  --novanilla \
  --levelsonly \
  --withwords
```

---

## Key Features

| Option | Purpose | Needs ROM? |
|--------|---------|------------|
| `--novanilla` | Remove vanilla names | ❌ No (hardcoded) |
| `--editedonly` | Only edited level DATA | ✅ Yes (--vanilla-rom) |
| `--levelsonly` | Remove message boxes | ❌ No (pattern detection) |
| `--withwords` | Only English names | ❌ No |

---

## Examples

### Find custom levels in a hack
```bash
python levelname_extractor2.py --romfile hack.sfc --novanilla --levelsonly
```

### Document edited levels
```bash
python levelname_extractor2.py --romfile hack.sfc \
  --editedonly --vanilla-rom smw.sfc \
  --levelsonly > edited_levels.txt
```

### Quick name check
```bash
python levelname_extractor2.py --romfile myrom.sfc --range 0x001-0x020
```

---

## Important Notes

- **`--novanilla`**: Works without any vanilla ROM file (uses 91 hardcoded names)
- **`--editedonly`**: Compares actual level DATA, not just names (requires vanilla ROM)
- **`--levelsonly`**: Smart pattern detection, no hardcoded lists
- Combine filters for precise results

