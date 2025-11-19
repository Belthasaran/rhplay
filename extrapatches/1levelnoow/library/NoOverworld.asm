; No overworld (uberasm version) 1.2 by Brolencho
;-------------------------------------------------------------
; IMPORTANT, to uninstall, set this flag to 1 and run Uberasm Tool:
;-------------------------------------------------------------
	!completely_remove = 0


; after that, you can remove this file from your library folder
;-------------------------------------------------------------
; Getting started
;-------------------------------------------------------------

; When using this patch, the first level you encounter would be $01
; Then, level $02, then level $03, etc...
; but when you get to $24 and beat it, next level is $101
; then $102, $103...
; you can change the initial level:


	!first_level = ${level_number}			; dont forget the dollar sign $


; but it must be any level between [$00-$24] or [$101-$13B].

; When the player reaches the final level and beats it
; the credits roll and the player beats the game.


	!final_level = ${level_number}


; When the player touches a midway, the game will save automatically,
; so if the player turns off the console, he can continue right after
; the midway.


	!save_at_midways = 1		; set to 0 if you don't want to save at midway


; That's the basic functionality. Down in the options below there's
; an advanced version with more control over the levels.

; More options:


	!more_levels_after_credits = 0		; Extra levels after beating final level
	!save_when_beating_level = 0 
	!save_during_transitions = 0 		; requires retry.asm to work properly:
                                		; https://www.smwcentral.net/?p=section&s=smwpatches&f%5Bname%5D=retry     
	!skip_intro_level = 1
	!sharing = 1 				; in 2 player mode, players share lives, coins, powerup, yoshi and itembox powerup.


; Advanced mode : gives you more control over the levels and unlocks the use of secret exits.


	!advanced_mode = 0 			; to use, set this to 1 and go to the end of this file to modify the levels' exits.


; Ram and Sram mirrors


	!curr_level = $1F13|!addr 		; sram mirror - this saves current level to sram; used only if !advanced_mode
	!new_game_flag = $1F14|!addr 		; sram mirror - should be 1 the whole game
	!midway_flag = $1B80|!addr 		; ram - used if !save_at_midways = 1
	!addmusick_ram_addr = $7FB000


;-------------------------------------------------------------
; Defines - dont change
;-------------------------------------------------------------

    !first_level_13BF = 00
    if !first_level >= $25
        !first_level_13BF #= !first_level-$DC
    else
        !first_level_13BF #= !first_level
    endif

    !FINAL_level_13BF = 00
    if !final_level >= $25
        !FINAL_level_13BF #= !final_level-$DC
    else
		!FINAL_level_13BF #= !final_level
    endif

    !intro_level = read1($009CB1)

    !7ED000 = $7ED000		; $7ED000 if LoROM, $40D000 if SA-1 ROM.
    if !sa1
        !7ED000 = $40D000		; $7ED000 if LoROM, $40D000 if SA-1 ROM.
    endif

    if read2($009B41) == $04A0
    	!sram_plus = 1
    else
        !sram_plus = 0
    endif
    
;-------------------------------------------------------------
; Macros
;-------------------------------------------------------------
macro SaveGame()
	if !sram_plus
		JSL $009BC9|!bank
	else
		PHB
		REP #$30
			LDX.w #$1EA2|!addr
			LDY.w #$1F49|!addr
			LDA.w #140
			if !sa1
				MVN $00,$00
			else
				MVN $7E,$7E
			endif
		SEP #$30
		JSL $009BC9|!bank ; v1.2, this is now above PLB to avoid crashes
		PLB
	endif
endmacro

macro ResetGame()
	STZ $4200	;no interrupts from here on out
	SEI
	SEP #$30	;request upload
	LDA #$FF
	STA $2141
	LDA #$00	;DB must be zero, this is done by the h/w normally
	PHA
	PLB

	STZ $420C	;disable any HDMA, this is done by the h/w normally
	JML $008016|!bank
endmacro

macro STZ(addr)
	if <addr> < $10000
		STZ <addr>
	else
		PHA
		LDA #$00
		STA <addr>
		PLA
	endif
endmacro

;-------------------------------------------------------------
; Hijacks
;-------------------------------------------------------------

pushpc

if !completely_remove
	org $04DC64
	db $20, $F2, $D7

	warn "No Overworld is removing the hijacks it needs to work properly. If you want it to work again, reset !completely_remove = 0"
else

	org $04DC64 ;disable loading overworld layer1 translevels to $7ED000
    NOP #3 ; to fix issue in castle entrance

