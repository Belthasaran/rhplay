from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys
import loadsmwrh
from py2snes import py2snes
import asyncio
import time
import code

import IPython
import nest_asyncio
from smw_e_generic import *
import pdb
nest_asyncio.apply()
#IPython.embed()

class TakeItemEffect(SmwEffectRunner):
    #async def run(self,amount=1,duration=0):
    #    self.super.run(amount,duration)
    #async def ready(self):
    #    return await self.inlevel()
    def __init__(self,amount=1,duration=0,retries=300,tick_interval=1):
        super().__init__(amount,duration,retries,tick_interval)
        self.name = "Remove item from item box"
        self.game = "SuperMarioWorld"
        self.description = "Remove item from item box"
        self.effectId = "takeItem"
        #self._duration = duration
        #self._amount = amount
        #self._retries = retries
        #self._tick_interval = tick_interval


    async def initiate(self):
        amount = self._amount
        duration = self._duration
        print(f'TakeItemEffect.Initiate({amount},{duration})')
        # Start the action
        await self.snes.PutAddress([(0xF51DFC, b'\x00'), (0xF50dc2, b'\x00')])

    async def refresh(self):
        # Refresh
        pass

    async def finalize(self):
        # Cleanup actions
        pass

    async def settime(self,seconds):
         curtime = seconds
         hundreds = int(curtime / 100)
         tens = int((int(curtime) - hundreds*100)/10)
         ones = (int(curtime) - hundreds*100 - tens*10)  % 10
         await self.snes.PutAddress([ (0xF50F31, bytes([hundreds]) ),
                                 (0xF50F32, bytes([tens]) ),
                                 (0xF50F33, bytes([ones]) )])

    async def inlevel(self):
        run_game = ((await self.snes.GetAddress(0xF50010,1)) == b'\x00')
        game_unpaused = (await self.snes.GetAddress(0xF513D4,1)) == b'\x00'
        noanimation = (await self.snes.GetAddress(0xF50071,1)) == b'\x00'
        no_endlevel_keyhole = (await self.snes.GetAddress(0xF51434,1)) == b'\x00'
        no_endlevel_timer = (await self.snes.GetAddress(0xF51493,1)) == b'\x00'
        normal_level = (await self.snes.GetAddress(0xF50D9B,1)) == b'\x00'
        return run_game and game_unpaused and noanimation and no_endlevel_keyhole and no_endlevel_timer and normal_level



async def effect_runner(args):
    ohash = loadsmwrh.get_local_options()
    print(f"snes_xmario: {ohash}")

    #snes = py2snes.snes()
    runner = TakeItemEffect()
    await runner.readyup()
    #await snes.connect(address=ohash['wsaddress']) # ws://hostname:8080
    #devices = await snes.DeviceList()
    #print('Devices =' + str(devices))
    #print('Attaching')
    #await snes.Attach(devices[0])
    #print('Attach done')
    #print('usb2snes information:')
    #print(await snes.Info())
    ##image = args[1]
    result = await runner.run()
    print('Result = ' + str(result))
    return runner

if __name__ == '__main__':
    asyncio.run(effect_runner(sys.argv))





