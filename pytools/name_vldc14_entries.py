#
# Rename the VLDC14 contest entries based on vldc14_authors.txt
#
import os
import re 
bps_files = []
bps_files.extend("VLDC14_entry_01 VLDC14_entry_02 VLDC14_entry_03".split(" "))
bps_files.extend("VLDC14_entry_04 VLDC14_entry_05 VLDC14_entry_06".split(" "))
bps_files.extend("VLDC14_entry_07 VLDC14_entry_08 VLDC14_entry_09".split(" "))
bps_files.extend("VLDC14_entry_10 VLDC14_entry_11 VLDC14_entry_12".split(" "))
bps_files.extend("VLDC14_entry_13 VLDC14_entry_14 VLDC14_entry_15".split(" "))
bps_files.extend("VLDC14_entry_16 VLDC14_entry_17 VLDC14_entry_18".split(" "))
bps_files.extend("VLDC14_entry_19 VLDC14_entry_20 VLDC14_entry_21".split(" "))
bps_files.extend("VLDC14_entry_22 VLDC14_entry_23 VLDC14_entry_24".split(" "))
bps_files.extend("VLDC14_entry_25 VLDC14_entry_26 VLDC14_entry_27".split(" "))
bps_files.extend("VLDC14_entry_28 VLDC14_entry_29 VLDC14_entry_30".split(" "))
bps_files.extend("VLDC14_entry_31 VLDC14_entry_32 VLDC14_entry_33".split(" "))
bps_files.extend("VLDC14_entry_34 VLDC14_entry_35 VLDC14_entry_36".split(" "))
bps_files.extend("VLDC14_entry_37 VLDC14_entry_38 VLDC14_entry_39".split(" "))
bps_files.extend("VLDC14_entry_40 VLDC14_entry_41 VLDC14_entry_42".split(" "))
bps_files.extend("VLDC14_entry_43 VLDC14_entry_44 VLDC14_entry_45".split(" "))
bps_files.extend("VLDC14_entry_46 VLDC14_entry_47 VLDC14_entry_48".split(" "))
bps_files.extend("VLDC14_entry_49 VLDC14_entry_50 VLDC14_entry_51".split(" "))
bps_files.extend("VLDC14_entry_52 VLDC14_entry_53 VLDC14_entry_54".split(" "))
bps_files.extend("VLDC14_entry_55 VLDC14_entry_56 VLDC14_entry_57".split(" "))
bps_files.extend("VLDC14_entry_58 VLDC14_entry_59 VLDC14_entry_60".split(" "))
bps_files.extend("VLDC14_entry_61 VLDC14_entry_62 VLDC14_entry_63".split(" "))
bps_files.extend("VLDC14_entry_64 VLDC14_entry_65 VLDC14_entry_66".split(" "))
bps_files.extend("VLDC14_entry_67 VLDC14_entry_68 VLDC14_entry_69".split(" "))
bps_files.extend("VLDC14_entry_70 VLDC14_entry_71".split(" "))
contest_name = 'VLDC14'
compilation_date = '2024-07-02'

authors = {}
af = open('vldc14_authors.txt', 'r')
for rl in af.readlines():
    entry = rl.strip().split(' ',1)
    authors[ entry[0] ] = entry[1]

for bps in bps_files:
     if os.path.isfile(bps + '.bps'):
         m = re.match('^VLDC14_entry_(\d+)', bps)
         if m:
             entrynum = m.group(1)
             if str(entrynum) in authors:
                os.rename(bps + '.bps', contest_name+' level ' + str(entrynum) + ' by ' + authors[str(entrynum)] + '['+compilation_date+']'+'.bps')

