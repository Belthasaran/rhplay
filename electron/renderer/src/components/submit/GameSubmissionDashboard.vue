<template>
  <div class="submission-dashboard">
    <div class="header">
      <h3>Game Submissions</h3>
      <div class="actions">
        <button class="btn" @click="newDraft">New Draft</button>
        <button class="btn" @click="importDraft">Import Draft…</button>
        <button class="btn" :disabled="!current" @click="exportDraft">Export Draft…</button>
        <button class="btn" :disabled="!current" @click="saveAndClose">Save &amp; Close</button>
      </div>
    </div>

    <div v-if="!current" class="empty">
      <div>No draft selected.</div>
      <div class="field" style="margin-top:8px;">
        <label>Choose a saved draft to load</label>
        <div style="display:flex; gap:8px; align-items:center;">
          <select v-model="selectedDraftUuid" class="input" style="flex:1;">
            <option v-for="d in draftsDb" :key="d.draft_uuid" :value="d.draft_uuid">
              {{ d.draft_name || '(untitled)' }} — {{ new Date((d.updated_at_utc||0)*1000).toLocaleString() }} ({{ d.state || 'draft' }})
            </option>
          </select>
          <button class="btn" @click="loadSelectedDraft" :disabled="!selectedDraftUuid">Load</button>
          <button class="btn" @click="refreshDraftList">Refresh</button>
        </div>
      </div>
    </div>

    <div v-else class="wizard">
      <div class="steps">
        <button :class="['step', { active: step===1 }]" @click="step=1">1. Files</button>
        <button :class="['step', { active: step===2 }]" @click="step=2">2. Listing</button>
        <button :class="['step', { active: step===3 }]" @click="step=3">3. Listing (More)</button>
        <button :class="['step', { active: step===4 }]" @click="step=4">4. Tags</button>
        <button :class="['step', { active: step===5 }]" @click="step=5">5. Description</button>
        <button :class="['step', { active: step===5.5 }]" @click="step=5.5">5.5. Game Levels (Optional)</button>
        <button :class="['step', { active: step===6 }]" @click="step=6">6. Notes</button>
        <button :class="['step', { active: step===7 }]" @click="step=7">7. Developer Options</button>
        <button :class="['step', { active: step===8 }]" @click="step=8">8. Review &amp; Submit</button>
        <button :class="['step', { active: step===9 }]" @click="step=9">9. Publish &amp; Verify</button>
      </div>

      <div v-if="step===1" class="panel">
        <h4>Patch &amp; Screenshots</h4>
        <div class="field">
          <label>Patch (BPS ≤ 4 MiB)</label>
          <div class="file-row">
            <input type="text" class="input" :value="current.files?.patch?.path || ''" placeholder="Select .bps file" readonly />
            <button class="btn" @click="pickPatch">Browse…</button>
          </div>
          <div v-if="current.files?.patch?.size" class="hint">Size: {{ formatBytes(current.files!.patch!.size) }}</div>
        </div>

        <div class="field">
          <label>Screenshots (PNG 256×224, up to 12, ≤ 300 KB each)</label>
          <div class="file-row">
            <button class="btn" @click="pickScreenshots">Add Screenshots…</button>
          </div>
          <ul class="shots">
            <li v-for="(s, idx) in current.files!.screenshots" :key="s.path">
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
            <input v-model="current.meta.name" class="input" placeholder="Game name" />
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
            <input v-model="current!.meta.author" class="input" placeholder="Primary author" />
          </div>
          <div class="field">
            <label>Authors (comma-separated)</label>
            <input v-model.trim="current!.meta.authors" class="input" placeholder="Optional, comma-separated" />
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

      <div v-if="step===5.5" class="panel">
        <h4>Optional Game Levels Details</h4>
        <div class="grid">
          <div class="field full">
            <div class="hint" style="margin-bottom: 12px;">
              You can optionally add detailed stage/level information for your game. This information will be included in the RHPAK and can help players understand the structure of your game.
            </div>
            <button class="btn" @click="openStagesEditor">Edit Game Stages</button>
            <div v-if="current.meta.gamestages && current.meta.gamestages.length > 0" style="margin-top: 12px;">
              <div class="hint">
                <strong>{{ current.meta.gamestages.length }} stage(s) configured</strong>
              </div>
            </div>
            <div v-else style="margin-top: 12px;">
              <div class="hint">No stages configured yet. Click "Edit Game Stages" to add stage information.</div>
            </div>
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
        <h4>Developer Options</h4>
        <div class="grid">
          <div class="field full">
            <label><input type="checkbox" v-model="current!.meta.admin_only" /> Admin-only submission</label>
            <div class="hint">Do not check this unless you are a delegated admin or moderator for the Nostr system; otherwise your RHPAK will be rejected.</div>
          </div>
          <div class="field">
            <label>gvuuid</label>
            <input class="input" :value="current?.meta?.gvuuid || ''" readonly />
          </div>
          <div class="field">
            <label>gameid</label>
            <input class="input" :readonly="!current?.meta?.admin_only" v-model.trim="current!.meta.gameid" />
            <div class="hint" v-if="!current?.meta?.admin_only">Read-only. Auto-generated during save. Only editable when Admin-only is checked.</div>
          </div>
          <div class="field" v-if="current?.meta?.admin_only">
            <label>moderation_result</label>
            <select v-model="current!.meta.moderation_result" class="input">
              <option value=""></option>
              <option value="accept">Accept</option>
              <option value="reject">Reject</option>
              <option value="extinguish">Extinguish</option>
              <option value="extinguish_block">Extinguish and Block</option>
            </select>
          </div>
          <div class="field" v-if="current?.meta?.admin_only">
            <label>admin_comments</label>
            <input class="input" v-model.trim="current!.meta.admin_comments" placeholder="Optional admin/moderator comments" />
          </div>
          <div class="field full">
            <label><input type="checkbox" v-model="overrideGameIdEnabled" /> Override RHPAK gameid for testing purposes</label>
            <div class="hint">For test packages only. The override gameid will be written into the RHPAK, but not persisted to your draft. Use only for non-final testing; do not publish such RHPAKs to Nostr.</div>
          </div>
          <div class="field" v-if="overrideGameIdEnabled">
            <label>Override gameid</label>
            <input class="input" v-model.trim="overrideGameIdValue" placeholder="e.g., My_Test_Game" />
            <div class="hint">Only alphanumeric characters and underscores are allowed. Must not conflict with an existing (gameid, version) in your database.</div>
          </div>
        </div>
      </div>

      <div v-if="step===8" class="panel">
        <h4>Review</h4>
        <div class="review">
          <div><strong>Patch:</strong> <span class="mono">{{ current.files?.patch?.name || '—' }}</span></div>
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
          <button class="btn" @click="saveDraftToDb" :disabled="!current">Save Draft</button>
          <button class="btn" @click="loadDraftFromDb">Load Draft…</button>
          <button class="btn" @click="runPrepare" :disabled="!canSubmit">Prepare</button>
          <button class="btn" @click="runPackage" :disabled="!canSubmit">Package RHPAK</button>
        </div>
        <div class="hint" style="margin-top: 12px; padding: 8px; background: #fff3e0; border: 1px solid #ef6c00; border-radius: 4px; color: #333;">
          <strong style="color: #333;">Next Step:</strong> <span style="color: #333;">After packaging your RHPAK, proceed to step 9 "Publish & Verify" to provide download information and verify your uploaded file before submitting to Nostr.</span>
        </div>
      </div>

      <div v-if="step===9" class="panel">
        <h4>Publish &amp; Verify</h4>
        <div class="instructions" style="padding: 12px; background: #e3f2fd; border: 1px solid #1976d2; border-radius: 4px; margin-bottom: 16px;">
          <h5 style="margin: 0 0 8px 0; color: #1976d2;">Instructions</h5>
          <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #1a1a1a;">
            <li>Upload your packaged RHPAK file to a public location (ArDrive, IPFS, or any public HTTP/HTTPS server).</li>
            <li>If using IPFS, provide the IPFS v1 CID (starts with "bafy").</li>
            <li>If using ArDrive, provide the ArDrive file ID and file path.</li>
            <li>If using a direct download URL, provide the full URL where the file can be downloaded.</li>
            <li>Click "Verify Download" to check that the file is accessible and matches the expected SHA256 hash.</li>
            <li>Once verified, you can proceed to submit your submission to Nostr.</li>
          </ol>
          <div style="margin-top: 8px; font-size: 12px; color: #1a1a1a;">
            <strong style="color: #1a1a1a;">Note:</strong> If you make any changes to your draft (including tags or metadata), you will need to re-package the RHPAK and provide new download information, as the file contents will have changed.
          </div>
        </div>

        <div class="grid">
          <div class="field full">
            <label>RHPAK File Path</label>
            <input class="input" :value="current.meta.rhpak_path || '—'" readonly />
            <div class="hint">The local path where your RHPAK was saved. This file must be uploaded externally before verification.</div>
          </div>
          <div class="field">
            <label>SHA256 Hash</label>
            <input class="input" :value="current.meta.rhpak_sha256 || '—'" readonly />
            <div class="hint">Automatically calculated from your RHPAK file. Used to verify the downloaded file matches.</div>
          </div>
          <div class="field">
            <label>File Size</label>
            <input class="input" :value="current.meta.rhpak_size ? formatBytes(current.meta.rhpak_size) : '—'" readonly />
          </div>
          <div class="field full">
            <label>Upload Method</label>
            <select class="input" v-model="rhpakUploadMethod">
              <option value="ipfs">IPFS</option>
              <option value="ardrive">ArDrive</option>
              <option value="url">Direct Download URL</option>
            </select>
            <div class="hint">Select the method you used to upload your RHPAK file.</div>
          </div>
          <div v-if="rhpakUploadMethod === 'ipfs'" class="field full">
            <label>IPFS v1 CID (bafy...)</label>
            <input class="input" v-model.trim="current.meta.rhpak_ipfs_cid" placeholder="bafybei..." />
            <div class="hint">Provide the IPFS v1 CID (must start with "bafy").</div>
          </div>
          <template v-if="rhpakUploadMethod === 'ardrive'">
            <div class="field">
              <label>ArDrive File ID *</label>
              <input class="input" v-model.trim="current.meta.rhpak_ardrive_file_id" placeholder="e.g., abc123..." />
              <div class="hint">The ArDrive transaction/file ID for your uploaded file.</div>
            </div>
            <div class="field">
              <label>ArDrive File Path</label>
              <input class="input" v-model.trim="current.meta.rhpak_ardrive_file_path" placeholder="e.g., /MyDrive/game.rhpak" />
              <div class="hint">Optional: The path/name of the file in ArDrive.</div>
            </div>
            <div class="field full">
              <label>ArDrive Download URL</label>
              <input class="input" v-model.trim="current.meta.rhpak_download_url" placeholder="https://arweave.net/..." />
              <div class="hint">The direct download URL for the file (usually from ArDrive or Arweave gateway).</div>
            </div>
          </template>
          <div v-if="rhpakUploadMethod === 'url'" class="field full">
            <label>Download URL *</label>
            <input class="input" v-model.trim="current.meta.rhpak_download_url" placeholder="https://example.com/path/to/file.rhpak" />
            <div class="hint">Provide the full HTTP/HTTPS URL where the file can be downloaded.</div>
          </div>
        </div>

        <div v-if="current.meta.rhpak_verified" class="verified-badge" style="padding: 8px; background: #e8f5e9; border: 1px solid #2e7d32; border-radius: 4px; margin: 12px 0;">
          <strong style="color: #2e7d32;">✓ Verified</strong>
          <span style="font-size: 12px; color: #1a1a1a; margin-left: 8px;">
            File verified on {{ current.meta.rhpak_verified_at ? new Date(current.meta.rhpak_verified_at * 1000).toLocaleString() : '—' }}
          </span>
        </div>

        <div class="actions">
          <button class="btn" @click="calculateRHPakHash" :disabled="!current.meta.rhpak_path">Calculate Hash</button>
          <button class="btn" @click="verifyRHPakDownload" :disabled="!canVerify">Verify Download</button>
          <button class="btn" @click="saveDraftToDb" :disabled="!current">Save Draft</button>
          <button class="btn" @click="submitNow" :disabled="!canSubmitVerified">Submit &amp; Publish</button>
        </div>
      </div>
    </div>

    <!-- Game Stages Dialog for submission editor -->
    <GameStagesDialog
      :is-open="showStagesDialog"
      :game-id="current?.meta?.gameid || 'draft'"
      :game-name="current?.meta?.name || 'Draft Submission'"
      :game-version="current?.meta?.version || 1"
      mode="edit"
      @close="showStagesDialog = false"
      @saved="handleStagesSaved"
    />

    <!-- Custom Modal Dialogs -->
    <AlertDialog
      :visible="alertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="handleAlertConfirm"
      @cancel="handleAlertCancel"
    />
    <ConfirmDialog
      :visible="confirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      :confirm-text="confirmDialogConfirmText"
      :cancel-text="confirmDialogCancelText"
      @confirm="handleConfirmConfirm"
      @cancel="handleConfirmCancel"
    />
    <PromptDialog
      :visible="promptDialogVisible"
      :title="promptDialogTitle"
      :message="promptDialogMessage"
      :placeholder="promptDialogPlaceholder"
      :default-value="promptDialogDefaultValue"
      :input-type="promptDialogInputType"
      :required="promptDialogRequired"
      :confirm-text="promptDialogConfirmText"
      :cancel-text="promptDialogCancelText"
      @confirm="handlePromptConfirm"
      @cancel="handlePromptCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import GameStagesDialog from '../GameStagesDialog.vue';
