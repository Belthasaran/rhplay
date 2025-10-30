#!/bin/bash

# Extract level names for all gameids in the gameversions table
# Saves output as temp/<gameid>_levelids.json

export DISPLAY=:1

cd lmlevelnames

# Get all unique gameids from rhdata.db
echo "Fetching all gameids from rhdata.db..."
if [ -z "$GAMEIDS" ] ; then
GAMEIDS=$(sqlite3 ../electron/rhdata.db "SELECT DISTINCT gameid FROM gameversions WHERE gameid IS NOT NULL ORDER BY gameid")
fi

if [ -z "$GAMEIDS" ]; then
    echo "No gameids found in rhdata.db"
    exit 1
fi

echo "Found $(echo "$GAMEIDS" | wc -l) unique gameids"

# Create temp directory if it doesn't exist
mkdir -p temp

# Counter for progress
total=$(echo "$GAMEIDS" | wc -l)
current=0

for i_gameid in $GAMEIDS; do
    current=$((current + 1))
    echo "[$current/$total] Processing gameid: $i_gameid"
    
    # Get the highest version for this gameid
    VERSION=$(sqlite3 ../electron/rhdata.db "SELECT MAX(version) FROM gameversions WHERE gameid = '$i_gameid'")
    echo "  Using version: $VERSION"
    
    set -x
    # Fetch the patch for the highest version
    ../enode.sh ../jstools/fetchpatches.js mode3 -q patch -b gameid $i_gameid -o temp/temp.bps --patchbindb=../electron/patchbin.db --rhdatadb=../electron/rhdata.db
    
    if [ $? -ne 0 ]; then
        echo "  Error: no patch found for gameid $i_gameid -- skipping"
        continue
    fi
    
    # Apply the patch to create patched ROM
    flips --apply temp/temp.bps smw.sfc temp/temp.sfc
    if [ $? -ne 0 ]; then
        echo "  Failed to apply patch for gameid $i_gameid -- skipping"
        continue
    fi
    
    # Add SMC header
    echo "  Adding SMC header"
    wine snesheader.exe temp/temp.sfc 1
    if [ $? -ne 0 ]; then
        echo "  Error adding SMC header for gameid $i_gameid -- skipping"
        continue
    fi
    
    # Extract level names and save as JSON
    echo "  Extracting level names..."
    python3 levelname_extractor_json.py --levelsonly --romfile temp/temp.sfc --output temp/${i_gameid}_levelids.json --gameid $i_gameid --version $VERSION
    
    if [ $? -eq 0 ]; then
        echo "  ✓ Saved level names to temp/${i_gameid}_levelids.json"
    else
        echo >> temp/${i_gameid}.failed
        echo "  ✗ Failed to extract level names for gameid $i_gameid"
    fi
    
    # Clean up temporary files
    rm -f temp/temp.bps temp/temp.sfc
    
    echo ""
done

echo "Level extraction complete!"
echo "JSON files saved in temp/ directory"
