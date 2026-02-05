####
# Importing of 72hoQLDC SMW Romhacks into the master search catalog --
# These scripts are written against Python 3.10.1 and Electron NodeJS v22.19.0
#
# This script is part of the Rhplay SMW Romhack Manager;
# which is a Javascript prototype rewrite of RHTools.
#
# The reimplementation as an Electron app has been cursorAi-assisted.
#  - https://github.com/belthasaran/rhplay?tab=readme-ov-file#purpose-of-this-program

# This file remains in Python, and has not been converted.
# The scripts in pytools/ specifically are provided under the GNU General Public License Version 3 or later.
#####

#
# This script is part of the process for importing new ROMHacks into the Offline-Searchable 
# romhack patch catalog and
# BPS patch cache which holds search data and cache for ~31,000 patch files of various SMW romhacks.
#
# This is still a manual process: with some automation.
#

#
# This script handles Step 1.  Of the overall process.
# This documentation header points to the next steps.
# After you finish the steps in this process:
#
#   - New SMW romhacks should be searchable through the Search Catalog button. And available by users to
#   point-and-click Add and then launch on their SNES using the USB2SNES File Upload integration.
#
#   That is, once users have updated their client to use a new Manifest file
#   from  https://github.com/Belthasaran/rhplay/blob/main/electron/bpsarchives.json
#
#   - This requires a new build of the app, (until Online functionality is finished,
#   but the plan requires Minimizing the use of hosted or centralized servers for any feature.
#
#     - Eventually we could iplement a Nostr+Ceramic event for Manifest updates, or Ethereum blockchain
#       artifact for locating the current dbmanifest and bps manifests, or an IPFS IPNS,
#       or IPFS DNSLink to point to an IPFS CID containing signed Manifest update locations on the
#       IPFS or ArWeave networks.
#

###  
# PREPARATION PROCES
#
#
# Step 1 is to temporarily enrich BPS filenames for convenience to import 72hoQLDC files with better metadata.
# This is because the Intake process is a standard one used for bulk search imports for Romhacks previously
# found on Archive.org, SMWCentral, and RHDN.
#
# The filenames BEFORE running this script   look like 72hoQLDC_1234_authorname.bps
#
# In this example: 1234 is the entry number, and   (authorname) is the authorname for each Romhack in the contest.
#
#
# Step 1  We will temp rename
#   AFTER renaming; All the filenames look like:  SMWC72hoQLDC2-2026 Level Design Contest 1234 by authorname [2026-01-26] (SMW Hack)
#
#   This provides extra context for full-text search.
#
# --> During import into our search database for the purposes of generating meaningful search metadata  <-- YOU ARE HERE
#
# 
# Next steps for you to perform after finishing this script:
#
# Step 2  You need to run the next script in the chain to create all the Romhacks  as .sfc files.
#        This MASS-patches all romhacks, so we can capture checksum hashes, and auto-analyze them.
#        Actual ROMfiles are not included in search catalog nor archive cache files.
#
# This Bulk patches ALL romhacks in the current directory at once for quicker analysis, and creates the temporary .7z files
#  ./pytools/patch_cwd_bps_files.py
#
#   This creates a patched ROM and matching 7z file for each BPS file in the current directory.
#####
#####

#
# AFTER Step 2: 
#  Follow the Intake process for any list of new Romhacks without detailed metadata that uses:  7z+sfc file pairs
#
#   In this example "authorname" will be automatically parsed as the author name.
#    2026-01-026 will be automatically parsed as the date.
#    And  "SMWC72hoQLDC2-2026 Level Design Contest 1234"  will be entered in the hack title field
#
#######
#######
#  This is the Intake process for ANY list of bulk Romhacks.
#  Excluding those that go into the main database.
#
#


