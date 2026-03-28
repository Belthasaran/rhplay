###  specific to .1.23
###
exit 0

enode.sh ~/rhplay/jsutils/update_coremf.js ~/rhplay/electron/coremanifest.json --target "beta/RHPLAY/win64/portable"  --exe ~/release/0.1.29beta/RHTools-0.1.29-beta-portable.exe  --ardrive-drive-id "58677413-8a0c-4982-944d-4a1b40454039" --ardrive-folder-id  "eb87554f-6669-433b-9fb6-1204e018031c" 


#enode.sh ~/rhplay/jsutils/update_coremf.js ~/rhplay/electron/coremanifest.json --target "beta/RHPLAY/linux64/AppImage"   --exe ~/release/0.1.23beta//RHTools-0.1.23-beta.AppImage   --ardrive-drive-id "58677413-8a0c-4982-944d-4a1b40454039" --ardrive-folder-id  "eb87554f-6669-433b-9fb6-1204e018031c" 

enode.sh ~/rhplay/jsutils/update_coremf.js coremanifest.json --target "beta/RHPLAY/linux64/AppImage" --exe ~/release/0.1.29beta/RHTools-0.1.29-beta.AppImage  --ardrive-folder-id "eb87554f-6669-433b-9fb6-1204e018031c"


#enode.sh ~/rhplay/jsutils/update_coremf.js ~/rhplay/electron/coremanifest.json --target "beta/MANIFEST_PKG"   --zipfile ~/release/0.1.23beta/manifest20260219.zip  --ardrive-drive-id "58677413-8a0c-4982-944d-4a1b40454039" --ardrive-folder-id  "58f5feb4-f3d6-430b-b428-dcc3b7da90f0"


