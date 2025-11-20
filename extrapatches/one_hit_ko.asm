;Experimental

; Mushroom or Cape doesnh't protect you.
; One hit still gets you, even on Yoshi.
;

if read1($00FFD5) == $23
    sa1rom
    !addr = $6000
    !bank = $000000
    !FastMirror = $000000
else
    lorom
    !addr = $0000
    !bank = $000000
    !FastMirror = $800000
    !Hundreds = $0F31
    !Tens = $0F32
    !Ones = $0F33
endif	
!PowerupAddress = $19|!addr
!OnYoshiAddr = $187A|!addr
!OnYoshiOW = $0DC1|!addr
!Hundreds = $0F31|!addr
!Tens = $0F32|!addr
!Ones = $0F33|!addr

org $00F5B7 
   autoclean JML Main

freecode
Main:
    LDA #$00
    STA !PowerupAddress ; Store it to the RAM address $7E0019
;    STA !OnYoshiAddr
;    STA !OnYoshiOW
;    STA !Hundreds
;    STA !Tens
;    LDA #$01
;    STA !Ones
    JML $00F5BD
Main2:
    jml $008178
;Main3:
;    stz.w $14C8,X
;    rts


;Munchers and spikes hit you even on Yoshi.
org $00F124
  NOP #2 ; Erase the Yoshi-checking branch

;org $01A8FE
;   NOP #3

;CODE_01A901:        D0 18         BNE Return01A91B          
org $01A901
   NOP #2

;CODE_01B0FF:        D0 09         BNE CODE_01B10A           
org $01B0FF
   NOP #2

;CODE_01A8FE:        AD 7A 18      LDA.W RAM_OnYoshi         


;CODE_02A4AE
org $02C813
    NOP #2

;CODE_02F9F8:        D0 05         BNE CODE_02F9FF           
org $02F9F8
   NOP #2

;CODE_0395CD:        0D 7A 18      ORA.W RAM_OnYoshi         ;  |  ... or mario on yoshi...          

;000018E2 YoshiIsLoose

;org $008176
;autoclean jml Main2
;nop #2

; On hit.. KO.
org $00F5B7
jml $00F606

;;
org $01F719
db $00		; Disable "Yoshi runs away" sound effect?
;
org $01F71D
JSL $00F5B7	; Hurt Mario instead of losing Yoshi
BRA +		; \
NOP #39		;  | Remove "Yoshi runs away" routine
+		;  |
RTS		; /
;
org $02A47D	;extended sprite related
db $00		;disable sfx
;
org $02A481	;extended sprite related
JSR $A4AE	; Hurt Mario instead of losing Yoshi
BRA +
NOP #38		;nullify code
+
;;;



;;; Anti yoshi ditch
;org $1ACA1

org $01AC80
autoclean jsl Main3
;JSR $A4AE

freecode
Main3:
    LDA $009E,X
    CMP.B #$35 
    BNE Next
    JSL $00F5B7 
    LDA #00
    STA !Hundreds
    STA !Tens
    LDA #$09
    STA !Ones
Next:
    LDA $009E,X
    CMP.B #$1F 
    RTL
    ;stz.w $14C8,X
    ;rts
;;;






