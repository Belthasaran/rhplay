import sys
import json
import re

for paramval in sys.argv[1:]:
    lmfilter = False
    levelread = False
    if (re.match('.*_lmfilter.json',paramval)):
        lmfilter = True
    if (re.match('.*_levelread.json',paramval)):
        levelread = True

    #print("Filename: %s\n" % sys.argv[1])
    try:
        f = None
        f = open(paramval, 'r')
        if not(levelread or lmfilter): 
            s = json.load(f)
        if lmfilter:
            sv = "{\n" + f.read().rstrip('[\r\n,]') + "]\n}"
            #print(sv)
            s = json.loads(sv)
        if levelread:
            s = json.loads("{\n" + f.read() + "\n}\n")
        f.close()
    except Exception as y:
        print('Failed on ' + paramval + str(y))
    finally:
        if f:
            f.close()

