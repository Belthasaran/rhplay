;===========================================
; SMW Overworld Level Force Patch (with Midway Support)
; Forces all overworld tiles to enter level !val
; Compatible with Lunar Magic + Retry System
; Strategy: Intercept $7ED000 read and override at $05DCDD
;
; GOAL: Fix Midway entrances
;===========================================

;===========================================
; CONFIGURATION: Set your target level here (0x000-0x1FF)
;===========================================
!val = $005

;===========================================
; Free RAM for tracking checkpoint collection
;===========================================
!checkpoint_tracked = $7FB3C1  ; Free RAM byte: 0 = not collected, 1 = collected

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

; Hook at $05D9D7 - This is where the game checks checkpoint flag from $1EA2
; Original: LDA.W $1EA2,X (3 bytes) = opcode $BD
; Retry System uses: JML CheckMidwayEntrance (4 bytes) = opcode $5C
; 
; We check if something has already hooked here (JML = $5C or JSL = $22)
; If yes, we skip our hook (let Retry System handle it)
; If no, we hook here to handle the checkpoint flag ourselves
if read1($05D9D7) == $5C || read1($05D9D7) == $22
    ; Retry System (or another patch) has already hooked here
    ; Since we're forcing $13BF to !anumber in OverrideLevel, the existing hook
    ; will automatically read the checkpoint flag for our forced level
    ; No additional hook needed
else
    ; No existing hook - we need to handle the checkpoint flag ourselves
    ; Original: LDA.W $1EA2,X (3 bytes) at $05D9D7
    ;           AND.B #$40 (2 bytes) at $05D9DA
    ;           BEQ ... at $05D9DC (check if checkpoint collected)
    ;           STA.W $13CF at $05D9DE (set midway flag if checkpoint collected)
    ; 
    ; We replace only the LDA (3 bytes) with JSL (4 bytes), but we need to preserve
    ; the AND instruction. However, we can't fit JSL (4 bytes) in 3 bytes, so we need
    ; to replace both LDA and AND (5 bytes total) with JSL + NOP (4 + 1 = 5 bytes)
    ; 
    ; IMPORTANT: We must return A with the AND already applied, because we're overwriting
    ; the AND instruction. The BEQ at $05D9DC will check if A is non-zero.
    org $05D9D7
        autoclean JSL CheckMidwayFlag
        NOP
