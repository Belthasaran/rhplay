import os
import json
import pathlib
import re
import csv
import html
import json
import ast
import traceback
from datetime import datetime, timezone

basedir = pathlib.Path(__file__).parent.resolve()
gamesdir = os.path.join(basedir)
indexdir = os.path.join(basedir, '..', 'refmaterial', 'index7z')
status = {}

cols = ['moderated','time','date','gameid','name','demo','sa1','collab','author','authors','submitter','combinedtype','length','fields_type','difficulty','warnings','url','section','tags','bps_files','json_files','data_txid']
items = []

fwaiting = open('waiting.json', 'r')
for gamew in json.load(fwaiting):
    status[ str(gamew["id"]) ] = "Waiting"
fwaiting.close()

fstatus = open('waiting_moderated.json', 'r')
for key,value in json.load(fstatus).items():
    status[ key ] = value
#status = json.load(fstatus)
fstatus.close()


with open(os.path.join(basedir,'smwc_world', 'waiting_index_ar.csv'), 'r', newline='') as csvf:
    csv_reader = csv.reader(csvf, delimiter=',')
    for row in csv_reader:
        if not(row[21]) or row[21] == '':
            continue
        record = {}
        for x in range(len(cols)):
            record[ cols[x] ] = html.escape(row[x])
            if cols[x] == "json_files" :
                record[ cols[x] ] = row[x]
        items.insert(0,record)
items = sorted(items, key=lambda y: y['time'], reverse=True)

f = open('waiting_index_ar.html', 'w')

f.write("""
<html>
 <head>
    <title>Waiting Archive Index</title>
 </head>
<style>
body {
  background-color: #1e1e28;
  color: #ddd;
  font-family: "Segoe UI", "Open Sans", sans-serif;
  margin: 0;
  padding: 0;
}

.m_alert {
color: cyan;
font-weight: bold;
}

.m_removed {
  color: red;
  font-weight: bold;
}

.m_waiting {
  color: orange;
  font-weight: bold;
}

.m_moderated {
   color: darkgreen;
   font-weight: bold;
}

.page-header {
  text-align: center;
  padding: 2rem 1rem;
  border-bottom: 1px solid #333;
}

.page-header h1 {
  color: #b88cff;
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.subtitle {
  color: #aaa;
  font-size: 0.95rem;
}

.content {
  max-width: 900px;
  margin: 2rem auto;
  padding: 1rem;
}

.table-section {
  background-color: #2a2a36;
  border-radius: 10px;
  padding: 1rem;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
}

.release-table {
  width: 100%;
  border-collapse: collapse;
}

.release-table th,
.release-table td {
  padding: 0.75rem 1rem;
  text-align: left;
}

.release-table thead {
  background-color: #333344;
}

.release-table th {
  color: #b88cff;
  font-weight: 500;
  border-bottom: 1px solid #444;
}

.release-table tr:nth-child(even) {
  background-color: #242430;
}

.release-table tr:hover {
  background-color: #353545;
}

.release-table a {
  color: #80aaff;
  text-decoration: none;
}

.release-table a:hover {
  text-decoration: underline;
}

.footer {
  text-align: center;
  font-size: 0.9rem;
  color: #777;
  padding: 1.5rem 0;
  border-top: 1px solid #333;
}

ol {
	list-style-type: decimal;
}
</style>

<body>
""")


