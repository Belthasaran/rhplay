!val = $106
if !val >= $25
  !anumber #= !val-$DC
else
  !anumber #= !val
endif

;if !val >= $25
;org $851f11
; db $01
;endif


if read1($00FFD5) == $23
    sa1rom
    !sa1 = 1
    !addr = $6000
    !bank = $000000
else
    lorom
    !sa1 = 0
    !addr = $0000
    !bank = $000000
endif

;org $00D0D8
;NOP #3

;;##P7_H##;;

org $9CB1 ; skip intro
db $00

org $00A09C ; short timer
db $10

org $05DCDD
;org $05DCE2
    autoclean JSL Main
    NOP
    ;;##P6##;;

freedata

Main:
    ;#H#;
    ;PHY
    PHX
    PHP
    ;LDA #!anumber
   ; REP #$20
   ; LDA #$000000
;    LDA #!anumber
   ;; "010B - The first two bytes is the current level number in most hacks." 
    ; < Or so they claimed
;    ;STZ.w $010B  
;    ;STZ.w $7FB403
;    ;LDA.l #$FF30
;;;;-----
;;;    SBC #$00DC
;    STA $13BF|!addr
    ;REP #$20
    ;LDA #!anumber
    ;STA $010B
    SEP #$20
    LDA #!anumber
    STA $13BF
;ADC #$24
;STA $0109
if !val >= $25
    ;LDA.b   #$fe
    ;STA $17BB
    LDA.b #$01
    STA.w $851f11
    ;STA.b $13C3 ; submap
    ;TYA
    ;ORA #$01
    ;TAY
    LDA.b   #0
else
    LDA.b   #0  ; Turns out the carry flag and A value are important at this point
endif
    LDA #!anumber
;if $val >= $25
;    
;endif
    ;STZ $13C0
    ;STZ $1F11 ;tl highbyte
    ;STA !7ED000 
    ;STA $7ED000
    ;STA $0108
    ;STA $17BB|!addr
    ;STZ $7FB403
    ;;  SBC #$24
    ;INY
Ret2:
    PLP
    PLX
    ;PLY
      ;INY
RTL
;;#P7_C##;;


