;Experimental

; Mushroom or Cape doesnh't protect you.
; One hit still gets you, even on Yoshi.
;
if read1($00FFD5) == $23
    sa1rom
    !addr = $6000
    !bank = $000000
else
    lorom
    !addr = $0000
    !bank = $000000
endif	
!PowerupAddress = $19|!addr
!OnYoshiAddr = $187A|!addr
!OnYoshiOW = $0DC1|!addr

org $00F5B7 
   autoclean JML Main

freecode
Main:
    LDA #$00
    STA !PowerupAddress ; Store it to the RAM address $7E0019
    STA !OnYoshiAddr
    STA !OnYoshiOW
    JML $00F5BD


;Munchers and spikes hit you even on Yoshi.
org $00F124
  NOP #2 ; Erase the Yoshi-checking branch


