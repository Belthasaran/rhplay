# Vanilla SMW Translevel Generation - CODE_04D7F9

## Overview

In vanilla SMW, there is **no separate LevelNumberMap stored in ROM**. Instead, the translevel table at RAM $7ED000 is **generated dynamically** by scanning the Layer 1 tilemap.

## Vanilla Code Analysis (CODE_04D7F9)

### Setup

```asm
CODE_04D7F9:  A9 00         LDA.B #$00                
CODE_04D7FB:  85 0D         STA $0D                   
CODE_04D7FD:  A9 D0         LDA.B #$D0                
CODE_04D7FF:  85 0E         STA $0E                   
CODE_04D801:  A9 7E         LDA.B #$7E                
CODE_04D803:  85 0F         STA $0F                   ; $0D/$0E/$0F = $7ED000 (destination: translevel numbers)

CODE_04D805:  A9 00         LDA.B #$00                
CODE_04D807:  85 0A         STA $0A                   
CODE_04D809:  A9 D8         LDA.B #$D8                
CODE_04D80B:  85 0B         STA $0B                   
CODE_04D80D:  A9 7E         LDA.B #$7E                
CODE_04D80F:  85 0C         STA $0C                   ; $0A/$0B/$0C = $7ED800 (destination: exit path directions)

CODE_04D811:  A9 00         LDA.B #$00                
CODE_04D813:  85 04         STA $04                   
CODE_04D815:  A9 C8         LDA.B #$C8                
CODE_04D817:  85 05         STA $05                   
CODE_04D819:  A9 7E         LDA.B #$7E                
CODE_04D81B:  85 06         STA $06                   ; $04/$05/$06 = $7EC800 (source: Layer 1 tilemap low bytes)

CODE_04D81D:  A0 01 00      LDY.W #$0001              
CODE_04D820:  84 00         STY $00                   ; $00 = translevel counter (starts at 1)
```

### Initialization Loop

```asm
CODE_04D822:  A0 FF 07      LDY.W #$07FF              ; Y = 2047 (loop through 2048 bytes)
CODE_04D825:  A9 00         LDA.B #$00                
CODE_04D827:  97 0A         STA [$0A],Y              ; Clear $7ED800[Y]
CODE_04D829:  97 0D         STA [$0D],Y              ; Clear $7ED000[Y]
CODE_04D82B:  88            DEY                       
CODE_04D82C:  10 F9         BPL CODE_04D827          ; Loop until Y < 0
```

This clears both destination tables (2048 bytes = 32x32x2 submaps).

### Main Generation Loop

```asm
CODE_04D82E:  A0 00 00      LDY.W #$0000              ; Y = 0 (tile index)
CODE_04D831:  BB            TYX                       
CODE_04D832:  B7 04         LDA [$04],Y              ; Load tile value from $7EC800[Y]
CODE_04D834:  C9 56         CMP.B #$56                ; Compare with $56
CODE_04D836:  90 11         BCC CODE_04D849          ; If < $56, skip (not a level tile)
CODE_04D838:  C9 81         CMP.B #$81                ; Compare with $81
CODE_04D83A:  B0 0D         BCS CODE_04D849          ; If >= $81, skip (not a level tile)
CODE_04D83C:  A5 00         LDA $00                   ; Load translevel counter
CODE_04D83E:  97 0D         STA [$0D],Y              ; Store translevel to $7ED000[Y]
CODE_04D840:  AA            TAX                       
CODE_04D841:  BF 78 D6 04   LDA.L DATA_04D678,X      ; Load exit path direction
CODE_04D845:  97 0A         STA [$0A],Y              ; Store exit path to $7ED800[Y]
CODE_04D847:  E6 00         INC $00                   ; Increment translevel counter
CODE_04D849:  C8            INY                       
CODE_04D84A:  C0 00 08      CPY.W #$0800              ; Compare with 2048
CODE_04D84D:  D0 E3         BNE CODE_04D832           ; Loop until Y >= 2048
```

### Key Findings

1. **Level Tile Range**: Tiles with values **$56-$80** (inclusive) are level tiles
2. **Sequential Assignment**: Translevels are assigned sequentially (1, 2, 3, ...) as level tiles are found
3. **Source**: Layer 1 tilemap low bytes at RAM $7EC800 (loaded from ROM)
4. **Destinations**:
   - $7ED000[Y] = translevel number (1 byte)
   - $7ED800[Y] = exit path direction from DATA_04D678 (1 byte)

### DATA_04D678 - Exit Path Directions

Located at ROM offset `$04D678`, this table contains exit path directions for each translevel:
- One byte per translevel (indexed by translevel number)
- Contains direction/exit path information
- ~96 entries (for translevels 0-95)

## Implementation Strategy

For vanilla ROMs (no hijack):

1. **Find Layer 1 tilemap source** in ROM
   - Need to locate where $7EC800 data comes from
   - May be uncompressed in ROM or loaded via other means

2. **Scan tilemap** for tiles in range $56-$80
   - For each level tile found, assign sequential translevel number
   - Map tile position (X, Y, submap) to translevel

3. **Read exit path directions** from DATA_04D678
   - Located at ROM offset corresponding to SNES $04D678
   - Use translevel number as index

4. **Build translevel map** with:
   - Translevel number (sequential: 1, 2, 3, ...)
   - Level number (using translevel_to_level formula)
   - Tile positions (X, Y, submap)
   - Exit path directions

## Differences from LM Hijacked ROMs

| Aspect | Vanilla | LM Hijacked |
|--------|---------|-------------|
| LevelNumberMap | Generated dynamically | Stored compressed in ROM |
| Source | Layer 1 tilemap scan | Compressed LevelNumberMap |
| Translevel assignment | Sequential (1, 2, 3...) | Pre-defined in LevelNumberMap |
| Exit paths | DATA_04D678 table | May be in LevelNumberMap |

## Notes

- Translevel 0 is never assigned (counter starts at 1)
- Maximum translevels: ~96 (limited by DATA_04D678 table size)
- Tilemap size: 2048 bytes (32x32x2 submaps)
- Level tiles: $56-$80 (inclusive)

