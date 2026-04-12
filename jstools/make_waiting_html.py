import os
import json
import pathlib
import re
import csv
import html
import json
import ast
import traceback
import shutil
#from zipfile import ZipFile
import py7zr
from datetime import datetime, timezone

basedir = pathlib.Path(__file__).parent.resolve()
gamesdir = os.path.join(basedir)
indexdir = os.path.join(basedir, '..', 'refmaterial', 'index7z')
worlddir = os.path.join(basedir, 'smwc_world')
uploaddir = os.path.join(worlddir, 'upload')
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
    <meta charset="UTF-8">
    <title>Waiting Archive Index</title>
 </head>
<script>
 var openButton = null;
 var closeButton = null;
 var dialog = null;
 var dialogMessage = null

 document.addEventListener('DOMContentLoaded', (event) => {
 openButton = document.getElementById('openDialogButton');
 closeButton = document.getElementById('closeDialogButton');
 dialog = document.getElementById('acknowledgmentDialog');
 dialogMessage = document.getElementById('dialogMessage');

 closeButton.addEventListener('click', () => {
    dialog = document.getElementById('acknowledgmentDialog');
    dialog.close();
  });

 })

//openButton.addEventListener('click', () => {
//    dialog.showModal();
//});



 function escapeP(text) {
    p = document.createElement('p')
    texto = document.createTextNode(text)
    p.appendChild(texto)
    return p.innerHTML.replaceAll("\\n","<br>")
 }

 function escH(text) {
    p = document.createElement('p')
    texto = document.createTextNode(text)
    p.appendChild(texto)
    return p.innerHTML;
 }


 function showNote(text) {
 dialog.showModal()
 dialogMessage.innerHTML =  (text);
 //alert(text)
 }

 function modData(el) {
 //alert(" GameID: " + el.parentElement.getAttribute("data-gameid"))
 linkData = escH(el.parentElement.getAttribute("data-mod-link"));
 threadData = escH(el.parentElement.getAttribute("data-mod-thread"));
 gameId = escH(el.parentElement.getAttribute("data-gameid"))

 html_gameid = `<A HREF="https://www.smwcentral.net/?p=section&a=details&id=${gameId}" TARGET="_new">${gameId}</A>`;
 html_link = `<A HREF="${linkData}" target="_new">${linkData}</A>`;
 html_thread  = `<A HREF="${threadData}" target="_new">${threadData}</A>`;

 if (!linkData) {
   html_link = "null";
 };
 if (!threadData) {
 html_link = "null";
 }

 mod_result = (el.parentElement.getAttribute("data-mod-result"));
 if (mod_result && mod_result !== "") {
     esc_mod_result = escH(mod_result);
 } else {
     esc_mod_result = "";
 }

 mod_status  = (el.parentElement.getAttribute("data-mod-status"));
 if (mod_status && mod_status !== "") {
     esc_mod_status = escH(mod_status);
 } else {
    esc_mod_status = "";
 }

if (esc_mod_result === "" && esc_mod_status !== "") {
    esc_mod_result = esc_mod_status;
}


 showNote(`GameID: ${html_gameid}\\nName: ${escH(el.parentElement.getAttribute("data-name"))}\\nResult: ${esc_mod_result}\\nModerator: ${escH(el.parentElement.getAttribute("data-mod-moderator"))}\\nNote: ${escH(el.parentElement.getAttribute("data-mod-note"))}\\nLink: ${html_link}\\nThread: ${html_thread}\\nT:${escH(el.parentElement.getAttribute("data-mod-t"))}  `.replaceAll("\\n","<br>"))
 }
</script>
<style>
body {
  background-color: #1e1e28;
  color: #ddd;
  font-family: "Segoe UI", "Open Sans", sans-serif;
  margin: 0;
  padding: 0;
}

.m_alert {
color: cyan !important;
font-weight: bold;
}

.m_removed {
  color: red !important;
  font-weight: bold;
}

.m_waiting {
  color: orange !important;
  font-weight: bold;
}

