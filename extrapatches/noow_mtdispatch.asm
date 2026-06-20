; Reference extrapatch template — no-overworld MTDispatch compatibility
; Patch type: asar | requires_parameters: true
;
; Parameter mapping JSON (Edit System Patch Definitions):
; {
;   "level_number":   { "input": "glevelnum_s" },
;   "dispatch_chain": { "input": "mtdispatch_code" },
;   "dispatch_check": { "input": "mtdispatch_check" }
; }
;
; mtdispatch_code / mtdispatch_check are computed from the main-patched ROM
; (after BPS, before extrapatches) via lib/rom-mtdispatch-code.js.
; mtdispatch_check: "1" = relocated JML at SNES $009322, "0" = vanilla fallback.
;
; This excerpt shows the Dispatch_wrap tail and SkipOW switch-palace hook sites
; from refmaterial/mevit/resources/asar/nooverworld.asm — use full template in DB.

freecode

Dispatch_wrap:
	PHP
	SEP #$20
	LDA.w $0100|!addr
	CMP #$0C
	BNE +
	PHA : JSL SkipOW : PLA
	+
	CMP #$10
	BNE +
	PHA : JSL PreLoadLevel : PLA
	+
	PLP
	{dispatch_chain}

SkipOW:
	; {SWITCH_PALACE_INIT}
	; ... remainder of nooverworld SkipOW / PreLoadLevel from nooverworld.asm ...
