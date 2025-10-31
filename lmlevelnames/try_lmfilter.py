import sys
import os
import shutil
import json
import glob
import re

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

if os.path.exists("temp/temp_lm361.sfc"):
    os.unlink("temp/temp_lm361.sfc")
shutil.copy("orig_lm361_noedits.sfc", "temp/temp_lm361.sfc")
shutil.copy(os.environ["ROMFILE"], "temp/temp_analyze.sfc")
if os.path.exists("temp/Graphics"):
    shutil.rmtree("temp/Graphics")
if os.path.exists("temp/ExGraphics"):
    shutil.rmtree("temp/ExGraphics")
orig_path = os.getcwd()
os.chdir("temp")
for f in glob.glob("*.mwl"):
      if re.match("^.*\.mwl$", f):
          os.remove(f)

result = os.system("timeout 3  wine ../lm361/lm361.exe -ExpandROM temp_lm361.sfc 4MB")
if not(result==0):
   raise Exception("lm333.exe -ExpandRom 4MB failed")

result =os.system("timeout 3 wine ../lm361/lm361.exe -DeleteLevels temp_lm361.sfc -AllLevels -ClearOrigLevelArea")
if not(result==0):
   raise Exception("lm333.exe -DeleteLEvels temp_lm361.sfc failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -ExportGFX temp_analyze.sfc")
if not(result==0):
   raise Exception("ExoprtGFX temp_analyze.sfc failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -ExportExGFX temp_analyze.sfc")
if not(result==0):
   raise Exception("ExoprtExGFX temp_analyze.sfc failed")

os.remove("temp.map16")
result = os.system("timeout 3 wine ../lm361/lm361.exe -ExportAllMap16 temp_analyze.sfc temp.map16")
if not(result==0):
   raise Exception("ExoprtAllMap16 temp_analyze.sfc failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -ImportAllMap16 temp.sfc temp.map16")
if not(result==0):
   raise Exception("ImportMap16 failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -ExportSharedPalette temp_analyze.sfc temp.smwpal")
if not(result==0):
   raise Exception("ExoprtSharedPalette Failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -ImportSharedPalette temp.sfc temp.smwpal")
if not(result==0):
   raise Exception("ImportSharedPalette Failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -ImportAllGraphics temp.sfc")
if not(result==0):
   raise Exception("ImportAllGraphics Failed")

result = os.system("timeout 3 wine ../lm361/lm361.exe -TransferLevelGlobalExAnim temp.sfc temp_analyze.sfc")
if not(result==0):
   raise Exception("TransferLevelGlobalExAnim Failed")

print("timeout 4 wine ../lm361/lm361.exe -TransferOverworld temp_lm361.sfc temp_analyze.sfc")
result = os.system('timeout 4 wine ../lm361/lm361.exe -TransferOverworld temp_lm361.sfc temp_analyze.sfc')
if not(result==0):
   raise Exception("TransferOverWorld Failed")

result = os.system('timeout 4 wine ../lm361/lm361.exe -ExportMultLevels temp_analyze.sfc MWL 1')
if not(result==0):
   raise Exception("ExoprtMultLevels Failed")
result = os.system('timeout 4 wine ../lm361/lm361.exe -ImportMultLevels temp_lm361.sfc "./"')
if not(result==0):
   raise Exception("ImportMultLevels Failed")

for f in glob.glob("MWL*.mwl"):
      result = re.match("^MWL ([^.]+)\.mwl$", f)
      if result:
          mgroup = result.groups(0)[0]
          levelset.append(normalize_lid(mgroup))
os.chdir(orig_path)
if (gametag):
    shutil.copy("temp/temp_lm361.sfc", "temp_lm361_" + str(gametag) + ".sfc")
#args.romfile = 'temp/temp_lm361.sfc'

dict = {
        "levels": levelset
}

with open('temp/temp.json', 'a') as file:
    file.write( "\"levels\": " + json.dumps(dict["levels"]) + ",\n")














