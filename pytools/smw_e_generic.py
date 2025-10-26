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
from sneslink import SnesLink
import pdb
nest_asyncio.apply()
#IPython.embed()

#class SmwEffectRunner(py2snes.snes):
class SmwEffectRunner():
    def __init__(self,amount=1,duration=60,retries=300,tick_interval=0.5):
        super().__init__()
        #super().__init__(amount,duration,retry,tick_interval)
        self.snes = SnesLink()
        self.is_running = 0
        self.time_left = 0
        self.name = "Generic Effect"
        self.game = "SuperMarioWorld"
        self.description = "Unspecified"
        self.effectID = "smwGenericEffect"
        self._duration = duration
        self._amount = amount
        self._retries = retries
        self._tick_interval = tick_interval

    async def readyup(self):
        return await self.snes.readyup()

    async def run(self):  #,amount=1,duration=0,retries=60,tick_interval=0.5):
       amount = self._amount
       duration = self._duration
       retries = self._retries
       tick_interval = self._tick_interval
       i = retries
       while (await self.ready()) == False and i > 1:
           print(f"Not ready, Retry    {i}")
           i = i - 1
           await asyncio.sleep(1)
           #time.sleep(1)
       pass
       #await self.mutex_lock(amount,duration)
       await self.initiate()
       #await self.mutex_unlock(amount,duration)
       self.is_running = 1
       self.time_left = duration
       while self.time_left > 0 :
           await self.tick()
           await asyncio.sleep(tick_interval)
       await self.finalize()

    async def ready(self):
        return await self.inlevel()

    async def isactive(self):
        return await self.inlevel()

    async def mutex_lock(self):
        pass

    async def mutex_unlock(self):
        pass

    async def initiate(self):
        # Start the action
        pass

    async def refresh(self):
        # Refresh
        pass

    async def finalize(self):
        self.is_running = 0
        # Cleanup actions
        pass

    async def tick(self): #,amount,duration,tick_interval=0.5):
        amount = self._amount
        duration = self._duration
        tick_interval = self._tick_interval
        if self.time_left > 0 :
            await asyncio.sleep(tick_interval)
            if await self.isactive():
                # Time is deducted while active
               self.time_left = self.time_left - tick_interval
        if self.time_left < 0 :
            self.time_left = 0
        if self.time_left >= 0:
            await self.refresh()
        # Refresh status
        pass

    async def c_item_empty(self, value=b'\x00'):
        await self.snes.PutAddress( [ (0xF50dc2, value) ] )

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
    async def connect_and_run(self,args=[]):
        print(f'SmwEffectRunner:connect_and_run')
        readystat = await self.snes.readyup()
        #ohash = loadsmwrh.get_local_options()
        #print(f"snes_xmario: {ohash}")
        ##
        ##snes = SMWEffectRunner(retries=300,duration=0,tick_interval=1)
        #await self.connect(address=ohash['wsaddress']) # ws://hostname:8080
        #devices = await self.DeviceList()
        #print('Devices =' + str(devices))
        #print('Attaching')
        #await self.Attach(devices[0])
        #print('Attach done')
        #print('usb2snes information:')
        #print(await self.Info())
        ##image = args[1]
        result = await self.run()
        print('Result = ' + str(result))
        return result




async def smw_gen_effect_runner(args):
    ohash = loadsmwrh.get_local_options()
    print(f"snes_xmario: {ohash}")

    #snes = py2snes.snes()
    runner = SmwEffectRunner()
    await snes.readyup()
    #await snes.connect(address=ohash['wsaddress']) # ws://hostname:8080
    #devices = await snes.DeviceList()
    #print('Devices =' + str(devices))
    #print('Attaching')
    #await snes.Attach(devices[0])
    #print('Attach done')
    #print('usb2snes information:')
    #print(await snes.Info())
    ##image = args[1]
    result = await snes.run()
    print('Result = ' + str(result))
    return snes

if __name__ == '__main__':
    asyncio.run(smw_gen_effect_runner(sys.argv))