endif

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
    
    ; Calculate the value to return FIRST (this is critical for correct level loading)
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
    
    ; NOW store original level number (after all calculations are done)
    ; This avoids interfering with level loading
    ; X is still valid from caller (we haven't restored it yet)
    ; Save A first since we need it for the read
    PHA  ; Save A (contains our return value)
    LDA.L $7ED000,X  ; Read original level (X still valid from caller)
    STA $7FB3C0|!addr  ; Store original level number
    PLA  ; Restore A (our return value)
    
    ; NOTE: We do NOT modify $1F11 here because it stores submap information
    ; Modifying it would change the player's overworld location
    ; Instead, we'll set $0F (high byte) directly in OverrideLevel
    
    ; Restore registers
    PLY
    PLX
    
    ; Return with target level in A (for the CMP instruction at $05D8A2)
    ; A already contains the correct value from the LDA above
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
    
    ; NOTE: We do NOT initialize the checkpoint tracking flag here
    ; OverrideLevel runs multiple times per session, so this is not an acceptable place
    ; We need a hook point that runs once at game startup, but haven't found a safe one yet
    ; For now, the flag may be uninitialized, but CheckMidwayFlag will handle this by
    ; checking $1EA2 directly (which works from save files)
    ; Set the level number in $13BF (main level number)
    ; Use direct addressing (no !addr) like 2lvno_test.asm
    LDA.b #!anumber
    STA $13BF
    
    ; For extended levels (>= 0x100), set $0F (high byte) directly
    ; This avoids modifying $1F11 which stores submap information
    ; The code at $05D8AE-$05D8B5 sets $0F based on $1F11, but we override it here
    ; This prevents the submap from changing when exiting the level
    if !val >= $100
        ; Extended level - set high byte directly
        LDA.b #$01
        STA $0F|!addr
    endif
    
    ; For levels >= $25 but < $100, the original code should handle $0F correctly
    ; based on $1F11 (submap). We don't need to modify anything.
    ; 
    ; NOTE: We intentionally do NOT modify $1F11 because:
    ; - $1F11 stores submap number (0 = main overworld, 1+ = submaps)
    ; - Modifying it would change the player's overworld location
    ; - The code at $05D8AE uses $1F11 to determine high byte, but for extended
    ;   levels we set $0F directly instead
    
    ; Clear $13CF (midway entrance flag) when entering from overworld
    ; This ensures we don't incorrectly enter at midway when the checkpoint flag is invalid
    ; $13CF will be set later by the game code if the checkpoint flag is valid
    STZ $13CF|!addr
    
    ; NOTE: We do NOT clear the checkpoint tracking flag here
    ; The flag should persist across overworld entries within the same session
    ; It will only be initialized to 0 once at game startup (when uninitialized)
    ; Once set to 1 (checkpoint collected), it stays 1 until game restart
    ; NOTE: We do NOT clear the checkpoint flag in $1EA2 here, because it might be
    ; a valid checkpoint from a previous session (saved in the save file)
    ; Instead, we let CheckMidwayFlag check $1EA2 directly, and it will work if valid
    
    ; Set A back to 0 (like 2lvno_test.asm does)
    LDA.b #$00
    
    ; Restore A register value (EXACTLY like 2lvno_test.asm)
    LDA.b #!anumber
    
    ; Restore processor state
    PLP
    PLX
    RTL

CheckMidwayFlag:
    ; This routine replaces: LDA.W $1EA2,X and AND.B #$40
    ; Original code flow:
    ;   $05D9D4: LDX.W $13BF  (load translevel into X)
    ;   $05D9D7: LDA.W $1EA2,X  (3 bytes) - read checkpoint flag
    ;   $05D9DA: AND.B #$40     (2 bytes) - mask to bit 6
    ;   $05D9DC: BEQ ...        (check if checkpoint collected)
    ;   $05D9DE: STA.W $13CF    (set midway flag if checkpoint collected)
    ; 
    ; At entry:
    ;   - X contains translevel from $13BF (which we forced to !anumber in OverrideLevel)
    ;   - We need to read $1EA2[X] and return it with AND #$40 applied
    ;   - CRITICAL: We MUST return A with the AND result (0x40 or 0x00)
    ;     because we're overwriting both LDA and AND instructions
    ; 
    ; IMPORTANT: X should already be !anumber since we set $13BF to !anumber
    ; But we verify this to ensure we're reading from the correct level
    
    ; Save registers (X must be preserved - game uses it after this)
    PHX
    PHP
    SEP #$20
    
    ; CRITICAL: Check if we're in the forced level scenario
    ; $13BF contains the actual level we're in (which we forced to !anumber)
    ; X contains the translevel from the overworld tile (original level, not forced level)
    ; We need to check $1EA2 for the forced level (!anumber), not the original level (X)
    LDA $13BF|!addr   ; Check if we're in the forced level
    CMP.b #!anumber
    BNE .wrong_level  ; If not in forced level, return 0 (no checkpoint)
    
    ; We're in the forced level - read checkpoint flag for forced level (!anumber)
    ; We check $1EA2 for the forced level to see if checkpoint was collected
    ; $1EA2 is RAM-based and persists within a session until game restart
    ; Use !anumber as the translevel index, not X (which is the original level's translevel)
    PHX  ; Save original X (game might use it)
    LDX.b #!anumber   ; Use forced level's translevel
    LDA $1EA2|!addr,X ; Read checkpoint flag for forced level
    AND.b #$40        ; Bit 6 = checkpoint collected
    PLX  ; Restore original X
    ; A now contains 0x40 if checkpoint set, 0x00 if not
    ; This is all we need - $1EA2 persists across overworld entries within a session
    
.wrong_level:
    ; Not in forced level - return 0 (no checkpoint)
    LDA.b #$00
    
.return:
    ; A now contains the checkpoint flag (0x40 if set, 0x00 if not)
    ; This matches what the original code would return after LDA + AND
    ; CRITICAL: Ensure A is exactly 0x40 or 0x00, nothing else
    ; This prevents issues where A might have an invalid value
    CMP.b #$40
    BEQ .return_valid  ; If A is 0x40, it's valid
    CMP.b #$00
    BEQ .return_valid  ; If A is 0x00, it's valid
    ; A has an invalid value - force it to 0x00
    LDA.b #$00
    
.return_valid:
    ; A is now guaranteed to be 0x40 or 0x00
    ; CRITICAL: The BEQ at $05D9DC checks if A is zero (Z flag set)
    ; We need to ensure the Z flag is set correctly based on A's value
    ; If A is 0x00, Z flag should be set (so BEQ branches, skipping STA)
    ; If A is 0x40, Z flag should be clear (so BEQ doesn't branch, STA executes)
    ; 
    ; IMPORTANT: The CMP instructions above have already set the Z flag correctly
    ; But we need to preserve it when we restore flags with PLP
    ; The solution is to set the Z flag based on A AFTER PLP, not before
    
    ; Restore registers (must restore in reverse order: PLP then PLX)
    PLP  ; Restore original flags (this will overwrite Z flag)
    PLX  ; Restore X register
    
    ; CRITICAL: Set Z flag based on A value AFTER restoring flags
    ; This ensures BEQ at $05D9DC will branch if A is 0, or not branch if A is non-zero
    ; We use CMP to set Z flag without modifying A
    CMP.b #$00  ; Sets Z flag if A is 0, clears Z if A is non-zero
    
    RTL

TrackCheckpointCollection:
    ; This routine hooks at $04995B where the game sets the checkpoint flag
    ; Original code:
    ;   $049950: LDA.L $7ED000,X  (read level number from overworld tile)
    ;   $049954: AND.W #$00FF
    ;   $049957: TAX
    ;   $049958: LDA.W DATA_04941E,Y  (load flag value, likely $40)
    ;   $04995B: ORA.W $1EA2,X  (OR with checkpoint flag)
    ;   $04995E: STA.W $1EA2,X  (store back)
    ; 
    ; At entry:
    ;   - X contains the translevel from the overworld tile (original level, not forced level)
    ;   - A contains the flag value to OR (from DATA_04941E,Y at $049958, likely $40)
    ;   - $13BF contains the actual level we're in (which we forced to !anumber)
    ; 
    ; Problem: The game sets the checkpoint flag for the original level (X), but we're in the forced level
    ; Solution: Check if we're in the forced level, and if so, set the checkpoint flag for !anumber instead
    
    ; Save registers
    PHX
    PHP
    SEP #$20
    
    ; Check if we're currently in the forced level
    ; $13BF contains the actual level we're in (which we forced to !anumber)
    LDA $13BF|!addr
    CMP.b #!anumber
    BNE .not_forced_level  ; If not in forced level, execute original code
    
    ; We're in the forced level - set checkpoint flag for forced level instead of original level
    ; $1EA2 is RAM-based and will persist across overworld entries within the session
    PHX  ; Save original translevel
    LDX.b #!anumber  ; Use forced level's translevel
    ORA $1EA2|!addr,X  ; OR with checkpoint flag for forced level
    STA $1EA2|!addr,X  ; Store back for forced level
    PLX  ; Restore original translevel
    
    ; Restore registers and return
    PLP
    PLX
    RTL
    
.not_forced_level:
    ; Not in forced level - execute original code
    ; A already contains the flag value to OR (from DATA_04941E,Y)
    ; X already contains the translevel from overworld tile
    ORA $1EA2|!addr,X  ; OR with checkpoint flag (original operation)
    STA $1EA2|!addr,X  ; Store back (original operation)
    
    ; Restore registers
    PLP
    PLX
    RTL

VerifyMidwayFlag:
    ; This routine hooks at $05DA60 where the game checks $13CF for midway spawn
    ; Original code:
    ;   $05DA60: LDA.W $13CF  (read midway flag)
    ;   $05DA63: BNE CODE_05DAD0  (if non-zero, use midway spawn)
    ;   $05DA65: ... (use main entrance spawn)
    ; 
    ; At entry:
    ;   - We need to read $13CF and return it, but verify checkpoint is valid
    ;   - If checkpoint wasn't collected, we return 0 to force main entrance spawn
    ;   - We check both tracking flag (current session) and $1EA2 (save file)
    ; 
    ; IMPORTANT: We must preserve X register (game uses it after this)
    ; NOTE: X should contain the translevel (which we forced to !anumber)
    
    ; Save registers
    PHX
    PHP
    SEP #$20
    
    ; First, check if we're in the forced level scenario
    ; $13BF contains the actual level we're in (which we forced to !anumber)
    ; X contains the translevel from the overworld tile (original level, not forced level)
    ; We need to check $1EA2 for the forced level (!anumber), not the original level (X)
    LDA $13BF|!addr   ; Check if we're in the forced level
    CMP.b #!anumber
    BNE .not_forced_level  ; If not in forced level, return $13CF as-is (original behavior)
    
    ; We're in the forced level - check if checkpoint is valid
    ; Use !anumber as the translevel index, not X (which is the original level's translevel)
    ; The game code at $05D9DE already set $13CF based on CheckMidwayFlag's return value
    ; So if $13CF is set to 0x40, it means CheckMidwayFlag found a checkpoint
    ; We just need to verify that the checkpoint is actually valid
    
    ; Read $13CF first (game code already set it)
    LDA $13CF|!addr   ; Read $13CF (original operation)
    CMP.b #$40        ; Check if $13CF is set to 0x40 (midway flag)
    BNE .no_midway    ; If not 0x40, no midway, return 0
    
    ; $13CF is set to 0x40 - verify checkpoint is actually valid by checking $1EA2
    ; $1EA2 is RAM-based and persists across overworld entries within a session
    PHA  ; Save $13CF value
    PHX  ; Save original X
    LDX.b #!anumber   ; Use forced level's translevel
    LDA $1EA2|!addr,X ; Read checkpoint flag for forced level
    PLX  ; Restore original X
    AND.b #$40        ; Bit 6 = checkpoint collected
    CMP.b #$40        ; Check if checkpoint flag is set
    BEQ .checkpoint_valid  ; If set, checkpoint exists, trust $13CF
    
    ; No checkpoint found in $1EA2 - but $13CF is set
    ; This shouldn't happen, but clear $13CF to be safe
    PLA  ; Discard saved $13CF value
    LDA.b #$00
    STA $13CF|!addr   ; Clear $13CF to prevent other code paths from using it
    BRA .return
    
.checkpoint_valid:
    ; Checkpoint is valid - restore $13CF value and return it
    PLA  ; Restore $13CF value (0x40)
    BRA .return
    
.no_midway:
    ; $13CF is not set to 0x40 - no midway, return 0
    LDA.b #$00
    BRA .return
    
.not_forced_level:
    ; Not our forced level - return $13CF as-is (original behavior)
    LDA $13CF|!addr   ; Read $13CF (original operation)
    
.return:
    ; A now contains the value to check (0x40 if midway, 0x00 if main entrance)
    ; The game code at $05DA63 will check if A is non-zero
    ; X register is preserved (game uses it after this)
    
    ; Restore registers
    PLP
    PLX
    RTL

;===========================================
; Hook at $05DA60 - Where $13CF is checked for midway spawn
; Original: LDA.W $13CF (3 bytes) followed by BNE CODE_05DAD0 (2 bytes) = 5 bytes total
; We replace with JSL + NOP (4 + 1 = 5 bytes)
; This ensures $13CF is only used if checkpoint was actually collected
;===========================================
org $05DA60
    JSL VerifyMidwayFlag
    NOP

;===========================================
; Hook at $04995B - Where checkpoint flag is set
; Original: ORA.W $1EA2,X (3 bytes) followed by STA.W $1EA2,X (3 bytes) = 6 bytes total
; We replace with JSL + NOP (4 + 2 = 6 bytes)
;===========================================
org $04995B
    JSL TrackCheckpointCollection
    NOP
    NOP

