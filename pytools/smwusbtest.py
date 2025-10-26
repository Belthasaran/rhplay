from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys
import loadsmwrh
from py2snes import py2snes
from sneslink import SnesLink
import asyncio
import time
import code

import IPython
import nest_asyncio
import pdb

nest_asyncio.apply()
#IPython.embed()

#class mysnes(py2snes.snes):
class SMWUSBTest(SnesLink):
    def __init__(self):
        super().__init__()

    powerupstate = 0xF50019
    powerupvalues = { 'fire' : b'\x03', 'cape': b'\x02', 'super': b'\x01', 'normal': b'\x00'  }

    itemboxvalues = { 'super' : b'\x01', 'fire' : b'\x02', 'star' : b'\x03', 'cape': b'\x04',
                      'blueyoshi': b'\x05',  'grayyoshi': b'\x06', 'orb': b'\xd7'  }

    # 0x7E1DF9 - 1DFC values
    _1dfcvalues = {
            'nothing' : b'\x00',
            'coin' : b'\x01',
            'hitblock': b'\x02',
            'vineblock': b'\x03',
            'spinjump': b'\x04',
            '1up': b'\x05',
            'fireball': b'\x06',
            'breakblock' : b'\x07',
            'springboard': b'\x08',
            'boom': b'\x09',  # b.bill / thwomp landing
            'egghatch': b'\x0a',
            'itembox': b'\x0b',
            'itemfalls': b'\x0c',
            'sameas0xc': b'\x0d',
            'screenscroll': b'\x0e',
            'door': b'\x0f',
            #x10 same as x09
            'drumroll': b'\x11', #(looped)
            'drumrollend': b'\x12',
            'loseyoshi': b'\x13',
            #x14 unused
             'tilerevealed': b'\x15',
             'castlecollapsed': b'\x16',
             'firespit': b'\x17',
             'thunder': b'\x18',
             'chuck_clap': b'\x19',
             'castle_destruction_b': b'\x1a',
             'castle_destruction_fuse': b'\x1b',
             'ow_palace_stomp': b'\x1c',
             'timerunningout': b'\x1d', # Running out of time (combine with the one in $1DF9, does not speed up tempo)
             'chuck_whistle' : b'\x1e',
             'yoshi_mount': b'\x1f',
             'koopaling_lands_in_lava': b'\x20',
             'yoshi_tongue': b'\x21',
             'messagebox': b'\x22',
             'ow_mariomove' : b'\x23',  # Mario moves onto level tile
             'pswitch_timeout': b'\x24', #p-switch time running out
             'yoshi_stomp': b'\x25',
             'swooper': b'\x26',
             'podoboo': b'\x27',
             'enemy_stunned': b'\x28',
             'correct': b'\x29',
             'wrong': b'\x2a',
             'firework_whistle': b'\x2b',
             'firework_bang': b'\x2c',
             'podoboo-m100' : b'\x2d',
             'podoboo-m71' : b'\x2e',
             'podoboo-m43' : b'\x2f',
             'podoboo-m14' : b'\x30',
             'podoboo-p14' : b'\x31',
             'podoboo-p43' : b'\x32',
             'podoboo-p71' : b'\x33',
             'podoboo-p100' : b'\x34'
              #35+	Mirror of $1DF9's sound effects, starting at the "Hit head" SFX
            }

    switchpalaceflags_addr = { 'green' : 0x1F27,  'yellow' : 0x1F28,  'blue' : 0x1F29, 'red': 0x1F2A }    
    switchpalaceflags_values = { 'off' : 0x00,  'on' : 0x01 }
    async def setswitchpalace(self, name, value = b'\x01' ):
        addr = switchpalaceflags_addr[name + 0xF50000]
        await self.PutAddress( [  (addr, value) ] )

    async def setspring(self):
       await self.PutAddress( [ (0xF51EEB, 0) ] )
    async def setautumn(self):
       # flag set after finishing special world
       await self.PutAddress( [ (0xF51EEB, 1) ] )

    async def setgamemode(self, value) :
       # 0=reset b=ow f=enter level
       await self.PutAddress( [ (0xF50100, value) ])

    async def setgamemode_b(self):
        # gamemode \x0b : return to overworld
        await self.setgamemode(b'\x0b')

    async def e_xmario(self):
        await self.settime(2)
        await self.PutAddress([(0xF50096, b'\xf0')])

    async def xmario(self):
        await self.settime(2)
        await self.PutAddress([(0xF50096, b'\xf0')])

    async def setleveloverride(self, value=b'\x03'):
       await self.PutAddress( [ (0xF50109, value)] )

    async def groundshake(self, value=b'\x70'):
       await self.PutAddress( [ (0xF51887, value) ] )

    async def give3up(self, value=b'\x03'):
       await self.PutAddress( [ (0xF5e18e4, value) ] )

    async def get_ow_location(self):
        b1 = 0xF50000
        addrlist = [ 0x1F10, 0x1f17, 0x1f18, 0x1f19, 0x1f1a ]

        values = {}
        for ai in addrlist:
            values[ai] = await self.GetAddress(b1 + ai, 1)
        return list(values.items())

    async def ow_yoshi_house(self):
        await self.PutAddress([(16064273, b'\x01'), (16064279, b'h'),
            (16064280, b'\x00'), (16064281, b'x'), (16064282, b'\x00'),
            (16056576, b'\x0b')])

    async def iggy(self):
        b1 = 0xF50000
        await self.PutAddress( [ (b1 + 0x1F11, b'\x01'),
                                 (b1 + 0x1f17, b'\x98'),
                                 (b1 + 0x1f18, b'\x00'),
                                 (b1 + 0x1f19, b'\x28'),
                                 (b1 + 0x1f1a, b'\x00'),
                                 (b1 + 0x0100, b'\x0b') ]  )

    async def morton(self):
        b1 = 0xF50000
        await self.PutAddress( [ (b1 + 0x1F11, b'\x00'), 
                                 (b1 + 0x1f17, b'\xd8'), 
                                 (b1 + 0x1f18, b'\x00'),
                                 (b1 + 0x1f19, b'\xc8'), 
                                 (b1 + 0x1f1a, b'\x00'),
                                 (b1 + 0x0100, b'\x0b') ]  )
    async def setbrightness(self, value=b'\x0f') :
         b1 =0xF50000
         await self.PutAddress([ (b1 + 0x0dae, value) ])

    async def saveprompt(self,value=b'\x01'):
        await self.PutAddress( [ (0xF513CA, value) ] )
    async def moretime(self):
         await self.PutAddress([  (0xF50F31, b"\x09") ])
    async def powerdown(self):
         # shrink mario
         await self.PutAddress([ ( 0xF50019, b'\x00' ) ])
    async def setpowerup(self, value=b'\x01'):
         # change powerup status, default=none
         await self.PutAddress([ ( 0xF50019, value ) ])
    async def supermario(self):
         await self.PutAddress([ ( 0xF50019, b'\x01' ) ])
    async def firepower(self):
         await self.PutAddress([ ( 0xF50019, b'\x03' ) ])
    async def capepower(self):
         await self.PutAddress([ ( 0xF50019, b'\x02' ) ])
    async def starpower(self): #x7e -> xff
         await self.PutAddress([ ( 0xF51490, b'\xff' ) ])
    async def lives99(self):
         await self.PutAddress([ ( 0xF50DBE, b'\x62' ) ])
    async def coins99(self):
         await self.PutAddress( [ (0xF50DBF, b'\x62' ) ])
    async def blueswitch(self, value=b'\xb0'):  #\x7e
         await self.PutAddress( [ (0xF514AD, value) ] )
    async def silverswitch(self, value=b'\x7e'):
         await self.PutAddress( [ (0xF514AE, value) ] )
    async def setitembox(self, value=b'\x00' ):
         await self.PutAddress( [ (0xF50DC2, value) ] )
    async def setwater(self, value=b'\x01'):
         await self.PutAddress( [ (0xF50085, value) ] )
    async def setslippery(self, value=b'\x01'):
         await self.PutAddress( [ (0xF50086, value) ] )
    async def setpballoon(self):
         await self.PutAddress( [ (0xF5009e,b'\x8D'), 
              (0xF514C8, b'\x0B'), (0xF513F3,b'\x09'),
              (0xF5167A, b'\x9A'), (0xF51686,b'\x29'),
              (0xF51DF9, b'\x1e') ] )

    async def setkeyhole(self, value=b'\x01'):
         await self.PutAddress( [ (0xF51434, value) ] )
    async def setendlevel(self, value=b'\xFF'):  # Set to FF or 28?
         await self.PutAddress( [ (0xF51493, value) ] )
    async def setonoff(self, value=b'\x01'):
         await self.PutAddress( [ (0xF514AF, value) ] )

    async def setnumevents(self, value):
         await self.PutAddress( [ (0xF51F2E, value)] )
    async def getnumevents(self):
         evnum =  await self.GetAddresss( 0xF51F2E, 1 )
         return evnum

    async def gettime(self):
        hundreds = await self.GetAddress(0xF50F31, 1)
        tens = await self.GetAddress(0xF50F32, 1)
        ones = await self.GetAddress(0xF50F33, 1)
        curtime = hundreds[0] * 100  + tens[0] * 10 + ones[0]
        return int(curtime)

    async def settime(self,seconds):
         curtime = seconds
         hundreds = int(curtime / 100)
         tens = int((int(curtime) - hundreds*100)/10)
         ones = (int(curtime) - hundreds*100 - tens*10)  % 10
         await self.PutAddress([ (0xF50F31, bytes([hundreds]) ),
                                 (0xF50F32, bytes([tens]) ),
                                 (0xF50F33, bytes([ones]) )])

    async def z3_setrupees(self,value):
        await self.PutAddress([(0xF5F360, value)])

    async def z3_setmagic(self,value):
        await self.PutAddress([(0xF5F36E, value)])

    async def z3_damage(self,value=b'\x02'):
        await self.PutAddress([(0xF50373, value)])

    async def z3_setbow(self, value=b'\x02'):
        # 0 none
        # 1 bow
        # 2 bow+arrow
        # 
        # 4 bow+silver
        #
        await self.PutAddress([(0xF5F340, value)])

    async def z3_setboomerang(self, value=b'\x02'):
        # 0 empty 1 blue 2 red
        await self.PutAddress([(0xF5F341, value)])


    async def z3_sethookshot(self, value=b'\x01'):
        await self.PutAddress([(0xF5F342, value)])

    async def z3_setbombs(self, value=b'\x01'):
        await self.PutAddress([(0xF5F343, value)])

    async def z3_setmushroom(self, value=b'\x02'):
        await self.PutAddress([(0xF5F344, value)])

    async def z3_setfirerod(self, value=b'\x01'):
        await self.PutAddress([(0xF5F345, value)])

    async def z3_seticerod(self, value=b'\x01'):
        await self.PutAddress([(0xF5F346, value)])

    async def z3_setbombos(self, value=b'\x01'):
        await self.PutAddress([(0xF5F347, value)])

    async def z3_setether(self, value=b'\x01'):
        await self.PutAddress([(0xF5F348, value)])

    async def z3_setquake(self, value=b'\x01'):
        await self.PutAddress([(0xF5F349, value)])

    async def z3_setlamp(self, value=b'\x01'):
        await self.PutAddress([(0xF5F34A, value)])

    async def z3_sethammer(self, value=b'\x01'):
        await self.PutAddress([(0xF5F34B, value)])

    async def z3_setflute(self, value=b'\x01'):
        # 0=Empty, 1=Shovel,  2=Flute Present but No Bird,  3=Flute, Activated
        await self.PutAddress([(0xF5F34C, value)])

    # Bug Net - F34D,  Book - F34E,  F350 - Cane of Somaria, F351 - Staff of Bryna
    async def z3_setbugnet(self, value=b'\x01'):
        await self.PutAddress([(0xF50000 + 0xF34D, value)])

    async def z3_c5(self, value=b'\x00'):
        await self.PutAddress([(0xF650C5, value) ] )
        #await self.PutAddress([(0xF650C0, b'\x01'), (0xF5F359, b'\x02'), (0xF5012F, b'\x0f'), (0xF650C5, b'\x03') ] )
        pass

    async def z3_ohko(self, value=b'\x01'):
        await self.PutAddress([ (0xF650CC, value)   ])

    async def z3_controls_b(self, value=b'\x01'):
        # x00 normal
        # x01 invert dpad
        # x02 invert buttons
        # x03 invert dpad + buttons
        # x04 swap dpad + buttons
        await self.PutAddress([ (0xF650CB, value)   ])

    async def z3_controls(self, dpad=False, buttons=False, swap=False):
        value = 0
        if dpad:
            value = value | (1 << 0)
        if buttons:
            value = value | (1 << 1)
        if swap:
            value = value | (1 << 2)
        await self.PutAddress([ (0xF650CB, bytearray([value]))   ])


    async def z3_setbook(self, value=b'\x01'):
        #a = (await self.GetAddress(0xF5F379,1))[0]
        #if value == b'\x01':
        #    a = a | (1<<6)
        #else:
        #    a = a & ~(1<<6)
        await self.PutAddress([(0xF50000 + 0xF34E, value)])

    # 0xF650CA --> 
    async def z3_infinite_magic(self, value=b'\x01'):
        await self.PutAddress([(0xF650CA, value)])

    async def z3_infinite_arrows(self, value=b'\x01'):
        await self.PutAddress([(0xF650C8, value)])

    async def z3_infinite_b(self, value=b'\x01'):
        await self.PutAddress([(0xF650C9, value)])

    async def z3_setredcane(self, value=b'\x01'):
        await self.PutAddress([(0xF50000 + 0xF350, value)])

    async def z3_setbluecane(self, value=b'\x01'):
        await self.PutAddress([(0xF50000 + 0xF351, value)])

    async def z3_setcape(self, value=b'\x01'):
        await self.PutAddress([(0xF50000 + 0xF352, value)])

    async def z3_setmirror(self, value=b'\x02'):
        await self.PutAddress([(0xF50000 + 0xF353, value)])

    async def z3_setglove(self, value=b'\x02'):
        # 1 = power glove, 2 = titan mitt
        await self.PutAddress([(0xF50000 + 0xF354, value)])

    async def z3_getabilities(self):
        return await self.GetAddress(0xF5F379,1)


    async def z3_setboots(self, value=b'\x01'):
        a = (await self.GetAddress(0xF5F379,1))[0]
        if value == b'\x01':
            a = a | (1<<2)
        else:
            a = a & ~(1<<2)
        await self.PutAddress([(0xF50000 + 0xF355, value),
                               (0xF50000 + 0xF379, bytes([a]))])

    async def z3_setflippers(self, value=b'\x01'):
        await self.PutAddress([(0xF50000 + 0xF356, value)])

    async def z3_setpearl(self, value=b'\x01'):
        await self.PutAddress([(0xF50000 + 0xF357, value)])

    # F358 ?

    async def z3_setsword(self, value=b'\x04'):
        # Sword: F359 0=None 01=Fighter 02=Master 03=Tempered 04=Yellow
        await self.PutAddress([(0xF50000 + 0xF359, value)])


    async def z3_setshield(self, value=b'\x04'):
        # Shield: F35A 0=None, 1=Blue, 2=Red, 3=Mirror
        await self.PutAddress([(0xF50000 + 0xF35A, value)])

    async def z3_setarmor(self, value=b'\x02'):
        # Armor: F35B 0=Green, 1=Blue, 2=Red
        await self.PutAddress([(0xF50000 + 0xF35B, value)])

           #Bottles - F34F  0=Empty  1=Has Bottles
           #      F35C Bottle 1  0=None 1=?? 2=EmptyBottle 3=RedPotion 4=GreenPot 5=BluePot 6=Fairy 7=Bee 8=GoodBee
           #      F35D Bottle 2  0=None 1=?? 2=EmptyBottle 3=RedPotion 4=GreenPot 5=BluePot 6=Fairy 7=Bee 8=GoodBee
           #      F35E Bottle 3  0=None 1=?? 2=EmptyBottle 3=RedPotion 4=GreenPot 5=BluePot 6=Fairy 7=Bee 8=GoodBee
           #      F35F Bottle 4  0=None 1=?? 2=EmptyBottle 3=RedPotion 4=GreenPot 5=BluePot 6=Fairy 7=Bee 8=GoodBee

    async def z3_setbottle(self, value=b'\x06', num=1):
        offset = 0
        offset_list = { 1: 0, 2: 1, 3: 2, 4: 3 }
        if num in offset_list:
            offset = offset_list[num]
        await self.PutAddress([(0xF50000 + 0xF35C + offset, value)])


    # Rupees - F362-3 (Actual)    F360-1 (New rupee amount)
    # F36B - Number of heart pieces (out of four) that Link has earned

    # F36A - Wishing pond:  Number of Rupees in the pond.

    #F364 - Dungeon compass1  BitVector
    #                bit-2=Ganon Tower, bit-3=TurtleRock, bit-4=Blinds,  bit-5=Hera, bit-6=Ice, bit-7=SkullWoods

    #F365 - Dungeon compass2  BitVector
    #               bit-0=Mire, bit-1=POD, bit-2=Swamp, bit-3=?, bit-4=Desert, bit-5=EasternPalace

    #F366 - BigKey1 BitVector
                    #bit-2=Ganon Tower, bit-3=TurtleRock, bit-4=Blinds,  bit-5=Hera, bit-6=Ice, bit-7=SkullWoods

    #F367 - Bigkey2 BitVector
                    #bit-0=Mire, bit-1=POD, bit-2=Swamp, bit-4=Desert, bit-5=EasternPalace, bit-6=Hyrule
    #
    #F368 - DungeonMaps1 BitVector 
    # bit-2=Ganon Tower, bit-3=TurtleRock, bit-4=Blinds,  bit-5=Hera, bit-6=Ice, bit-7=SkullWoods
    #F369 - DungeonMaps2 BitVector
    # bit-0=Mire, bit-1=POD, bit-2=Swamp, bit-4=Desert, bit-5=EasternPalace, bit-6=Hyrule

    #F37A - Crystals bit-0=Mire, bit-1=POD, bit-2=Ice, bit-3=TurtleRock, bit-4=Swamp, bit-5=Blinds, Bit-6=SkullWoods
    # 

    #Small Key Counts: F37C-Sewer, F37D-Hyrule, F37E-Eastern, F37F-Desert, F380-Hyrule 2, F381-Swamp,
    #       F382- POD, F383- Mire, F384- SkullWoods, F385- Ice, F386- Hera, F387- Blinds, F388- TurtleRock, F389- GannonTower
    #       F38A-????,  F38B-????


    #$0CF4[0x01] - Activates bomb or snake trap overlords when set to a nonzero value.
    #$57[0x01] - Modifier for Link's movement speed. 0 - normal,
    #0x01 to 0x0F - slow,  0x10 and up - fast.  Negative values actually reverse your direction!

    #$04C5[0x01] - State dealing with Ganon's fight = 2 - you can hit him,
    # 1 - he's translucent, 0 - he’s invisible.


    #Flippers: $356. 0 - nothing. 1 - flippers. Having this allows you to swim, but doesn't make
    # the swim ability text show up by itself. See $379
    # ** Unlike the boots, the ability is granted, as long as you have this item.**

    #Bunny Link
    # 005D(01)  = Link handler  17=permabunny 1C=tempbunny
    #02E0 = bunny link picture?
    #03F5 = link tempbunny timer set to 0x100 when a yellow hunter hits him and 03F6 = (set to 1)
    #$0458[0x02]  0 - in dark room, 1 in dark room have lantern
    #$045A[0x01] - Seems to be the number of torches that are lit in a dark room.
    #    Torch objects during load can be set to be permanently lit,
    #    so this can affect how the room's lighting behaves.
    #
    #Always shoot sword beams regardless of heart level 0x39E7B - ?? ??  Change to EA EA
    #
    #Bosses don't drop hearts - 2F14C : D0 07 (or something similar) ?? ??  Change to EA EA
    #
    #02E0
    #03F5
    #set 03F6=0x30
    #0x7e03f6=0x30,  0x7e03f7=0x01
    #Write 0x30 to WRAM address 0x7e03f6 and 0x01 to 0x7e03f7.

    #Create Temp Bunny
    # 03F6  When 03F6==0x00 and 03F5==0x00  then  set 03F6=0x30
     #   and    set these to 0x00 
    #    STZ $036C STZ $031C STZ $031D STZ $0315 STZ $03EF STZ $02E3
        # STZ $02F6 STZ $0301 STZ $037A STZ $020B STZ $0350 STZ $030D
        # STZ $030E STZ $030A STZ $3B STZ $3A STZ $3C STZ $0308 STZ $0309
        # STZ $0376 STZ $50 STZ $4D STZ $46 STZ $0360 STZ $02DA STZ $55
       # STZ $037B #STZ $0300 STZ $037E STZ $02EC STZ $0314 STZ $03F8 STZ $02FA

        # Create Perm Bunny:  When 05D   set 05D to 0x17 and 
        # 02E0  and $056
        # F379==0xFF
        # ; Link no longer has to be changed into a bunny.
        # STZ $03F7

    #0f=1111

    #F3C5  = 01 after uncle
    #F36D =  cur hearts?  18=FULL 4
    #F36F = Number keys cur. dungeon?
    # F373 = Magic Refill amount ; 10=small 
    #0373 = Subtract heart amount?
    #037B = spike immunity
    #02E0 = bunny link picture?
    #03F5 = link tempbunny timer set to 0x100 when a yellow hunter hits him
    #03F6 = (set to 1)
    # $0458[0x02]  0 - in dark room, 1 in dark room have lantern
    # Always shoot sword beams regardless of heart level 0x39E7B - ?? ??  Change to EA EA

    #GameGenie:7E 045A 03 - Dark rooms are always lit
    #$0CF4[0x01] - Activates bomb or snake trap overlords when set to a nonzero value.

    #$57[0x01] - Modifier for Link's movement speed.
    # 0 normal, 0x01 to 0x0F - slow, , 0x10 and up - fast.
    # Negative values actually reverse your direction!
    #  $04C5[0x01] - State dealing with Ganon's fight = 2 - you can hit him,
    #   1 - he's translucent, 2- he's invisible

    #005D(01)  = Link handler  17=permabunny 1C=tempbunny

    #Ability Flags:      $379. Bit 0:
    #                       Bit 1: Swim
    #                       Bit 2: Run / Dash
    #                       Bit 3: Pull
    #                       Bit 4: ----
    #                       Bit 5: Talk
    #                       Bit 6: Read
    #                       Bit 7: ----











    
















    async def addtime(self,seconds):
         # add time to the timer
         seconds = 0
         hundreds = await self.GetAddress(0xF50F31, 1)
         tens = await self.GetAddress(0xF50F32, 1)
         ones = await self.GetAddress(0xF50F33, 1)
         curtime = hundreds[0] * 100  + tens[0] * 10 + ones[0] 
         curtime = curtime + seconds
         hundreds = int(curtime / 100) 
         tens = int((int(curtime) - hundreds*100)/10)
         ones = (int(curtime) - hundreds*100 - tens*10)  % 10
         await self.PutAddress([ (0xF50F31, bytes([hundreds]) ),
                                 (0xF50F32, bytes([tens]) ),
                                 (0xF50F33, bytes([ones]) )])



         await self.PutAddress([  (0xF50F31, b"\x09") ])

    #c.vanilla addresses# found to work
    async def c_invertcontrols(self, value=b'\x02'): 
         # x01 invert dpand
         # x02 invert buttons
         # x04 dpad and buttons mixed up
        await self.PutAddress( [ (0xF61980, value) ] )

    async def c_magicsound(self, value=b'\x00'):
        await self.PutAddress( [(0xF51DF9, b'\x10')] )

    async def c_resetgame(self, value=b'\x00'):
        await self.PutAddress( [(0xF50100, value)] )
    async def c_exitlevel(self, value=b'\x0b'):
        await self.PutAddress( [(0xF50100, value)] )

    async def c_pixelate(self, value=b'\x02'):
        await self.PutAddress([(0xF60723,b'\x01')])

    async def c_spawnthwomp(self, value=b'\x01'):
        #F60725=>spawns
        await self.PutAddress([(0xF60006, b'\x01'), (0xF60725, b'\x01')])

    async def c_kaizoblock(self, value=b'\x01'):
        await self.PutAddress([(0xF60729,b'\x01')])

    async def c_fishgen(self, value=b'\7'): # \a
        await self.PutAddress( [ (0xF518B9, value) ] )

    async def c_item_empty(self, value=b'\x00'):
        await self.PutAddress( [ (0xF50dc2, value) ] )

    async def c_item_mushroom(self, value=b'\x01'):
        await self.PutAddress( [ (0xF50dc2, value) ] )

    async def c_item_flower(self, value=b'\x02'):
        await self.PutAddress( [ (0xF50dc2, value) ] )

    async def c_item_starman(self, value=b'\x03'):
        await self.PutAddress( [ (0xF50dc2, value) ] )

    async def c_starman(self):
         await self.PutAddress([ ( 0xF51490, b'\xff' ) ])

    async def c_item_capefeather(self, value=b'\x04'):
        await self.PutAddress( [ (0xF50dc2, value) ] )

    async def c_item_blueyoshi(self, value=b'\xc2'): #(0xf50dc2, b'\xc2')
        await self.PutAddress( [ (0xF50dc2, value) ] )

    async def sfx_mountyoshi(self, value=b'\x1f'):
        await self.PutAddress( [ (0xF51DFC, value)])

    async def c_blueswitch(self, value=b'\xb0', value2=b'\x0e'):
         await self.PutAddress( [ (0xF514AD, value), (0xF51DFB, value2) ] )

    async def c_silverswitch(self, value=b'\xb0', value2=b'\x0e'):
             # F60728 => turns enemies into coins on x01
         await self.PutAddress( [ (0xF514AE, value), (0xF51DFB, value2), (0xF60728, b'\x01') ] )


    async def c_bulletbillgen(self, value=b'\x0b', value2=b'\x09'):  # Set F51889 to 0x0b
        await self.PutAddress( [ (0xF518B9, value), (0xF51DFC, value2) ] )

    async def c_addlives(self, value=b'\x01', value2=b'\x05'):       # To increment lives gradually by n,  set 0xF518E4 to n
        await self.PutAddress( [ (0xF518E4, value), (0xF51DFC, value2) ] )

    async def c_5up(self, value=b'\x03', value2=b'\x05'):
        await self.PutAddress( [ (0xF518E4, value), (0xF51DFC, value2) ] )

    async def c_5up(self, value=b'\x05', value2=b'\x05'):
        await self.PutAddress( [ (0xF518E4, value), (0xF51DFC, value2) ] )

    async def c_lippery(self, value=b'\x01'):
         await self.PutAddress( [ (0xF50086, value) ] )

    async def c_water(self, value=b'\1'):
        await self.PutAddress( [ (0xF50085, value) ] )

    async def c_disappearing(self, value=b'\1'):
        await self.PutAddress( [ (0xF60000, value) ] )

    async def c_munchers( self, value=b'\1'):
        await self.PutAddress( [ (0xF60003, value) ] )

    async def c_duplicating(self, value=b'\1'):
        await self.PutAddress( [ (0xF60002, value) ])

    async def c_window(self, value=b'\1'):
        await self.PutAddress( [ (0xF60004, value) ] )
 
    # (0xf61981, b'\x06')
    # (0xf50dc2, b'\xc2'), (0xf51dfc, b'\x1f')
    # write 1f to 0xf51dfc

    # (0xf61981, b'\x04')
    # (0xF50DC2, b'\xc2')
    # (0xF51DFC, b'\x1f') 

    async def c_yellow_yoshi(self):
        await self.PutAddress( [(0xf61981, b'\x04'), (0xF50DC2, b'\xc2'), (0xF51DFC, b'\x1f') ])

    async def c_speed(self, value=b'\1'): # bx01 activates
        await self.PutAddress( [ (0xF60001, value) ] )

    async def sfx_item_reservebox(self, value=b'\x0b'): # c_1dfc_write0b
        await self.PutAddress( [ (0xF51DFC, value) ] )

    async def c_stickyfloor(self, value=b'\1'):
        await self.PutAddress( [ (0xF60005, value) ] )

    async def sfx_springboard(self, value=b'\x08'):
        await self.PutAddress( [ (0xF51DFC, value) ])

    async def c_balloon(self, value=b'\1'):
        await self.PutAddress( [ (0xF60007, value) ] )

    async def sfx_midway(self):
        await self.PutAddress([(0xF51DF9, b'\x05')])

    async def c_midway(self, value=b'\x01'):
        if self.inlevel():
            if value == b'\x01':
                await self.PutAddress([(0xF513CE, b'\x01'), (0xF51DF9, b'\x05')])
            else:
                await self.PutAddress([(0xF513CE, value), (0xF51DF9, b'\x10')])

    async def setmarioYpos(self, value=b'\x00'):
        await self.PutAddress([(0xF50096, b'\x00')])

    async def a_endmario(self):
        i = 60
        while (await self.inlevel()) == False and i > 1:
            i = i - 1
        await self.settime(2)
        await self.PutAddress([(0xF50096, b'\xf0')])


    async def inlevel(self):
        run_game = ((await self.GetAddress(0xF50010,1)) == b'\x00')
        game_unpaused = (await self.GetAddress(0xF513D4,1)) == b'\x00'
        noanimation = (await self.GetAddress(0xF50071,1)) == b'\x00'
        no_endlevel_keyhole = (await self.GetAddress(0xF51434,1)) == b'\x00'
        no_endlevel_timer = (await self.GetAddress(0xF51493,1)) == b'\x00'
        normal_level = (await self.GetAddress(0xF50D9B,1)) == b'\x00'
        return run_game and game_unpaused and noanimation and no_endlevel_keyhole and no_endlevel_timer and normal_level

     #14AF onoffstatus



async def runsnes():
    #test = SmwEffectRunner()
    ohash = loadsmwrh.get_local_options()

    #snes = py2snes.snes()
    snes = SMWUSBTest()
    #snes = SnesLink()
    await snes.readyup()
    #await snes.connect(address=ohash['wsaddress']) # ws://hostname:8080
    #devices = await snes.DeviceList()
    #print('Devices =' + str(devices))
    #print('Attaching')
    #await snes.Attach(devices[0])
    #print('Attach done')
    #print('usb2snes information:')
    #print(await snes.Info())
    ramplus = 0x77
    #rambase = 0x85
    rambase = 0xF5
    #code.interact(local=locals())
    IPython.embed(using='asyncio')
    return snes

if __name__ == '__main__':
    asyncio.run(runsnes())





