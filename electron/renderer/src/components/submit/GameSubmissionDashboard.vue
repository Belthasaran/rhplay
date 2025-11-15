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
        <button :class="['step', { active: step===2 }]" @click="step=2">2. Listing</button>
        <button :class="['step', { active: step===3 }]" @click="step=3">3. Description</button>
        <button :class="['step', { active: step===4 }]" @click="step=4">4. Notes</button>
        <button :class="['step', { active: step===5 }]" @click="step=5">5. Review & Submit</button>
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
        <h4>Listing</h4>
        <div class="grid">
          <div class="field">
            <label>Name *</label>
            <input v-model.trim="current.meta.name" class="input" placeholder="Game name" />
          </div>
          <div class="field">
            <label>Version *</label>
            <input v-model.number="current.meta.version" class="input" type="number" min="1" />
          </div>
          <div class="field">
            <label>Based Against</label>
            <input class="input" value="SMW" disabled />
          </div>
          <div class="field">
            <label>Length (exits)</label>
            <input v-model.number="current.meta.length" class="input" type="number" min="0" />
            <div class="hint">Standard: use exit count (e.g., "Length: 5 exit(s)"). Non-standard lengths require moderator approval.</div>
          </div>
          <div class="field">
            <label>Demo</label>
            <select v-model="current.meta.demo" class="input">
              <option :value="false">No</option>
              <option :value="true">Yes</option>
            </select>
          </div>
          <div class="field">
            <label>SA-1</label>
            <select v-model="current.meta.sa1" class="input">
              <option :value="false">No</option>
              <option :value="true">Yes</option>
            </select>
          </div>
          <div class="field">
            <label>Collab</label>
            <select v-model="current.meta.collab" class="input">
              <option :value="false">No</option>
              <option :value="true">Yes</option>
            </select>
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
          <div class="field full">
            <label>Warnings</label>
            <div class="chips">
              <label v-for="w in warningsOptions" :key="w"><input type="checkbox" :value="w" v-model="current.meta.warnings" /> {{ w }}</label>
            </div>
          </div>
          <div class="field">
            <label>Info URL</label>
            <input v-model.trim="current.meta.url" class="input" placeholder="https://example.com/info" />
          </div>
          <div class="field">
            <label>Download URL</label>
            <input v-model.trim="current.meta.download_url" class="input" placeholder="https://example.com/download" />
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
            <label>Tags</label>
            <div class="tag-picker">
              <div class="tag-input-row">
                <input
                  v-model.trim="newTag"
                  class="input"
                  placeholder="Type to search tags (e.g., 'Kaizo')"
                  @keyup.enter.prevent="addCustomTag"
                />
                <button type="button" class="btn" @click="addCustomTag" :disabled="!newTag">Add</button>
              </div>
              <ul v-if="filteredSuggestions.length" class="suggestions">
                <li
                  v-for="s in filteredSuggestions"
                  :key="s"
                  @click="toggleTag(s)"
                  :title="'Add '+s"
                >{{ s }}</li>
              </ul>
              <div v-if="selectedTags.length" class="selected-tags">
                <span class="selected-label">Selected:</span>
                <button
                  v-for="t in selectedTags"
                  :key="t"
                  type="button"
                  class="chip selected removable"
                  @click="removeTag(t)"
                  :title="'Remove '+t"
                >{{ t }} ✕</button>
              </div>
              <div class="hint">Final value is saved as a comma-separated list. Prefer predefined tags to ensure consistent search/filtering.</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="step===3" class="panel">
        <h4>Description</h4>
        <div class="grid">
          <div class="field full">
            <label>Description</label>
            <textarea v-model="current.meta.description" class="textarea" rows="5" placeholder="Full description" />
          </div>
        </div>
      </div>

      <div v-if="step===4" class="panel">
        <h4>Notes</h4>
        <div class="grid">
          <div class="field full">
            <label>Submission Notes (to moderators)</label>
            <textarea v-model="current.meta.submission_notes" class="textarea" rows="4" />
          </div>
        </div>
      </div>

      <div v-if="step===5" class="panel">
        <h4>Review</h4>
        <div class="review">
          <div><strong>Patch:</strong> <span class="mono">{{ current.files.patch?.name || '—' }}</span></div>
          <div><strong>Screenshots:</strong> {{ current.files.screenshots.length }}</div>
          <div><strong>Name:</strong> {{ current.meta.name || '—' }}</div>
          <div><strong>Version:</strong> {{ current.meta.version || 1 }}</div>
          <div><strong>Author:</strong> {{ current.meta.author || '—' }}</div>
          <div><strong>Difficulty:</strong> {{ current.meta.difficulty || '—' }}</div>
          <div><strong>Types:</strong> {{ current.meta.types.join(', ') || '—' }}</div>
          <div><strong>Length:</strong> {{ current.meta.length != null ? (current.meta.length + ' exit(s)') : '—' }}</div>
          <div><strong>Demo:</strong> {{ current.meta.demo ? 'Yes' : 'No' }}</div>
          <div><strong>SA-1:</strong> {{ current.meta.sa1 ? 'Yes' : 'No' }}</div>
          <div><strong>Collab:</strong> {{ current.meta.collab ? 'Yes' : 'No' }}</div>
          <div><strong>Warnings:</strong> {{ (current.meta.warnings || []).join(', ') || '—' }}</div>
          <div><strong>Info URL:</strong> {{ current.meta.url || '—' }}</div>
          <div><strong>Download URL:</strong> {{ current.meta.download_url || '—' }}</div>
        </div>
        <div class="actions">
          <button class="btn" @click="submitNow" :disabled="!canSubmit">Submit & Publish</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