# Intake Step 1. we run our processing script
#  node $RHT_PROGRAMDIR/jstools/process_arcsfc_runner.js  
#
# This step is fully automated, and the result will be an output/  directory containing:
#  - Many JSON files containing enriched Metadata for each patch file, including hack name, author, etc.
#    each JSON is named (rom sha1hash).json - CURRENTLY.   (rom sha256hash).json is also possible.
#
#  - BPS files containing the patch which can be applied to play the romhack
#    each BPS is named (rom sha1hash).bps
#
#
# Intake Step 2.
#    After processing  we need to separate our JSON files to a new arcsfcXX_json directory
#     the files are all named  (FILECODE)*.json  and  (FILECODE)*.txt
#     the files to be moved here are ONLY the files arsfc generated.
#
#    The text files will eventually indivudally End up combined into One Master JSON file per game and
#    placed in a single .zip file  containing the complete search catalog (all ~31,000 Master JSON files).
#
##
#    All the other files related to a game go to an arcsfcXX_bps directory -
#    The BPS patch file and potential READMEs.
#
#    Please delete any ROM files or executables found in the arcsfcXX_bps subdirectory.
#    ROMS and executables are explicitly forbidden.  Only patches should be included.

#    the files in this directory are to be divided up into 7z files.
#    There can be MANY bps 7z files.  Or just one.
#
#    ** Make sure the average 7Z size is approximately 25 Megabytes, and avoid exceeding 30 **
#    ** See earlier batches for the naming conventions for sharded batches **
#
#     - The bps files are named  (FILECODE).bps
#     - There are some logfiles
#    -  Any supplementary files to be included with a patch ought to be placed below a:
#            XX/(FILECODE)/   - subdirectory
#      where XX is the first 2 characters of FILECODE
#
# Intake Step 3.
#
#      Divide the arcsfcXX_bps files inspected in Step 2,  and place the files into BPS archive files.
#      That means you have to create the 7z file or Sharded 7z files which contain each ROMHACK.
#
#      Place the BPS archive files below a   arcsfcXX_bps7z  subdirectory
#
# Intake Step 4.
#      Execute index creation against the New batch's arcsfc_JSON files folder, and the New batch's BPS7Z Archives folder.
#
#  EXAMPLE: enode.sh $RHTPROG/jstools/process_index7zs.js arcsf202602b_newindex index7z arcsf202602b_bps7z/
#
#  This script examines ALL 3 folders and adds Master catalog files  in the index7z folder:
#          - arcsf202602b_newindex - The folder containing our new ROMHACK JSON files
#          - index7z - The system's existing Master catalog folder (Contains all existing romhacks, and new ones will be added)
#          - arcsf202602b_bps7z -  Folder that has our .7Z files containing the BPS files related to the hacks described in arcsf202602b_newindex
#
#
#        where arcsf202602b_newindex -  is the  Index DIR containing the new JSON files
#        index7z -  Is the system MASTER INDEX folder where the new Master Index JSON files are to be created
#
#        arcsf202602b_newbps -   Is the folder containing the new bps7z  Archive files from above
#            This is important because the JSON files created in the MASTER INDEX will Identify the filename of
#            the 7z file in this directory containing each specific patch
#
# Intake Step 5.
#        AFTER index7z Processing is complete  You need to perform these steps
#        to publish the Romhack cache data, BEFORE publishing new search catalogs:
#
#              - Upload and Add all the new bps7z files to IPFS. So the client can download using IPFS gateways.
#              - Move all the bps7z files to the Software's  Master bps7z  folder.
#              They are no longer new, and should be packaged with the next offline version.
#
# Intake Step 6. Go ahead and  Rebuild rhsearch.zip and rhsearch_cat.db - both search_build1 and search_build2
#
#    enode.sh $RHTPROG/jstools/search_build1.js  $RHTREF/index7z $RHTREF/bps7z/
#    enode.sh $RHTPROG/jstools/search_build2.js  $RHTREF/index7z  $RHTREF/bps7z/
#
#      This scans all the files in index7z and  bps7z   to create the Master search Database.
#                 rhsearch.zip   -  contains search index JSON files - 1 JSON file per hack
#                 rhsearch_cat.db  - sqlite full text search database
#
# Intake Step 7.Upload the new bps7z files to ArWeave AND add the new files to the bpsarchives.json Manifest:
#  The file requiring updates is found at:
#      https://github.com/Belthasaran/rhplay/blob/main/electron/bpsarchives.json
#
#  IPFS UPLOAD
#  ipfs add --cid-version 1 bpsxc_20260204.7z  
#
#  Create bpsarchives.json  MANIFEST records for the new bps7z files
#  This tells users client software what the 7z files are and where to find them.
#
#  Automated Manifest Addition for new bps7z target files:
#  enode.sh $RHTPROG/jsutils/update_bpsarchives.js $RHTPROG/electron/bpsarchives.json --add-archive bpsxex_20260204.7z  
#  enode.sh $RHTPROG/jsutils/update_bpsarchives.js $RHTPROG/electron/bpsarchives.json --target bpsxex_20260204.7z --update-from-ardrive
#
#  Edit the "addr" or "baddr"  field on the base file for additional download endpoints
#
#   This step is repeated with Every additional 7z file being added to the game patch caches
#
# Intake Step 8. PACKAGE AND UPLOAD the Freshly-rebuilt search catalog
#  (Which will now include the new romhacks added, And the new Bps7z filenames to find them in)
#             Package the new rhsearch.zip and rhsearch_cat.db  and Upload them
#
#  Create unique source filenames, before uploading:
#             cp rhsearch.zip rhsearch-20260204.zip
#             cp rhsearch_cat.db rhsearch_cat-20260204.db
#             xz -9 rhsearch_cat-20260204.db
#
#  SHA256 Hashes will be required for the manifest
#             sha256sum rhsearch-20260204.zip rhsearch_cat-20260204.db.xz
#
#  Add new files to IPFS to make them available
#             ipfs add --cid-version 1 rhsearch-20260204.zip 
#             ipfs add --cid-version 1 rhsearch_cat-20260204.db.xz
#
#  Upload cache files to redundant mirrors and offline hosts, and save URLs to be added to the Manifest
#             Upload rhsearch-20260204.zip and get baddr
#             Upload rhsearch_cat-20260204.db.xz and get baddr
#             Upload rhsearch-20260204.zip to ArWeave
#             Upload rhsearch_cat-20260204.db.xz to ArWeave
#
#
#
# Intake Step 9. COMPLETE and Finalize the Manifest Updates (bpsarchives.json)
#  So that end users' Catalog search clients would find and download the new
# Romhack search catalog updates  After updating their program to a version including the new
# manifest file.
#
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
# Intake Step 9.  Bump manifest file version numbers, so Updated clients will know that their Search catalog cache
# is stale, and should be updated.
#
#     Bump the version numbers for existing catalog targets in bpsarchives.json   that have been updated
#     Always update rhsearch.zip  before rhsearch_cat.db
#
# Note that the client does not detect an Update/Replacement to its search database is required if the Version 
# number has not changed.
#                
####
#  Intake Step 10.  BPSMANIFEST VERIFICATION
#    Run automated Manifest verification to help ensure that the search catalog will actually still
#    work, and still be installable after the update.
#
#  Final step is to use the  verify_bpsarchives.js  to verify that:
#    -  The new entries can be successfully downloaded from all locations
#    -  The script will also make sure SHA256 checksum values match; which is critical for successful downloads.
#
#
#   enode.sh $RHTPROG/jstools/verify_bpsarchives.js --manifest $RHTPROG/electron/bpsarchives.json --target NAME --verify-links 
#
#    * Repeat the script where NAME is:  rhsearch.zip      then rhsearch_cat.db
#    * Repeat for each BPS 7Z file that was added to the manifest earlier
#
#   -- Use the Verify script to confirm the entire build process.
#
##   enode.sh $RHTPROG/jstools/verify_bpsarchives.js --manifest $RHTPROG/electron/bpsarchives.json --target rhsearch.zip --verify-build
#    enode.sh $RHTPROG/jstools/verify_bpsarchives.js --manifest $RHTPROG/electron/bpsarchives.json --target rhsearch_cat.db --verify-build
#
#    Also,  enode.sh $RHTPROG/jstools/verify_bpsarchives.js --help
#    For more information.   The target option should be optional, and omit it to completely verify the entire manifest.
#
#    (Make sure Download endpoints added earlier are still operational!)
#
#
#    - If you have also modified dbmanifest.json,  then invoke its verification script as well.
#      (The dbmanifest.json  is actually more critical than the bpsarchives manifest.)
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


