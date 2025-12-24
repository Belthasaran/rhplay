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

m=re.match('^KLDCX level \d+ by ([^\[]+) \[.*', s["sfcsource_filename"])
c=False
if m:
 if not("sfc_filename_author") in s:
     sys.exit(0)
 if s["sfc_filename_author"]=="Contest Entry":
   s["sfc_filename_author"] = m.group(1)
   c=True
 if s["7z_filename_author"]=="Contest Entry":
    s["7z_filename_author"] = m.group(1)
    c=True
if c:
  f=open(fntemp,'w')
  f.write(json.dumps(s,indent=2))
  f.close()