f.write('<table class="release-table">')
x=0
for record in items:
    if x == 0:
        f.write('<thead style="position: sticky; top: 0;">')
        record['timeStr'] = record['time']
    else:
        #
        timeStr = str(record['time'])
        try:
            if record['time'] and not(record['time'] == 'time'):
                dto = datetime.fromtimestamp( int(record['time']), tz=timezone.utc )
                timeStr = dto.strftime('%Y-%m-%d T%H:%M:%SZ')
        except Exception as xer:
            print("ERR " + str(xer))
            pass
        record['timeStr'] = timeStr
        try:
            #print(record['json_files'])
            for json_file in ast.literal_eval(record['json_files']) :
                codeString = json_file.split('.')[0]
                if  codeString in status:
                    record["moderated"] = status[codeString]
                    raise Exception("Found status")
                elif record["gameid"] in status:
                    record["moderated"] = status[ record["gameid"] ]
                    raise Exception("Found status")
                jsonf = open(os.path.join(indexdir, json_file), 'r')
                jsond = json.load(jsonf)
                jsonf.close()
                if "gameversion" in jsond:
                    #print("FOUND gameversion " + codeString)
                    if "removed" in jsond["gameversion"] and str(jsond["gameversion"]["removed"]) == "1":
                        status[codeString] = "Removed"
                    elif "removed" in jsond["gameversion"] and str(jsond["gameversion"]["removed"]).lower() == "yes":
                        status[codeString] = "Removed"
                    elif "obsoleted" in jsond["gameversion"] and str(jsond["gameversion"]["obsoleted"]) == "1":
                        status[codeString] = "Obsoleted"
                    elif "obsoleted" in jsond["gameversion"] and str(jsond["gameversion"]["obsoleted"]).lower() == "yes":
                        status[codeString] = "Obsoleted"
                    elif "moderated" in jsond["gameversion"] and str(jsond["gameversion"]["moderated"]) == "1":
                        status[codeString] = "Moderated"
                    elif  "moderated" in jsond["gameversion"] and str(jsond["gameversion"]["moderated"]).lower() == "yes":
                        status[codeString] = "Moderated"
                    #print("New status " + status[codeString])

                    if codeString in status:
                        print(f'{codeString},{status[codeString].rstrip()}')
                        if status[codeString] == "Moderated" :
                            record["moderated"] = "Moderated"
                        if status[codeString] == "Removed" :
                            record["moderated"] = "Removed"
                        if status[codeString] == "Obsoleted" : 
                            record["moderated"] = "Obsoleted"
                #print(json_file)
        except Exception as xerr:
            #print("ERR:" + str(xerr))
            #traceback.print_exc()
            pass
        #
    modclass = ""
    modemoji = ""
    if record["moderated"] == "Moderated" or re.match(r'^moderated.*', record["moderated"],re.I)  or re.match(r'^accepted.*', record["moderated"],re.I) :
        modclass = "m_moderated"
        modemoji = "✅ "
    elif record["moderated"] == "Waiting" or re.match(r'^waiting.*', record["moderated"],re.I) :
        modclass = "m_waiting"
        modemoji = "⌛"
    elif record["moderated"] == "Removed" or re.match(r'^removed.*', record["moderated"],re.I) :
        modclass = "m_removed"
        modemoji = "❌"
    elif record["moderated"] == "Rejected" or re.match(r'^rejected.*', record["moderated"],re.I) :
        modemoji = "❌"
        modclass = "m_rejected"
    elif record["moderated"] == "Alert" or re.match(r'^alert.*', record['moderated'],re.I):
        modemoji = "[‼️]"
        modclass = "m_alert"
    else:
        modclass = ""

    if x ==0 :
        modclass = ""
        modemoji = ""
    record["modclass"] = modclass
    record["modemoji"] = modemoji
    f.write('<tr> <td>{timeStr}</td>  <td class="{modclass}">{modemoji}{moderated}</td>  <td><a href="https://arweave.net/{data_txid}">{gameid}</a></td> <td><a href="https://arweave.net/{data_txid}">{name}</a></td> <td>{demo}</td> <td>{sa1}</td> <td>{collab}</td> <td>{author}</td> <td>{authors}</td> <td>{submitter}</td> <td>{combinedtype}</td> <td>{length}</td> <td>{fields_type}</td> <td>{difficulty}</td> <td>{warnings}</td> <td>{tags}</td> </tr>'.format(**record))
    if x == 0:
        f.write('</thead><tbody>')
    f.write('\n')
    x = x+1
f.write('<tr></tr>')
f.write('</tbody>')
f.write('</table>')
f.write("""
        </body>
        </html>
        """)









