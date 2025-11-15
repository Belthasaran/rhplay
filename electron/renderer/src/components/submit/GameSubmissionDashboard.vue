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
        <button :class="['step', { active: step===3 }]" @click="step=3">3. Listing (More)</button>
        <button :class="['step', { active: step===4 }]" @click="step=4">4. Tags</button>
        <button :class="['step', { active: step===5 }]" @click="step=5">5. Description</button>
        <button :class="['step', { active: step===6 }]" @click="step=6">6. Notes</button>
        <button :class="['step', { active: step===7 }]" @click="step=7">7. Review & Submit</button>
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
        </div>
      </div>

      <div v-if="step===3" class="panel">
        <h4>Listing (More)</h4>
        <div class="grid">
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
        </div>
      </div>

      <div v-if="step===4" class="panel">
        <h4>Tags</h4>
        <div class="tags-layout">
          <div class="cat-pane">
            <div class="breadcrumb">
              <button class="btn-link" @click="browseToRoot">Root</button>
              <span v-for="(crumb, idx) in categoryBreadcrumb" :key="idx">
                › <button class="btn-link" @click="browseTo(indexPath(idx))">{{ crumb }}</button>
              </span>
            </div>
            <ul class="cat-list">
              <li v-for="child in visibleCategories" :key="child.name">
                <button class="btn-link" @click="browseInto(child.name)">{{ child.name }}</button>
              </li>
            </ul>
          </div>
          <div class="tag-pane">
            <div class="encouragement">
              <span :class="['badge', hasGraphicsMusic ? 'ok' : 'missing']">Graphics & Music</span>
              <span :class="['badge', hasDesignStyle ? 'ok' : 'missing']">Design Style</span>
              <span :class="['badge', hasTheme ? 'ok' : 'missing']">Theme</span>
              <span :class="['badge', hasSpecialization ? 'ok' : 'missing']">Specialization</span>
            </div>
            <div class="tag-picker">
              <div class="tag-input-row">
                <input
                  v-model.trim="newTag"
                  class="input"
                    placeholder="Type to search tags or categories (e.g., 'Kaizo' or 'Graphics')"
                  @keyup.enter.prevent="addCustomTagFromSuggest"
                  @input="updateRemoteSuggestions"
                />
                <button type="button" class="btn" @click="addCustomTagFromSuggest" :disabled="!newTag">Add</button>
              </div>
              <div v-if="showAnySuggestions" class="suggestions">
                <div v-if="categorySuggestions.length" class="suggest-section">
                  <div class="suggest-title">Categories</div>
                  <ul class="suggest-list">
                    <li
                      v-for="cp in categorySuggestions"
                      :key="cp"
                      @click="browseTo(cp)"
                      :title="'Browse '+cp"
                    >{{ cp }}</li>
                  </ul>
                </div>
                <div v-if="remoteSuggestions.length" class="suggest-section">
                  <div class="suggest-title">Tags</div>
                  <ul class="suggest-list">
                    <li
                      v-for="s in remoteSuggestions"
                      :key="s"
                      @click="toggleTag(s)"
                      :title="'Add '+s"
                    >{{ s }}</li>
                  </ul>
                </div>
              </div>
              <div class="cat-tags">
                <div class="cat-header">Tags in {{ currentCategoryPath || 'Root' }}</div>
                <div class="chips">
                  <button
                    v-for="t in categoryTags"
                    :key="t"
                    type="button"
                    :class="['chip', { selected: selectedTags.some(x => x.toLowerCase() === t.toLowerCase()) }]"
                    @click="toggleTag(t)"
                  >{{ t }}</button>
                </div>
              </div>
              <div v-if="recommendedTags.length" class="selected-tags">
                <span class="selected-label">Recommended:</span>
                <button
                  v-for="t in recommendedTags"
                  :key="t"
                  type="button"
                  class="chip"
                  @click="toggleTag(t)"
                  :title="'Add '+t"
                >{{ t }}</button>
              </div>
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
              <div class="hint">
                Include at least: Graphics & Music, Design Style, Theme/Genre, and Specialization tags where applicable. A minimum of 4 tags is required to finalize submission.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="step===5" class="panel">
        <h4>Description</h4>
        <div class="grid">
          <div class="field full">
            <label>Description</label>
            <textarea v-model="current.meta.description" class="textarea" rows="5" placeholder="Full description" />
          </div>
        </div>
      </div>

      <div v-if="step===6" class="panel">
        <h4>Notes</h4>
        <div class="grid">
          <div class="field full">
            <label>Submission Notes (to moderators)</label>
            <textarea v-model="current.meta.submission_notes" class="textarea" rows="4" />
          </div>
        </div>
      </div>

      <div v-if="step===7" class="panel">
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

