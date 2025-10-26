from zipfile import ZipFile
import re
import hashlib
import base64
import os
import os
import json
import sys
import loadsmwrh
from compress import Compressor

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

def mkblob_function(args):
    filename = os.path.join("temp","in.zip")
    
    hackid = (args[1])
    filename = os.path.join("zips", "") + str(hackid) + ".zip"
    
    fr = open(os.path.join('hacks', str(hackid) ))
    hackinfo = json.load(fr)
    fr.close()
 
    if ('patchblob1_name' in hackinfo):
        print('ERROR: ' + str(hackid) + ' - patchblob1 already defined')
        return   
      
    with ZipFile(filename, 'r') as zip:
        found = False
        for info in zip.infolist():
            if re.match('Espa', info.filename) :
                continue
            if re.match('.*\.bps', info.filename) or info.filename=='CrowdControlVanilla.ips' :
                print(info.filename)
                patdata = zip.read(info)
                shake1 = (base64.b64encode(hashlib.shake_128(patdata).digest(24), b"_-")).decode('latin1')
                sha1 = (hashlib.sha1(patdata).hexdigest())
                xsha224 = hashlib.sha224(patdata).hexdigest()
    
                f1 = open(os.path.join("temp",  xsha224) + ".new" , "wb")
                f1.write(patdata)
                f1.close()
                os.replace(os.path.join("temp", xsha224) + ".new", os.path.join("patch", shake1))
                hackinfo["patch"] = os.path.join("patch", shake1)
                wslflips = "/mnt/c/snesgaming/lbin/flips"
                if os.path.exists(wslflips):
                    os.system(wslflips+" --apply " + os.path.join('patch', shake1) +"  smw.sfc " + os.path.join('temp', 'result'))
                else:
                    os.system("flips --apply " + os.path.join('patch', shake1) +"  smw.sfc " + os.path.join('temp', 'result'))
                #data = bytearray()
                #with open(os.path.join("temp", "result"), "rb") as patched:
                #    data += patched.read(1)
                resultf = open(os.path.join("temp", "result"), "rb")
                romdata = resultf.read()
                resultf.close()
    
                shake1_patched = (base64.b64encode(hashlib.shake_128(romdata).digest(24), b"_-")).decode('latin1')
                sha1_patched = (hashlib.sha1(romdata).hexdigest())
                xsha224_patched = hashlib.sha224(romdata).hexdigest()
    
                romfilename = hackinfo["id"] + "_" + shake1_patched  + ".sfc"
                f0 = open(os.path.join("rom", romfilename) + ".new", "wb")
                f0.write(romdata)
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


                comp = Compressor()
                comp.use_lzma()
                comp_patdata = comp.compress(patdata)
                comp_patdata_sha224 = hashlib.sha224(comp_patdata).hexdigest()


                ##
                password = bytes(xsha224, 'ascii')
                salt = os.urandom(16)
                kdf = PBKDF2HMAC( algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000, )
                key = base64.urlsafe_b64encode(kdf.derive(password))
                frn = Fernet(key)
                frndata = frn.encrypt(comp_patdata)

                comp = Compressor()
                comp.use_lzma()
                comp_frndata = comp.compress(frndata)
                frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()

                #
                blob1_name = "pblob_" + hackinfo["id"] + "_" + frn_sha224[0:10]
                blob1_path = os.path.join("blobs", blob1_name)
                blob1f = open(blob1_path + ".new", "wb")
                blob1f.write(comp_frndata)
                blob1f.close()
                os.replace( blob1_path + ".new", blob1_path )

                hackinfo["patchblob1_name"] = blob1_name
                hackinfo["patchblob1_key"] = base64.urlsafe_b64encode(key).decode('ascii')
                hackinfo["patchblob1_sha224"] = frn_sha224
                #hackinfo["patchblob1_salt"] = str(salt)

                comp = Compressor()
                comp.use_lzma()
                #comp_frndata = comp.compress(frndata)

                baseromf = open("smw.sfc", "rb")
                baseromdata = baseromf.read()
                baseromf.close()
                comp_romdata = comp.compress(romdata)

                password = bytes( hashlib.sha224( baseromdata + bytes(xsha224, 'ascii')  ).hexdigest(), 'ascii')

                hackinfo["romblob_salt"] = (base64.urlsafe_b64encode(salt)).decode('ascii')
                kdf = PBKDF2HMAC( algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000, )
                key = base64.urlsafe_b64encode(kdf.derive(password))
                frndata = frn.encrypt(comp_romdata)

                comp = Compressor()
                comp.use_lzma()
                comp_frndata = comp.compress(frndata)
                frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()
                romblob_name = "rblob_" + hackinfo["id"] + "_" + frn_sha224[0:10]
                romblob_path = os.path.join("blobs", romblob_name)
                romblobf = open(romblob_path + ".new", "wb")
                romblobf.write(comp_frndata)
                romblobf.close()
                os.replace( romblob_path + ".new", romblob_path )
                hackinfo["romblob_name"] = romblob_name



                print("::: " + str(hackinfo))
                f2 = open(os.path.join("hacks", hackinfo["id"])  + ".new", "w")
                f2.write( json.dumps(hackinfo) + "\n" )
                f2.close()
                os.replace(os.path.join("hacks", hackinfo["id"]) + "", os.path.join("hacks", hackinfo["id"])  + ".original")
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
    mkblob_function(sys.argv)
    
    
    
    
 