import AlertDialog from '../AlertDialog.vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import PromptDialog from '../PromptDialog.vue';
import {
  showAlert,
  showConfirm,
  showPrompt,
  alertDialogVisible,
  alertDialogTitle,
  alertDialogMessage,
  handleAlertConfirm,
  handleAlertCancel,
  confirmDialogVisible,
  confirmDialogTitle,
  confirmDialogMessage,
  confirmDialogConfirmText,
  confirmDialogCancelText,
  handleConfirmConfirm,
  handleConfirmCancel,
  promptDialogVisible,
  promptDialogTitle,
  promptDialogMessage,
  promptDialogPlaceholder,
  promptDialogDefaultValue,
  promptDialogInputType,
  promptDialogRequired,
  promptDialogConfirmText,
  promptDialogCancelText,
  handlePromptConfirm,
  handlePromptCancel,
} from '@/utils/dialogs';
// Predefined tags loaded from text file (one tag per line)
// Vite raw import to get file contents as string
// File: electron/renderer/src/components/submit/smwtags.txt
// Users can still add custom tags via the input below.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import tagsText from './smwtags.txt?raw';

// Developer option: override RHPAK gameid (testing only)
const overrideGameIdEnabled = ref<boolean>(false);
const overrideGameIdValue = ref<string>('');

