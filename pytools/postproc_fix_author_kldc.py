import json
import sys
import re

#       ne='SMWC Old-School LDC 2023 Kaizo '+str(entrynum)+' by '+name+' [2023-10-23] (SMW Hack).bps'
sys.exit(0)

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
m=re.match(r'SMWC 72hour Kaizo Level Design Contest (\d+) by ([^\[]+) \[2025-04-12\]', s["sfcsource_filename"])
c=False
if m:
 entrynum = str(m.group(1))
 author = str(m.group(2))
 s["sfcsource_filename"] = 'SMWC 72hour Kaizo #2 Entry '+entrynum+' by '+entrynum+' [2024-12-18] (SMW Hack)  [Kaizo].sfc' 
 s["sfcarchive_filename"] = 'SMWC 72hour Kaizo #2 Entry '+entrynum+' by '+entrynum+' [2024-12-18] (SMW Hack)  [Kaizo].7z' 
 s["sfc_filename_title"] = 'SMWC 72hour Kaizo #2 Entry '+entrynum
 s["7z_filename_title"] = 'SMWC 72hour Kaizo #2 Entry '+entrynum
 s["sfc_filename_author"] = author
 s["7z_filename_author"] = author
 s["sfc_filename_date"] = '2024-12-18'
 s["7z_filename_date"] = '2024-12-18' 
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

