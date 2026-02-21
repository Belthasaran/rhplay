<template>
  <div v-if="visible" class="modal-backdrop" @click.self.prevent>
    <div class="modal database-update-dialog">
      <header class="modal-header">
        <h3>Database Update Available</h3>
      </header>
      <section class="modal-body">
        <p class="intro-text">
          New database versions are available. Choose how to proceed:
        </p>

        <!-- Update list with per-row status -->
        <div class="update-list">
          <div
            v-for="u in mergedUpdates"
            :key="u.dbName"
            class="update-row"
            :class="getRowStatusClass(u)"
          >
            <span class="status-icon">{{ getStatusIcon(u) }}</span>
            <span class="db-name">{{ u.dbName }}</span>
            <span class="version-info">
              {{ u.currentVersion }} → {{ u.targetVersion }}
            </span>
            <span class="update-type" :class="u.canPatch ? 'patch' : 'reprovision'">
              {{ u.canPatch ? '(patch)' : '(re-provision)' }}
            </span>
            <span v-if="u.status === 'failed' && u.error" class="update-error" :title="u.error">
              {{ u.error }}
            </span>
          </div>
        </div>

        <!-- Progress section (visible during update or when we have log) -->
        <div v-if="isProcessing || (updateInfo.progressLog && updateInfo.progressLog.length > 0)" class="progress-section">
          <h4>Update Progress</h4>
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <div class="progress-text">
            <strong>{{ updateInfo.progress?.message || 'Processing...' }}</strong>
          </div>
          <div v-if="updateInfo.progress?.filename" class="progress-filename">
            <strong>File:</strong> {{ updateInfo.progress.filename }}
          </div>
          <!-- Progress log -->
          <div v-if="updateInfo.progressLog && updateInfo.progressLog.length > 0" class="progress-log">
            <div v-for="(entry, idx) in updateInfo.progressLog" :key="idx" class="progress-log-entry">
              {{ entry }}
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="updateInfo.error && !isCompletedWithErrors" class="error-box">
          <p><strong>Error:</strong> {{ updateInfo.error }}</p>
        </div>

        <!-- Success -->
        <div v-if="updateInfo.updateState === 'completed'" class="success-box">
          <p><strong>Database update completed successfully!</strong></p>
        </div>

        <!-- Completed with errors: rebuild prompt -->
        <div v-if="isCompletedWithErrors" class="warning-box">
          <p><strong>Database must be rebuilt from scratch due to corruption or errors.</strong></p>
          <p>Click <strong>Rebuild Database</strong> to clean affected database(s) and reprovision.</p>
          <p class="note-text">Note that custom-installed RHPAKs will be uninstalled.</p>
        </div>
      </section>
      <footer class="modal-footer">
        <template v-if="updateInfo.updateState === 'completed'">
          <button class="btn-primary" @click="handleContinue">Continue</button>
        </template>
        <template v-else-if="isCompletedWithErrors">
          <button class="btn-primary" @click="handleRebuildAffected">Rebuild Database</button>
          <button class="btn-secondary" @click="handleSkip">Use old Database Version</button>
        </template>
        <template v-else-if="!isProcessing">
          <button class="btn-primary" @click="handleUpdate" :disabled="false">
            Attempt to Update the databases
          </button>
          <button class="btn-secondary" @click="handleReprovision">
            Re-provision databases
          </button>
          <button class="btn-secondary" @click="handleSkip">
            Use old Databases For now
          </button>
        </template>
        <template v-else>
          <button disabled class="btn-primary">Updating...</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  visible: boolean;
  updateInfo: {
    updates?: Array<{
      dbName: string;
      currentVersion: string;
      targetVersion: string;
      canPatch: boolean;
      status?: 'pending' | 'updating' | 'success' | 'failed';
      error?: string;
    }>;
    results?: Array<{ dbName: string; success: boolean; error?: string }>;
    updatesAvailable?: boolean;
    updateState?: 'idle' | 'downloading' | 'updating' | 'completed' | 'completedWithErrors' | 'error';
    progress?: {
      message?: string;
      filename?: string;
      current?: number;
      total?: number;
      percent?: number;
    };
    progressLog?: string[];
    error?: string;
    failedDbs?: string[];
    affectedDbs?: string[];
  };
  isBlocking?: boolean;
}>();