const typeOptions = ['Standard', 'Kaizo', 'Troll', 'Puzzle', 'Tool-Assisted', 'Pit'];
const warningsOptions = [
  'Suggestive Content or Language',
  'Crude Content or Language',
  'Possible Photosensitivity Triggers',
  'Violence',
  'Mature'
];

const step = ref<1|2|3|4|5|6|7>(1);
const current = ref<Draft | null>(null);
const predefinedTags = ref<string[]>([]);
const selectedTags = ref<string[]>([]);
const newTag = ref<string>('');
const tagsMap = ref<Record<string, string[]>>({});
const categoryTree = ref<any>(null);
const recommendedTags = computed(() => {
  const tags = new Set<string>();
  const meta = current.value?.meta;
  // basic recommendations from Types
  if (meta?.types?.includes('Kaizo')) {
    tags.add('kaizo');
  }
  if (meta?.types?.includes('Troll')) {
    tags.add('troll');
  }
  // simple heuristics from description text
  const desc = (meta?.description || '').toLowerCase();
  if (desc.includes('chocolate')) tags.add('chocolate');
  if (desc.includes('vanilla')) tags.add('vanilla');
  // return only those not already selected and that exist in predefined list (when present)
  return Array.from(tags)
    .filter(t => !selectedTags.value.some(x => x.toLowerCase() === t.toLowerCase()));
});
const remoteSuggestions = ref<string[]>([]);

const canSubmit = computed(() => {
  const c = current.value;
  if (!c) return false;
  const hasBasics = !!(c.files.patch && c.meta.name && c.meta.author && (c.meta.version ?? 1) >= 1);
  const hasTags = selectedTags.value.length >= 4;
  return hasBasics && hasTags;
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
  const api = (window as any)?.electronAPI;
  if (api?.getTagCategoryTree && api?.getTagsMap) {
    api.getTagCategoryTree().then((res: any) => {
      if (res?.success) categoryTree.value = res.tree;
    }).catch(() => {});
    api.getTagsMap().then((res: any) => {
      if (res?.success) tagsMap.value = res.tags || {};
    }).catch(() => {});
  }
});

// ---- Category browsing state & helpers ----
const currentCategoryPath = ref<string>('');
const categoryBreadcrumb = computed(() => currentCategoryPath.value ? currentCategoryPath.value.split(' > ').filter(Boolean) : []);
function indexPath(idx: number) {
  return categoryBreadcrumb.value.slice(0, idx + 1).join(' > ');
}
function browseToRoot() {
  currentCategoryPath.value = '';
  fetchCategoryTags();
}
function browseTo(pathStr: string) {
  currentCategoryPath.value = pathStr || '';
  fetchCategoryTags();
}
function browseInto(childName: string) {
  const next = currentCategoryPath.value ? (currentCategoryPath.value + ' > ' + childName) : childName;
  currentCategoryPath.value = next;
  fetchCategoryTags();
}
const visibleCategories = computed(() => {
  // Walk the tree along currentCategoryPath
  const path = categoryBreadcrumb.value;
  let node = categoryTree.value;
  try {
    if (!node) return [];
    let children = node.children || [];
    if (!path.length) return children;
    for (const part of path) {
      const found = (children || []).find((c: any) => c.name === part);
      if (!found) return [];
      children = found.children || [];
    }
    return children || [];
  } catch {
    return [];
  }
});
const categoryTags = ref<string[]>([]);
function fetchCategoryTags() {
  const api = (window as any)?.electronAPI;
  if (!api?.getTagsByCategory) { categoryTags.value = []; return; }
  const cp = currentCategoryPath.value || '';
  api.getTagsByCategory(cp).then((res: any) => {
    categoryTags.value = res?.success ? (res.tags || []) : [];
  }).catch(() => { categoryTags.value = []; });
}

// Encouragement checks
const hasGraphicsMusic = computed(() => hasAnySelectedInPrefixes(['Content & Presentation > Graphics & Visual Style', 'Content & Presentation > Music & Audio']));
const hasDesignStyle = computed(() => hasAnySelectedInPrefixes(['Design & Structure']));
const hasTheme = computed(() => hasAnySelectedInPrefixes(['Content & Presentation > Themes & Genres']));
const hasSpecialization = computed(() => hasAnySelectedInPrefixes(['Gameplay & Difficulty > Gameplay Specializations', 'Gameplay & Difficulty > Core Mechanics']));
function hasAnySelectedInPrefixes(prefixes: string[]) {
  const map = tagsMap.value || {};
  for (const tag of selectedTags.value) {
    const paths = map[tag] || map[String(tag).toLowerCase()] || [];
    if (paths.some((p: string) => prefixes.some(pref => String(p).startsWith(pref)))) return true;
  }
  return false;
}

