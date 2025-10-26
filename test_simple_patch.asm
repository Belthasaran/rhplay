; Minimal test patch - just skip intro
; This should definitely work if asar is working properly

lorom

org $9CB1
    db $00    ; Skip intro

org $00A09C  
    db $10    ; Short timer

