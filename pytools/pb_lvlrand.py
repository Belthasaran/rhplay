#!/usr/bin/python3
# Copyright C Belthasar 2023 All Rights Reserved

import os
import json
import random
import sys
import re
import loadsmwrh
import pb_sendtosnes
import pb_repatch
import pb_sendtosnes
import binascii
import time
import asm1
import re
import ast

def lvl_tab():
  return ({
       
  })

def l2rr(x):
    if x < 0x25:
        return (x+0xDC)%0x100
    return x

def l2r(x):
    if x >= 0x25:
        x = (x+0xDC)%0x100
    return x

def l2p(x):
    if x >= 0x25:
        x = x - 0xDC
        x = x - 0x24
        x = x % 0xFF
    return x

def readfileat(pa,addr,le):
   f = open(pa, "rb")
   bufferx = (f.read())
   return bufferx[addr:addr+le]

def randlevel_count(hid):
    includecodes = ['+', '_', 'B', 'G', 'M']
    found = False
    scount = 0
    try:
        f0 = open('pnums.dat','r')
        for line in f0.readlines():
           e0 = line.split(' ')
           if str(hid) == e0[0]:
              found = True
              break
        f0.close()
        if not(found):
           return 0
        f1 = open('log.txt', 'r')
        for line in f1.readlines():
             e0 = line.split(' ')
             if e0[1] == str(hid):
                 if e0[6] in includecodes:
                    scount = scount+1
        f1.close()
        return scount
    except:
         return 0

