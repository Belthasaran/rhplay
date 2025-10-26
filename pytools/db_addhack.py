# Copyright C Belthasar 2023 All Rights Reserved

from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys
import loadsmwrh

def addhack_function(args):
    if not loadsmwrh.path_rerequisites():
        return None

    hackid = (args[1])
    filename = os.path.join("hacks", "") + str(hackid) + ""
    force = False

    if len(args) < 3 or not args[2]=='force':
        force = False
    else:
        force = True

    hacklist = loadsmwrh.get_hacklist_data(filename=None)
    #
    for i in range(len(hacklist)): 
         if type(hacklist[i]) == list:
             hacklist[i] = hacklist[i][0]
         #print('' + str(i) + ' ::  ' + str(hacklist[i]))
         if hacklist[i]['id'] == hackid:
             if force == True:
                 print('NOTE: Hack id '+hackid+' already exists in dataset, and database entry will be overwritten')
             else:
                 print('Skip Hack id '+hackid+' already in database')
                 #
             del hacklist[i]
             break
    for i in range(len(hacklist)):
         if hacklist[i]['id'] == hackid:
             print('NOTE: Hack id '+hackid+' already exists in dataset, and database entry will be overwritten')
             del hacklist[i]
             break

    f1 = open(filename, 'r')
    #hackinfo  = loadsmwrh.get_hack_info( str(hackid)  )
    data = f1.read()
    f1.close()
    addhackinfo = json.loads(data)
    if not('name' in addhackinfo):
        print('ERROR: ' + str(hackid) + ' - name attribute not found')
        return
    if not('id' in addhackinfo):
        print('ERROR: ' + str(hackid) + ' - id attribute not found')
        return
    if not('author' in addhackinfo):
        print('ERROR: ' + str(hackid) + ' - author attribute not found')
        return
    if not('description' in addhackinfo):
        print('ERROR: ' + str(hackid) + ' - description attribute not found')
        return
    if not('patchblob1_name' in addhackinfo):
        print('ERROR: ' + str(hackid) + ' - patchblob1_name attribute not found')
        return
    if not('patchblob1_sha224' in addhackinfo):
        print('ERROR: ' + str(hackid) + ' - patchblob1_sha224 attribute not found')
        return
    if not(type(addhackinfo) == list):
        addhackinfo = [addhackinfo]
    hacklist = hacklist + addhackinfo
    savepath = loadsmwrh.rhmd_path()
    loadsmwrh.save_hacklist_data(hacklist, filename=savepath, docompress=True)

if __name__ == '__main__':
    addhack_function(sys.argv)
    
    
    
    
 
