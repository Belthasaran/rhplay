;===========================================
; SMW Overworld Level Force Patch - WORKING VERSION
; Forces all overworld tiles to enter level !val
; Compatible with Lunar Magic + Retry System
; Strategy: Intercept $7ED000 read and override at $05DCDD
;===========================================
;
; TESTED AND WORKING:
; - Game ID: 18238
; - Level Number: $106 (262 decimal)
; - Status: Works perfectly on first entry
; - Retry system: Works correctly after death
;
; KNOWN SIDE EFFECT:
; - After exiting level (Start+Select), player's overworld location/submap changes
; - This is an unintended side effect that occurs "much later" (after level exit)
; - The level loading itself works correctly, but overworld state is affected
;
;===========================================
; CONFIGURATION: Set your target level here (0x000-0x1FF)
;===========================================
!val = $106

;===========================================
; Calculate level components
; Use #= for assembly-time calculations (no spaces around operators)
;===========================================
; For levels >= $25, SMW uses a special calculation
; Levels 0x00-0x24: use directly
; Levels 0x25+: subtract $DC to get translevel number
; This applies to both 0x25-0x5F and extended levels (>= 0x100)
if !val >= $25
    !anumber #= !val-$DC  ; For levels >= $25, subtract $DC to get translevel
else
    !anumber #= !val
endif

; Calculate high byte flag for extended levels
if !val >= $100
    !high_byte_flag = $01  ; High bit set for extended levels
else
    !high_byte_flag = $00
endif

; SA-1 detection
!addr = $0000
if read1($00FFD5) == $23
    sa1rom
    !addr = $6000
endif

; Skip intro and short timer
org $9CB1
    db $00

org $00A09C
    db $10

; Hook at $05D89B - This is where the game reads the level number from $7ED000
; Original: LDA.L $7ED000,X (4 bytes) followed by STA.W $13BF (3 bytes)
; We replace the LDA with JSL, and our routine will execute the STA
org $05D89B
    autoclean JSL GetTargetLevel
    ; The STA.W $13BF instruction is now in our routine

; Hook at $05DCDD - This is AFTER Lunar Magic's GetLevelHighByte runs
; This ensures the level is set correctly even if something overrides it
; Same approach as 2lvno_test.asm - this is the proven working hook
org $05DCDD
    autoclean JSL OverrideLevel
    NOP

; Free space for code
freedata

GetTargetLevel:
    ; This routine replaces: LDA.L $7ED000,X
    ; Original code flow:
    ;   $05D89B: LDA.L $7ED000,X  (4 bytes)
    ;   $05D89F: STA.W $13BF      (3 bytes)
    ;   $05D8A2: CMP.B #$25, then subtract $24 if >= $25
    ; 
    ; At entry: 
    ;   - X register contains the tile index (already set up by caller)
    ;   - Processor is in 8-bit accumulator mode (SEP #$20 was done at $05D899)
    ;   - Y register contains player index (set at $05D88A)
    ; 
    ; We need to:
    ;   1. Return the correct value in A
    ;   2. Execute the STA.W $13BF that we overwrote
    ;   3. The code will then process it at $05D8A2
    
    ; Save registers (preserve X and Y, which are used by caller)
    PHX
    PHY
    
    ; Calculate the value to return
    ; For level $106: !anumber = $106 - $DC = $2A
    ; The code at $05D8A2 will subtract $24 if >= $25
    ; So if we return $2A, it will subtract $24 giving $06 (wrong!)
    ; We need to return $2A + $24 = $4E, so after subtracting $24 we get $2A (correct!)
    ; But then $13BF will be $4E (wrong), so we'll fix it at $05DCDD
    if !val >= $25
        ; For levels >= $25, return !anumber + $24
        ; This ensures $17BB and $0E are set correctly after the subtraction
        LDA.b #(!anumber+$24)
    else
        ; For levels < $25, return !anumber directly
        LDA.b #!anumber
    endif
    
    ; Execute the STA.W $13BF instruction that we overwrote
    ; This stores our value to $13BF (we'll fix it later at $05DCDD)
    STA $13BF|!addr
    
    ; For extended levels (>= 0x100), we need to set $1F11 (high byte flag)
    ; This is checked later at $05D8AE: LDA.W $1F11,Y
    if !val >= $100
        ; Set high byte flag in $1F11 for the current player
        ; Y register is already set to player index, so we can use it directly
        PHA  ; Save our return value
        LDA.b #!high_byte_flag
        STA $1F11|!addr,y  ; Set high byte for current player
        PLA  ; Restore return value
    endif
    
    ; Restore registers
    PLY
    PLX
    
    ; Return with target level in A (for the CMP instruction at $05D8A2)
    RTL

OverrideLevel:
    ; This routine hooks at $05DCDD (same as 2lvno_test.asm)
    ; At this point, Lunar Magic's GetLevelHighByte has already run
    ; We need to ensure $13BF is set to our target level
    
    ; Save registers (EXACTLY like 2lvno_test.asm)
    PHX
    PHP
    
    ; Set processor to 8-bit accumulator mode
    SEP #$20
    
    ; Set the level number in $13BF (main level number)
    ; Use direct addressing (no !addr) like 2lvno_test.asm
    LDA.b #!anumber
    STA $13BF
    
    ; For levels >= $25, set $1F11 (high byte flag) - same as 2lvno_test.asm
    ; Note: 2lvno_test.asm uses STA.w $851f11 which seems to be $1F11 with absolute addressing
    ; We'll use the standard approach with player index
    if !val >= $25
        ; Get current player index
        LDA $0DD6|!addr
        LSR
        LSR
        TAY
        LDA.b #$01
        STA $1F11|!addr,y  ; Set high byte for current player
        ; Set A back to 0 (like 2lvno_test.asm does)
        LDA.b #$00
    else
        ; For levels < $25, set A to 0 (like 2lvno_test.asm)
        LDA.b #$00
    endif
    
    ; Restore A register value (EXACTLY like 2lvno_test.asm)
    LDA.b #!anumber
    
    ; Restore processor state
    PLP
    PLX
    RTL

