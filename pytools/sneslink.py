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
import pdb

nest_asyncio.apply()
#IPython.embed()

class SnesLink(py2snes.snes):
    _instance = None
    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            print(f'SnesLink:return existing instance')
            cls._instance = super().__new__(cls)
            ####
            super().__init__(cls._instance)
            #super(py2snes.snes,cls._instance).state = py2snes.SNES_DISCONNECTED
            ####
        return cls._instance

    async def readyup(self, note=''):
        #while not(super(py2snes.snes,self).state == py2snes.SNES_ATTACHED):
        while not(self.state == py2snes.SNES_ATTACHED):
            if self.state == py2snes.SNES_DISCONNECTED:
                ohash = loadsmwrh.get_local_options()
                await self.connect(address=ohash['wsaddress'])
            while self.state == py2snes.SNES_CONNECTING:
                await asyncio.sleep(1)
            if self.state == py2snes.SNES_CONNECTED:
                await self.Name(f'sneslink {note}')
                devices = await self.DeviceList()
                print('Devices =' + str(devices))
                print(f'Attaching {devices[0]}')
                await self.Attach(devices[0])
                print('usb2snes information:')
                print(await self.Info())
            await asyncio.sleep(1)
        return True

    def __init__(self, *args, **kwargs):
        pass


async def runsnes():
    ohash = loadsmwrh.get_local_options()

    #snes = py2snes.snes()
    snes = mysnes()
    await snes.connect(address=ohash['wsaddress']) # ws://hostname:8080
    devices = await snes.DeviceList()
    print('Devices =' + str(devices))
    print('Attaching')
    await snes.Attach(devices[0])
    print('Attach done')
    print('usb2snes information:')
    print(await snes.Info())
    ramplus = 0x77
    #rambase = 0x85
    rambase = 0xF5
    #code.interact(local=locals())
    IPython.embed(using='asyncio')
    return snes

if __name__ == '__main__':
    asyncio.run(runsnes())





