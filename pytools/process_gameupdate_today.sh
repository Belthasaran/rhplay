UPDATEFOLDER=gameupdate$(date +%Y-%m-%d)
enode.sh ~/rhplay/jstools/updategames.js --new-only --target-folder=${UPDATEFOLDER}
enode.sh ~/rhplay/jstools/updategames.js --new-only --source-folder=${UPDATEFOLDER} --changes-inplace --subfolders=all --backup-folder=${UPDATEFOLDER}.backup
enode.sh ~/rhplay/jstools/findscreenshots.js --target-folder=${UPDATEFOLDER} --gamefolders=all
enode.sh ~/rhplay/jstools/findscreenshots.js --target-database


