local alldone
alldone = 0

while true do
        local infoline = string.format("\n%s %s ", gameinfo.getromname(), gameinfo.getromhash())
        local ba
        local b1
        local b0
        local sv
         local count
	emu.frameadvance();
        local sb = mainmemory.readbyte(0x0db4)
        local eo = memory.readbyte(0x0109)
     local bcalc

         memory.usememorydomain("WRAM")
        local first = mainmemory.readbyte(0xD000)
        local last = mainmemory.readbyte(0xD000 + 2046)
        local fh
--console.log(string.format("A %X\n",sb))
--client.sleep(1000)
        if alldone == 0 and sb> 0x00 and last ~= 0x25 and last ~= 0x55 then
                  fh = io.open('owdump.txt', 'a')
                  ba = 0xD000
                  b0 = 0
                  sv = ""
                   count = 0
                 console.log(infoline)
                 fh:write(infoline)
                 while(b0 < 2048) do
                  b1 = mainmemory.readbyte(ba+b0)     
                 b0 = b0 + 1
                 if b1 ~= 0 then
                     bcalc = b1
                     if bcalc > 0x25 then
                        bcalc = bcalc + 0xDC
                     end
                     sv = sv .. (string.format("(0x%X,0x%X,0x%X),",b0,b1,bcalc))
                      count = count + 1
                 end
                 if (count > 0) and (count % 100) == 0 then
                    console.log(sv)
                    fh:write(sv)
                    sv = ""
                 end
                end
               console.log(sv)
               fh:write(sv)
               fh:write("\n")
               fh:close()

                 console.log("\n")
                alldone = 1
                console.log("ALL DONE: Exit when ready\n")
                --  client.exit()
                -- client.sleep(1000)
        end
end
