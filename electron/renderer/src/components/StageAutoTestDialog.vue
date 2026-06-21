<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop stage-autotest-backdrop" @click.self.prevent>
      <div class="modal stage-autotest-modal">
        <header class="modal-header">
          <h3>🤖 Stage Auto Test</h3>
        </header>

        <section class="modal-body">
          <div v-if="phase === 'running'" class="autotest-progress">
            <div class="phase-label">{{ currentPhase }}</div>
            <div class="progress-message">{{ progressMessage }}</div>
            <div class="loading-spinner"></div>
          </div>

          <div v-else class="autotest-result">
            <div :class="['result-banner', resultSuccess ? 'pass' : 'fail']">
              {{ resultSuccess ? 'PASS' : 'FAIL' }}
            </div>
            <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
            <p v-if="logPath" class="log-path">Log: {{ logPath }}</p>
          </div>

          <pre v-if="logTail" class="log-tail">{{ logTail }}</pre>
        </section>

        <footer class="modal-footer">
          <template v-if="phase === 'running'">
            <button class="btn-secondary" @click="cancelTest">Cancel</button>
          </template>
          <template v-else>
            <button class="btn-primary" :disabled="running" @click="startTest">Retry</button>
            <button class="btn-secondary" @click="closeDialog">Close</button>
          </template>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { showAlert } from '@/utils/dialogs';
import type { StageTestDialogStage } from '@/components/StageTestDialog.vue';

const props = defineProps<{
  isOpen: boolean;
  stage: StageTestDialogStage | null;
  gameId: string;
  gameName?: string;
  gameVersion?: number | null;
  getPlaylevelPatchCode: (stage: StageTestDialogStage) => string;
  getRequisiteTags: (stage: StageTestDialogStage) => string[];
  formatLevelNumberHex: (levelnumber?: string | null) => string;
}>();

const emit = defineEmits<{ close: []; completed: [payload: { success: boolean }]; }>();

type Phase = 'running' | 'done';

const phase = ref<Phase>('running');
const running = ref(false);
const progressMessage = ref('Starting...');
const currentPhase = ref('init');
const resultSuccess = ref(false);
const errorMessage = ref('');
const logPath = ref('');
const logTail = ref('');
let removeProgressListener: (() => void) | null = null;

async function startTest() {
  if (!props.stage || running.value) return;
  const api = (window as any)?.electronAPI;
  if (!api?.runStageAutoTest) {
    await showAlert('Stage auto-test is not available', 'Error');
    return;
  }

  running.value = true;
  phase.value = 'running';
  progressMessage.value = 'Starting auto test...';
  currentPhase.value = 'init';
  errorMessage.value = '';
  logPath.value = '';
  logTail.value = '';

  removeProgressListener?.();
  removeProgressListener = api.onStageAutoTestProgress?.((payload: { phase?: string; message?: string }) => {
    if (payload?.phase) currentPhase.value = payload.phase;
    if (payload?.message) progressMessage.value = payload.message;
  }) || null;

  try {
    const result = await api.runStageAutoTest({
      gameId: props.gameId,
      gameVersion: props.gameVersion || 1,
      stage: props.stage,
    });

    resultSuccess.value = !!result?.success;
    errorMessage.value = result?.error || '';
    logPath.value = result?.logPath || '';
    if (result?.summary) {
      logTail.value = JSON.stringify(result.summary, null, 2);
    }
    phase.value = 'done';
    emit('completed', { success: resultSuccess.value });
  } catch (err: any) {
    resultSuccess.value = false;
    errorMessage.value = err?.message || String(err);
    phase.value = 'done';
  } finally {
    running.value = false;
    removeProgressListener?.();
    removeProgressListener = null;
  }
}

async function cancelTest() {
  const api = (window as any)?.electronAPI;
  if (api?.cancelStageAutoTest) {
    await api.cancelStageAutoTest();
  }
}

function closeDialog() {
  emit('close');
}

watch(
  () => props.isOpen,
  (open) => {
    if (open && props.stage) {
      startTest();
    } else if (!open) {
      phase.value = 'running';
      running.value = false;
    }
  }
);

onUnmounted(() => {
  removeProgressListener?.();
});
</script>

<style scoped>
.stage-autotest-backdrop {
  z-index: 26100;
}

.stage-autotest-modal {
  max-width: 820px;
  width: 94%;
}

.autotest-progress,
.autotest-result {
  min-height: 80px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phase-label {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.85em;
  opacity: 0.85;
}

.progress-message {
  text-align: center;
}

.result-banner {
  font-size: 1.4em;
  font-weight: 700;
  text-align: center;
  padding: 8px;
  border-radius: 6px;
}

.result-banner.pass {
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.15);
}

.result-banner.fail {
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.15);
}

.error-message {
  color: #e74c3c;
}

.log-path {
  font-size: 0.85em;
  word-break: break-all;
  opacity: 0.9;
}

.log-tail {
  margin-top: 12px;
  max-height: 220px;
  overflow: auto;
  font-size: 0.75em;
  background: rgba(0, 0, 0, 0.25);
  padding: 8px;
  border-radius: 4px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  margin: 8px auto 0;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent-color, #4a90d9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
