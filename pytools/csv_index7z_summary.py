#
# To be run from inside index7z  subfolder to create  CSV summary
# save to index7z.csv
#
import re
import os
import json
import csv
import dateutil.parser
import sys

writer = csv.writer(sys.stdout)
writer.writerow(['json','filecode','sfc_rom_sha1_hash','sfc_rom_sha256_hash','gameid','url','download_url','name','gamedate','author','authors','index7z_name','indexbps_name'])

for de in os.listdir("."):
    m = re.match(r'([^.]+)\.json',de)
    if m:
         hashcode = m.group(1)
         f = open(de, 'r')
         j = json.load(f)
         f.close()
         gameid = None
         url = None
         download_url = None
         sfc_rom_sha256_hash = None
         sfc_rom_sha1_hash = None
         name = None
         author = None
         authors = None		 
         gamedate = None
         index7z_name = None
         indexbps_name = None
         if 'indexbps_name' in j:
             indexbps_name = j['indexbps_name']
         if 'index7z_name' in j:
             index7z_name = j['index7z_name']
         if 'sfc_rom_sha256_hash' in j:
             sfc_rom_sha256_hash = j['sfc_rom_sha256_hash']
         if 'sfc_rom_sha1_hash' in j:
             sfc_rom_sha1_hash = j['sfc_rom_sha1_hash']
         if 'gameversion' in j and 'name' in j['gameversion']:
              if not(name):
                   name = j['gameversion']['name']
         if 'sfc_filename_title' in j:
              if not(name):
                   name = j['sfc_filename_title']
         if 'gameversion' in j and 'added' in j['gameversion']:
              if not(gamedate) and j['gameversion']['added']:
                   dto = dateutil.parser.parse(j['gameversion']['added'])
                   gamedate = dto.strftime("%Y-%m-%d")
         if 'gameversion' in j and 'date' in j['gameversion']:
              if not(gamedate) and j['gameversion']['date']:
                   dto = dateutil.parser.parse(j['gameversion']['date'])
                   gamedate = dto.strftime("%Y-%m-%d")
         if 'sfc_filename_date' in j:
              if not(gamedate):
                   gamedate = j['sfc_filename_date']
         if 'gameversion' in j and 'author' in j['gameversion']:
              if not(author):
                   author = j['gameversion']['author']
         if 'gameversion' in j and 'authors' in j['gameversion']:
              if not(authors):
                   author = j['gameversion']['authors']
         if 'url' in j:
             url = j['url']
         if 'download_url' in j:
             download_url = j['download_url']
         if 'gameversion' in j and 'gameid' in j['gameversion']:
              gameid_1 = j['gameversion']['gameid']
              gameid = gameid_1
         if 'gameversion' in j and 'url' in j['gameversion']:
              if not(url):
                   url = j['gameversion']['url']
         if 'gameversion' in j and 'download_url' in j['gameversion']:
              if not(download_url):
                   download_url = j['gameversion']['download_url']
         if 'smwc_world' in j and 'gameid' in j['smwc_world']:
              gameid_0 = j['smwc_world']['gameid']
              if not(gameid):
                   gameid = gameid_0
         if 'smwc_world' in j and 'url' in j['smwc_world']:
              if not(url):
                   url = j['smwc_world']['url']
         if 'smwc_world' in j and 'download_url' in j['smwc_world']:
              if not(download_url):
                   url = j['smwc_world']['download_url']
         writer.writerow([de,hashcode,sfc_rom_sha1_hash,sfc_rom_sha256_hash,gameid,url,download_url,name,gamedate,author,authors,index7z_name,indexbps_name])