// RHPAK upload method selector
const rhpakUploadMethod = ref<'ipfs' | 'ardrive' | 'url'>('ipfs');

// Game Stages Dialog
const showStagesDialog = ref(false);

const MAX_SCREENSHOTS = 12;
const REQUIRED_WIDTH = 256;
const REQUIRED_HEIGHT = 224;
const MAX_SCREENSHOT_BYTES = 300 * 1024; // 300KB
const MAX_TOTAL_SCREENSHOTS_BYTES = MAX_SCREENSHOTS * MAX_SCREENSHOT_BYTES; // 3.6MB
const MAX_PATCH_BYTES = 4 * 1024 * 1024; // 4MB

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
    gameid?: string;
    gvuuid?: string;
    section?: string;
    admin_only?: boolean;
    moderation_result?: string;
    admin_comments?: string;
    // RHPAK publish & verify fields
    rhpak_path?: string;
    rhpak_sha256?: string;
    rhpak_size?: number;
    rhpak_ipfs_cid?: string;
    rhpak_download_url?: string;
    rhpak_ardrive_file_id?: string;
    rhpak_ardrive_file_path?: string;
    rhpak_verified?: boolean;
    rhpak_verified_at?: number;
    // Optional gamestages for RHPAK
    gamestages?: GameStage[];
  };
};

interface GameStage {
  stage_uuid?: string;
  gameid: string;
  levelnumber?: string | null;
  levelname: string;
  versions?: string;
  submapid?: string | null;
  translevel_13bf?: string | null;
  tile_x?: string | null;
  tile_y?: string | null;
  requisites?: string | null;
  playable: number;
  rando: number;
  difficulty: number;
  mainexit: number;
  keyhole: number;
  credits: number;
  ghouse: number;
  spalace: number;
  castle: number;
  boss: number;
  secret: number;
  troll: number;
  final: number;
  lock?: number;
  playlevel_patch_code?: string | null;
  excluded_patchcodes?: string | null;
  extradescription?: string | null;
}

const typeOptions = ['Standard', 'Kaizo', 'Troll', 'Puzzle', 'Tool-Assisted', 'Pit'];
const warningsOptions = [
  'Suggestive Content or Language',
  'Crude Content or Language',
  'Possible Photosensitivity Triggers',
  'Violence',
  'Mature'
];

const step = ref<1|2|3|4|5|5.5|6|7|8|9>(1);
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
  // Validate patch size if known (0 means unknown in this UI)
  const patchOk = (c.files.patch?.size || 0) === 0 || (c.files.patch!.size <= MAX_PATCH_BYTES);
  // Validate screenshots count; detailed size/dimension checks are enforced during Prepare in backend
  const shots = c.files.screenshots || [];
  const countOk = shots.length <= MAX_SCREENSHOTS;
  return hasBasics && hasTags && patchOk && countOk;
});

const canVerify = computed(() => {
  const c = current.value;
  if (!c || !c.meta.rhpak_path) return false;
  if (rhpakUploadMethod.value === 'ipfs') {
    return !!(c.meta.rhpak_ipfs_cid && c.meta.rhpak_ipfs_cid.trim().startsWith('bafy'));
  } else if (rhpakUploadMethod.value === 'ardrive') {
    return !!(c.meta.rhpak_ardrive_file_id && c.meta.rhpak_ardrive_file_id.trim()) && 
           !!(c.meta.rhpak_download_url && c.meta.rhpak_download_url.trim().startsWith('http'));
  } else if (rhpakUploadMethod.value === 'url') {
    return !!(c.meta.rhpak_download_url && c.meta.rhpak_download_url.trim().startsWith('http'));
  }
  return false;
});

