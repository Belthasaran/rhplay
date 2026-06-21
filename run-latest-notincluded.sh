#!/bin/bash
mkdir -p temp

enode.sh  jstools/find_waiting_notincluded.js --index=/home/steamu/rhplay/jstools/smwc_world/waiting_index_ar.csv --hidematches-all  --older-than=30 --latest-waiting-csv=temp/latest_waiting_notincluded.csv

