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

class XMarioEffect(SmwEffectRunner):
    #async def run(self,amount=1,duration=0):
    #    self.super.run(amount,duration)
    #async def ready(self):
    #    return await self.inlevel()
    def __init__(self,amount=1,duration=60,retries=300,tick_interval=1):
        super().__init__(amount,duration,retries,tick_interval)
        # Timed-effect: Little Mario
        #   For the duration of affect: Mario shrinks and continuously loses
        #   any mushroom, cape, or flower status.
        self.name = "X Mario"
        self.game = "SuperMarioWorld"
        self.description = "X Mario"
        self.effectId = "xMario"
    async def ready(self):    # ready(): Effect pre-requisites
        return await self.inlevel()
    async def initiate(self):  # initiate() -> Initially apply affect
        print(f'XMarioEffect.Initiate({self._amount},{self._duration})')
        await self.snes.PutAddress([(0xF50096, b'\xf0'), (0xF50F31, b'\x00'), 
                               (0xF50F32, b'\x00'), (0xF50F33, b'\x01')])
    async def connect_and_run(self,args=[]):
        ohash = loadsmwrh.get_local_options()
        print(f"snes_xmario: {ohash}")
        #
        snes = XMarioEffect(retries=300,duration=0,tick_interval=1)
        await snes.connect(address=ohash['wsaddress']) # ws://hostname:8080
        devices = await snes.DeviceList()
        print('Devices =' + str(devices))
        print('Attaching')
        await snes.Attach(devices[0])
        print('Attach done')
        print('usb2snes information:')
        print(await snes.Info())
        #image = args[1]
        result = await snes.run()
        print('Result = ' + str(result))
        return result



async def effect_runner(args):
    ohash = loadsmwrh.get_local_options()
    print(f"snes_xmario: {ohash}")

    #snes = py2snes.snes()
    runner = XMarioEffect(retries=300,duration=0,tick_interval=1)
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
    #result = await snes.run()
    result = await runner.run()
    print('Result = ' + str(result))
    return runner

if __name__ == '__main__':
    asyncio.run(effect_runner(sys.argv))





