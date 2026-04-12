import sys
import os
import shutil
import json
import glob
import re
import time

levelset = []
def normalize_lid(val):
    lid=str(val)
    if isinstance(val,int):
        lid = "0x%.3d" % val
    #print("normalize(" + lid + ") = " + lid)
    return lid
gametag=os.environ['GAMETAG']

if not(os.path.exists("temp")):
   sys.mkdir("temp")

if os.path.exists("temp/temp_lm363.sfc"):
    os.unlink("temp/temp_lm363.sfc")
shutil.copy("orig_lm363_noedits.sfc", "temp/temp_lm363.sfc")
shutil.copy(os.environ["ROMFILE"], "temp/temp_analyze.sfc")
if os.path.exists("temp/Graphics"):
    shutil.rmtree("temp/Graphics")
if os.path.exists("temp/ExGraphics"):
    shutil.rmtree("temp/ExGraphics")
if os.path.exists("temp/sysLMRestore"):
    shutil.rmtree("temp/sysLMRestore")
orig_path = os.getcwd()
os.chdir("temp")
for f in glob.glob("*.mwl"):
      if re.match("^.*\.mwl$", f):
          os.remove(f)

os.system("ps -eo pid,exe | fgrep '/opt/wine-stable/bin/wine64-preloader' | awk '{print $1}' | xargs kill")
os.system("/usr/bin/wineserver -k")
time.sleep(1)
os.system("pkill -9 winedevice.exe")
os.system("pkill -9 wine")
os.system("ps -eo pid,exe | fgrep '/opt/wine-stable/bin/wine64-preloader' | awk '{print $1}' | xargs kill -9")
os.system("/usr/bin/timeout --foreground -k 25 18 /usr/bin/wineserver --persistent -f &")

result =os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -DeleteLevels temp_lm363.sfc -AllLevels -ClearOrigLevelArea")
if not(result==0):
   raise Exception("lm333.exe -DeleteLevels temp_lm363.sfc -AllLevels -ClearOrigLevelArea --  failed")

result = os.system("timeout --foreground -k 7 3  winetowrap ../lm363/lm363.exe -ExpandROM temp_lm363.sfc 4MB")
#if not(result==064):
#   raise Exception("lm333.exe -ExpandRom 2MB failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ExportGFX temp_analyze.sfc")
#if not(result==0):
#   raise Exception("ExoprtGFX temp_analyze.sfc failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ExportExGFX temp_analyze.sfc")
#if not(result==0):
#   raise Exception("ExoprtExGFX temp_analyze.sfc failed")

if os.path.exists("temp.map16"):
    os.remove("temp.map16")
result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ExportAllMap16 temp_analyze.sfc temp.map16")
#if not(result==0):
#   raise Exception("ExoprtAllMap16 temp_analyze.sfc failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ImportAllMap16 temp.sfc temp.map16")
#if not(result==0):
#   raise Exception("ImportMap16 failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ExportSharedPalette temp_analyze.sfc temp.smwpal")
#if not(result==0):
#   raise Exception("ExoprtSharedPalette Failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ImportSharedPalette temp.sfc temp.smwpal")
#if not(result==0):
#   raise Exception("ImportSharedPalette Failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -ImportAllGraphics temp.sfc")
#if not(result==0):
#   raise Exception("ImportAllGraphics Failed")

result = os.system("timeout --foreground -k 7 3 winetowrap ../lm363/lm363.exe -TransferLevelGlobalExAnim temp.sfc temp_analyze.sfc")
#if not(result==0):
#   raise Exception("TransferLevelGlobalExAnim Failed")

print("timeout --foreground -k 7 4 winetowrap ../lm363/lm363.exe -TransferOverworld temp_lm363.sfc temp_analyze.sfc")
result = os.system('timeout --foreground -k 7 4 wine ../lm363/lm363.exe -TransferOverworld temp_lm363.sfc temp_analyze.sfc')
#if not(result==0):
#   raise Exception("TransferOverWorld Failed")

result = os.system('timeout --foreground -k 7 4 winetowrap ../lm363/lm363.exe -ExportMultLevels temp_analyze.sfc MWL 1')
if not(result==0):
   raise Exception("ExoprtMultLevels Failed")
result = os.system('timeout --foreground -k 7 4 winetowrap ../lm363/lm363.exe -ImportMultLevels temp_lm363.sfc "./"')
if not(result==0):
   raise Exception("ImportMultLevels Failed")

for f in glob.glob("MWL*.mwl"):
      result = re.match("^MWL ([^.]+)\.mwl$", f)
      if result:
          mgroup = result.groups(0)[0]
          levelset.append(normalize_lid(mgroup))
os.chdir(orig_path)
if (gametag):
    shutil.copy("temp/temp_lm363.sfc", "temp_lm363_" + str(gametag) + ".sfc")
#args.romfile = 'temp/temp_lm363.sfc'

dict = {
        "levels": levelset
}

with open('temp/temp.json', 'w') as file:
    file.write( "\"levels\": " + json.dumps(dict["levels"]) + ",\n")

os.system("/usr/bin/wineserver -k")
print("lmfilter finishing")












