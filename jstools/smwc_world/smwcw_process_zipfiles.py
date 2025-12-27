import os
import sys
import re
import json
import zipfile

sys.exit(0)

# Processing failed for gameid#25259  ERR: Error: File 'Extra.zip' is encrypted, password required for extraction
# Processing failed for gameid#26356  ERR: Error: File 'Extra/Extra.zip' is encrypted, password required for extraction
# Processing failed for gameid#25259  ERR: Error: File 'Extra.zip' is encrypted, password required for extraction


for de in os.listdir("."):
  m = re.match(r'^([0-9]+).json', de)
  if m:
      gameid = m.group(1)
      f = open(de, 'r')
      j = json.load(f)
      f.close()
      for b0 in j["json_files"]:
          try:
              b = b0.split('.')[0]
              prefix = b[0:2]
              if not(os.path.isdir(prefix)):
                  os.mkdir(prefix)
              if not(os.path.isdir(prefix + '/' + b)):
                  os.mkdir(prefix + '/' + b)
              zf = zipfile.ZipFile('../zips/' + gameid + '.zip')
              for zentry in zf.namelist():
                  if re.match(r'.*.bps', zentry.lower()):
                       continue
                  df = prefix + '/' + b + '/' + re.sub(r'[^a-zA-Z0-9\.]', '_', zentry)
                  df = df.replace('..', '__')
                  if re.findall(r'\.\.', df):
                       continue
                  try:
                       zd = zf.open(zentry, 'r')
                       of = open(df + 'tmpfile', 'wb')
                       of.write(zd.read())
                       zd.close()
                       of.close()
                       os.rename(df + 'tmpfile', df)
                  except Exception as xerr:
                       raise Exception('Error: ' + str(xerr))
          except Exception as xerr2:
              print('Processing failed for gameid#'+str(gameid) + '  ERR: ' + str(xerr2))




