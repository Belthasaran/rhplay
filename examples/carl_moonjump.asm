; CARL Module Example: Moon Jump
; Hold B button to slowly rise upward
; 
; To use:
; 1. Upload this file to /work/carl/moonjump.asm on USB2SNES
; 2. In chat commands: !load moonjump
; 3. Hold B while playing to moon jump
; 4. To remove: !unload moonjump

; Check initialization flag
LDA $7F8000         ; First module's init flag
BNE already_init

  ; First time initialization
  LDA #$01
  STA $7F8000       ; Mark as initialized
  
already_init:

; Main code - runs every frame
LDA $15             ; Read controller 1
AND #$80            ; Check B button (bit 7)
BEQ done            ; If not pressed, skip

  ; B is pressed - apply upward velocity
  LDA #$F8          ; Negative Y velocity = upward
  STA $7E007D       ; Mario's Y velocity

done:
RTL                 ; REQUIRED: Return from JSL