def randlevel_function(args):
    includecodes = ['+', '_', 'B', 'G', 'M']
    generalexclude = []

    if len(args)<=1:
        print('Please use pb_randomlevel.py to choose a hack')
        print('This module requires a hackid')
        print('Usage: pb_randomlevel hackid')
        sys.exit(1)
    chosen = str(args[1])
    patchnum = 0
    pnumdict = {}
    try:
        f0 = open('pnums.dat', 'r')
        for line in f0.readlines():
           entry = [x for x in line.strip().split(' ') if len(x) > 0]
           print("XXX " + str(entry))
           if len(entry) >= 2 and entry[1][0:].isdigit() :
               pnumdict[ entry[0] ] = int(entry[1])
           elif len(entry) >= 2:
               print('Bad line in pnums: ' + line)
        f0.close()
    except Exception as hhh:
        print(str(hhh))
        pass

    hacklist = loadsmwrh.get_hacklist_data()
    argvstr =  ' '.join(args[1:])
    asar_cmd = ''
    if os.path.exists("bin/asar"):
       asar_cmd = 'bin/asar'
    elif os.path.exists("asar.exe"):
       asar_cmd = 'asar.exe'
    elif os.path.exists("/mnt/c/snesgaming/bin/asar"):
       asar_cmd = '/mnt/c/snesgaming/bin/asar'
    elif os.path.exists("/usr/local/bin/asar"):
       asar_cmd = '/usr/local/bin/asar'
    elif os.path.exists("asar"):
        asar_cmd = os.path.join('.','asar')
    else:
       print('Please put asar or asar.exe and smw.sfc in start directory ' + os.getcwd())
       return None

    if len(args) < 2:
        print('Please Specify A Hackid')
        sys.exit(1)

    #
    # ???Ok.. but what if a certain level requires a different patch
    # from the index?  is  the log.txt entry used ???
    #
    patchspecified = False
    if patchnum == 0:
        if chosen in pnumdict :
            patchnum = pnumdict[ chosen ]
        if len(args) > 3 and args[3][0]=='P':
            patchnum = int(args[3][1:])
            patchspecified = True

    #

    hackdata = {}
    for x in hacklist:
        #print(str(x["id"]) + ' / ' + str(args[1]))
        #if re.search(argvstr.lower(), x["type"].lower(), re.I):
        #    selection = selection + [x["id"]]
        hackdata[ str(x["id"]) ] = x
    chosenrecord = hackdata[str(chosen)]
    print(str(chosen)  +  '  -  '  + chosenrecord["name"]  )
    print(json.dumps(chosenrecord, indent=4, sort_keys=True))
    print('Executing patch operation...')
    print('       Running repatch.py ' + chosen)
    romfile = pb_repatch.repatch_function(['repatch', chosen])
    if not romfile:
        print('Repatch failed')
        return None
    hackfn = romfile
    hackfp = hackfn
    #hackfp = "rom/" + hackfn
    smwfp = "smw.sfc"

    overworld = readfileat(hackfp, loadsmwrh.get_pc_address(0x05D608,0) , 96)
    overworldset = []
    overworld2 = readfileat(hackfp, loadsmwrh.get_pc_address(0x04D678,0), 96)
    overworldset2 = []

    # stubbed out scan code

    lidlist = []
    lidlistr = list(lidlist)
    lidlistr = [*set(lidlistr)]
    lidlistr2 = [x for x in lidlist if l2p(x) in overworldset2]
    lidlistr2.sort()

    rlist = []
    rlist2 = []
    try: 
      xy = open('owdump.txt', 'r')
      for line in xy.readlines():
          entry = [x for x in line.strip().split(' ') if len(x) >= 3]
          if len(entry) > 3 and entry[0] == str(chosen): 
              rlist = ast.literal_eval('[' + re.sub(',$', '', entry[3]) +  ']')
              rlist2 = [x[2] for x in rlist]
              print(str(lidlistr2))
              print("RLIST2 = "+str(rlist2))
    except Exception as err:
         print('ERR:' + str(err))
    rlist2 = [*set(rlist2)]  # Reduce rlist2 down to uniques
    lidlist = rlist2
    lidlistr2 = rlist2
    lidlistr2 = [*set(lidlistr2)] # Also reduce our augmented list down
    codedict =  {  }

    aaaa = open('log.txt', 'r')
    for line in aaaa.readlines():
        entry = [x for x in line.strip().split(' ') if len(x) > 0]
        if entry[0] == '#':
            continue
        if not(entry[1] == str(chosen)):
            continue
        if (entry[0] == '>'
            and entry[1] == str(chosen) and not( entry[4] in lidlistr2)
            and not(entry[4] in generalexclude)
            and entry[6] in includecodes):
            lidlistr2 = lidlistr2 + [ int(entry[4]) ]
        if len(entry)>2 and  entry[1] == str(chosen):
            if int(entry[2],base=16) in lidlistr2:
                etype = entry[0]
                elnum = int(entry[2],base=16)
                epnum = int(entry[3])
                elnum2 = int(entry[4],base=10)
                if entry[5] == '_':
                    elts = 0
                else:
                    elts = int(entry[5])
                elcode = entry[6]
                eldiff = 0
                if len(entry) > 7:
                   eldiff = int(entry[7],base=16)
                elnote = ""
                if len(entry)>8:
                    elnote=entry[8]
                if not(elcode in codedict):
                    codedict[elcode] = []
                xtraent = list([elnum,epnum,eldiff,elnote])
                codedict[elcode] = codedict[elcode] + [xtraent]
                if epnum==0 and ('X' in elcode or 'Z' in elcode):
                    generalexclude = generalexclude + [entry[2]]
                    lidlistr2.remove(int(entry[2], base=16))
    aaaa.close()
    print('codedict = ' + str(codedict))

    fallbackpatch = {}
    okpatches = {}
    badpatches = {}
    excludeCodes = ['E', 'C', 'X', 'XX', 'Z', 'ZZ', 'V', 'VB', 'U', 'S', 'L', '?', 'O', 'T',
                    'P']
    exfound = False
    for r in lidlistr2:
        badpatches[r] = []
        okpatches[r] = []

    for ec in includecodes:
         if not(ec in codedict):
             continue
         for ek in range(len(codedict[ec])):
             fallbackpatch[ codedict[ec][ek][0] ] = codedict[ec][ek][1]
             okpatches[ codedict[ec][ek][0] ] = okpatches[ codedict[ec][ek][0] ] + [ codedict[ec][ek][1]  ]
             if not( codedict[ec][ek][0] in lidlist):
                 lidlistr2 = lidlistr2 + [ int(codedict[ec][ek][0])  ]
                 lidlistr2 = [*set(lidlistr2)]
         
    for ec in excludeCodes:
        if ec in codedict:
             for ek in range(len(codedict[ec])):
                     if (codedict[ec][ek][0] in lidlistr2 and
                         codedict[ec][ek][1] == patchnum):
                         badpatches[ codedict[ec][ek][0] ] = (
                             badpatches[ codedict[ec][ek][0] ] +
                             [  codedict[ec][ek][1]  ])
                
                         if not( codedict[ec][ek][0] in fallbackpatch ):
                             lidlistr2.remove(codedict[ec][ek][0])
                         pass

    # Take out rooms we don't know how to patch in(only found patchid is 0)
    for u in lidlistr2:
        if patchspecified == False and patchnum == 0 and not(u in fallbackpatch):
             lidlistr2.remove(u)
        elif patchspecified == False and u in badpatches and patchnum in badpatches[u]:
            if not(u in fallbackpatch):
                lidlistr2.remove(u)
                     
    #generalExclude = [22,25,26,30,52,53,54,59]
    exf = open('exclude.dat', 'r')
    for line in exf.readlines():
        if len(line)<2:
            continue
        entry = exf.strip().split(' ')
        if entry[0]==chosen :
            generalexclude = generalexclude + entry[1]
    exf.close()
         
    for x in generalexclude:
        if x in lidlistr2:
            lidlistr2.remove(x)
        
    lidlistr2.sort()
    print("lidlistr2 = " + str(lidlistr2))
    random.shuffle(lidlistr2)
    randomlid = lidlistr2[0]

    xg = open(hackfp, "rb")
    wholefile = bytearray(xg.read())
    xg.close()
    #print('Debug3: ' + str(lidlistr))
    u = 0
    #wholefile[0x0007F281] = 0x74

    chosenlid = None
    if args[2:]:
        chosenlid = int(args[2]) ##
        pass
    else:
        chosenlid = int(randomlid)
        print("chosenlid = " + str(chosenlid))

    if chosenlid in badpatches and  patchnum in badpatches[ chosenlid]:
        patchnum = fallbackpatch[ chosenlid]

    #if chosenlid < 0x25 #| chosenlid < 0x100:
    #    pass
    #else:
    #    chosenlid = chosenlid - 0xDC
    #    if chosenlid < 0:
    #        chosenlid += 0xFF
    #if chosenlid >= 0x25:
    #    chosenlid = (chosenlid+0xDC)%0x100  #|% 0xFE
    #elif chosenlid < 0x24:
    #    chosenlid = chosenlid + 0xDC 

    asmfilename = os.path.join("temp", 'randomlevel_' + ('%s_%.4X'% (str(chosen),chosenlid)) + 'P' + str(patchnum) + '.asm')
    f1 = open(asmfilename + '.new', 'w')
    anumber = ( '%.4X' % (chosenlid)    )
    #if patchnum == 4:
    #    anumber = ( '%.2X' % (chosenlid)    )

    f1.write('!anumber = $' + str(anumber))

    print('pnum = ' + str(patchnum))
    f1.write( asm1.get_a_patch(patchnum,chosenlid) )
    f1.close()
    os.replace(asmfilename + ".new", asmfilename)
    romfile = pb_repatch.repatch_function(['rand' + str(anumber), chosen])
    #asar_cmd = 'bin/asar'
    print(asar_cmd + " " + asmfilename +  "  " + romfile)
    os.system(asar_cmd + " " + asmfilename + " " + romfile)
    print('READY with hackid=' + chosen + '  lid=' + str(chosenlid) + ('(%X)' % chosenlid)  + ' pnum=' + str(patchnum))
    f3 = open('log_b.txt','a')
    tsv1 = int(time.time())
    f3.write("> %s %X %d %d %d ? 0x0\n" % (chosen, chosenlid, patchnum, chosenlid, int(tsv1)))
    f3.close()
    print('Press [ENTER] to send to SNES')
    #input()
    pb_sendtosnes.sendtosnes_function(['sendtosnes', romfile])
    print(str(chosen)  +  '  -  '  + chosenrecord["name"]  )
    print(" author: " + str(chosenrecord["author"]))
    print("   (chosen=%s,levelid=%s (hex $%X),pnum=%s,ts=%s)" % ( chosen, chosenlid,int(chosenlid), patchnum, int(tsv1)  ))
    time.sleep(10) #SL 10
    #os.system("bash rlaunch.sh " + romfile)
    #os.system("bash llaunch_rand.sh " + romfile)
    ####os.system(flips_cmd+" --apply " + os.path.join('patch', shake1) +"  smw.sfc " + os.path.join('temp', 'result'))
    az = romfile.replace( os.path.join('rom', ''), '' )
    return romfile.replace( '.sfc', '')


if __name__ == '__main__':
    randlevel_function(sys.argv)
    


