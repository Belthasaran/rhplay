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


