def get_c_patch(pid, chosenlid):
    return """
org $9CB1 ; skip intro
db $00
org $00A09C ; short timer
db $10

; I just want to try playing levels in Storks other than Level 1...
;
; asar temp3.asm storks_copy2.sfc ; snes9x -conf snes9xb.conf storks_copy2.sfc
!levelnumber = #""" + str(chosenlid)  + """
org $85d856
    JSR Main ;jsr n n   +2 d85a  (length=3)
    BNE $3   ; len=2    (bne,       length=2) ;  bne n   
    JMP $d8a5 ; len=3     (jmp $nnnn, length=3) ;  jmp n n   ; +3
org $85f8f0
Main:
    LDA !levelnumber
    STA $13bf
    CPX #$03
    BNE .etest 
        LDA $0109
    RTS
    .etest:
    RTS
"""



def get_b_patch(pid, chosenlid):
    lob = chosenlid & 0xff
    hib = (chosenlid & 0xff00)  >> 8
    if hib > 0:
        hiflag = 0x01
    else:
        hiflag = 0

    set_switchpalaces = """LDA #$01
    STA $1F27
    STA $1F28
    STA $1f29
    STA $1F2A"""

    set_zerolives = """
STZ $0DBE
    """

    set_quick = """
    org $9CB1 ; skip intro
db $00
org $00A09C ; short timer
db $10
    """

    basep_header = ("\n!hib = " +str(hib) + "\n" +
            "!lob = " +str(lob) + "\n" +
            ("!hiflag = $%.X\n" % (hiflag)) +
    """
if read1($00FFD5) == $23
    sa1rom
    !sa1 = 1
    !addr = $6000
else
    lorom
    !sa1 = 0
    !addr = $0000
endif
    """)

    basep_main_1 = ("""
; 00A28A
;org $00A1DF
;    JSL temp
    ;JSL $05B10C

;org $80A1DF
org  $00A28A
   ; NOP #8  <=  00A28A nop#8 lol, level no longer scrolls
   ;NOP #4
   JSL $7F8000
   JSL $00F6DB
   JSL $05BC00
   ;JSL $0586F1
   ;JSL $05BB39
   ;LDA $1C

org $05DCDD
;org $05DCE2
    autoclean JSL Main
    NOP #2
    RTL
;##QUICK##;

;;;;;
org $00A2EA
    pla
    sta $1D
    pla

org $05D842
    lda $0109|!addr
    db $D0

if read1($0DA415) == $5C && read1($0DA106) != $5C
org $0DA415
    sep #$30
    lda $1931|!addr
endif

;;;;;

freedata

temp:
 INC $1426|!addr
    STZ $41
    STZ $42
    STZ $43
    LDA #$80
    TRB $0D9F|!addr
    RTL


Main:
    ;##SP##;
    PHY
    PHX
    PHP
    ;##ZEROLIVES##;
    ;STZ $0DBE
    ;##
    LDA.b #!lob
    STA $13BF|!addr
    STA $17BB|!addr
    STA $0E
    ;STA $FE ;+
    LDX.d #$1F
    a: STA $19B8|!addr,x
    DEX
    BPL a
    LDA.b #!hib
    ORA.b #$04
    LDX.d #$1F
    b: STA $19D8|!addr,x
    DEX
    BPL b
    LDA.b #$05
    ;STA $71|!addr
    LDA.b #!hiflag
    ;STA $19C0
    ;STA $17BC
    ;STA $0F
Ret2:
    PLP
    PLX
    PLY
    INY
    LDA.b #$01
    RTL
    """)
    
    basep_main_2 = ("""
org $008222
;org $05DCE2
    autoclean JSL Main
;##QUICK##;

freedata
Main:
    ;##SP##;
    PHY
    PHX
    PHP
    LDA $100
    EOR #$14
    ORA $9D
    BEQ proceed
    RTL    
    proceed:    
    LDA #!lob
    CMP $13BF
    BEQ Ret2
    STA $13BF|!addr
    STA $17BB|!addr
    STA $0E
    dd
    LDX #$1F
    a: STA $19B8|!addr,x
    DEX
    BPL a
    LDA #!hib
    ORA #$04
    LDX #$1F
    b: STA $19D8|!addr,x
    DEX
    BPL b
    LDA #$05
    STA $71|!addr
    LDA #!hiflag
Ret2:
    PLP
    PLX
    PLY
    RTL
    """)
    

    if pid == 8 or pid == 9 or pid == 12 or pid == 13:
        basep = basep_header + basep_main_1

    if pid == 10 or pid == 11:
        basep = basep_header + basep_main_2
 
    if pid == 12 or pid == 13:
         basep = basep.replace(';##ZEROLIVES###;', set_zerolives)

    basep_q = basep.replace(';##QUICK##;', set_quick)
    if pid == 9 or pid == 11:
        return basep_q.replace(';##SP##;', set_switchpalaces)
    return basep_q

