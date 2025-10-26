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
#nest_asyncio.apply()
#IPython.embed()

class mysnes(py2snes.snes):
    powerupstate = 0xF50019
    powerupvalues = { 'fire' : b'\x03', 'cape': b'\x02', 'super': b'\x01', 'normal': b'\x00'  }

    itemboxvalues = { 'super' : b'\x01', 'fire' : b'\x02', 'star' : b'\x03', 'cape': b'\x04',
                      'blueyoshi': b'\x05',  'grayyoshi': b'\x06'  }

    async def moretime(self):
         await self.PutAddress([  (0xF50F31, b"\x09") ])
    async def firepower(self):
         await self.PutAddress([ ( 0xF50019, b'\x03' ) ])
    async def capepower(self):
         await self.PutAddress([ ( 0xF50019, b'\x02' ) ])
    async def starpower(self):
         await self.PutAddress([ ( 0xF51490, b'\x7e' ) ])
    async def lives99(self):
         await self.PutAddress([ ( 0xF50DBE, b'\x62' ) ])
    async def coins99(self):
         await self.PutAddress( [ (0xF50DBF, b'\x62' ) ])
    async def blueswitch(self, value=b'\x7e'):
         await self.PutAddress( [ (0xF514AD, value) ] )
    async def silverswitch(self, value=b'\x7e'):
         await self.PutAddress( [ (0xF514AE, value) ] )
    async def setitembox(self, value=b'\x00' ):
         await self.PutAddress( [ (0xF50DC2, value) ] )
    async def setwater(self):
         await self.PutAddress( [ (0xF50085, b'\x01') ] )
    async def setkeyhole(self, value=b'\x01'):
         await self.PutAddress( [ (0xF51434, value) ] )
    async def setonoff(self, value=b'\x01'):
         await self.PutAddress( [ (0xF514AF, value) ] )

     #14AF onoffstatus


async def connect_to_snes():
    ohash = loadsmwrh.get_local_options()
    snes = mysnes()
    await snes.connect(address=ohash['wsaddress'])
    devices = await snes.DeviceList()
    print('Devices =' + str(devices))
    print('Attaching')
    await snes.Attach(devices[0])
    print('Attach done')
    print('usb2snes information:')
    print(await snes.Info())
    return snes
    

#async def runsnes():
if True:
    snes = asyncio.run(connect_to_snes())
    ramplus = 0x77
    #rambase = 0x85
    rambase = 0xF5
    #code.interact(local=locals())
    IPython.embed(using='asyncio')
#    return snes
#
#if __name__ == '__main__':
#    asyncio.run(runsnes())





