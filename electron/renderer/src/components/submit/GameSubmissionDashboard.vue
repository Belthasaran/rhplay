<template>
  <div class="submission-dashboard">
    <div class="header">
      <h3>Game Submissions</h3>
      <div class="actions">
        <button class="btn" @click="newDraft">New Draft</button>
        <button class="btn" @click="loadDraft">Load Draft…</button>
        <button class="btn" :disabled="!current" @click="saveDraft">Save Draft…</button>
        <button class="btn" :disabled="!current || !canSubmit" @click="submitNow">Submit & Publish</button>
      </div>
    </div>

    <div v-if="!current" class="empty">No draft selected. Create a new draft or load one.</div>

    <div v-else class="wizard">
      <div class="steps">
        <button :class="['step', { active: step===1 }]" @click="step=1">1. Files</button>
        <button :class="['step', { active: step===2 }]" @click="step=2">2. Metadata</button>
        <button :class="['step', { active: step===3 }]" @click="step=3">3. Review & Submit</button>
      </div>

      <div v-if="step===1" class="panel">
        <h4>Patch & Screenshots</h4>
        <div class="field">
          <label>Patch (BPS ≤ 4 MiB)</label>
          <div class="file-row">
            <input type="text" class="input" :value="current.files.patch?.path || ''" placeholder="Select .bps file" readonly />
            <button class="btn" @click="pickPatch">Browse…</button>
          </div>
          <div v-if="current.files.patch?.size" class="hint">Size: {{ formatBytes(current.files.patch.size) }}</div>
        </div>

        <div class="field">
          <label>Screenshots (PNG 256×224, up to 5, ≤ 300 KB each)</label>
          <div class="file-row">
            <button class="btn" @click="pickScreenshots">Add Screenshots…</button>
          </div>
          <ul class="shots">
            <li v-for="(s, idx) in current.files.screenshots" :key="s.path">
              <span class="mono">{{ s.name }}</span>
              <span class="meta">{{ s.width }}×{{ s.height }}, {{ formatBytes(s.size) }}</span>
              <button class="btn-link" @click="removeShot(idx)">Remove</button>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="step===2" class="panel">
        <h4>Metadata</h4>
        <div class="grid">
          <div class="field">
            <label>Name *</label>
            <input v-model.trim="current.meta.name" class="input" placeholder="Game name" />
          </div>
          <div class="field">
            <label>Exit Count</label>
            <input v-model.number="current.meta.length" class="input" type="number" min="0" />
          </div>
          <div class="field">
            <label>Difficulty</label>
            <select v-model.number="current.meta.difficulty" class="input">
              <option :value="1">1 - Newcomer</option>
              <option :value="2">2 - Casual</option>
              <option :value="3">3 - Skilled</option>
              <option :value="4">4 - Advanced</option>
              <option :value="5">5 - Expert</option>
              <option :value="6">6 - Master</option>
              <option :value="7">7 - Grandmaster</option>
            </select>
          </div>
          <div class="field">
            <label>Type (select one or more)</label>
            <div class="chips">
              <label v-for="t in typeOptions" :key="t"><input type="checkbox" :value="t" v-model="current.meta.types" /> {{ t }}</label>
            </div>
          </div>
          <div class="field">
            <label>Author *</label>
            <input v-model.trim="current.meta.author" class="input" placeholder="Primary author" />
          </div>
          <div class="field">
            <label>Authors (comma-separated)</label>
            <input v-model.trim="current.meta.authors" class="input" placeholder="Optional, comma-separated" />
          </div>
          <div class="field full">
            <label>Description</label>
            <textarea v-model="current.meta.description" class="textarea" rows="5" placeholder="Full description" />
          </div>
          <div class="field full">
            <label>Tags (comma-separated)</label>
            <input v-model.trim="current.meta.tags" class="input" placeholder="e.g. vanilla, cape, puzzle" />
          </div>
          <div class="field full">
            <label>Submission Notes (to moderators)</label>
            <textarea v-model="current.meta.submission_notes" class="textarea" rows="3" />
          </div>
        </div>
      </div>

      <div v-if="step===3" class="panel">
        <h4>Review</h4>
        <div class="review">
          <div><strong>Patch:</strong> <span class="mono">{{ current.files.patch?.name || '—' }}</span></div>
          <div><strong>Screenshots:</strong> {{ current.files.screenshots.length }}</div>
          <div><strong>Name:</strong> {{ current.meta.name || '—' }}</div>
          <div><strong>Author:</strong> {{ current.meta.author || '—' }}</div>
          <div><strong>Difficulty:</strong> {{ current.meta.difficulty || '—' }}</div>
          <div><strong>Types:</strong> {{ current.meta.types.join(', ') || '—' }}</div>
          <div><strong>Exit Count:</strong> {{ current.meta.length ?? '—' }}</div>
        </div>
        <div class="actions">
          <button class="btn" @click="submitNow" :disabled="!canSubmit">Submit & Publish</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

type PatchFile = { path: string; name: string; size: number } | null;
type ShotFile = { path: string; name: string; size: number; width?: number; height?: number };

type Draft = {
  files: { patch: PatchFile; screenshots: ShotFile[] };
  meta: {
    name: string;
    length?: number | null;
    difficulty?: number | null;
    types: string[];
    author: string;
    authors?: string;
    description?: string;
    tags?: string;
    submission_notes?: string;
  };
};

