import json
import sys
import re

if len(sys.argv)<2:
  print('Usage: fix_author_kldcx.py FILENAME')
  sys.exit(1)
fn=sys.argv[1]
fntemp=fn+'.temp'
f=open(fn,'r')
s=json.load(f)
f.close()

if not("sfcsource_filename" in s):
    sys.exit(0)

#m=re.match('^SMWC QLDC2025 Standard.* by ([^\[]+)', s["sfcsource_filename"])
m=re.match(r'SMWC OLDC .. \w+ Entry .. by ([^\[]+)', s["sfcsource_filename"])
#           "SMWC OLDC #4 Kaizo Entry 07 by LouisDoucet [Kaizo] [2025-04-12] (SMW Hack).sfc",

            #SMWC OLDC Standard #4 Entry 23 by DentalFloss [Standard] [2025-04-12] (SMW Hack).7z
c=False
if m:
 print("M")
 if not("sfc_filename_author" in s):
     sys.exit(0)
 n = re.match(r'([^\[]+) \[', s["sfc_filename_author"])
 if n:
     s["sfc_filename_author"] = n.group(1)
     s["7z_filename_author"] = s["sfc_filename_author"]
     c=True
if c:
  f=open(fntemp,'w')
  f.write(json.dumps(s,indent=2))
  f.close()

