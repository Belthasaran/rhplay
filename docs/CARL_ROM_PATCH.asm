; CARL ROM Patch for Super Mario World
; This patch adds CARL (Code Assembly Runtime Loader) support to SMW
; Apply this patch to your SMW ROM using ASAR before using !load commands
;
; Usage:
;   asar CARL_ROM_PATCH.asm your_smw_rom.sfc
;
; This will inject a JSL hook into the NMI routine that calls CARL modules every frame

; ============================================================================
; NMI Hook Installation
; ============================================================================

; Hijack SMW's NMI routine to call CARL hook
org $008056
    JSL carl_frame_hook
    NOP  ; Padding (JSL is 4 bytes, replaced what was here)
    
; Return point - continue with original NMI code
; (The original code at $008056 was replaced, so we execute it in our hook)

; ============================================================================
; CARL Frame Hook (in ROM for now, could be moved to RAM)
; ============================================================================

org $00FFC0  ; Unused ROM space (adjust as needed for your ROM)

carl_frame_hook:
    ; Preserve registers
    PHB
    PHA
    PHX
    PHY
    PHP
    
    ; Set data bank to $7F (WRAM)
    PEA $7F7F
    PLB
    PLB
    
    ; Call CARL module hook in RAM
    ; The RHTools CARL system will populate $7F8200 with JSL instructions
    ; to all loaded modules, ending with RTL
    JSL $7F8200
    
    ; Restore registers
    PLP
    PLY
    PLX
    PLA
    PLB
    
    ; Execute original NMI code that was at $008056
    ; (You may need to adjust this based on your SMW version)
    ; Original bytes: $03 $05 $86 $D0 (from your console output)
    db $03,$05,$86,$D0
    
    ; Return to NMI routine (will continue at $00805A)
    RTL

; ============================================================================
; Alternative: Simpler hook (if the above doesn't work)
; ============================================================================
; If the above causes issues, try this simpler version:
;
; org $008056
;     JSL carl_simple_hook
;
; org $00FFC0
; carl_simple_hook:
;     JSL $7F8200  ; Call CARL modules
;     RTL          ; Return to NMI

; ============================================================================
; CARL Hook Stub in RAM (initialized by RHTools)
; ============================================================================
; The following is NOT part of the ROM patch, but shows what RHTools sets up:
;
; $7F8200: JSL $7FA000  ; Module 1
; $7F8204: JSL $7FA00X  ; Module 2
; $7F8208: RTL          ; Return when no modules or all done
;
; Each loaded module ($7FA000+) must end with RTL

; ============================================================================
; Notes
; ============================================================================
; 1. This patch modifies the NMI routine, so it will affect all game modes
; 2. CARL modules are called EVERY FRAME after VBlank
; 3. Modules must be fast - they run 60 times per second
; 4. Modules must preserve registers or restore them before RTL
; 5. The hook address $7F8200 is managed by RHTools automatically