const emit = defineEmits<{
  (e: 'skip'): void;
  (e: 'update'): void;
  (e: 'reprovision'): void;
  (e: 'rebuild-affected'): void;
}>();

const isProcessing = computed(() => {
  const s = props.updateInfo.updateState;
  return s === 'downloading' || s === 'updating';
});

const isCompletedWithErrors = computed(() => {
  return props.updateInfo.updateState === 'completedWithErrors';
});

const mergedUpdates = computed(() => {
  const updates = props.updateInfo.updates || [];
  const results = props.updateInfo.results || [];
  const resultMap = new Map(results.map((r) => [r.dbName, r]));

  return updates.map((u) => {
    const res = resultMap.get(u.dbName);
    let status = u.status || 'pending';
    let error = u.error;
    if (res !== undefined) {
      status = res.success ? 'success' : 'failed';
      error = res.error;
    }
    return { ...u, status, error };
  });
});

function getRowStatusClass(u: { status?: string }) {
  const s = u.status || 'pending';
  return `status-${s}`;
}

function getStatusIcon(u: { status?: string }) {
  const s = u.status || 'pending';
  if (s === 'success') return '✓';
  if (s === 'failed') return '✗';
  if (s === 'updating') return '…';
  return '○';
}

const progressPercent = computed(() => {
  const p = props.updateInfo.progress;
  if (!p) return 0;
  if (p.percent !== undefined) return Math.max(0, Math.min(100, p.percent));
  if (p.total && p.total > 0 && p.current !== undefined) {
    return Math.round((p.current / p.total) * 100);
  }
  return 0;
});

function handleSkip() {
  emit('skip');
}

function handleUpdate() {
  emit('update');
}

function handleReprovision() {
  emit('reprovision');
}

function handleRebuildAffected() {
  emit('rebuild-affected');
}

function handleContinue() {
  emit('skip');
}
</script>

<style scoped>
.database-update-dialog {
  max-width: 550px;
  width: 90%;
}

.modal-body {
  padding: 20px;
}

.intro-text {
  margin-bottom: 16px;
}

.update-list {
  margin: 16px 0;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.update-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 14px;
}

.db-name {
  font-weight: 600;
  min-width: 120px;
}

.version-info {
  color: #333;
}

.update-type {
  font-size: 12px;
  color: #666;
}

.update-type.patch {
  color: #28a745;
}

.update-type.reprovision {
  color: #dc3545;
}

.update-row.status-success {
  color: #155724;
}

.update-row.status-failed {
  color: #721c24;
}

.update-row.status-updating {
  color: #0c5460;
}

.update-error {
  font-size: 11px;
  color: #721c24;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-icon {
  min-width: 20px;
  font-weight: bold;
}

.progress-section {
  margin: 20px 0;
  padding: 15px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.progress-bar-container {
  width: 100%;
  height: 20px;
  background: #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-bar {
  height: 100%;
  background: #007bff;
  transition: width 0.3s ease;
}

.progress-text,
.progress-filename {
  margin: 4px 0;
  font-size: 14px;
}

.progress-log {
  max-height: 150px;
  overflow-y: auto;
  margin-top: 10px;
  padding: 8px;
  background: #1e1e1e;
  color: #e0e0e0;
  font-family: monospace;
  font-size: 11px;
  border-radius: 4px;
}

.progress-log-entry {
  padding: 2px 0;
  word-break: break-all;
}

.warning-box {
  margin: 16px 0;
  padding: 12px;
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  color: #856404;
}

.warning-box .note-text {
  font-size: 12px;
  margin-top: 8px;
  color: #666;
}

.error-box {
  margin: 16px 0;
  padding: 12px;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
  color: #721c24;
}

.success-box {
  margin: 16px 0;
  padding: 12px;
  background: #d4edda;
  border: 1px solid #c3e6cb;
  border-radius: 4px;
  color: #155724;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 15px 20px;
  border-top: 1px solid #e0e0e0;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0056b3;
}

.btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-secondary:hover {
  background: #5a6268;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e0e0e0;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}
</style>
