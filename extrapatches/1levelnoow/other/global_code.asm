; The global init routine is included in the same freecode block as the main patch, so it should end with RTS rather than RTL

init:
        ; this is some code that deletes the save at 0.
        LDA #$00
        TAY
        LDA $0100
        STA $00
        LDY #$00
        PHK
        PEA.w .rts-1
        PEA.w $0084CF-1
        JML $009B48
        .rts
        LDA $00
        STA $0100
  rts







