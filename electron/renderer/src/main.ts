import { createApp } from 'vue';
import App from './App.vue';
import Provisioner from './Provisioner.vue';

// Check for mode in query params, hash, or localStorage
let mode = 'app';
try {
  // Check query params first
  const params = new URLSearchParams(window.location.search);
  mode = params.get('mode') || mode;
  
  // Check hash if not found in query
  if (mode === 'app' && window.location.hash) {
    const hashMatch = window.location.hash.match(/[#&]mode=([^&]+)/);
    if (hashMatch) {
      mode = hashMatch[1];
    } else {
      // Try parsing hash as URLSearchParams
      const hashStr = window.location.hash.substring(1);
      if (hashStr.includes('mode=')) {
        const hashParams = new URLSearchParams(hashStr.startsWith('?') ? hashStr.substring(1) : hashStr);
        mode = hashParams.get('mode') || mode;
      }
    }
  }
  
  // Check localStorage as backup (set by update window)
  if (mode === 'app' && typeof localStorage !== 'undefined') {
    const storedMode = localStorage.getItem('updateMode');
    if (storedMode === 'update') {
      mode = 'update';
      localStorage.removeItem('updateMode');
    }
  }
  
  // Check sessionStorage as backup
  if (mode === 'app' && typeof sessionStorage !== 'undefined') {
    const storedMode = sessionStorage.getItem('updateMode');
    if (storedMode === 'update') {
      mode = 'update';
      sessionStorage.removeItem('updateMode');
    }
  }
  
  console.log('[main.ts] Detected mode:', mode);
  console.log('[main.ts] window.location.href:', window.location.href);
  console.log('[main.ts] window.location.search:', window.location.search);
  console.log('[main.ts] window.location.hash:', window.location.hash);
} catch (e) {
  console.error('[main.ts] Error detecting mode:', e);
}

if (!(typeof process !== 'undefined' && process.env && process.env.RHTOOLS_CLI_MODE)) {
  console.log('[main.ts] Mounting Vue app, mode:', mode);
  try {
    if (mode === 'provisioner') {
      console.log('[main.ts] Creating Provisioner app');
      createApp(Provisioner).mount('#app');
    } else {
      // Always mount App - it will handle update mode internally
      console.log('[main.ts] Creating App component');
      const app = createApp(App);
      console.log('[main.ts] Mounting to #app');
      app.mount('#app');
      console.log('[main.ts] Mount complete');
    }
  } catch (error) {
    console.error('[main.ts] ERROR mounting Vue app:', error);
    // Show error on page
    document.body.innerHTML = `
      <div style="padding: 20px; background: red; color: white;">
        <h1>Vue Mount Error</h1>
        <pre>${error instanceof Error ? error.stack : String(error)}</pre>
      </div>
    `;
  }
} else {
  console.log('[main.ts] Skipping mount (CLI mode)');
}
