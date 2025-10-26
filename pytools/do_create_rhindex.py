#!/usr/bin/python
# Create or update a rhindex

import requests
import json
import re
import os
import sys
import time
import random
import base64
import loadsmwrh

hkdict = {}
hkdata = []

if os.path.exists('rhindex.dat'):
   hkdata = loadsmwrh.get_hacklist_data(filename='rhindex.dat')
   for u in range(len(hkdata)):
       hkdict[  hkdata[u]['id']  ] = hkdata[u]
   hkdata = []


rhfiles = os.listdir('hacks')

for  filename in rhfiles:
    if re.match('^[_a-z0-9]+$', filename):
         f = open(os.path.join('hacks',filename), 'r')
         entry = json.load(f)
         f.close()
         if type(entry) == type([]):
             entry = entry[0]
         entry['id'] = str(filename)
         hkdict[ entry['id'] ] = entry
         #hkdata.append(entry)

for idval in hkdict.keys():
     hkdata.append( hkdict[idval] )


loadsmwrh.save_hacklist_data(hkdata, filename='rhindex.dat')







