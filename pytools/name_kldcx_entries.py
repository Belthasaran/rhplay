import os
import re

for de in os.listdir("."):
   m = re.match('KLDCX_(\d+)_(.*).bps',de)
   if not(m):
       continue
   fromname = de
   toname = 'KLDCX level ' + m.group(1) + ' by ' + m.group(2) + ' [2022-12-08] [Kaizo] (SMW Hack) (Contest Entry).bps'
   toname = " ".join(toname.split(" "))
   print("fromname = "  + fromname)
   print("toname = " + toname + "\n")
   os.rename(fromname,toname)
   

