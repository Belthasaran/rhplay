!base1 = $0000
!base2 = $0000

if read1($00FFD5) == $23
sa1rom
!base1 = $3000
!base2 = $6000
endif

org $009C72
autoclean JML TitleCode
NOP

org $0F60A
autoclean JML NoMusic
NOP #6

freedata ; this one doesn't change the data bank register, so it uses the RAM mirrors from another bank, so I might as well toss it into banks 40+

TitleCode:
LDA $71
CMP #$09
BEQ Restart
PHX
DEC $1DF5|!base2
BNE Old
PLX
JML $009C77

Old:
PLX
JML $009C82

Restart:
JML $009C89

NoMusic:
LDA $0100|!base2
CMP #$07
BEQ Nope
LDA #$09                ;\ 
STA $1DFB|!base2        ;/ Change music 
LDA #$FF                ;\
STA $0DDA|!base2        ;/ change music some more
Nope:

