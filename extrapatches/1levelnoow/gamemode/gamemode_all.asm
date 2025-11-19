; The global init routine is included in the same freecode block as the main patch, so it should end with RTS rather than RTL

init:
main:
        .NoOverworld
        LDA $0100|!addr
        CMP #$10
        BNE +
        JSL NoOverworld_PreLoadLevel ; this happens at gamemode 10 (init)
        +
        CMP #$14
        BNE +
        JSL NoOverworld_DuringLevel ; this happens at gamemode 14 (main)
        +
        CMP #$0C
        BNE +
        JSL NoOverworld_SkipOW ; this happens at gamemode 0C (init)
        +
        .NoOverworld_end
    RTL







