#!/bin/bash

export DISPLAY=:1

cd lmlevelnames
for i_gameid in  $GAMEIDS ; do
../enode.sh ../jstools/fetchpatches.js mode3 -q patch -b gameid $i_gameid -o temp/temp.bps   --patchbindb=../electron/patchbin.db --rhdatadb=../electron/rhdata.db 
 if [ $? -ne 0 ] ; then
	 echo "Error: no result found -- skip gameid $i_gameid"
	 continue
 fi
flips --apply temp/temp.bps smw.sfc temp/temp.sfc 
if [ $? -ne 0  ] ; then
	echo "Failed to apply patch -- skip gameid $i_gameid"
	continue
fi


SHA1_TEMP=$(sha1sum temp/temp.sfc)
echo "SHA1 temp/temp.sfc: ${SHA1_TEMP}"
echo "Adding SMC header"
# Add 512-byte SMC header to ROM
wine snesheader.exe temp/temp.sfc 1
if [ $? -ne 0 ] ; then
	echo "Error adding SMC header -- skip gameid $i_gameid"
	continue
fi

#
set -x
python3 levelname_extractor3.py --levelsonly --gametag ${i_gameid} --romfile temp/temp.sfc
done





#GVUUID= ../enode.sh ../jstools/fetchpatches.js mode3 -b gameid 26252 --patchbindb=../electron/patchbin.db --rhdatadb=../electron/rhdata.db | egrep '^\s*"gvuuid"' | awk '{print $2}'

#PBLOB_NAME=../enode.sh ../jstools/fetchpatches.js mode3 -b gameid 26252 --patchbindb=../electron/patchbin.db --rhdatadb=../electron/rhdata.db | egrep '^\s*"patchblob1_name"' | awk '{print $2}'

#../enode.sh  ../jstools/fetchpatches.js mode3  -q rawpblob  pblob_26252_24e503ed1e  --patchbindb=../electron/patchbin.db  --rhdatadb=../electron/rhdata.db

#../enode.sh  ../jstools/fetchpatches.js mode3  -q patch  pblob_26252_24e503ed1e  --patchbindb=../electron/patchbin.db  --rhdatadb=../electron/rhdata.db

#../enode.sh  ../jstools/fetchpatches.js mode3  -q patch 26252 --patchbindb=../electron/patchbin.db  --rhdatadb=../electron/rhdata.db

#   node fetchpatches.js mode3 -b gvuuid <gvuuid> -q patch --searchipfs
#../enode.sh ../jstools/fetchpatches.js mode3 -q patch -b gvuuid e7caedb6-05a5-4669-ab93-dc0974045f06 --patchbindb=../electron/patchbin.db --rhdatadb=../electron/rhdata.db




