#
# Script to temporarily enrich BPS filename for convenience to import 72hoQLDC files with better metadata.
#
# The filenames look like 72hoQLDC_1234_authorname.bps
#
# Step 1  We will temp rename to SMWC72hoQLDC2-2026 Level Design Contest 1234 by authorname [2026-01-26] (SMW Hack)
#   during import for the purposes of generating meaningful search metadata
#
# Step 2 Then we run  our script to create them as .sfc files  And creates a temporary .7z file
#  ./pytools/patch_cwd_bps_files.py

#
# Next follow the Intake process for 7z+sfc file pairs
#

#
# Step 3 Then we run our processing script
#  node $RHT_PROGRAMDIR/jstools/process_arcsfc_runner.js  
#
# Step 4
#    After processing  we need to separate our JSON files to a new arcsfcXX_json directory
#     the files are all named  (FILECODE).json
#
#    everything else to an arcsfcXX_bps directory
#      the bps files are named  (FILECODE).bps
#      there are some logfiles
#      Any supplementary files to be included with a patch ought to be placed below a:
#            XX/(FILECODE)/   - subdirectory
#      where XX is the first 2 characters of FILECODE
#
# Step 5
#      Divide the arcsfcXX_bps  files  and place them into BPS archive files.
#      Place the BPS archive files below a   arcsfcXX_bps7z  subdirectory
#
# Step 6
#      Execute index creation against the arcsfc JSON files and BPS files
#
#  EXAMPLE: enode.sh $RHTPROG/jstools/process_index7zs.js arcsf202602b_newindex index7z arcsf202602b_newbps/
#
#        where arcsf202602b_newindex -  is the  Index DIR containing the new JSON files
#        index7z -  Is the system MASTER INDEX folder where the new Master Index JSON files are to be created
#
#        arcsf202602b_newbps -   Is the folder containing the new bps7z  Archive files from above
#            This is important because the JSON files created in the MASTER INDEX will Identify the filename of
#            the 7z file in this directory containing each specific patch
#
#        AFTER Processing is complete:
#              - Upload and Add all the new bps7z files to IPFS.
#              - Create bpsarchives.json  MANIFEST records for the new bps7z files
#              - Move all the bps7z files to the Software's  Master bps7z  folder.
#
#              - Rebuild rhsearch.zip and rhsearch_cat.db - both search_build1 and search_build2
#    enode.sh $RHTPROG/jstools/search_build1.js  $RHTREF/index7z $RHTREF/bps7z/
#    enode.sh $RHTPROG/jstools/search_build2.js  $RHTREF/index7z  $RHTREF/bps7z/
#
#      This scans all the files in index7z and  bps7z   to create the Master search Database.
#                 rhsearch.zip   -  contains search index JSON files - 1 JSON file per hack
#                 rhsearch_cat.db  - sqlite full text search database
#
# STEP 7
#   Upload the new bps7z files to ArWeave AND add the new files to the bpsarchives.json Manifest:
#
#  ipfs add --cid-version 1 bpsxc_20260204.7z  
#  Automated Manifest Addition:
#  enode.sh $RHTPROG/jsutils/update_bpsarchives.js $RHTPROG/electron/bpsarchives.json --add-archive bpsxc_20260204.7z  
#  enode.sh $RHTPROG/jsutils/update_bpsarchives.js $RHTPROG/electron/bpsarchives.json --target bpsxc_20260204.7z --update-from-ardrive
#
#  Edit the "addr" or "baddr"  field on the base file for additional download endpoints
#
#   This step is repeated with Every additional 7z file being added to the game patch caches
#
# STEP 8
#             Package the new rhsearch.zip and rhsearch_cat.db  and Upload them
#
#             cp rhsearch.zip rhsearch-20260204.zip
#             cp rhsearch_cat.db rhsearch_cat-20260204.db
#             xz -9 rhsearch_cat-20260204.db
#             sha256sum rhsearch-20260204.zip rhsearch_cat-20260204.db.xz
#             ipfs add --cid-version 1 rhsearch-20260204.zip 
#             ipfs add --cid-version 1 rhsearch_cat-20260204.db.xz
#
#             Upload rhsearch-20260204.zip and get baddr
#             Upload rhsearch_cat-20260204.db.xz and get baddr
#             Upload rhsearch-20260204.zip to ArWeave
#             Upload rhsearch_cat-20260204.db.xz to ArWeave
#
# STEP 8
#             Update bpsarchives.json for the rhsearch.zip and rhsearch_cat.db targets
#              - to  remove the specific ArWeave locations.
#      REMOVE the attributes:  ardrive_file_name, ardrive_file_path, ardrive_file_id, data_txid
#              - replace the ipfs_cidv1 value
#              - change the source filename
#              - replace the size with the correct size
#              - replace the sha256 hash with the correct hash of the new file
#              - blank the addr or baddr attribute.
#
# Follow the same process for both targets.
#
#      Update bpsarchives.json  Using the script to Update ArWeave data for each target.
# enode.sh $RHTPROG/jsutils/update_bpsarchives.js $RHTPROG/electron/bpsarchives.json --target rhsearch.zip   --update-from-ardrive --ardrive-folder-id d4fe5f98-e15b-4ceb-98f9-cded2b6a7cf1
# enode.sh $RHTPROG/jsutils/update_bpsarchives.js $RHTPROG/electron/bpsarchives.json --target rhsearch_cat.db   --update-from-ardrive --ardrive-folder-id d4fe5f98-e15b-4ceb-98f9-cded2b6a7cf1  
#              
#
# Add the correct addr or baddr  attribute  for the file download endpoint on the updated file.
#
# STEP 9
#     Bump the version numbers for existing catalog targets in bpsarchives.json   that have been updated
#     Always update rhsearch.zip  before rhsearch_cat.db
#
# Note that the client does not detect an Update/Replacement to its search database is required if the Version 
# number has not changed.
#                
#
#
import sys
import os
import re
sys.exit(0)
for de in os.listdir("."):
    m = re.match(r'72hoQLDC_(\d+)_([^\.]+).bps',de)
    if m:
       entrynum = m.group(1)
       name = m.group(2)
       ne='SMWC72hoQLDC2-2026 Level Design Contest '+str(entrynum)+' by '+name+' [2026-01-26] (SMW Hack).bps'
       print('rename '+str(de)+' '+str(ne))
       os.rename(de, ne)