const canSubmitVerified = computed(() => {
  const c = current.value;
  if (!c) return false;
  if (!c.meta.rhpak_verified || !c.meta.rhpak_sha256) return false;
  if (rhpakUploadMethod.value === 'ipfs') {
    return !!(c.meta.rhpak_ipfs_cid && c.meta.rhpak_ipfs_cid.trim().startsWith('bafy'));
  } else if (rhpakUploadMethod.value === 'ardrive') {
    return !!(c.meta.rhpak_ardrive_file_id && c.meta.rhpak_ardrive_file_id.trim()) && 
           !!(c.meta.rhpak_download_url && c.meta.rhpak_download_url.trim().startsWith('http'));
  } else if (rhpakUploadMethod.value === 'url') {
    return !!(c.meta.rhpak_download_url && c.meta.rhpak_download_url.trim().startsWith('http'));
  }
  return false;
});

function newDraft() {
  current.value = { files: { patch: null, screenshots: [] }, meta: { name: '', author: '', types: [], version: 1, demo: false, sa1: false, collab: false, warnings: [], gamestages: [] } };
  step.value = 1;
  // reset tag selection
  selectedTags.value = [];
}

async function openStagesEditor() {
  if (!current.value || !current.value.meta.name) {
    await showAlert('Please provide a game name first before editing stages.', 'Validation Error');
    return;
  }
  const api = (window as any)?.electronAPI;
  if (!api) return;
  
  // Ensure gameid exists for the stages editor
  if (!current.value.meta.gameid) {
    // Save draft first to generate gameid
    await saveDraftToDb();
    if (!current.value.meta.gameid) {
      await showAlert('Failed to generate game ID. Please save the draft first.', 'Error');
      return;
    }
  }
  
  // Clear existing stages in DB for this gameid to prevent duplicates
  // (We'll sync draft stages fresh each time)
  try {
    const existingStages = await api.getGameStages({ 
      gameid: current.value.meta.gameid,
      version: current.value.meta.version || 1
    });
    if (existingStages?.success && existingStages?.stages && existingStages.stages.length > 0) {
      // Delete all existing stages for this gameid
      for (const stage of existingStages.stages) {
        if (stage.stage_uuid && api.deleteGameStage) {
          try {
            await api.deleteGameStage({ stage_uuid: stage.stage_uuid });
          } catch (e: any) {
            console.warn('Failed to delete existing stage:', e);
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('Failed to clear existing stages:', e);
  }
  
  // If we have draft stages, temporarily save them to DB so the dialog can load them
  if (current.value.meta.gamestages && current.value.meta.gamestages.length > 0) {
    try {
      for (const stage of current.value.meta.gamestages) {
        // Save each stage to DB temporarily (they'll be cleaned up or kept based on submission approval)
        // Note: saveGameStage expects individual fields, not a nested stage object
        await api.saveGameStage({
          gameid: current.value.meta.gameid,
          levelnumber: stage.levelnumber || null,
          levelname: stage.levelname || 'New Stage',
          versions: stage.versions || '*',
          submapid: stage.submapid || null,
          translevel_13bf: stage.translevel_13bf || null,
          tile_x: stage.tile_x || null,
          tile_y: stage.tile_y || null,
          requisites: stage.requisites || null,
          playable: stage.playable ?? 1,
          rando: stage.rando ?? 1,
          difficulty: stage.difficulty ?? 0,
          mainexit: stage.mainexit ?? 1,
          keyhole: stage.keyhole ?? 0,
          credits: stage.credits ?? 0,
          water: stage.water ?? 0,
          ghouse: stage.ghouse ?? 0,
          spalace: stage.spalace ?? 0,
          castle: stage.castle ?? 0,
          boss: stage.boss ?? 0,
          secret: stage.secret ?? 0,
          troll: stage.troll ?? 0,
          final: stage.final ?? 0,
          lock: stage.lock ?? 0,
          playlevel_patch_code: stage.playlevel_patch_code || null,
          excluded_patchcodes: stage.excluded_patchcodes || null,
          extradescription: stage.extradescription || null
        });
      }
    } catch (e: any) {
      console.warn('Failed to sync draft stages to DB:', e);
      // Continue anyway - dialog will start with empty stages
    }
  }
  
  showStagesDialog.value = true;
}

async function handleStagesSaved() {
  // Load the stages from the database and store them in the draft
  // Keep the dialog open so user can continue editing
  const api = (window as any)?.electronAPI;
  if (!api || !current.value || !current.value.meta.gameid) {
    return; // Don't close dialog on error
  }
  
  try {
    // Get stages for this gameid from the database (after dialog saved them)
    const result = await api.getGameStages({ 
      gameid: current.value.meta.gameid,
      version: current.value.meta.version || 1
    });
    
    if (result?.success && result?.stages) {
      // Store stages in draft (without stage_uuid since they're draft data)
      // Also remove rhpakuuid as it will be set when the RHPAK is packaged
      current.value.meta.gamestages = result.stages.map((s: any) => {
        const { stage_uuid, rhpakuuid, ...stageData } = s;
        return stageData;
      });
    } else {
      // No stages found, clear draft stages
      current.value.meta.gamestages = [];
    }
    
    // Auto-save draft to persist stages (but keep dialog open)
    // Note: saveDraftToDb shows an alert which might reset scroll in the dialog
    // The dialog's loadStages will handle scroll restoration after the alert
    await saveDraftToDb();
  } catch (e: any) {
    console.warn('Failed to load stages after save:', e);
  }
  // Don't close the dialog - let user continue editing
}

async function pickPatch() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const res = await api.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'BPS patch', extensions: ['bps','zip'] }] });
  const file = res?.filePaths?.[0];
  if (!file) return;
  const name = file.split(/[/\\]/).pop();
  // Renderer cannot safely read file:// for size due to security; backend Prepare enforces 4MB limit.
  current.value!.files.patch = { path: file, name: name || 'patch.bps', size: 0 };
}