.m_moderated {
   color: darkgreen !important;
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

<dialog id="acknowledgmentDialog">
    <p id="dialogMessage">This is a non-editable message for the user to acknowledge.</p>
    <button id="closeDialogButton">OK</button>
</dialog>


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
                    #
                    if str(record["gameid"])+"_"  in status:
                        record["moderated_d"] = status[ str(record["gameid"]) + "_" ]
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
    moddata = {}
    blockentry = False
    if "moderated_d" in record:
        moddata = record["moderated_d"]
    if record["moderated"] == "Moderated" or re.match(r'^moderated.*', record["moderated"],re.I)  or re.match(r'^accepted.*', record["moderated"],re.I) :
        modclass = "m_moderated"
        modemoji = "✅ "
    elif record["moderated"] == "Waiting" or re.match(r'^waiting.*', record["moderated"],re.I) :
        modclass = "m_waiting"
        modemoji = "⌛"
    elif record["moderated"] == "Removed" or re.match(r'^removed.*', record["moderated"],re.I)  or re.match(r'^block.*', record["moderated"], re.I) :
        modclass = "m_removed"
        modemoji = "❌"
    elif record["moderated"] == "Rejected" or re.match(r'^rejected.*', record["moderated"],re.I) :
        modemoji = "❌"
        modclass = "m_rejected"
    elif record["moderated"] == "A3" or re.match(r'^a3.*', record["moderated"],re.I) :
        modclass = "m_removed"
        modemoji = "❌❌"
        blockentry = True
    elif record["moderated"] == "Alert" or re.match(r'^alert.*', record['moderated'],re.I):
        modemoji = "[‼️]"
        modclass = "m_alert"
    elif record["moderated"] == "Unlogged" or  re.match(r'^unlogged.*', record['moderated'],re.I):
        modemoji = "❓"
        modclass = "m_alert"
    elif record["moderated"] == "":
        modemoji = "❓"
        record["moderated"] = "Unknown"
        modclass = ""
    else:
        modclass = ""

    if x ==0 :
        modclass = ""
        modemoji = ""
    record["modclass"] = modclass
    record["modemoji"] = modemoji
    record["moddata_s"] = ""
    moddata_s = ' data-gameid="' + html.escape(str(record["gameid"]))  + '"'
    moddata_s = moddata_s + ' data-name="' + html.escape(str(record["name"])) + '"'
    for w in ['link','thread','moderator','t','note','result','status']:
        if w in moddata:
            moddata_s = moddata_s + " data-mod-" + w + '="' + html.escape(moddata[w])  + '"'
        pass
    record["moddata_s"] = moddata_s
    record["waiting_anchor"]='<a href="https://arweave.net/{data_txid}">'.format(**record);
    record["end_waiting_anchor"]='</a>'
    if blockentry:
        record["waiting_anchor"]=""
        record["end_waiting_anchor"]=""

    f.write('<tr> <td>{timeStr}</td>  <td class="{modclass}"{moddata_s}>{modemoji}<a class="{modclass}" href="#" onclick="event.preventDefault(); modData(this)">{moderated}</a></td>  <td>{waiting_anchor}{gameid}{end_waiting_anchor}</td> <td>{waiting_anchor}{name}{end_waiting_anchor}</td> <td>{demo}</td> <td>{sa1}</td> <td>{collab}</td> <td>{author}</td> <td>{authors}</td> <td>{submitter}</td> <td>{combinedtype}</td> <td>{length}</td> <td>{fields_type}</td> <td>{difficulty}</td> <td>{warnings}</td> <td>{tags}</td> </tr>'.format(**record))
    f.write("\n")
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


#print(uploaddir)

shutil.copy( os.path.join(worlddir, 'waiting_index_ar.html'),  uploaddir )
#shutil.copy( os.path.join(worlddir, 'waiting_moderated.json'), uploaddir )
shutil.copy( os.path.join(worlddir, 'waiting_packages_completed.json'), uploaddir)

with py7zr.SevenZipFile(os.path.join(uploaddir,'waiting_metadata.bin'), 'w') as archive:
    archive.write('waiting_moderated.json')
    archive.write('waiting_processed.json')
    archive.write('waiting_packages_completed.json')
    archive.write('alreadyhave.json')
    archive.write('needed.json')
    archive.write('waiting.json')
    archive.write('waiting_needed.json')
    archive.write('waiting_queue.json')
    #archive.write('games/'+gameid+'.json')