// Remote suggestions using IPC suggest with ranking
let suggestTimer: any = null;
function updateRemoteSuggestions() {
  clearTimeout(suggestTimer);
  const query = (newTag.value || '').trim();
  if (!query) {
    remoteSuggestions.value = [];
    return;
  }
  suggestTimer = setTimeout(async () => {
    const api = (window as any)?.electronAPI;
    const selected = selectedTags.value.slice();
    const contextTypes = current.value?.meta?.types || [];
    let list: string[] = [];
    
    // Try IPC first if available
    if (api?.suggestTags) {
      try {
        const res = await api.suggestTags({ query, selected, contextTypes, limit: 12 });
        list = res?.success ? (res.suggestions || []) : [];
      } catch (e) {
        console.warn('IPC suggestTags failed:', e);
      }
    }
    
    // Fallback to local substring search if remote is empty or not available
    if ((!list || list.length === 0) && Object.keys(tagsMap.value || {}).length > 0) {
      const all = Object.keys(tagsMap.value);
      const q = query.toLowerCase();
      const notSelected = (t: string) => !selected.some(x => x.toLowerCase() === t.toLowerCase());
      list = all.filter(t => notSelected(t) && t.toLowerCase().includes(q)).slice(0, 12);
    }
    
    remoteSuggestions.value = list || [];
  }, 150);
}
function addCustomTagFromSuggest() {
  addCustomTag();
  updateRemoteSuggestions();
}

// Category suggestions while typing
const allCategoryPaths = ref<string[]>([]);
watch(categoryTree, () => {
  allCategoryPaths.value = [];
  try {
    function walk(node: any, prefix: string) {
      if (!node) return;
      const name = node.name || '';
      // Skip including the root name in paths; start paths at first-level categories
      const isRoot = !prefix && name && String(name).toLowerCase().includes('smw tag categories');
      const pathHere = isRoot ? '' : (name ? (prefix ? (prefix + ' > ' + name) : name) : prefix);
      if (node.children && node.children.length) {
        for (const child of node.children) walk(child, pathHere);
      } else if (pathHere) {
        // include leaf paths
        allCategoryPaths.value.push(pathHere);
      }
      // also include intermediate nodes as selectable categories
      if (pathHere) allCategoryPaths.value.push(pathHere);
    }
    walk(categoryTree.value, '');
    // dedupe/sort
    const set = new Set(allCategoryPaths.value);
    allCategoryPaths.value = Array.from(set).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {}
});
const categorySuggestions = computed(() => {
  const q = (newTag.value || '').toLowerCase();
  if (!q) return [];
  return allCategoryPaths.value.filter(p => p.toLowerCase().includes(q)).slice(0, 10);
});
const showAnySuggestions = computed(() => {
  return (categorySuggestions.value.length + remoteSuggestions.value.length) > 0;
});

// Watch newTag to update suggestions as user types
watch(newTag, () => {
  updateRemoteSuggestions();
});

// If tags map loads after user has started typing, refresh suggestions so tag matches appear
watch(tagsMap, () => {
  if (newTag.value) {
    updateRemoteSuggestions();
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
.suggestions .suggest-section { padding: 6px 8px; }
.suggestions .suggest-title { font-size: 11px; color: var(--text-secondary,#666); margin: 4px 0; }
.suggestions .suggest-list { list-style: none; padding: 0; margin: 0; }
.suggestions .suggest-list li { padding: 6px 10px; cursor: pointer; }
.suggestions .suggest-list li:hover { background: #f0f7ff; }
.tags-layout { display: grid; grid-template-columns: 260px 1fr; gap: 12px; }
.cat-pane { border-right: 1px solid var(--border-color,#eee); padding-right: 10px; }
.breadcrumb { font-size: 12px; color: var(--text-secondary,#666); margin-bottom: 6px; }
.cat-list { list-style: none; padding: 0; margin: 0; }
.cat-list li { padding: 4px 0; }
.tag-pane { display: flex; flex-direction: column; gap: 10px; }
.encouragement { display: flex; gap: 8px; flex-wrap: wrap; }
.badge { font-size: 11px; padding: 2px 6px; border-radius: 10px; border: 1px solid #ccc; }
.badge.ok { background: #e8f5e9; border-color: #2e7d32; color: #2e7d32; }
.badge.missing { background: #fff3e0; border-color: #ef6c00; color: #ef6c00; }
.cat-tags .cat-header { font-size: 12px; color: var(--text-secondary,#666); margin: 6px 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