def get_a_patch(pid,chosenlid):
    if pid == 20:
        return get_c_patch(pid, chosenlid)
    if pid == 8 or pid == 9 or pid == 10 or pid == 11 or pid == 12 or pid == 13:
        return get_b_patch(pid,chosenlid)
    if pid == 1000:
        return """
org $9CB1 ; skip intro
db $00
org $00A09C ; short timer
db $10
org $05DCDD
        """
    
    pdata4 = """


if read1($00FFD5) == $23
    sa1rom
    !sa1 = 1
    !addr = $6000
else
    lorom
    !sa1 = 0
    !addr = $0000
endif
org $9CB1 ; skip intro
db $00
org $00A09C ; short timer
db $10
org $05DCDD
    autoclean JSL Main
    NOP
freedata
Main:
    PHY
    PHX
    PHP
    REP  #$20
    LDA.l #!anumber
    SEP  #$30
    ;CMP #$0025
    ;BCC ReturnRL        ; if level number is greater than #$025
    ;SEC
    ;SBC #$00DC          ; add #$00DC to it
    ;BRA ReturnRL
    ;
 ;  REP #$20
 ;  AND #$00FF
 ;  CMP #$0025
 ;  BCC R
 ;  CLC
    ;ADC #$00DC
    ;SBC #$00DC   
 ;  R:
    ;SBC #$00DC
    ;ReturnRL:
    ;
    STA $13BF|!addr
Ret2:
    PLP
    PLX
    PLY
    ; ;###; INY
    RTL
    """
    pdata2 = """
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

;org $009329+2 : dw $9F6F

org $9CB1 ; skip intro
db $00

org $00A09C ; short timer
db $10

org $05DCDD
;org $05DCE2
    autoclean JSL Main
    NOP

freedata

Main:
    ;#H#;
    PHY
    PHX
    PHP
    ;REP #$20
    ;LDA #!anumber
    ;SEC 
    ;SBC #$00DC
    ;STA $13BF|!addr
    REP #$20
    ;LDA #$32
    LDA.l #!anumber
    SBC #$00DC
    ;LDA.l #$0032
    ;STA.l $13BF
    SEP #$20
    STA $13BF
    STA $17BB|!addr ;+
    ;SBC #$24
    ;LDA $13BF
    ;STA $17BB|!addr
;SBC #$24
    ;INY
Ret2:
    PLP
    PLX
    PLY
;INY
    RTL
    
    
    """
    pdata1 = """
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
    REP #$20
    LDA.l #!anumber
    ;LDA.l #$FF30
    ;###; SBC #$00DC
    STA $13BF|!addr
    SEP #$20
    LDA $13BF
    STA $17BB|!addr
    ;###; SBC #$24
    ;INY
Ret2:
    PLP
    PLX
    PLY
    ;###; INY
RTL
;;#P7_C##;;

    """
    pdata = ""
    if pid == 1 or pid == 5 or pid == 6 or pid == 7:
        pdata = pdata1
        if pid == 5 or pid == 6:
            pdata = pdata.replace(';#H#;', """LDA #$01
    STA $1F27
    STA $1F28
    STA $1f29
    STA $1F2A""")
        if pid == 6 or pid == 7:
            pdata = pdata.replace(';;##P6##;;', 'NOP')
            if pid == 7:
                # 05801E
                pdata = pdata.replace(';;##P7_H##;;', """
                org $03C0CD
                 autoclean JSL p7code
                """)
                pdata = pdata.replace(';;#P7_C##;;',"""
                p7code: PHA
                LDA #$FF
                STA $0EF7
                PLA
                ;JSL $05DCDD
                ;JSL $05D796
                RTL
                """)

    if pid == 4:
        pdata = pdata4
    if pid == 2 or pid == 3:
        pdata = pdata2
        if pid == 3:
            pdata = pdata2.replace(';#H#;', """LDA #$01
    STA $1F27
    STA $1F28
    STA $1f29
    STA $1F2A
            """)
    if chosenlid >= 0x25:
       return pdata.replace(';###;', ' ')
    return pdata