async function pickScreenshots() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const res = await api.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  const paths: string[] = res?.filePaths || [];
  const existing = current.value!.files.screenshots;
  // Enforce max count
  if (existing.length + paths.length > MAX_SCREENSHOTS) {
    await showAlert(`You can select up to ${MAX_SCREENSHOTS} screenshots.`, 'Validation Error');
  }
  const allowedSlots = Math.max(0, MAX_SCREENSHOTS - existing.length);
  const toAdd = paths.slice(0, allowedSlots);
  for (const p of toAdd) {
    const name = p.split(/[/\\]/).pop() || 'image.png';
    let width = 0;
    let height = 0;
    let sizeBytes = 0;
    try {
      if (api.validateScreenshot) {
        const info = await api.validateScreenshot({ filePath: p });
        if (!info?.success) {
          await showAlert(`Failed to validate screenshot ${name}: ${info?.error || 'Unknown error'}`, 'Validation Error');
          continue;
        }
        width = info.width || 0;
        height = info.height || 0;
        sizeBytes = info.sizeBytes || 0;
      }
    } catch (e: any) {
      console.warn('validateScreenshot IPC failed:', e);
    }
    if (width && height) {
      if (width !== REQUIRED_WIDTH || height !== REQUIRED_HEIGHT) {
        await showAlert(`Screenshot ${name} must be exactly ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT} (got ${width}x${height}).`, 'Validation Error');
        continue;
      }
    }
    if (sizeBytes && sizeBytes > MAX_SCREENSHOT_BYTES) {
      await showAlert(`Screenshot ${name} exceeds ${Math.floor(MAX_SCREENSHOT_BYTES/1024)}KB.`, 'Validation Error');
      continue;
    }
    const currentTotal = existing.reduce((sum, s) => sum + (s.size || 0), 0);
    if (sizeBytes && currentTotal + sizeBytes > MAX_TOTAL_SCREENSHOTS_BYTES) {
      await showAlert(`Total screenshots size exceeds ${(MAX_TOTAL_SCREENSHOTS_BYTES/1024).toFixed(0)}KB. Remove some or choose smaller images.`, 'Validation Error');
      break;
    }
    existing.push({ path: p, name, size: sizeBytes || 0, width: width || undefined, height: height || undefined });
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
    const contextTypes = Array.isArray(current.value?.meta?.types) ? [...current.value!.meta!.types] : [];
    let list: string[] = [];
    
    // Try IPC first if available
    if (api?.suggestTags) {
      try {
        const params = JSON.parse(JSON.stringify({ query, selected, contextTypes, limit: 12 }));
        const res = await api.suggestTags(params);
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

// Initial load of drafts list when component mounts
onMounted(() => {
  refreshDraftList();
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

async function exportDraft() {
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

// --- Import/Export + DB-backed draft save/load ---
async function saveDraftToDb() {
  if (!current.value) return;
  const api = (window as any)?.electronAPI;
  if (!api?.saveSubmissionDraft) { await exportDraft(); return; }
  const title = current.value?.meta?.name || 'Untitled Submission';
  try {
    // Serialize reactive object to plain JSON to avoid IPC cloning errors
    const plainPayload = JSON.parse(JSON.stringify(current.value));
    const draftUuid = (current.value as any)?.meta?.draft_uuid || null;
    const draftName = title;
    const draftData = plainPayload;
    const params = JSON.parse(JSON.stringify({ draftUuid, draftName, draftData }));
    const res = await api.saveSubmissionDraft(params);
    if (res?.success) {
      (current.value as any).meta = current.value?.meta || {};
      if (res.draftUuid) {
        (current.value as any).meta.draft_uuid = res.draftUuid;
      }
      if (res.gameid) {
        (current.value as any).meta.gameid = res.gameid;
      }
      if (res.gvuuid) {
        (current.value as any).meta.gvuuid = res.gvuuid;
      }
      await showAlert('Draft saved.', 'Success');
    } else {
      await showAlert(`Failed to save draft: ${res?.error || 'Unknown error'}`, 'Save Failed');
    }
  } catch (e: any) {
    await showAlert(`Error saving draft: ${e?.message || String(e)}`, 'Error');
  }
}

async function importDraft() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  const res = await api.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  const file = res?.filePaths?.[0];
  if (!file) return;
  try {
    const rf = await api.readFile({ filePath: file });
    const text = rf?.content || '';
    if (!text) throw new Error('Empty file or failed to read file');
    const raw = JSON.parse(text);
    current.value = coerceLoadedDraft(raw);
    step.value = 2;
    initSelectedTagsFromMeta();
  } catch (e: any) {
    await showAlert(`Error importing draft: ${e?.message || String(e)}`, 'Error');
  }
}

function coerceLoadedDraft(raw: any): Draft {
  // If it already looks like our Draft shape
  if (raw && raw.files && raw.meta && typeof raw.meta === 'object') {
    const draft: Draft = {
      files: { patch: raw.files.patch || null, screenshots: Array.isArray(raw.files.screenshots) ? raw.files.screenshots : [] },
      meta: raw.meta
    };
    return draft;
  }
  // If it looks like a prepared skeleton from newgame.js
  if (raw && (raw.gameversion || raw.metadata)) {
    const mapped = mapSkeletonToDraftMeta(raw);
    const draft: Draft = { files: { patch: null, screenshots: [] }, meta: mapped };
    return draft;
  }
  // If it's only meta-like
  if (raw && raw.name) {
    const draft: Draft = { files: { patch: null, screenshots: [] }, meta: raw } as Draft;
    return draft;
  }
  // Fallback to empty draft
  return { files: { patch: null, screenshots: [] }, meta: { name: '', author: '', types: [], version: 1, demo: false, sa1: false, collab: false, warnings: [] } };
}

// Initialize upload method based on existing draft data
function updateUploadMethodFromDraft() {
  if (!current.value) return;
  const meta = current.value.meta;
  if (meta.rhpak_ipfs_cid && meta.rhpak_ipfs_cid.trim().startsWith('bafy')) {
    rhpakUploadMethod.value = 'ipfs';
  } else if (meta.rhpak_ardrive_file_id && meta.rhpak_ardrive_file_id.trim()) {
    rhpakUploadMethod.value = 'ardrive';
  } else if (meta.rhpak_download_url && meta.rhpak_download_url.trim().startsWith('http')) {
    rhpakUploadMethod.value = 'url';
  }
}

async function loadDraftFromDb() {
  const api = (window as any)?.electronAPI;
  if (!api?.listSubmissionDrafts || !api?.loadSubmissionDraft) { await loadDraft(); return; }
  try {
    const list = await api.listSubmissionDrafts();
    const drafts = list?.drafts || [];
    if (!drafts.length) { await showAlert('No drafts saved.', 'Info'); return; }
    const labels = drafts.map((d: any) => `${d.draft_uuid} — ${d.draft_name || '(untitled)'} — updated ${new Date((d.updated_at_utc||0)*1000).toLocaleString()} (${d.state||'draft'})`);
    const pick = await showPrompt(
      `Enter draft number to load:\n${labels.map((s: string, i: number) => `${i+1}. ${s}`).join('\n')}`,
      '',
      'Load Draft',
      'Enter draft number'
    );
    const idx = pick ? (parseInt(pick, 10) - 1) : -1;
    if (idx < 0 || idx >= drafts.length) return;
    const chosen = drafts[idx];
    const got = await api.loadSubmissionDraft({ draftUuid: chosen.draft_uuid });
    if (got?.success && got?.draft?.draftData) {
      current.value = coerceLoadedDraft(got.draft.draftData);
      (current.value as any).meta = current.value?.meta || {};
      (current.value as any).meta.draft_uuid = chosen.draft_uuid;
      step.value = 2;
      initSelectedTagsFromMeta();
      updateUploadMethodFromDraft();
    } else {
      await showAlert(`Failed to load draft: ${got?.error || 'Unknown error'}`, 'Load Failed');
    }
  } catch (e: any) {
    await showAlert(`Error loading draft: ${e?.message || String(e)}`, 'Error');
  }
}

// Load list of drafts and support selecting one when no current draft is open
const draftsDb = ref<any[]>([]);
const selectedDraftUuid = ref<string>('');
async function refreshDraftList() {
  const api = (window as any)?.electronAPI;
  if (!api?.listSubmissionDrafts) return;
  try {
    const res = await api.listSubmissionDrafts();
    draftsDb.value = res?.drafts || [];
    if (!draftsDb.value.find(d => d.draft_uuid === selectedDraftUuid.value)) {
      selectedDraftUuid.value = draftsDb.value[0]?.draft_uuid || '';
    }
  } catch {
    draftsDb.value = [];
    selectedDraftUuid.value = '';
  }
}
async function loadSelectedDraft() {
  if (!selectedDraftUuid.value) return;
  const api = (window as any)?.electronAPI;
  try {
    const got = await api.loadSubmissionDraft({ draftUuid: selectedDraftUuid.value });
    if (got?.success && got?.draft?.draftData) {
      current.value = coerceLoadedDraft(got.draft.draftData);
      (current.value as any).meta = current.value?.meta || {};
      (current.value as any).meta.draft_uuid = selectedDraftUuid.value;
      step.value = 2;
      initSelectedTagsFromMeta();
    } else {
      await showAlert(`Failed to load draft: ${got?.error || 'Unknown error'}`, 'Load Failed');
    }
  } catch (e: any) {
    await showAlert(`Error loading draft: ${e?.message || String(e)}`, 'Error');
  }
}

async function saveAndClose() {
  if (!current.value) return;
  const name = current.value?.meta?.name?.trim();
  if (!name) {
    await showAlert('Please provide a unique game Name before saving and closing the draft.', 'Validation Error');
    return;
  }
  saveDraftToDb().then(() => {
    current.value = null;
    refreshDraftList();
  });
}

// --- Prepare / Package via IPC ---
async function runPrepare() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  try {
    const payload = JSON.stringify(current.value, null, 2);
    if (api.saveTextAsTempFile) {
      const tempRes = await api.saveTextAsTempFile({ prefix: 'submission_', suffix: '.json', content: payload });
      const draftUuid = (current.value as any)?.meta?.draft_uuid || null;
      const res = await api.prepareSubmission({ configPath: tempRes?.filePath || tempRes, draftUuid });
      if (res?.success) {
        // If backend returned a newgame skeleton, map it back into our Draft shape
        if (res?.skeleton && current.value) {
          const oldFiles = current.value.files ? JSON.parse(JSON.stringify(current.value.files)) : { patch: null, screenshots: [] };
          const mappedMeta = mapSkeletonToDraftMeta(res.skeleton);
          // preserve existing tags if mapping can't infer them
          if (!mappedMeta.tags && current.value.meta?.tags) {
            mappedMeta.tags = current.value.meta.tags;
          }
          const newDraft: Draft = {
            files: oldFiles,
            meta: mappedMeta
          };
          // carry forward draft uuid if returned
          if (res.draftUuid) {
            (newDraft as any).meta = newDraft.meta || {};
            (newDraft as any).meta.draft_uuid = res.draftUuid;
          }
          current.value = newDraft;
          initSelectedTagsFromMeta();

          // Persist merged draft (including files) back to DB so Files survive restart
          try {
            if (api.saveSubmissionDraft) {
              const plainPayload = JSON.parse(JSON.stringify(current.value));
              const params = JSON.parse(JSON.stringify({
                draftUuid: (current.value as any)?.meta?.draft_uuid || draftUuid || null,
                draftName: current.value?.meta?.name || 'Untitled Submission',
                draftData: plainPayload
              }));
              await api.saveSubmissionDraft(params);
            }
          } catch {}
        }
        await showAlert('Prepare completed.', 'Success');
      }
      else await showAlert(`Prepare failed: ${res?.error || 'Unknown error'}`, 'Prepare Failed');
    } else {
      await showAlert('Prepare requires Electron environment with temp file support.', 'Error');
    }
  } catch (e: any) {
    await showAlert(`Prepare error: ${e?.message || String(e)}`, 'Error');
  }
}

function mapSkeletonToDraftMeta(skel: any): Draft['meta'] {
  const gv = (skel && skel.gameversion) ? skel.gameversion : {};
  const meta: any = {};
  meta.name = gv.name || '';
  // version: number
  meta.version = (typeof gv.version === 'number') ? gv.version : (gv.version ? Number(gv.version) || 1 : 1);
  // length may be string in skeleton
  if (gv.length != null && gv !== '') {
    const n = Number(gv.length);
    meta.length = Number.isFinite(n) ? n : undefined;
  }
  meta.demo = (String(gv.demo || '').toLowerCase() === 'yes');
  meta.sa1 = (String(gv.sa1 || '').toLowerCase() === 'yes');
  meta.bruteforce = false;
  meta.collab = (String(gv.collab || '').toLowerCase() === 'yes');
  // difficulty: map back to 1..7
  const diffMap: Record<string, number> = {
    'newcomer': 1, 'casual': 2, 'skilled': 3, 'advanced': 4, 'expert': 5, 'master': 6, 'grandmaster': 7
  };
  if (gv.difficulty) {
    const key = String(gv.difficulty).toLowerCase().trim();
    meta.difficulty = diffMap[key] || undefined;
  } else if (gv.raw_difficulty && /^diff_(\d)$/.test(String(gv.raw_difficulty))) {
    const m = String(gv.raw_difficulty).match(/^diff_(\d)$/);
    meta.difficulty = m ? Number(m[1]) : undefined;
  }
  // types: from type or gametype (comma separated) → array
  const typeStr = gv.type || gv.gametype || '';
  meta.types = typeStr ? String(typeStr).split(',').map((s: string) => s.trim()).filter((s: string) => !!s) : [];
  meta.based_against = gv.based_against || 'SMW';
  meta.warnings = Array.isArray(gv.warnings) ? gv.warnings : [];
  // tags: array→csv
  if (Array.isArray(gv.tags)) {
    meta.tags = gv.tags.join(', ');
  } else if (typeof gv.tags === 'string') {
    meta.tags = gv.tags;
  }
  meta.author = gv.author || '';
  meta.authors = gv.authors || '';
  meta.url = gv.url || '';
  meta.download_url = gv.download_url || '';
  meta.description = gv.description || '';
  meta.submission_notes = gv.submission_notes || '';
  meta.gameid = gv.gameid || (skel?.metadata?.gameid) || meta.gameid || '';
  meta.gvuuid = gv.gvuuid || (skel?.metadata?.gvuuid) || meta.gvuuid || '';
  meta.section = gv.section || 'smwhacks';
  return meta as Draft['meta'];
}

async function runPackage() {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  try {
    const payload = JSON.stringify(current.value, null, 2);
    if (api.saveTextAsTempFile) {
      // Always run a fresh Prepare first to ensure artifacts (screenshots, etc.) are embedded
      const tempRes = await api.saveTextAsTempFile({ prefix: 'submission_', suffix: '.json', content: payload });
      const draftTempPath = tempRes?.filePath || tempRes;
      const draftUuid = (current.value as any)?.meta?.draft_uuid || null;
      const prep = await api.prepareSubmission({ configPath: draftTempPath, draftUuid });
      if (!prep?.success || !prep?.skeleton) {
        await showAlert(`Package failed: Prepare step did not succeed (${prep?.error || 'Unknown error'})`, 'Package Failed');
        return;
      }

      // Optional override validation
      let overrideGameId: string | undefined = undefined;
      if (overrideGameIdEnabled.value) {
        const ov = (overrideGameIdValue.value || '').trim();
        if (ov) {
          if (!/^[A-Za-z0-9_]+$/.test(ov)) {
            await showAlert('Override gameid may only contain alphanumeric characters and underscores.', 'Validation Error');
            return;
          }
          const version = current.value?.meta?.version || 1;
          try {
            const existing = await api.getGame(ov, Number(version));
            if (existing) {
              const confirmed = await showConfirm(`A game with id "${ov}" and version ${version} already exists. Using this override will conflict. Continue anyway (for testing only)?`, 'Override Conflict');
              if (!confirmed) {
                return;
              }
            }
          } catch {}
          const confirmed = await showConfirm(`You are about to package a RHPAK with override gameid "${ov}" for testing purposes. This will not be persisted to your draft. Continue?`, 'Override Confirmation');
          if (!confirmed) {
            return;
          }
          overrideGameId = ov;
        }
      }

      // If overriding, mutate the prepared skeleton's gameid before packaging
      // Apply override to ALL gameid references: gameversion, screenshots, resources, gamestages
      let preparedForPackage = prep.skeleton;
      if (overrideGameId) {
        try {
          // Override gameversion gameid
          if (preparedForPackage.gameversion) {
            preparedForPackage.gameversion.gameid = overrideGameId;
          }
          // Override metadata gameid
          if (preparedForPackage.metadata) {
            preparedForPackage.metadata.gameid = overrideGameId;
          }
          // Override all screenshots gameid
          if (Array.isArray(preparedForPackage.screenshots)) {
            preparedForPackage.screenshots = preparedForPackage.screenshots.map((shot: any) => {
              if (shot && typeof shot === 'object') {
                return { ...shot, gameid: overrideGameId };
              }
              return shot;
            });
          }
          // Override all resources gameid
          if (Array.isArray(preparedForPackage.resources)) {
            preparedForPackage.resources = preparedForPackage.resources.map((res: any) => {
              if (res && typeof res === 'object') {
                return { ...res, gameid: overrideGameId };
              }
              return res;
            });
          }
          // Override all gamestages gameid
          if (Array.isArray(preparedForPackage.gamestages)) {
            preparedForPackage.gamestages = preparedForPackage.gamestages.map((stage: any) => {
              if (stage && typeof stage === 'object') {
                return { ...stage, gameid: overrideGameId };
              }
              return stage;
            });
          }
        } catch (e) {
          console.warn('Error applying gameid override:', e);
        }
      }

      // Write prepared skeleton to a temp file for packaging
      const preparedJson = JSON.stringify(preparedForPackage, null, 2);
      const prepTempRes = await api.saveTextAsTempFile({ prefix: 'prepared_', suffix: '.json', content: preparedJson });
      const preparedPath = prepTempRes?.filePath || prepTempRes;

      // Build default filename: gameid-gamename.rhpak
      const meta = current.value?.meta || {};
      const safe = (s: string) => (s || '').toString().toLowerCase().trim().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '');
      const gameId = safe((overrideGameId || (preparedForPackage?.gameversion?.gameid) || (meta as any).gameid || meta.name || 'submission') as string);
      const gameName = safe(meta.name || '');
      const defaultName = `${gameId}${gameName ? '-' + gameName : ''}.jpg`.replace(/\.jpg$/, '.rhpak');
      const saveRes = await api.chooseSavePath({
        title: 'Save RHPAK',
        defaultPath: defaultName,
        filters: [{ name: 'RHPAK Package', extensions: ['rhpak'] }]
      });
      if (!saveRes?.success || !saveRes.filePath) {
        return;
      }
      const outPath = saveRes.filePath;
      // If an online profile with Nostr keypair is active, request packager signature metadata
      let includePackagerSignature = false;
      try {
        if (api.checkProfileForPublishing) {
          const status = await api.checkProfileForPublishing();
          includePackagerSignature = !!(status?.hasProfile && status?.hasNostrKeypair);
        }
      } catch {
        includePackagerSignature = false;
      }
      const res = await api.packageSubmission(preparedPath, outPath, includePackagerSignature ? { includePackagerSignature: true } : {});
      if (res?.success) {
        // Store RHPAK path and calculate hash
        if (current.value) {
          current.value.meta.rhpak_path = outPath;
          // Calculate hash and size
          try {
            const hashRes = await api.calculateFileHash({ filePath: outPath });
            if (hashRes?.success) {
              current.value.meta.rhpak_sha256 = hashRes.sha256;
              current.value.meta.rhpak_size = hashRes.sizeBytes || 0;
              // Clear verification status since file may have changed
              current.value.meta.rhpak_verified = false;
              current.value.meta.rhpak_verified_at = undefined;
            }
          } catch (e) {
            console.warn('Failed to calculate RHPAK hash:', e);
          }
        }
        await showAlert('Package completed. Proceed to step 9 "Publish & Verify" to provide download information.', 'Package Success');
        step.value = 9;
      } else {
        await showAlert(`Package failed: ${res?.error || 'Unknown error'}`, 'Package Failed');
      }
    } else {
      await showAlert('Package requires Electron environment with temp file support.', 'Error');
    }
  } catch (e: any) {
    await showAlert(`Package error: ${e?.message || String(e)}`, 'Error');
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
      initSelectedTagsFromMeta();
      updateUploadMethodFromDraft();
    } catch (e) {
      await showAlert('Invalid draft JSON', 'Error');
    }
  } else {
    await showAlert('Reading files requires Electron environment.', 'Error');
  }
}

async function submitNow() {
  if (!current.value) return;
  if (!canSubmitVerified.value) {
    if (!canSubmit.value) {
      await showAlert('Please provide required fields and a patch file.', 'Validation Error');
    } else if (!current.value.meta.rhpak_verified) {
      await showAlert('Please verify your RHPAK download in step 9 "Publish & Verify" before submitting.', 'Validation Error');
      step.value = 9;
    } else {
      await showAlert('Please provide RHPAK download information (IPFS CID or download URL) and verify it before submitting.', 'Validation Error');
    }
    return;
  }
  const api = (window as any)?.electronAPI;
  if (!api) return;
  try {
    // Ensure profile is available
    const profileCheck = await api.checkProfileForPublishing();
    if (!profileCheck?.hasProfile || !profileCheck?.hasNostrKeypair) {
      await showAlert('An online profile with a Nostr keypair is required to submit.', 'Validation Error');
      return;
    }

    const submission = buildSubmissionPayload(current.value);
    const result = await api.enqueueGameSubmission({ submission });
    if (result?.success) {
      await showAlert('Submission enqueued for publishing to Nostr.', 'Success');
      // Optionally navigate back to review or close
    } else {
      await showAlert(`Failed to enqueue submission: ${result?.error || 'Unknown error'}`, 'Submit Failed');
    }
  } catch (e: any) {
    console.error('Submit error', e);
    await showAlert(`Error: ${e?.message || String(e)}`, 'Error');
  }
}

async function calculateRHPakHash() {
  const api = (window as any)?.electronAPI;
  if (!api || !current.value?.meta.rhpak_path) return;
  try {
    const hashRes = await api.calculateFileHash({ filePath: current.value.meta.rhpak_path });
    if (hashRes?.success) {
      if (current.value) {
        current.value.meta.rhpak_sha256 = hashRes.sha256;
        current.value.meta.rhpak_size = hashRes.sizeBytes || 0;
      }
      await showAlert('Hash calculated successfully.', 'Success');
    } else {
      await showAlert(`Failed to calculate hash: ${hashRes?.error || 'Unknown error'}`, 'Hash Failed');
    }
  } catch (e: any) {
    await showAlert(`Error calculating hash: ${e?.message || String(e)}`, 'Error');
  }
}

async function verifyRHPakDownload() {
  const api = (window as any)?.electronAPI;
  if (!api || !current.value) return;
  const meta = current.value.meta;
  if (!meta.rhpak_sha256) {
    await showAlert('Please calculate the hash first.', 'Validation Error');
    return;
  }
  let ipfsCid: string | undefined = undefined;
  let downloadUrl: string | undefined = undefined;
  
  if (rhpakUploadMethod.value === 'ipfs') {
    ipfsCid = meta.rhpak_ipfs_cid?.trim();
    if (!ipfsCid) {
      await showAlert('Please provide an IPFS CID.', 'Validation Error');
      return;
    }
  } else if (rhpakUploadMethod.value === 'ardrive') {
    if (!meta.rhpak_ardrive_file_id?.trim()) {
      await showAlert('Please provide an ArDrive File ID.', 'Validation Error');
      return;
    }
    downloadUrl = meta.rhpak_download_url?.trim();
    if (!downloadUrl) {
      await showAlert('Please provide an ArDrive download URL.', 'Validation Error');
      return;
    }
  } else if (rhpakUploadMethod.value === 'url') {
    downloadUrl = meta.rhpak_download_url?.trim();
    if (!downloadUrl) {
      await showAlert('Please provide a download URL.', 'Validation Error');
      return;
    }
  }
  
  try {
    const verifyRes = await api.verifyRHPakDownload({
      expectedSha256: meta.rhpak_sha256,
      ipfsCid: ipfsCid || undefined,
      downloadUrl: downloadUrl || undefined
    });
    if (verifyRes?.success) {
      if (current.value) {
        current.value.meta.rhpak_verified = true;
        current.value.meta.rhpak_verified_at = Math.floor(Date.now() / 1000);
      }
      await showAlert('✓ Verification successful! The file is accessible and matches the expected hash.', 'Verification Success');
    } else {
      await showAlert(`Verification failed: ${verifyRes?.error || 'Unknown error'}`, 'Verification Failed');
    }
  } catch (e: any) {
    await showAlert(`Error verifying download: ${e?.message || String(e)}`, 'Error');
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
    meta: { ...draft.meta },
    rhpak: {
      sha256: draft.meta.rhpak_sha256 || '',
      size_bytes: draft.meta.rhpak_size || 0,
      ipfs_cid: draft.meta.rhpak_ipfs_cid || undefined,
      download_url: draft.meta.rhpak_download_url || undefined,
      ardrive_file_id: draft.meta.rhpak_ardrive_file_id || undefined,
      ardrive_file_path: draft.meta.rhpak_ardrive_file_path || undefined,
      verified: draft.meta.rhpak_verified || false,
      verified_at: draft.meta.rhpak_verified_at || undefined
    }
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
