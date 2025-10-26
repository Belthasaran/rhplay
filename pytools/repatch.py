# Copyright C Belthasar 2023 All Rights Reserved

from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys

def repatch_function(args):
    filename = os.path.join("temp","in.zip")
    
    hackid = int(args[1])
    filename = os.path.join("zips", "") + str(hackid) + ".zip"
    
    fr = open(os.path.join('hacks', str(hackid) ))
    hackinfo = json.load(fr)
    fr.close()
    
      
    with ZipFile(filename, 'r') as zip:
        found = False
        for info in zip.infolist():
            if re.match('Espa', info.filename) :
                continue
            if re.match('.*\.bps', info.filename) :
                print(info.filename)
                data = zip.read(info)
                shake1 = (base64.b64encode(hashlib.shake_128(data).digest(24), b"_-")).decode('latin1')
                sha1 = (hashlib.sha1(data).hexdigest())
                xsha224 = hashlib.sha224(data).hexdigest()
    
                f1 = open(os.path.join("temp",  xsha224) + ".new" , "wb")
                f1.write(data)
                f1.close()
                os.replace(os.path.join("temp", xsha224) + ".new", os.path.join("patch", shake1))
                hackinfo["patch"] = os.path.join("patch", shake1)
                os.system("flips --apply " + os.path.join('patch', shake1) +"  smw.sfc " + os.path.join('temp', 'result'))
                #data = bytearray()
                #with open(os.path.join("temp", "result"), "rb") as patched:
                #    data += patched.read(1)
                resultf = open(os.path.join("temp", "result"), "rb")
                data = resultf.read()
                resultf.close()
    
                shake1_patched = (base64.b64encode(hashlib.shake_128(data).digest(24), b"_-")).decode('latin1')
                sha1_patched = (hashlib.sha1(data).hexdigest())
                xsha224_patched = hashlib.sha224(data).hexdigest()
    
                romfilename = hackinfo["id"] + "_" + shake1_patched  + ".sfc"
                f0 = open(os.path.join("rom", romfilename) + ".new", "wb")
                f0.write(data)
                f0.close()
                os.replace(os.path.join("rom", romfilename) + ".new", os.path.join("rom", romfilename))
    
                hackinfo["pat_sha224"] = xsha224
                hackinfo["pat_sha1"] = sha1
                hackinfo["pat_shake_128"] = shake1
                hackinfo["result_sha224"] = xsha224_patched
                hackinfo["result_sha1"] = sha1_patched
                hackinfo["result_shake1"] = shake1_patched
                hackinfo["rom"] = os.path.join("rom",  romfilename)
                f2 = open(os.path.join("pat_meta",  shake1) + ".new", "w")
                f2.write( json.dumps(hackinfo) + "\n" )
                f2.close()
                os.replace(os.path.join("pat_meta", shake1) + ".new", os.path.join("pat_meta", shake1) + "")
    
                f2 = open(os.path.join("rom_meta", shake1_patched) + ".new", "w")
                f2.write( json.dumps(hackinfo) + "\n" )
                f2.close()
                os.replace(os.path.join("rom_meta", shake1_patched) + ".new", os.path.join("rom_meta", shake1_patched) + "")
    
    
                f2 = open(os.path.join("hacks", hackinfo["id"])  + ".new", "w")
                f2.write( json.dumps(hackinfo) + "\n" )
                f2.close()
                os.replace(os.path.join("hacks", hackinfo["id"])  + ".new", os.path.join("hacks", hackinfo["id"])  + "")

                print(os.path.join('rom', romfilename))
                found = True
                return os.path.join('rom', romfilename)
                break
        #
        if found == False:
            print('ERROR: No BPS found')
    
    
    
        #zip.printdir()
     

if __name__ == '__main__':
    repatch_function(sys.argv)
    
    
    
    
 
