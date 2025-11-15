<template>
  <div class="trust-declarations-list">
    <div class="list-header">
      <h4>Trust Declarations</h4>
      <p class="admin-note">Trust declarations establish trust relationships between public keys. These can be preconfigured or learned from the network.</p>
    </div>
    
    <!-- Trust Declarations List Widget -->
    <div class="keypairs-list-widget">
      <div class="keypairs-list-container">
        <table class="keypairs-table">
          <thead>
            <tr>
              <th style="width: 40px;"></th>
              <th>Issuing Key</th>
              <th>Subject Key</th>
              <th>Trust Level</th>
              <th>Valid From</th>
              <th>Valid To</th>
              <th>Status</th>
              <th>Publish Status</th>
            </tr>
          </thead>
          <tbody>
            <tr 
              v-for="decl in declarations" 
              :key="decl.declaration_uuid"
              :class="{ 'selected': selectedUuid === decl.declaration_uuid }"
              @click="handleSelect(decl.declaration_uuid)"
            >
              <td @click.stop>
                <input 
                  type="checkbox" 
                  :checked="selectedUuid === decl.declaration_uuid"
                  @change.stop="handleSelect(decl.declaration_uuid)"
                  @click.stop
                />
              </td>
              <td><code style="font-size: 10px;">{{ formatFingerprint(decl.signing_keypair_fingerprint) }}</code></td>
              <td><code style="font-size: 10px;">{{ formatFingerprint(decl.target_keypair_fingerprint) }}</code></td>
              <td>{{ getTrustLevelFromContent(decl) || 'N/A' }}</td>
              <td>{{ formatDate(decl.valid_from) }}</td>
              <td>{{ decl.valid_until ? formatDate(decl.valid_until) : 'No expiration' }}</td>
              <td>
                <span :class="getTrustDeclarationStatusClass(decl)">
                  {{ decl.status || 'Draft' }}
                </span>
              </td>
              <td>
                <span
                  :class="['publish-status-pill', getTrustDeclarationPublishStatusClass(decl)]"
                  :title="getTrustDeclarationPublishStatusHint(decl) || ''"
                >
                  {{ getTrustDeclarationPublishStatusLabel(decl) }}
                </span>
              </td>
            </tr>
            <tr v-if="declarations.length === 0">
              <td colspan="8" class="empty-message">No trust declarations found. Use the menu to create or import one.</td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <!-- Dropdown menu on the right -->
      <div class="keypairs-menu-container">
        <div class="dropdown-container">
          <button @click.stop="toggleActionDropdown" class="btn-secondary-small dropdown-toggle">
            Actions ▼
          </button>
          <div v-if="showActionDropdown" class="dropdown-menu" @click.stop>
            <button @click="handleAction('create')" class="dropdown-item">Create New Declaration</button>
            <button @click="handleAction('import')" class="dropdown-item">Import Declaration</button>
            <div class="dropdown-divider"></div>
            <button 
              v-if="selectedUuid" 
              @click="handleAction('view-edit')" 
              class="dropdown-item"
            >
              View/Edit
            </button>
            <button 
              v-if="selectedUuid && canSign" 
              @click="handleAction('sign')" 
              class="dropdown-item"
            >
              Add Countersignature
            </button>
            <button 
              v-if="selectedUuid" 
              @click="handleAction('publish')" 
              class="dropdown-item"
            >
              Publish Declaration
            </button>
            <button 
              v-if="selectedUuid" 
              @click="handleAction('export')" 
              class="dropdown-item"
            >
              Export Declaration
            </button>
            <button 
              v-if="selectedUuid" 
              @click="handleAction('delete')" 
              class="dropdown-item danger"
            >
              Delete Declaration
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="trust-declarations-actions">
      <button class="btn-secondary" @click="handleAction('view-summary')" :disabled="!primaryPubkey">
        View Trust Summary
      </button>
      <button class="btn-secondary" @click="handleAction('import-all')">Import</button>
      <button class="btn-primary" @click="handleAction('export-all')">Export All</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type TrustDeclaration = {
  declaration_uuid: string;
  signing_keypair_fingerprint?: string;
  target_keypair_fingerprint?: string;
  valid_from?: string;
  valid_until?: string;
  status?: string;
  content_json?: string;
  nostr_publish_status?: string | null;
  nostr_event_id?: string | null;
};

const props = defineProps<{
  declarations: TrustDeclaration[];
  selectedUuid?: string | null;
  primaryPubkey?: string | null;
  canSign?: boolean;
}>();

const emit = defineEmits<{
  (event: 'select', uuid: string): void;
  (event: 'action', action: string, uuid?: string): void;
}>();

const showActionDropdown = ref(false);

function handleSelect(uuid: string) {
  emit('select', uuid);
}

function toggleActionDropdown() {
  showActionDropdown.value = !showActionDropdown.value;
}

function handleAction(action: string) {
  showActionDropdown.value = false;
  emit('action', action, props.selectedUuid || undefined);
}

