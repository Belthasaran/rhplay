import json
import os
import sys
import uuid
import py7zr
from datetime import datetime, timezone
import sys


gameid = sys.argv[1]
current_time_utc = datetime.now(timezone.utc)
formatted_time = current_time_utc.isoformat(timespec='milliseconds')
formatted_time = formatted_time.replace('+00:00', 'Z')

f=open('games/'+gameid+'.json','r')
j=json.load(f)
f.close()
archive_name='upload/waiting_'+gameid+'.7z'

with py7zr.SevenZipFile(archive_name, 'w') as archive:
    archive.write('games/'+gameid+'.json')
    for jf in j["json_files"]:
        archive.write('bpsindex/'+jf)
    if "bps_files" in j:		
        for jf in j["bps_files"]:
            archive.write('bps/'+jf)
    if "screenshot_files" in j:		
        for jf in j["screenshot_files"]:
            archive.write('images/'+str(gameid)+'/'+jf)
    #archive.write('games/'+gameid+'.json',  gameid + '.json')



