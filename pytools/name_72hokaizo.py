sys.exit(0)
for de in os.listdir("."):
    m = re.match(r'(\d+)_([^\.]+).bps',de)
    if m:
       entrynum = m.group(1)
       name = m.group(2)
       ne='SMWC 72hour Kaizo Level Design Contest '+str(entrynum)+' by '+name+' [2025-04-12] (SMW Hack)  [Kaizo].bps'
       print('rename '+str(de)+' '+str(ne))
       os.rename(de, ne)


