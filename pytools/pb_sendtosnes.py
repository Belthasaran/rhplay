# Copyright C Belthasar 2023 All Rights Reserved

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
from sneslink import SnesLink

def sendtosnes_function(args):
    result = asyncio.run(sendtosnes_function_async(args))
    #print('AsyncResult = ' + str(result))
    return result

async def sendtosnes_function_async(args):
    if (len(args) < 2):
        print('Usage: pb_sendtosnes <FILENAME>')
        return None
    romfile = args[1]
    if (romfile and len(args) >= 2):
        ohash = loadsmwrh.get_local_options()
        if 'wsaddress' in ohash:
            print('WebSocket Address for usb2SNES is configured;  Connecting...')
            try: 
                snes = SnesLink()
                print('snesLink:Readying connection')
                await snes.readyup(note='pb_sendtosnes')
                #snes = py2snes.snes()
                #await snes.connect(address=ohash['wsaddress'])
                #print('Socket open, Attaching..')
                #await snes.Name('pb_sendtosnes')
                #devices = await snes.DeviceList()
                #print('devices=' + str(devices))
                ##await snes.Attach(devices[0])
                #print('Attach result:' + str(await snes.Attach(devices[0])))
                #print(await snes.Info())
                print('Uploading file')
                basefilename = os.path.basename(romfile)
                await snes.PutFile(args[1], '/xfer/'+basefilename)
                time.sleep(15)
                await snes.List('/xfer')
                print('Upload ended, attempting to boot []'+basefilename)
                await snes.Boot('/xfer/'+basefilename)
                print('Ok')
                return True
            except Exception as snerr:
                print('ERROR: ' + str(snerr))
                print('Fallback in 10 seconds')
                return False
                time.sleep(10)
                pass
        
        if args[0] == 'launch1':
             ohash = loadsmwrh.get_local_options()
             syscmd = str(ohash['launcher1']).replace('%file',romfile)
             print('Running '+syscmd)
             if not(os.system(syscmd)):
                 return True
             print('ERROR: Launch error for ' +str(syscmd))
    if romfile:
        #syscmd = r'C:\stream\QUsb2Snes\SendToSd2Snes.exe ' + romfile
        if os.path.exists('/mnt/c'):
            syscmd = os.path.join('/mnt', 'c', 'stream', 'QUsb2Snes', 'SendToSd2Snes.exe') + ' ' + romfile
        else:
            syscmd = 'C:\\' + os.path.join('stream', 'QUsb2Snes', 'SendToSd2Snes.exe') + ' ' + romfile
        print('Running   ' + syscmd)
        if os.system(syscmd):
            return None
        return True
    pass

if __name__ == '__main__':
    sendtosnes_function(sys.argv)
    
    
    
    
 
