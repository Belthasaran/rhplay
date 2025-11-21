!val = $00A
if !val >= $25
  !anumber #= !val-$DC
else
  !anumber #= !val
endif


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
    PHY
    PHX
    PHP
    ;LDA #!anumber
;    REP #$20
;    LDA #!anumber
;
;;010B - The first two bytes is the current level number in most hacks.
;;;
;    ;STZ.w $010B  
;    ;STZ.w $7FB403
;;;  ;      LDA $010B
;;;        STA $7FB403
;
;    ;LDA.l #$FF30
;;;;-----
;;;    SBC #$00DC
;    STA $13BF|!addr
    SEP #$20
    LDA #!anumber
    STA $13BF
    STA $17BB|!addr
    ;;;
    STZ $010B
    ;STZ $7FB403
    ;;;
    ;  SBC #$24
    ;INY
Ret2:
    PLP
    PLX
    PLY
      INY
RTL
;;#P7_C##;;
