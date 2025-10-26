#!/bin/bash

TMPDIR=~/tmp/


# Smart startup script that handles dynamic ports
# Run from: /home/main/proj/rhtools/electron/

echo "🚀 Starting RHTools Electron App (Smart Mode)..."
echo ""

# Start Vite and capture output
echo "Starting Vite dev server..."
cd renderer
npm run dev > ${TMPDIR}/rhtools-vite.log 2>&1 &
VITE_PID=$!
cd ..

echo "Waiting for Vite to start and detecting port..."
sleep 3

# Extract the port from Vite's output
VITE_PORT=$(grep -oP 'Local:\s+http://localhost:\K\d+' ${TMPDIR}/rhtools-vite.log | head -1)

if [ -z "$VITE_PORT" ]; then
    echo "❌ Error: Could not detect Vite port!"
    echo "Vite output:"
    cat ${TMPDIR}/rhtools-vite.log
    kill $VITE_PID 2>/dev/null
    exit 1
fi

echo "✓ Vite is running on port $VITE_PORT"
echo ""
echo "Starting Electron on port $VITE_PORT..."

# Start Electron with the detected port
ELECTRON_START_URL="http://localhost:$VITE_PORT" npx electron --xdg-portal-required-version=4 main.js

# Cleanup on exit
echo ""
echo "Cleaning up..."
kill $VITE_PID 2>/dev/null
echo "Done!"