function formatFingerprint(fp: string | null | undefined): string {
  if (!fp) return 'N/A';
  return fp.substring(0, 16) + '...';
}

function getTrustLevelFromContent(decl: TrustDeclaration): string | null {
  if (!decl?.content_json) return null;
  try {
    const content = JSON.parse(decl.content_json);
    return content.trust_level || content.subject?.trust_level || null;
  } catch {
    return null;
  }
}

function getTrustDeclarationStatus(decl: TrustDeclaration): string {
  return decl.status || 'Draft';
}

function getTrustDeclarationStatusClass(decl: TrustDeclaration): string {
  const status = getTrustDeclarationStatus(decl);
  if (status === 'Published') return 'status-active';
  if (status === 'Finalized') return 'status-pending';
  if (status === 'Draft') return 'status-inactive';
  return 'status-inactive';
}

const PUBLISH_STATUS_LABELS: Record<string, string> = {
  published: 'Published',
  queued: 'Queued',
  retrying: 'Retrying',
  pending: 'Pending',
  failed: 'Failed',
  draft: 'Not Published'
};

const PUBLISH_STATUS_HINTS: Record<string, string> = {
  queued: 'Event queued for Nostr publish. Will be sent shortly.',
  retrying: 'Previous publish attempt failed. Runtime will retry automatically.',
  pending: 'Awaiting signature or publish confirmation.',
  failed: 'Publish failed. Review logs and retry.',
  draft: 'Declaration has not been published to relays yet.'
};

function getTrustDeclarationPublishStatusRaw(decl: TrustDeclaration): string {
  const raw = String(decl?.nostr_publish_status || '').toLowerCase();
  if (raw) {
    return raw;
  }
  if (decl?.nostr_event_id) {
    return 'published';
  }
  if ((decl?.status || '').toLowerCase() === 'draft') {
    return 'draft';
  }
  return 'pending';
}

function getTrustDeclarationPublishStatusLabel(decl: TrustDeclaration): string {
  const raw = getTrustDeclarationPublishStatusRaw(decl);
  if (PUBLISH_STATUS_LABELS[raw]) {
    return PUBLISH_STATUS_LABELS[raw];
  }
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown';
}

function getTrustDeclarationPublishStatusHint(decl: TrustDeclaration): string | null {
  const raw = getTrustDeclarationPublishStatusRaw(decl);
  return PUBLISH_STATUS_HINTS[raw] || null;
}

function getTrustDeclarationPublishStatusClass(decl: TrustDeclaration): string {
  const raw = getTrustDeclarationPublishStatusRaw(decl);
  return `publish-status-${raw || 'pending'}`;
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
}
</script>

<style scoped>
.trust-declarations-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.list-header h4 {
  margin: 0 0 8px;
}

.admin-note {
  color: var(--text-secondary, #666);
  font-size: 13px;
  margin: 0 0 16px;
}

.keypairs-list-widget {
  display: flex;
  gap: 16px;
}

.keypairs-list-container {
  flex: 1;
  overflow-x: auto;
}

.keypairs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.keypairs-table th,
.keypairs-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.keypairs-table th {
  background: var(--bg-secondary, #f5f5f5);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.keypairs-table tbody tr {
  cursor: pointer;
}

.keypairs-table tbody tr:hover {
  background: var(--bg-hover, #f9f9f9);
}

.keypairs-table tbody tr.selected {
  background: var(--bg-selected, #e3f2fd);
}

.empty-message {
  text-align: center;
  color: var(--text-secondary, #666);
  padding: 24px;
}

.status-active {
  color: #2e7d32;
  font-weight: 600;
}

.status-pending {
  color: #f57c00;
  font-weight: 600;
}

.status-inactive {
  color: #666;
}

.publish-status-pill {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.publish-status-published {
  background: #e8f5e9;
  color: #2e7d32;
}

.publish-status-queued {
  background: #e3f2fd;
  color: #1565c0;
}

.publish-status-retrying {
  background: #fff3e0;
  color: #f57c00;
}

.publish-status-pending {
  background: #f5f5f5;
  color: #666;
}

.publish-status-failed {
  background: #ffebee;
  color: #c62828;
}

.publish-status-draft {
  background: #f5f5f5;
  color: #999;
}

.keypairs-menu-container {
  display: flex;
  align-items: flex-start;
}

.dropdown-container {
  position: relative;
}

.dropdown-toggle {
  white-space: nowrap;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 100;
  min-width: 200px;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
}

.dropdown-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.dropdown-item.danger {
  color: #c62828;
}

.dropdown-item.danger:hover {
  background: #ffebee;
}

.dropdown-divider {
  height: 1px;
  background: var(--border-color, #ddd);
  margin: 4px 0;
}

.trust-declarations-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-secondary,
.btn-primary {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--color-primary, #1976d2);
  color: white;
  border-color: var(--color-primary, #1976d2);
}

.btn-secondary:disabled,
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary:hover:not(:disabled),
.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>

