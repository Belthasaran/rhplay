#!/usr/bin/python

import sys
import json
import re
import os
import loadsmwrh
import pb_repatch

def mkpage_function(args,jsonfile='randomsel.json'):
    f0 = open(jsonfile, 'r')
    h = json.loads(f0.read())

    sitags = "Tags:" + " ".join(h["tags"])
    siname = h["name"]
    if re.match('^Super ', siname):
        siname = siname[6:]
    if len(siname) > 23:
        siname = siname[0:20] + '...'
    siurl = h["url"].replace('https://','').replace('www.smwcentral.net','smwcentral.net')
    siadded = h["added"]
    siauthors = h["authors"]
    if re.search(' ', siadded):
        siadded = siadded.split(' ')[0]
    if re.search('-', siadded):
        vec1 = siadded.split('-')
        siadded = vec1[0] # + '-' + vec1[1]
    

    of = open('_curhack.html', 'w')
    of.write("""
<HTML>
<HEAD>
<STYLE>
  * {
/*    background: #35393e; */
    background: black;
    color: #f6f6f6;
    font-size: 30px;
  }
  #infotable {
      opacity: 0.80;
  }
</STYLE>
 <META http-equiv="refresh" content="20"/>
</HEAD>
<BODY>
 <TABLE ID="infotable">
""")

    fmt = 2
    if not('method' in h):
        h["method"] = ""
    if fmt == 1:
      of.write('<TR><TD>' + h["method"].capitalize() + h["id"] + ' // ' + siname + ' // ' + siauthors + " <BR>" + h["type"] + ' // ' + siadded  + " // " + sitags + '</TD></TR>')
    else:
      of.write('<TR><TD>' +
              h["method"].capitalize() + h["id"] + "<BR>" +
              siname + ' <BR> ' + siauthors + " <BR> " +
              h["type"] + '<BR> ' + siadded + '<BR>' +
             '</TD></TR>'
            )
    #of.write('<TR><TH></TH><TD>' + h["method"].capitalize() +  '</TD></TR>' )
    #of.write('<TR><TH>Id, Authors</TH><TD>' + h["id"].capitalize() +  ', ' + h["authors"] + '</TD></TR>' )
    #of.write('<TR><TH>Name</TH><TD>' + h["name"] +  '</TD></TR>' )
    #of.write('<TR><TH>Url</TH><TD>' + h["url"] +  '</TD></TR>' )
    of.write("""
  </TABLE>
 </BODY>
</HTML>
""")
    f0.close()
    #

if __name__ == '__main__':
    jsonfile = 'randomsel.json'
    if len(sys.argv)>1:
        if os.path.exists(sys.argv[1]):
            jsonfile = sys.argv[1]
        else:
            romfile = pb_repatch.repatch_function(sys.argv)
            if romfile:
                jsonfile = romfile + 'json'
    mkpage_function(sys.argv,jsonfile=jsonfile)
    

