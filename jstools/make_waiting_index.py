import os
import json
import pathlib
import re
import csv

basedir = pathlib.Path(__file__).parent.resolve()
gamesdir = os.path.join(basedir, 'smwc_world','games')

cols = ['moderated','time','date','gameid','name','demo','sa1','collab','author','authors','submitter','combinedtype','length','fields_type','difficulty','warnings','url','section','tags','bps_files','json_files','']
items = {}

with open(os.path.join(basedir,'smwc_world', 'waiting_index.csv'), 'w', newline='') as fw:
    writer = csv.DictWriter(fw, fieldnames=cols)
    writer.writeheader()
    for de in os.listdir(gamesdir):
        if not(re.match(r'.*\.json$', de)):
            continue
        print(de)
        f = open(os.path.join(gamesdir,de), 'r')
        j = json.load(f)
        itemdata = {
           k: j[k]  for k in cols if k in j
        }
        if 'url' in itemdata:
            itemdata["url"] = itemdata["url"].replace('https://www.smwcentral.net/','/')
        writer.writerow(itemdata)
        f.close()