endif

pullpc

;-------------------------------------------------------------
; Code
;-------------------------------------------------------------
if !advanced_mode
	tablita: db $01, $02, $04, $08
endif

SkipOW:

    ; instead of loading OW, this code sets a flag to bypass it (sets $0109 to #$01).
    ; also does stuff like dealing with a level being beaten,
    ; reloading music, flags etc... (down in sublabel .just_reload_stuff)
    ; this code has a lot of verbose.

    .check_game_over
        LDA $0DBE|!addr ; lives
        BPL ..continue
if !sharing == 0
		LDA $0DB2|!addr ; 2 player mode
        BEQ ..to_tile_screen
        LDA $0DB3|!addr ; which player(luigi or mario)
        EOR #$01
        TAX
        LDA $0DB4|!addr,X ; other player's lives
        BPL ..continue
endif

        ..to_tile_screen
        LDA #$02 ; change gamemode to title screen($02)
        STA $0100|!addr
        RTL
        ..continue

    if !skip_intro_level
        LDA $0109|!addr
        CMP.b #!intro_level
        BNE +
        STZ $0109|!addr
        +
    endif

    .set_flag_to_bypass_overworld
        LDA $0109|!addr ; check if $0109 is intro level (more than zero)
        BEQ +
        JMP .just_reload_stuff
        +
        INC $0109|!addr ; set to #$01 to bypass overworld load (this happens at CODE_00A096)
        if !intro_level == $01 : INC $0109|!addr ; if for some reason intro level is $01, inc twice so it's not the same

	.for_the_first_time ; run this code once for the whole game (just after intro level)
		LDA !new_game_flag
		BNE +
		if !advanced_mode			
			LDA #!first_level_13BF
			STA !curr_level
			
			..reset_some_ow_flags ; advanced mode uses $1EA2 to store info about levels' exits
			LDX #95
			-
			LDA $1EA2|!addr,X
			AND #%11110000
			STA $1EA2|!addr,X
			DEX
			BPL -
		endif
		%SaveGame() ;save game for the first time
		INC !new_game_flag
	+

    .check_if_level_beaten
        LDA $0DD5|!addr   ; load events
        BNE +
		-
		JMP .just_reload_stuff
		+
        CMP #$05
		BCS -

    .level_is_beaten ; kind of messy

        macro LDA_current_level()
            if !advanced_mode
                LDA !curr_level
            else
                LDA $1F2E|!addr   ; load number of beaten levels
                CLC ; and add first_level to get...
                ADC #!first_level_13BF ; current level (translevel, $13BF format)
            endif
        endmacro

        macro beat_level() ; A must contain current level ($13BF format)

            TAX ; current level to X

			if !advanced_mode
				PHB : PHK : PLB	; fix if using in global mode

				LDY $0DD5|!addr   ; load events (which exit was crossed)
				DEY
				LDA $1EA2|!addr,X ; level flags from current level
				AND tablita,Y
				BEQ ?first_time_beating

				?exit_already_beaten
				LDA $1EA2|!addr,X ; level flags from current level
				AND #~$40	; reset midway flag
				STA $1EA2|!addr,X
				BRA +

				?first_time_beating
				LDA $1EA2|!addr,X ; level flags from current level
				ORA tablita,Y ; set flag of exit beaten
            	ORA #$80	; set beaten flag
				AND #~$40	; reset midway flag
            	STA $1EA2|!addr,X
				INC $1F2E|!addr ; increase number of beaten levels
				+
				PLB ; fix if using in global mode
	
			else
            	LDA $1EA2|!addr,X ; level flags from current level
            	ORA #$80	; set beaten flag
				AND #~$40	; reset midway flag
            	STA $1EA2|!addr,X
            	INC $1F2E|!addr ; increase number of beaten levels
            	+
			endif
        endmacro

        macro set_next_level() ;uses $00 and $01 if !advanced_mode
            if !advanced_mode
				?get_normal_or_secret_exit ;(normal or secret exit 1, 2 or 3)
                LDA $0DD5|!addr ; load event(exit or secret exit)
                DEC
                ASL ; x2
                STA $00
                STZ $01

				?add_to_curr_level
                REP #$30
                LDA !curr_level
                AND #$00FF
                ASL
                ASL
                ASL ; x8
                CLC
                ADC $00
                TAX

				?get_next_level
                LDA.l Exit_Table,X
                SEP #$10

                ?reset_game_if_invalid_level
                CMP #$0025
                BCC +
				CMP #$013C
				BCS ?.re
				CMP #$0101
				BCS +
				?.re
                %ResetGame()
                +

                ?to_translevel_format
                CMP #$0025
                BCC +
                SEC
                SBC #$00DC
                +
                SEP #$20

                ?store_level
                STA !curr_level
            endif
        endmacro

        ..check_if_final_level
            %LDA_current_level()
            CMP #!FINAL_level_13BF
            BNE ..not_final_level
			JMP ..credits

        ..not_final_level
            %beat_level()
            %set_next_level()
            if !save_when_beating_level
                %SaveGame()
            endif
            JMP .just_reload_stuff

        ..credits
            if !more_levels_after_credits
                %beat_level()
                %set_next_level()
                %SaveGame()
            endif
            LDA #$08    ; load credits scene (#$08)...
            STA $13C6|!addr   ; to current cutscene ($13C6)
            LDA #$19    ; and load credits gamemode (#$19) to...
            STA $0100|!addr   ; curr gamemode (#$18 doesn't work)
            BRA .reset_music

    .just_reload_stuff

        ;STZ $0DD5|!addr ; not needed?
        STZ $13C6|!addr ; current cutscene
        STZ $13D2|!addr ; current switch palace color
		LDA #$10
		STA $0101+3|!addr ; make it believe sprite GFX 1 is from the overworld (#$10). So it DMAs it later.
		STA $0101+2|!addr ; same but GFX 2
		STA $0101+1|!addr ; same but GFX 3
		STA $0101+0|!addr ; same but GFX 4


    .2_player_stuff

        ..check_if_2_players_mode
		LDA $0DB2|!addr
        BEQ ..dont_switch

        ..get_current_player
        LDX $0DB3|!addr ; player to X (0 mario, 1 luigi)

        ..save_player_stuff
		if !sharing == 0
        LDA $0DBE|!addr
        STA $0DB4|!addr,X ; lives
        LDA $0DBF|!addr
        STA $0DB6|!addr,X ; coins
        LDA $19
        STA $0DB8|!addr,X ; powerup
        LDA $0DC1|!addr ; if yoshi
        BEQ ++
        LDA $13C7|!addr
        ++
        STA $0DBA|!addr,X ; yoshi color
        LDA $0DC2|!addr
        STA $0DBC|!addr,X ; itembox
		endif

		..check_if_fade_to_luigi ;(for exit.asm block)
	    LDA $13D9|!addr ; current overworld process
		CMP #$06
		BEQ +

        ..check_if_switch_flag
        LDA $0DD5|!addr
        BEQ ..dont_switch
		+

        ..switch_player
        TXA ; X has current player
        EOR #$01 ;switch 
        TAX

        ..load_other_player_stuff
		if !sharing == 0
        LDA $0DB4|!addr,X ; lives
        BMI ..dont_switch ; don't switch if other player has no lives
        STA $0DBE|!addr
        LDA $0DB6|!addr,X ; coins
        STA $0DBF|!addr
        LDA $0DB8|!addr,X ; powerup
        STA $19
        LDA $0DBA|!addr,X ; yoshi color
        STA $13C7|!addr
        STA $0DC1|!addr
        STA $187A|!addr
        LDA $0DBC|!addr,X ; itembox
        STA $0DC2|!addr
		endif

        ..confirm_switch
        STX $0DB3|!addr ; store switched player
        TXA
        ASL
        ASL
        STA $0DD6|!addr ; store switched player

        ..dont_switch

    .reset_music
        LDA $008075|!bank; if addmusik installed
        CMP #$5C
        BNE ..noamk

        ..amk
        LDA #$00
        STA $1DFB|!addr
        STA !addmusick_ram_addr
        BRA +

        ..noamk
        STZ $0DDA|!addr ;reset music
        +

RTL

PreLoadLevel:

    .check_sublevel
    LDA $141A|!addr
	BEQ .if_translevel

	.if_sublevel ;(or if returning from dead with retry patch)
	if !save_at_midways
        LDA $13CE|!addr
		if !save_during_transitions : EOR #$01
	    STA !midway_flag
    elseif !save_during_transitions
		LDA #$01
		STA !midway_flag
	endif
    BRA .return

	.if_translevel
    if !save_at_midways || !save_during_transitions : %STZ(!midway_flag)

    .return_if_intro_level
    LDA $0109|!addr
    if !intro_level == $01
        BEQ +   ;continue if flag is 00
        CMP #$02    ;or 02
        BEQ +
        BRA .return
        +
    else
        CMP #$02
        BCC +   ;continue if flag is 00 or 01
        BRA .return
        +
    endif

    .get_mario_or_luigi
    LDY #$00
    LDX $0DB2|!addr ; if 2 players
    BEQ +
    LDX $0DD6|!addr ; mario or luigi
    LDY $0DB3|!addr ; mario or luigi
    +

    .set_mario_ow_position_to_zero ;(level load uses mario ow pos to load level)
    REP #$20
    STZ $1F17|!addr,X     ; mario pos (x=0), luigi pos(x=1)
    STZ $1F19|!addr,X
    STZ $1F1F|!addr,X
    STZ $1F21|!addr,X
    SEP #$20

    .set_translevel_to_mario_ow_pos ;(level load gets translevel from 7ED000)
    %LDA_current_level()
    STA !7ED000 ;store curr translevel to OW pos.
    STA !7ED000+$400 ; mario pos could be here too.
    CMP #$25
    LDA #$00
    ROL
    STA $1F11|!addr,Y ; translevel highbyte to $1F11 (used in level load)

    .reset_0109
    STZ $0109|!addr ; set flag back to normal on level load. Otherwise, it would behave weird.

.return : RTL

DuringLevel:

    if !save_at_midways
		
        LDA $13CE|!addr
	    CMP !midway_flag ; if ram different from midway flag
	    BEQ +
	    INC                 ; make them equal (should be #$02)
	    STA $13CE|!addr
	    STA !midway_flag

	    LDX $13BF|!addr     ; and save midway status of translevel
        LDA $1EA2|!addr,X 
        ORA #$40
        STA $1EA2|!addr,X
		
        %SaveGame()
        +
	elseif !save_during_transitions
		LDA !midway_flag
		BEQ +
	    LDX $13BF|!addr     ; and save midway status of translevel
        LDA $1EA2|!addr,X 
        ORA #$40
        STA $1EA2|!addr,X
		%SaveGame()
		%STZ(!midway_flag)
		+
	endif
RTL

if !advanced_mode
;-------------------------------------------------------------
; Advanced Mode
;-------------------------------------------------------------

; Advanced mode allows you to manually say what's the next level
; in basic mode, it goes like level $01, $02, $03, etc...
; however in this mode, it can go whatever (like level $01, $120, $07,...)

; yo do this by changing the exits, check .level_001


Exit_Table:
	.level_000
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_001                  		; <-- Example with level $01
		..normal  dw $03        	; This sets normal exit to $03. So when you beat level $01, next level is $03,
		..secret1 dw $101       	; but if you beat it with a secret exit(for example, a key), you go to $101.
		..secret2 dw $24        	; if you beat it with secret exit 2, you go to $24.
		..secret3 dw $13B       	; and with secret exit 3, you go to $13B.
	.level_002
		..normal  dw $FF		; a valid level must be between [$00-$24] or [$101-$13B].
		..secret1 dw $FF		; *CAREFUL*, if an exit is invalid the game will reset after getting that exit.
		..secret2 dw $FF
		..secret3 dw $FF
	.level_003
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_004
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_005
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_006
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_007
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_008
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_009
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_00A
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_00B
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_00C
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_00D
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_00E
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_00F
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_010
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_011
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_012
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_013
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_014
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_015
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_016
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_017
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_018
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_019
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_01A
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_01B
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_01C
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_01D
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_01E
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_01F
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_020
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_021
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_022
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_023
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_024
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_101
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_102
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_103
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_104
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_105
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_106
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_107
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_108
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_109
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_10A
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_10B
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_10C
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_10D
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_10E
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_10F
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_110
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_111
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_112
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_113
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_114
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_115
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_116
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_117
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_118
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_119
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_11A
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_11B
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_11C
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_11D
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_11E
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_11F
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_120
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_121
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_122
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_123
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_124
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_125
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_126
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_127
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_128
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_129
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_12A
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_12B
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_12C
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_12D
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_12E
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_12F
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_130
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_131
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_132
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_133
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_134
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_135
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_136
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_137
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_138
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_139
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_13A
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF
	.level_13B
		..normal  dw $FF
		..secret1 dw $FF
		..secret2 dw $FF
		..secret3 dw $FF

endif


; Advanced mode allows you to manually say what's the next level
; in basic mode, it goes like level $01, $02, $03, etc...
; however in this mode, it can go whatever (like level $01, $120, $07,...)

; yo do this by changing the exits, look for .level_001 above.
