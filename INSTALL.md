## RHTools Electron + Vue: Install and Run

### Prerequisites
- Node.js 18+ and npm
- Linux, macOS, or Windows (WSL2 supported)

### 1) Install Dependencies
Run once in the project root to install Electron and root deps:

```bash
cd /home/main/proj/rhtools
npm install
```

Install the renderer (Vue + Vite) dependencies:

```bash
npm --prefix electron/renderer install
```

### 2) Development (hot reload)
This runs Vite (Vue dev server) and Electron together. The Electron window will load `http://localhost:5173`.

```bash
cd /home/main/proj/rhtools
npm run app:dev
```

Notes:
- If you need to run each process manually:
  - Terminal A: `npm --prefix electron/renderer run dev`
  - Terminal B: `ELECTRON_START_URL=http://localhost:5173 npx electron electron/main.js`

### 3) Production Build
Build the renderer assets with Vite. Electron will load the built HTML from `electron/renderer/dist/index.html`.

```bash
cd /home/main/proj/rhtools
npm --prefix electron/renderer run build
```

### 4) Run in Production Mode
Launch Electron without the dev server. Ensure you have built step (3) first.

```bash
cd /home/main/proj/rhtools
npm run electron:start
```

### Troubleshooting
- If Electron opens a blank window in production, confirm the build exists at `electron/renderer/dist/`.
- If dev server port differs from 5173, set `ELECTRON_START_URL` accordingly.
- On Windows PowerShell, replace environment variable syntax with `cross-env` (already configured in scripts).