// Predefined tags loaded from text file (one tag per line)
// Vite raw import to get file contents as string
// File: electron/renderer/src/components/submit/smwtags.txt
// Users can still add custom tags via the input below.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import tagsText from './smwtags.txt?raw';

type PatchFile = { path: string; name: string; size: number } | null;
type ShotFile = { path: string; name: string; size: number; width?: number; height?: number };

type Draft = {
  files: { patch: PatchFile; screenshots: ShotFile[] };
  meta: {
    name: string;
    version?: number | null;
    length?: number | null;
    difficulty?: number | null;
    types: string[];
    author: string;
    authors?: string;
    description?: string;
    tags?: string;
    submission_notes?: string;
    demo?: boolean;
    sa1?: boolean;
    collab?: boolean;
    url?: string;
    download_url?: string;
    warnings?: string[];
  };
};

const typeOptions = ['Standard', 'Kaizo', 'Puzzle', 'Tool-Assisted', 'Pit'];
const warningsOptions = [
  'Suggestive Content or Language',
  'Crude Content or Language',
  'Possible Photosensitivity Triggers',
  'Violence',
  'Mature'
];

const step = ref<1|2|3|4|5>(1);
const current = ref<Draft | null>(null);
const predefinedTags = ref<string[]>([]);
const selectedTags = ref<string[]>([]);
const newTag = ref<string>('');
const filteredSuggestions = computed(() => {
  const q = (newTag.value || '').toLowerCase();
  if (!q) return [];
  const notSelected = (t: string) => !selectedTags.value.some(x => x.toLowerCase() === t.toLowerCase());
  return predefinedTags.value
    .filter(t => notSelected(t) && t.toLowerCase().includes(q))
    .slice(0, 12);
});

const canSubmit = computed(() => {
  const c = current.value;
  if (!c) return false;
  return !!(c.files.patch && c.meta.name && c.meta.author && (c.meta.version ?? 1) >= 1);
});

function newDraft() {
  current.value = { files: { patch: null, screenshots: [] }, meta: { name: '', author: '', types: [], version: 1, demo: false, sa1: false, collab: false, warnings: [] } };
  step.value = 1;
  // reset tag selection
  selectedTags.value = [];
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

// ---- Tag selection helpers ----
function parsePredefinedTags(raw: string): string[] {
  return (raw || '')
    .split(/\r?\n/g)
    .map(s => s.trim())
    .filter(s => !!s && !s.startsWith('#'))
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    .sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function initSelectedTagsFromMeta() {
  const tagsCsv = current.value?.meta?.tags || '';
  const parts = tagsCsv.split(',').map(s => s.trim()).filter(Boolean);
  selectedTags.value = Array.from(new Set(parts));
}

function syncMetaTagsFromSelected() {
  if (!current.value) return;
  current.value.meta.tags = selectedTags.value.join(', ');
}

function toggleTag(tag: string) {
  const idx = selectedTags.value.findIndex(t => t.toLowerCase() === tag.toLowerCase());
  if (idx >= 0) {
    selectedTags.value.splice(idx, 1);
  } else {
    selectedTags.value.push(tag);
  }
  syncMetaTagsFromSelected();
}

function addCustomTag() {
  const t = (newTag.value || '').trim();
  if (!t) return;
  if (!selectedTags.value.some(x => x.toLowerCase() === t.toLowerCase())) {
    selectedTags.value.push(t);
    syncMetaTagsFromSelected();
  }
  newTag.value = '';
}

function removeTag(tag: string) {
  const idx = selectedTags.value.findIndex(t => t.toLowerCase() === tag.toLowerCase());
  if (idx >= 0) {
    selectedTags.value.splice(idx, 1);
    syncMetaTagsFromSelected();
  }
}

onMounted(() => {
  predefinedTags.value = parsePredefinedTags(tagsText as string);
  if (current.value) {
    initSelectedTagsFromMeta();
  }
});

watch(() => current.value?.meta?.tags, () => {
  // keep selectedTags in sync if meta.tags changes externally (e.g., loading draft)
  initSelectedTagsFromMeta();
});

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
      step.value = 5;
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
.tag-picker { display: flex; flex-direction: column; gap: 8px; }
.tag-chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 140px; overflow: auto; padding: 4px; border: 1px solid var(--border-color,#eee); border-radius: 6px; background: var(--bg-primary,#fff); }
.chip { padding: 4px 8px; border: 1px solid var(--border-color,#ccc); border-radius: 12px; background: var(--bg-secondary,#f5f5f5); font-size: 12px; cursor: pointer; }
.chip.selected { background: #e3f2fd; border-color: #1976d2; color: #1976d2; }
.chip.removable { background: #e8f5e9; border-color: #2e7d32; color: #2e7d32; }
.tag-input-row { display: flex; gap: 8px; align-items: center; }
.selected-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.selected-label { font-size: 12px; color: var(--text-secondary,#666); margin-right: 4px; }
.hint { font-size: 12px; color: var(--text-secondary,#666); }
.suggestions { margin: 0; padding: 6px 0; list-style: none; border: 1px solid var(--border-color,#eee); border-radius: 6px; max-height: 200px; overflow: auto; background: var(--bg-primary,#fff); }
.suggestions li { padding: 6px 10px; cursor: pointer; }
.suggestions li:hover { background: #f0f7ff; }
</style>
