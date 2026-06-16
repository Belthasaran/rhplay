;;;module corpus  for study
;Game: SMW
;Description: allows for a chat command to initiate a warp to a specific level
; Warp Dispatch
; to activate this, use this in chat:
; !wl 7FB3C0 00 0X XX
; where XXX is the level number.
; for example: "!wl 7FB3C0 00 01 20" will take you to level 120
;  Writes to $7FB3C0  00 01 20
; NOTE: Hi byte only works in romhacks! So if you're on a level in the 100-1FF range you can only warp to another level in that range.

!go = $7FB3C0
!levelHi = $7FB3C1
!levelLo = $7FB3C2

	LDA $100	; \ only run in gamemode 14
	EOR #$14	; |
	ORA $9D		; | and when the game isn't paused
	BEQ +		; |
	RTL		; |
	+		; /

LDA !go
ORA $71
BEQ +
RTL
+
LDA #$55
STA !go
LDX #$1F
LDA !levelLo
-
STA $19B8,x
DEX
BPL -
LDX #$1F
LDA !levelHi
ORA #$04     ; lunar magic flag to enable use of the hi byte
-
STA $19D8,x
DEX
BPL -
LDA #$05
STA $71
RTL

