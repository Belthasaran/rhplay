!val = $106
if !val >= $25
  !anumber #= !val-$DC
else
  !anumber #= !val
endif

;org $85d8a2 
;  cmp #$25
;org $85d8a4
;  bcc $d8a9
;org $85d8a6
;  sec
;org $85d8a7
;   sbc #$24
;
;org $85d8a9
;   sta $17bb
;org $85d8ac
;   sta $0e
;-------------------------------------
;org $85d8ae
org $85d8ae
  autoclean JSL Main1
  NOP #2
  BRA +6
;lda $1f11,y
;org $85d8b1
;jsl $85dcd0 ; GetLevelHighByte ; <---
;org $85d8b5
;sta $0f
;org $85d8b7
; bra d8bc
;;;;;;;;;

;org $05D8E2     ; loading normal level
;    JSL TrackLevelNumber

;org $05D8E2 
;     autoclean JSL Main2
freecode
Main1:
  LDA #$2A;!anumber
  STA $13BF
  STA $17BB
  STA $010B
  STA $0E
  STA $FE
  LDA #$1
  STA $0F
  STA $FF
  LDA $13BF
  SEP #$02
  RTL
;Main2:
;  LDA #$2A
;  STA $13BF
;  RTL




 