const typeOptions = ['Standard', 'Kaizo', 'Puzzle', 'Tool-Assisted', 'Pit'];

const step = ref<1|2|3>(1);
const current = ref<Draft | null>(null);

const canSubmit = computed(() => {
  const c = current.value;
  if (!c) return false;
  return !!(c.files.patch && c.meta.name && c.meta.author);
});

function newDraft() {
  current.value = { files: { patch: null, screenshots: [] }, meta: { name: '', author: '', types: [] } };
  step.value = 1;
}

async function pickPatch() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const res = await api.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'BPS patch', extensions: ['bps'] }] });
  const file = res?.filePaths?.[0];
  if (!file) return;
  // We cannot directly read file size here without fs; accept path and name. Size unknown → optional.
  const name = file.split(/[/\\]/).pop();
  current.value!.files.patch = { path: file, name: name || 'patch.bps', size: 0 };
}

async function pickScreenshots() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const res = await api.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  const paths: string[] = res?.filePaths || [];
  for (const p of paths) {
    const name = p.split(/[/\\]/).pop() || 'image.png';
    current.value!.files.screenshots.push({ path: p, name, size: 0 });
  }
}

function removeShot(idx: number) {
  current.value?.files.screenshots.splice(idx, 1);
}

function formatBytes(v: number) {
  if (!v || v <= 0) return '—';
  const units = ['B','KB','MB','GB'];
  let i=0; let n=v;
  while (n>=1024 && i<units.length-1) { n/=1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

async function saveDraft() {
  if (!current.value) return;
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const payload = JSON.stringify(current.value, null, 2);
  // Reuse existing API if available; otherwise, offer simple download via browser
  if (api.saveTextAsFile) {
    await api.saveTextAsFile({ defaultPath: 'game-submission-draft.json', content: payload });
  } else {
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'game-submission-draft.json'; a.click();
    URL.revokeObjectURL(url);
  }
}

async function loadDraft() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const res = await api.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  const file = res?.filePaths?.[0];
  if (!file) return;
  if (api.readTextFile) {
    const text = await api.readTextFile(file);
    try {
      current.value = JSON.parse(text);
      step.value = 2;
    } catch (e) {
      alert('Invalid draft JSON');
    }
  } else {
    alert('Reading files requires Electron environment.');
  }
}

async function submitNow() {
  if (!current.value) return;
  if (!canSubmit.value) {
    alert('Please provide required fields and a patch file.');
    return;
  }
  const api = (window as any)?.electronAPI;
  if (!api) return;
  try {
    // Ensure profile is available
    const profileCheck = await api.checkProfileForPublishing();
    if (!profileCheck?.hasProfile || !profileCheck?.hasNostrKeypair) {
      alert('An online profile with a Nostr keypair is required to submit.');
      return;
    }

    const submission = buildSubmissionPayload(current.value);
    const result = await api.enqueueGameSubmission({ submission });
    if (result?.success) {
      alert('Submission enqueued for publishing.');
      step.value = 3;
    } else {
      alert(`Failed to enqueue submission: ${result?.error || 'Unknown error'}`);
    }
  } catch (e: any) {
    console.error('Submit error', e);
    alert(`Error: ${e?.message || String(e)}`);
  }
}

function buildSubmissionPayload(draft: Draft) {
  const now = Math.floor(Date.now() / 1000);
  return {
    created_at_ts: now,
    files: {
      patch: draft.files.patch ? { path: draft.files.patch.path, name: draft.files.patch.name, size: draft.files.patch.size } : null,
      screenshots: draft.files.screenshots.map(s => ({ path: s.path, name: s.name, size: s.size, width: s.width, height: s.height }))
    },
    meta: { ...draft.meta }
  };
}
</script>

<style scoped>
.submission-dashboard { display: flex; flex-direction: column; gap: 12px; }
.header { display: flex; justify-content: space-between; align-items: center; }
.actions { display: flex; gap: 8px; }
.btn { padding: 6px 12px; border: 1px solid var(--border-color,#ddd); border-radius: 4px; background: var(--bg-primary,#fff); cursor: pointer; font-size: 13px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-link { background: none; border: none; color: #1976d2; cursor: pointer; text-decoration: underline; font-size: 11px; }
.empty { color: var(--text-secondary,#666); padding: 8px; }
.wizard { border: 1px solid var(--border-color,#ddd); border-radius: 6px; background: var(--bg-primary,#fff); }
.steps { display: flex; gap: 6px; border-bottom: 1px solid var(--border-color,#eee); padding: 8px; }
.step { padding: 6px 10px; border: 1px solid var(--border-color,#ddd); border-radius: 4px; background: var(--bg-secondary,#f5f5f5); cursor: pointer; font-size: 12px; }
.step.active { background: #e3f2fd; border-color: #1976d2; color: #1976d2; }
.panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.full { grid-column: 1 / -1; }
.input, .textarea, select.input { padding: 8px; border: 1px solid var(--border-color,#ddd); border-radius: 4px; font-size: 13px; }
.file-row { display: flex; gap: 8px; align-items: center; }
.shots { list-style: none; padding: 0; margin: 6px 0 0; }
.shots li { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.mono { font-family: monospace; font-size: 11px; }
.meta { color: var(--text-secondary,#666); }
.review { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 8px; }
</style>
