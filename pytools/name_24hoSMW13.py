import sys
import os
import re
for de in os.listdir("."):
    m = re.match(r'24hoSMW13_(\d+)_([^\.]+).bps',de)
    if m:
       entrynum = m.group(1)
       name = m.group(2)
       ne='24hoSMW13-2026 Level Design Contest '+str(entrynum)+' by '+name+' [2026-04-02] (SMW Hack).bps'
       print('rename '+str(de)+' '+str(ne))
       os.rename(de, ne)


