#!/usr/bin/python3
# Copyright C Belthasar 2023 All Rights Reserved

import os
import json
import random
import sys
import re
import loadsmwrh
import pb_sendtosnes
import pb_lvlrand
import pb_repatch
typenames = {}

#listfile = open(loadsmwrh.hacklist_path(), 'r')
#hacklist = json.load(listfile)
hacklist = loadsmwrh.get_hacklist_data()
argvstr =  ' '.join(sys.argv[1:])
includeCodes = ['+', '_', 'B', 'G', 'M']
excludeCodes = ['E', 'C', 'X', 'XX', 'Z', 'ZZ', 'V', 'VB', 'U', 'S', 'L', '?', 'O', 'T', 'P']

excludetags  = ['adult content',"sexual contet","epilepsy warning"]
hacklist = list( filter(lambda g: not('tags' in g) or
                                         not(any(x in g["tags"] for x in excludetags) )  , hacklist))
if len(sys.argv) < 2:
    print('Please Specify a Type: ')
    print('Or any for ANY type.')
    typenames['any'] = 1
    for x in hacklist:
        if loadsmwrh.get_pnum(x["id"]):
            typenames['any'] = typenames['any'] + 1
            if not( x["type"] in typenames):
                typenames[ x["type"] ] = 1
            else:
                typenames[ x["type"] ] = typenames[ x["type"] ] + 1
    for x in typenames.keys():
        print(' - %20s   (%d matches)' % ( x, typenames[x]  ))
    sys.exit(1)
    
selection = []
hackdata = {}

for x in hacklist:
     if re.search(argvstr.lower(), x["type"].lower(), re.I) or argvstr=='*' or argvstr.lower()=='any':
         if loadsmwrh.has_pnum( x["id"]  ) :
             pnum_s = loadsmwrh.get_pnum( x["id"] )
             if  (pnum_s and not(pnum_s == '0') 
                  and pnum_s[0].isdigit() and int(pnum_s)):
                 selection = selection + [x["id"]]
                 hackdata[ str(x["id"]) ] = x

selection = [*set(selection)]
logf = open("log.txt","r")
logentries = []
le_byhack = {}
for line in logf.readlines():
    lent = line.strip().split(' ')
    if len(lent) < 7:
        continue
    if lent[6] in excludeCodes:
        continue
    if not(lent[6] in includeCodes):
        continue
    if lent[0] in selection:
        logentries = logentries + [lent]
        if not ( lent[0] in le_byhack ):
            le_byhack[ lent[0] ] = []
        le_byhack[ lent[0] ] = le_byhack[ lent[0] ] + [lent]
logf.close()


exf = open('exclude.dat', 'r')
for line in exf.readlines():
    if len(line)<2:
       continue
    entry = exf.strip().split(' ')
    if entry[1]=='*' or entry[1]=='0' :
        if  entry[0] in selection:
            selection.remove(entry[0])
exf.close()

for u in selection:
     if  not(u in le_byhack):
         selection.remove(u)
      
if len(selection) >= 1 : 
    random.shuffle(selection)
    chosen = selection[0]
    chosenrecord = hackdata[str(chosen)]
    print(str(chosen)  +  '  -  '  + chosenrecord["name"]  )
    pb_lvlrand.randlevel_function(['randomlevel', chosen ])
    #print(json.dumps(chosenrecord, indent=4, sort_keys=True))
    #print('Executing patch operation...')
    #print('       Running repatch.py ' + chosen)
    #romfile = pb_repatch.repatch_function(['repatch', chosen])
    #if romfile:
    #    print('Press [ENTER] to send to SNES')
    #    input()
    #    pb_sendtosnes.sendtosnes_function(['sendtosnes', romfile])
    #
else:
    print('No matches for that type name')
    print('- Try: standard')

    
