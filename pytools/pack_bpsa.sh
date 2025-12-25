#
# Iniitial pack of bps files to bpsxa
#
# The bps7z is based on the leading first 2 charaecters of .bps filenames
# which were a sha1 hash for now.
#
# This second series the bpsxa archive file series is based on the first 1
# character of .bps filenames (First character of sha1 hash)
#
# That is because the bpsxa series is an incremental addition on top of the
# the bps7z archive series, so we only need 16  zip files to shard the archive.
#
#

exit
bps_series=bpsxa

for a in `seq 0 15` ; do
 q=$(printf "%x\n" $a)
 if [ -n "$q" ] ; then
     7z a -mx=9 ${bps_series}_${q}.7z ${q}*.bps
     if [ $? -eq 0 ] ; then
         echo mv -i ./${q}*.bps ./bpsdone/
         mv -i ./${q}*.bps ./bpsdone/
     fi
  fi
done

#enode.sh ~/rhplay/jstools/process_index7zs.js arcsfc2/ index_xsa/ bpsxa/
#enode.sh ~/rhplay/jstools/augment_index7zs.js index_xsa/ bpsxa/

# cd ~/rhplay/refmaterial/bps7z/
# enode.sh ~/rhplay/jsutils/update_bpsarchives.js /home/steamu/rhplay/electron/bpsarchives.json --target bpsxa_0.7z --add-archive bpsxa_0.7z
# node.sh ~/rhplay/jsutils/update_bpsarchives.js /home/steamu/rhplay/electron/bpsarchives.json --target bpsxa_1.7z --add-archive bpsxa_1.7z
#for a in `seq 2 15` ; do
# q=$(printf "%x\n" $a)
# enode.sh ~/rhplay/jsutils/update_bpsarchives.js /home/steamu/rhplay/electron/bpsarchives.json --target  bpsxa_${q}.7z --add-archive bpsxa_${q}.7z
#done 
 # add-archive: bpsxa_2.7z
#  [update_bpsarchives] Added new entry "bpsxa_2.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_3.7z
#  [update_bpsarchives] Added new entry "bpsxa_3.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_4.7z
#  [update_bpsarchives] Added new entry "bpsxa_4.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_5.7z
#  [update_bpsarchives] Added new entry "bpsxa_5.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_6.7z
#  [update_bpsarchives] Added new entry "bpsxa_6.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_7.7z
#  [update_bpsarchives] Added new entry "bpsxa_7.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_8.7z
#  [update_bpsarchives] Added new entry "bpsxa_8.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_9.7z
#  [update_bpsarchives] Added new entry "bpsxa_9.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_a.7z
#  [update_bpsarchives] Added new entry "bpsxa_a.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_b.7z
#  [update_bpsarchives] Added new entry "bpsxa_b.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_c.7z
#  [update_bpsarchives] Added new entry "bpsxa_c.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_d.7z
#  [update_bpsarchives] Added new entry "bpsxa_d.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_e.7z
#  [update_bpsarchives] Added new entry "bpsxa_e.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#  add-archive: bpsxa_f.7z
#  [update_bpsarchives] Added new entry "bpsxa_f.7z"
#  [update_bpsarchives] Completed manifest update.
#    Added entries: 1
#    

##    for a in `seq 0 15` ; do
##     q=$(printf "%x\n" $a)
##     enode.sh ~/rhplay/jsutils/update_bpsarchives.js /home/steamu/rhplay/electron/bpsarchives.json --target  bpsxa_${q}.7z --update-from-ardrive
##    done
##    [update_bpsarchives] Updated base entry for "bpsxa_0.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_1.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_2.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_3.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_4.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_5.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_6.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_7.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_8.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_9.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_a.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_b.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_c.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_d.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_e.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##    [update_bpsarchives] Updated base entry for "bpsxa_f.7z"
##    [update_bpsarchives] Completed manifest update.
##      Updated existing entries: 1
##



exit
bps_series=bps7z
for a in `seq 0 255` ; do
 q=$(printf "%.2x\n" $a)
 if [ -n "$q" ] ; then
     7z a -mx=9 ${bps_series}_${q}.7z ${q}*.bps
     if [ $? -eq 0 ] ; then
         echo mv -i ./${q}*.bps ./bpsdone/
         mv -i ./${q}*.bps ./bpsdone/
     fi
  fi
done

#enode.sh ~/rhplay/jstools/process_index7zs.js arcsfc1/ index7z/ bps7z/
#enode.sh ~/rhplay/jstools/augment_index7zs.js index7z/ bps7z/

