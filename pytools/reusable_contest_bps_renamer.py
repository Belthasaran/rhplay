
#72hoQLDC-Spring2022
rankings = {
}
rankings['16'] = ' R10 '
rankings['21'] = ' R09 '
rankings['33'] = ' R07-T '
rankings['54'] = ' R07-T '
rankings['39'] = ' R06 '
rankings['23'] = ' R05 '
rankings['03'] = ' R04 '
rankings['51'] = ' R03 '
rankings['14'] = ' R02 '
rankings['35'] = ' R01 '


import os
import sys
import re

rankings = {
'01' : ' Award ',
'04' : ' Award ',
'06' : ' Award ',
'10' : ' Award ',
'16' : ' Award ',
'17' : ' Award ',
'19' : ' Award ',
'21' : ' Award ',
'22' : ' Award ',
'23' : ' Award ',
'24' : ' Award ',
'27' : ' Award ',
'28' : ' Award ',
'29' : ' Award ',
'31' : ' Award ',
'33' : ' Award ',
'34' : ' Award ',
'35' : ' Award ',
'36' : ' Award ',
'37' : ' Award ',
'40' : ' Award ',
'42' : ' Award ',
'43' : ' Award ',
'44' : ' Award ',
'45' : ' Award ',
'47' : ' Award ',
'48' : ' Award ',
'49' : ' Award ',
'50' : ' Award ',
'51' : ' Award ',
'60' : ' Award ',
'61' : ' Award ',
'63' : ' Award ',
'65' : ' Award ',
'66' : ' Award ',
'67' : ' Award ',
'69' : ' Award ',
'70' : ' Award ',
'76' : ' Award ',
'77' : ' Award ',
'79' : ' Award ',
'81' : ' Award ',
'83' : ' Award '
}
rankings['35'] = ' R03 '
rankings['10'] = ' R02 '
#rankings['cannot find Ckristina'] = ' R01 '

import os
import sys
import re

rankings = {}
#CLDC_entry_01_XL Chocolate Bar - thatwaterblockrk.bps

for de in os.listdir("."):
    #"58_Faro-Minta's Winter Escapade V1.1.bps.bps"
    #m = re.match(r'(\d+)_([^\.]+).bps',de)
    m = re.match(r'CLDC_entry_(\d+)_([^-]+) - ([^\.]+).bps',de)
    #m = re.match(r'(\d+)_([^\.]+)-([^\.]+).bps',de)
    if m:
       entrynum = m.group(1)
       name = m.group(2)
       extra = '' #+ m.group(3) + ' '
       rankings.setdefault(entrynum, '')
       #ne='SMWC 72hoQLDC1 E'+str(entrynum)+' '+str(rankings[entrynum])+' by '+name+' [2022-06-03] (SMW Hack).bps'
       #ne='SMWC WLDC2022 E'+str(entrynum)+' '+str(rankings[entrynum])+str(extra)+' by '+name+' [2022-02-28] (SMW Hack).bps'
       #ne='SMWC QLDC2021 E'+str(entrynum)+' '+str(rankings[entrynum])+str(extra)+' by '+name+' [2021-10-22] (SMW Hack).bps'
       ne='SMWC CLDC2025 E'+str(entrynum)+' '+str(rankings[entrynum])+str(extra)+' by '+name+' [2025-11-25] (SMW Hack).bps'
       ne=" ".join(ne.split(" "))
       print('rename '+str(de)+' '+str(ne))
       os.rename(de, ne)


