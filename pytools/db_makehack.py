# Copyright C Belthasar 2023 All Rights Reserved

from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys
import loadsmwrh
import time

def makehack_function(args):
    if not loadsmwrh.path_rerequisites():
        return None
    f0 = open("taglist.json", "r")
    taglist = json.load(f0)
    f0.close()

    if len(args) < 2:
        print('Please use db_makehack.py <Unique ID>')
        print('For SMW-Central hacks please use th SMWc ID number')
        print('If you dont have an ID, then use  python3 tempid.py FILENAME')
        print('Tempid.py will create a temporary ID based on a timestamp and part of a file hash')
        return None

    hackid = (args[1])
    filename = os.path.join("hacks", "") + str(hackid) + ""
    force = False

    if len(args) < 3 or not args[2]=='force':
        force = False
    else:
        force = True

    hacklist = loadsmwrh.get_hacklist_data(filename=None)
    if os.path.exists(filename):
        print("Oh.. " + str(filename) + " filename already exists.")
        return
    #
    for i in range(len(hacklist)): 
         if type(hacklist[i]) == list:
             hacklist[i] = hacklist[i][0]
         #print('' + str(i) + ' ::  ' + str(hacklist[i]))
         if hacklist[i]['id'] == hackid:
             if force == True:
                 print('NOTE: Hack id '+hackid+' already exists in dataset, but force chosen')
             else:
                 print('Um.. Hack id '+hackid+' already in database')
                 return
                 #
             del hacklist[i]
             break

    knowntypes = ["Standard: Hard", "Standard: Easy", "Standard: Very Hard", "Standard: Normal",
                  "Tool-Assisted: Kaizo", "Kaizo: Intermediate", "Tool-Assisted: Pit", "Kaizo: Expert",
                  "Kaizo: Beginner", "Misc.: Troll", "Standard: Very Hard, Kaizo: Expert",
                  "Kaizo: Intermediate, Standard: Very Hard", "Standard: Hard, Kaizo: Intermediate",
                  "Standard: Hard, Misc.: Troll", "Standard: Hard, Kaizo: Beginner", "Standard: Very Hard, Kaizo: Beginner", "Other" ]

    if not(re.match("^[a-zA-Z]+_[_a-zA-Z0-9]+$", str(hackid))):
        print('Err: Please use unique alphanumeric ID starting with a word prefix and underscore, example: smwc_abc123')
        return

    hinfo =  {}
    hinfo["id"] = str(hackid)
    hinfo["name"] = input('Hack name:')
    hinfo["added"] = time.strftime("%y-%m-%d")
    hinfo["authors"] = input("Enter author names:")  
    hinfo["author"] = hinfo["authors"]
    hinfo["description"] = input("Description:")
    while True:
        hinfo["length"] = input("Length (example: \"5 exits\"), or unknown:")
        if re.match("^\d+ exits$", hinfo["length"]) or hinfo["length"]=='unknown':
            break
        else:
            print('Please list using the format shown above')
    hinfo["rating"] = "0.0"
    hinfo["type"] = ""
    while  hinfo["type"] == "":
         for kt in range(len(knowntypes)):
             print("%d.  %s" % ( kt+1, knowntypes[kt]  ))
         htype = input('Please choose type from above list: ')
         for kt in range(len(knowntypes)):
             if  htype == str(kt+1) or  htype == knowntypes[kt]:
                 htype = knowntypes[kt]
                 hinfo["type"] = htype
                 
    while True:
        demoval = input("Is the hack a demo?  Yes or No: ").lower()
        if demoval == 'yes' or demoval == 'y':
            hinfo["demo"] = "Yes"
            break
        elif demoval == 'no' or demoval == 'n':
            hinfo["demo"] = "No"
            break
        elif demoval:
            print('Invalid choice, try again.')
        else:
            return

    ii=0
    for w in taglist.keys():
        if taglist[w] < 4:
            continue
        print(" %20s" % w, end="")
        ii = ii + 1
        if ii % 3 == 0 :
            print('')
    print('')
    #print(str(taglist))
    hinfo["tags"] = [ ]
    tagset = {}
    print('Specify tags')
    while True:
        tagcom = input('Enter a tag to add, or -tag to remove a tag, +add to create a new tag, list to display common tags, or done to accept: ')
        if len(tagcom) < 1:
            continue
        if tagcom[0] == '+': 
           tagset[ tagcom[1:]  ] = 1
        elif tagcom[0] == '-':
           if tagcom[1:] in tagset:
               del tagset[ tagcom[1:] ]
        elif tagcom == 'list':
           ii=0
           for w in taglist.keys():
               if taglist[w] < 4:
                   continue
               print(" %20s" % w, end="")
               ii = ii + 1
               if ii % 3 == 0 :
                   print('')
           print('')
        elif len(tagcom) > 0:
            if (tagcom in taglist.keys()):
                tagset[tagcom] = 1
            else:
                print('That ' + tagcom + ' does not seem to be in the list of known tags -  Try +tag ')
        if tagcom == 'done':
            break
        print('Selected tags = ' + str( list(tagset.keys())  ))
        
    
    hinfo["tags_href"] = ""
    hinfo["author_href"] = ""
    hinfo["author_href"] = input('Enter optional author URL (or leave blank): ')
    hinfo["url"] = input('Enter URL for information about the hack (or leave blank): ')
    hinfo["name_href"] = input('Enter direct URL to the raw Zip file (or leave blank): ')




    makehackinfo = hinfo
    print(json.dumps(hinfo))


    #f1 = open(filename, 'r')
    #hackinfo  = loadsmwrh.get_hack_info( str(hackid)  )
    #data = f1.read()
    #f1.close()
    #makehackinfo = json.loads(data)
    if not('name' in makehackinfo):
        print('ERROR: ' + str(hackid) + ' - name attribute not found')
        return
    if not('id' in makehackinfo):
        print('ERROR: ' + str(hackid) + ' - id attribute not found')
        return
    if not('author' in makehackinfo):
        print('ERROR: ' + str(hackid) + ' - author attribute not found')
        return
    if not('description' in makehackinfo):
        print('ERROR: ' + str(hackid) + ' - description attribute not found')
        return
    print('Writing json output to ' + str(filename) + '..')
    f1 = open(filename, 'w')
    f1.write(json.dumps(makehackinfo))
    f1.close()
    print('Ok.  Next step should be to copy your zip file to zips/'+filename)
    print('Then run the next steps:')
    print('python3 mkblob.py '+filename)
    print('python3 db_addhack.py '+filename)


    return
    #if not('patchblob1_name' in makehackinfo):
    #    print('ERROR: ' + str(hackid) + ' - patchblob1_name attribute not found')
    #    return
    #if not('patchblob1_sha224' in makehackinfo):
    #    print('ERROR: ' + str(hackid) + ' - patchblob1_sha224 attribute not found')
    #    return
    #if not(type(makehackinfo) == list):
    #    makehackinfo = [addhackinfo]
    #hacklist = hacklist + makehackinfo
    #savepath = loadsmwrh.rhmd_path()
    #loadsmwrh.save_hacklist_data(hacklist, filename=savepath, docompress=True)

if __name__ == '__main__':
    makehack_function(sys.argv)
    
    
    
    
 
