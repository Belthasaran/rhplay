import os
import time
import json
import random
import sys
import re
import loadsmwrh
import pb_sendtosnes

if os.path.exists('cur_makepage.py'):
    import cur_makepage

import pb_repatch
typenames = {}

#listfile = open(loadsmwrh.hacklist_path(), 'r')
#hacklist = json.load(listfile)
hacklist = loadsmwrh.get_hacklist_data()
argvstr =  ' '.join(sys.argv[1:])

if len(sys.argv) < 2:
    print('Please Specify a Type: ')
    for x in hacklist:
        if True and x["id"]:
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
     if x["demo"]=="Yes":
         continue
     if re.search(argvstr.lower(), x["type"].lower(), re.I):
         selection = selection + [x["id"]]
         hackdata[ str(x["id"]) ] = x


if len(selection) >= 1 : 
    random.shuffle(selection)
    chosen = selection[0]
    chosenrecord = hackdata[str(chosen)]
    print(str(chosen)  +  '  -  '  + chosenrecord["name"]  )
    print(json.dumps(chosenrecord, indent=4, sort_keys=True))
    print('Executing patch operation...')
    print('       Running repatch.py ' + chosen)
    romfile = pb_repatch.repatch_function(['smwrh', chosen])
    if romfile:
        jsonfile = romfile + str('json')
        print('\n\nREADY: %s-%s by %s\n%s\n%s' % (chosen, chosenrecord["name"],
              chosenrecord["authors"],
              chosenrecord["url"], romfile) )
        print('Press [ENTER] to send to SNES')
        input()
        pb_sendtosnes.sendtosnes_function(['sendtosnes', romfile])
        f1 = open( romfile + 'json', 'r')
        jsonlev = json.loads(f1.read())
        jsonlev["chosen"] = str(chosen)
        #jsonlev["chosenlid_hex"] =""
        #jsonlev["patchnum"] = ""
        #jsonlev["chosenlid"] = ""
        jsonlev["tsv1"] = str(time.time())
        jsonlev["method"] = "randomhack"
        jsonlev["rundata"] = ("%s" % argvstr)
        f2 = open('randomsel.json', 'w')
        f2.write(json.dumps(jsonlev))
        f2.close()
        f1.close()
        try:
             cur_makepage.mkpage_function(['makepage'])
        except Exception as xerr:
             print(f'Makepage ERR: f{xerr}')
             pass

else:
    print('No matches for that type name')

    
