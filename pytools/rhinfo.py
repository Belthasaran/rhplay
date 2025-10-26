#!/usr/bin/python3

from loadsmwrh import *
import os
import sys
import json

if 'FILENAME' in os.environ:
   hacklist = get_hacklist_data(filename=os.environ['FILENAME'])
else:
   hacklist = get_hacklist_data()

if len(sys.argv)<=1:
   print('Usage: ' + sys.argv[0] + ' hackid ')
if len(sys.argv)==2:
    hrecord = get_hack_info( sys.argv[1] )
    #print(",")
    print(json.dumps(hrecord, indent=4, sort_keys=True))
if len(sys.argv)>2:
    hlist = []
    for ientry in sys.argv[1:]:
        he= get_hack_info(ientry)
        hlist = hlist+[he]
        print(",")
        print(json.dumps(he, indent=4, sort_keys=True))
    #print(json.dumps(hlist, indent=4, sort_keys=True))

