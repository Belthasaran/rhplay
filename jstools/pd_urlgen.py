#
#  This is a PD thing to convert the Path outputs from the API of PD
#  to full URLs
#  
#
#
import json
import base64
import re
f=open('flisting.json','r')
jsa=json.load(f)
cf = jsa["children"]

for ce in cf:
    m = re.match(r'/[^/]+\/bps7z\/bps(\w*)_(\w+).7z', ce['path'])
    if m:
        url = 'https://pixeldrain.com/api/filesystem/' + ce['id']
        burl = base64.b64encode(url.encode("utf-8")).decode('utf-8')
        print("bps%s_%s.7z %s\n" % ( m.group(1), m.group(2), burl ))

