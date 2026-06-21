#
#
#
UG_DAYFOLDER="games$(date +%Y%m%d)"
UG_BKFOLDER="backups$(date +%Y%m%d)"
echo $UG_DAYFOLDER
enode.sh jstools/updategames.js --target-folder=${UG_DAYFOLDER} --new-only
enode.sh jstools/updategames.js  --source-folder=${UG_DAYFOLDER} --subfolders=all --changes-inplace --backup-folder=${UG_BKFOLDER}


