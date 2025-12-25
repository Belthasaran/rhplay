import os
import sys
import re

for de in os.listdir("."):
    m = re.match('OLDC4_Standard_entry_(\d+)_([^.]+)\.bps',de)
    if m:
       entrynum = m.group(1)
       name = m.group(2)
       os.rename(de, 'SMWC OLDC Standard #4 Entry '+str(entrynum)+' by '+name+' [Standard] [2025-04-12] (SMW Hack).bps')
    m = re.match('OLDC4_Kaizo_entry_(\d+)_([^.]+)\.bps',de)
    if m:
       entrynum = m.group(1)
       name = m.group(2)
       os.rename(de, 'SMWC OLDC #4 Kaizo Entry '+str(entrynum)+' by '+name+' [Kaizo] [2025-04-12] (SMW Hack).bps')


