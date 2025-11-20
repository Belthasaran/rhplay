; Experimental  new version of OhKo based on   Kevinskie555/Smallhacker  knockback patch
;Sound effect to play when hurt
!sfx = $20
!sfxPort = $1DF9|!addr
;Speed to be knocked back with
!knockSpeed = $40

        !addr = $0000
if read1($00FFD5) == $23
	sa1rom
	!addr = $6000
endif

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Hijack the hurt routine
org $00F5D5
    autoclean JML NewRoutine

freecode
NewRoutine:
	LDA #!sfx
	STA !sfxPort
	;LDA.b #($100-!knockSpeed)
	;STA $7D
        LDA.b #$02  ;+
        STA $19     ;+
	LDA $76
	BNE Other
	LDA #!knockSpeed
	BRA Continue
    
Other:
;	LDA.b #($100-!knockSpeed)
    LDA.b #$02
Continue:
    STA $19
;	STA $7B

MarioFlash:
	LDA #$7F
	STA $1497|!addr
;;
;        jml $00F606
	RTL


