import os
import re
import subprocess

for de in os.listdir("."):
  m = re.match('(.*)\.bps', de)
  if m:
      print(m.group(1))
      patchfile = m.group(1) + '.bps'
      destination = m.group(1) + '.sfc'
      sfc7z = m.group(1) + '.7z'
      subprocess.run(["flips", "--apply", patchfile, "/usr/local/share/smw.sfc", destination], check=True)
      subprocess.run(["7z", "a", "-mx=9", sfc7z, destination], check=True)


