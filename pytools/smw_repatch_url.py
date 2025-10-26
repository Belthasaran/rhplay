#!/usr/bin/python3
from zipfile import ZipFile
import zipfile
import re
import hashlib
import base64
import os
import json
import sys
import loadsmwrh
import requests
import platform
import pb_sendtosnes
import traceback
import time
import io

def repatch_url_function(args,ccrom=False,noexit=False):
    hackinfo = {'id' : '0'}
    path_prefix = loadsmwrh.get_path_prefix()
    if not loadsmwrh.path_rerequisites():
        return None

    if os.path.exists("flips"):
       flips_cmd = os.path.join('.','flips')
    elif os.path.exists("flips.exe"):
       flips_cmd = 'flips.exe'
    elif os.path.exists("/mnt/c/snesgaming/bin/flips"):
       flips_cmd = '/mnt/c/snesgaming/bin/flips'
    elif os.path.exists("/usr/local/bin/flips"):
       flips_cmd = 'flips'
    else:
       print('Please put flips or flips.exe and smw.sfc in start directory ' + os.getcwd())
       return None
        

    filename = os.path.join(path_prefix,os.path.join("temp","in.zip"))
    
    bpsurl = (args[1])
    if re.search(r'https?:', bpsurl):
        req = requests.get(bpsurl)
        if not(req.status_code == 200):
            sys.stderr.write(f'ERR: HTTP Response {req.status_code} for URL')
            raise Exception(f'ERR: HTTP Response {req.status_code} for URL')
        dldata = req.content
    elif re.match('[^.]+.(zip|bps)$',bpsurl, re.I):
        f_handle = open(bpsurl, 'rb')
        dldata = f_handle.read()
        f_handle.close()
    else:
        dldata = None
        raise ValueError('Invalid filename')
    shake1 = (base64.b64encode(hashlib.shake_128(dldata).digest(24), b"_-")).decode('latin1')

    iszipfile = False
    try:
        with zipfile.ZipFile(io.BytesIO(dldata)) as zip:
            for info in zip.infolist():
                if re.match('Espa', info.filename) :
                    continue
                if re.match('.*\.bps', info.filename) :
                    dldata = zip.read(info)
                    shake1 = (base64.b64encode(hashlib.shake_128(dldata).digest(24), b"_-")).decode('latin1')
                    sha1 = (hashlib.sha1(dldata).hexdigest())
                    xsha224 = hashlib.sha224(dldata).hexdigest()
                    break
        iszipfile = True
    except zipfile.BadZipFile: 
        iszipfile = False

    #filename = os.path.join(path_prefix,os.path.join("zips", "")) + str(shake1) + ".b"
    #data = loadsmwrh.get_patch_blob( str(hackid), blobinfo  )
    shake1 = (base64.b64encode(hashlib.shake_128(dldata).digest(24), b"_-")).decode('latin1')
    sha1 = (hashlib.sha1(dldata).hexdigest())
    xsha224 = hashlib.sha224(dldata).hexdigest()
    
    f1 = open(os.path.join(path_prefix, "temp",  xsha224) + ".new" , "wb")
    f1.write(dldata)
    f1.close()
    os.replace(os.path.join(path_prefix, "temp", xsha224) + ".new", os.path.join(path_prefix, "patch", shake1))
    hackinfo["patch"] = os.path.join(path_prefix, "patch", shake1)
    if not os.path.exists(os.path.join(path_prefix,'smw.sfc')):
        print('Could not find ' + os.path.join(path_prefix, 'smw.sfc') + ': SMW Romfile required - Unable to patch')
        return None
    print('')
    print('Running command: '+flips_cmd+' --apply ' + os.path.join(path_prefix,'patch', shake1) +"  "+os.path.join(path_prefix,'smw.sfc') +" " + os.path.join(path_prefix,'temp', 'result'))
    os.system(flips_cmd+" --apply " + os.path.join(path_prefix,'patch', shake1) +"  "+os.path.join(path_prefix,'smw.sfc') +" " + os.path.join(path_prefix,'temp', 'result'))
    ##data = bytearray()
    ##with open(os.path.join("temp", "result"), "rb") as patched:
    ##    data += patched.read(1)
    resultf = open(os.path.join(path_prefix, "temp", "result"), "rb")
    data = resultf.read()
    resultf.close()
    
    shake1_patched = (base64.b64encode(hashlib.shake_128(data).digest(24), b"_-")).decode('latin1')
    sha1_patched = (hashlib.sha1(data).hexdigest())
    xsha224_patched = hashlib.sha224(data).hexdigest()

    print(f'patchBPSURL={bpsurl}')
    urltrailer = re.split(r'/', bpsurl)[-1]
    urltrailer = re.split(r'[^a-zA-Z0-9]', urltrailer)[0]
    urltrailer = f'{urltrailer}{shake1_patched[0:9]}'

    #SuperMarioWorld.ips

    namesuffix=''
    resultfile=os.path.join('temp','result')
    if ccrom:
        namesuffix='.cc'
        #
        os.system(flips_cmd+" --apply " + os.path.join(path_prefix,'zips', 'ccSuperMarioWorld.ips') +"  "+os.path.join(path_prefix,'temp', 'result')+" "+os.path.join(path_prefix,'temp', 'result2'))
        resultfile=os.path.join('temp','result2')
        resultf = open(os.path.join(path_prefix, "temp", "result2"), "rb")
        data = resultf.read()
        resultf.close()
        #shake1_patched = (base64.b64encode(hashlib.shake_128(data).digest(24), b"_-")).decode('latin1')

    jsonfilename = ''
    
    if re.match('patchurl', args[0]) or re.match('.*repatch.*', args[0]):
        print(f"_______{urltrailer}")
        romfilename = hackinfo["id"] + "_" +  str(urltrailer) + namesuffix + ".sfc"
        jsonfilename = hackinfo["id"] + "_" +  str(urltrailer) + namesuffix + ".sfcjson"
    elif re.match('.*repatch.*', args[0]):
        romfilename = hackinfo["id"] + "_" + shake1_patched  + namesuffix + ".sfc"
        jsonfilename = hackinfo["id"] + "_" + shake1_patched + namesuffix + ".sfcjson"
    else:
        romfilename = hackinfo["id"] + "_" +  str(args[0]) + namesuffix + ".sfc"
        jsonfilename = hackinfo["id"] + "_" +  str(args[0]) + namesuffix + ".sfcjson"

    f0 = open(os.path.join(path_prefix,"rom", romfilename) + ".new", "wb")
    f0.write(data)
    f0.close()

    f0 = open(os.path.join(path_prefix,"rom", jsonfilename) + ".new", "w")
    f0.write(json.dumps(hackinfo))
    f0.close()
    #print('Expected sha224(result) = ' + hackinfo["result_sha224"])
    #print('Actual sha224(result) = ' + xsha224_patched)
    #if xsha224_patched == hackinfo["result_sha224"]:
    os.replace(os.path.join(path_prefix,"rom", romfilename) + ".new", os.path.join(path_prefix,"rom", romfilename))
    os.replace(os.path.join(path_prefix,"rom", jsonfilename) + ".new", os.path.join(path_prefix,"rom", jsonfilename))
    #else:
    #    print('Error: Checksum of patched ROM does not match expected value.   Possible file corruption or incorrect SMW ROM')
    
    hackinfo["pat_sha224"] = xsha224
    hackinfo["pat_sha1"] = sha1
    hackinfo["pat_shake_128"] = shake1
    hackinfo["result_sha224"] = xsha224_patched
    hackinfo["result_sha1"] = sha1_patched
    hackinfo["result_shake1"] = shake1_patched
    hackinfo["rom"] = os.path.join(path_prefix,"rom",  romfilename)
    hackinfo["romjson"] = os.path.join(path_prefix,"rom",  jsonfilename)
    #            f2 = open(os.path.join("pat_meta",  shake1) + ".new", "w")
    #            f2.write( json.dumps(hackinfo) + "\n" )
    #            f2.close()
    #            os.replace(os.path.join("pat_meta", shake1) + ".new", os.path.join("pat_meta", shake1) + "")
    
    #            f2 = open(os.path.join("rom_meta", shake1_patched) + ".new", "w")
    #            f2.write( json.dumps(hackinfo) + "\n" )
    #            f2.close()
    #            os.replace(os.path.join("rom_meta", shake1_patched) + ".new", os.path.join("rom_meta", shake1_patched) + "")
    #            f2 = open(os.path.join("hacks", hackinfo["id"])  + ".new", "w")
    #            f2.write( json.dumps(hackinfo) + "\n" )
    #            f2.close()
    #            os.replace(os.path.join("hacks", hackinfo["id"])  + ".new", os.path.join("hacks", hackinfo["id"])  + "")
    #hacknotes = []
    #try:
    #    hacknotes = loadsmwrh.get_note_dict()
    #    if not( hackinfo["id"] in hacknotes ):
    #         hacknotes[ hackinfo["id"] ] = {}
    #    if not( 'downloaded' in hacknotes[ hackinfo["id"]  ] ) or not( hacknotes[ hackinfo["id"] ]["downloaded"]  ):
    #        if 'name_href' in hackinfo:
    #            url = hackinfo["name_href"]
    #        else:
    #            url = hackinfo["xdata"]["name_href"]
    #        if (re.match('^\/\/.*', url)):
    #            url = 'http:' + url
    #        print('Sending HEAD request: ' + url)
    #        req = requests.head(url, headers = { 'User-Agent' : f'rhtools-pb_repatch/1.0 ({platform.platform()}; Python/{platform.python_version()})' })
    #        hacknotes[ hackinfo["id"] ]["downloaded"] = int(time.time())
    #        loadsmwrh.save_note_dict(hacknotes)
    #        print(f'Result: {req.status_code} {req.reason} - {req.headers}')
    #except Exception as xerr:
    #    print(str(xerr))
    #    traceback.print_exc()
    #    pass
    #

    print('Patch was successful!  ROM Location:')
    print(os.path.join(path_prefix,'rom', romfilename))
    found = True
    return os.path.join(path_prefix,'rom', romfilename)

if __name__ == '__main__':
    ccrom = False
    if 'CCROM' in os.environ and os.environ['CCROM']:
        ccrom = True
    if len(sys.argv) > 2 and  re.search('ccrom', ' '.join(sys.argv[2:]).lower()):
        ccrom = True
    if len(sys.argv) < 1:
        sys.argv.append('repatch')
    else:
        sys.argv[0]='repatch'
    rp_result = repatch_url_function(sys.argv,ccrom=ccrom)
    if len(sys.argv) > 2 and re.search('sendtosnes', ' '.join(sys.argv[2:]).lower()):
       if rp_result:
           print(str(rp_result))
           sendresult = pb_sendtosnes.sendtosnes_function(['launch1', rp_result, 'launch1'])
           if not(sendresult):
               print('ERR: Error sending to snes')
           else:
               print('Game sent to snes')
    
    
 
