<template>
  <div v-if="isOpen" class="modal-backdrop first-time-launch-blocking" @click.stop>
    <div class="modal first-time-launch-modal" @click.stop>
      <header class="modal-header">
        <h3>First-Time Launch Setup</h3>
        <p class="modal-subtitle">Choose how you want to play games before continuing.</p>
      </header>

      <section class="modal-body">
        <div class="form-field">
          <label class="section-label">Primary / Default Launch Method</label>
          <label class="radio-row">
            <input v-model="primaryLaunch" type="radio" value="usb2snes" />
            Hardware SNES / FXPAK PRO with USB2SNES
          </label>
          <label class="radio-row">
            <input v-model="primaryLaunch" type="radio" value="emulator" />
            Software Emulator (RetroArch)
          </label>
        </div>

        <div class="form-field emulator-summary">
          <label class="section-label">Emulator Settings</label>
          <p class="hint">
            Emulator settings are required even when using USB2SNES (for SNI / RetroArch integration).
          </p>
          <div class="summary-box">
            <div><strong>Preset:</strong> RetroArch</div>
            <div><strong>Executable:</strong> <code>{{ displayRetroarchPath || '(not found — use Customize)' }}</code></div>
            <div><strong>Core:</strong> <code>{{ displayRetroarchCorePath || '(not found — use Customize)' }}</code></div>
            <div><strong>append.cfg:</strong> <code>{{ appendConfigPath || '(program data)' }}</code></div>
          </div>
          <button type="button" class="btn-secondary" @click="emit('customize')">Customize Settings</button>
          <p v-if="customizeRequired" class="warning-text">
            Customize Settings is required when not using the default RetroArch auto-detected paths.
          </p>
        </div>
      </section>

      <footer class="modal-footer">
        <button type="button" class="btn-primary" :disabled="!canSave" @click="emitSave">Save and Continue</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EmulatorConfigDraft } from './EmulatorConfigModal.vue';

const props = defineProps<{
  isOpen: boolean;
  emulatorDraft: EmulatorConfigDraft;
  appendConfigPath: string;
  autoDetectedRetroarchPath: string;
  autoDetectedRetroarchCorePath: string;
  customized: boolean;
}>();

const emit = defineEmits<{
  save: [payload: { primaryLaunch: 'usb2snes' | 'emulator' }];
  customize: [];
}>();

const primaryLaunch = ref<'usb2snes' | 'emulator'>('emulator');

const displayRetroarchPath = computed(() => props.emulatorDraft.retroarch_path || props.autoDetectedRetroarchPath);
const displayRetroarchCorePath = computed(() => props.emulatorDraft.retroarch_core_path || props.autoDetectedRetroarchCorePath);

const customizeRequired = computed(() => {
  if (props.customized) return false;
  return !displayRetroarchPath.value || !displayRetroarchCorePath.value;
});

const canSave = computed(() => {
  if (!primaryLaunch.value) return false;
  if (customizeRequired.value) return false;
  if (props.emulatorDraft.launchProgramPreset !== 'retroarch') return false;
  return Boolean(displayRetroarchPath.value && displayRetroarchCorePath.value);
});

watch(() => props.isOpen, (open) => {
  if (open) {
    primaryLaunch.value = 'emulator';
  }
});

function emitSave() {
  if (!canSave.value) return;
  emit('save', { primaryLaunch: primaryLaunch.value });
}
</script>

<style scoped>
.first-time-launch-modal {
  width: min(620px, 94vw);
  max-height: 90vh;
  overflow: auto;
}

.section-label {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
}

.radio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.summary-box {
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 8px 0;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-box code {
  word-break: break-all;
}

.hint {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px;
}

.warning-text {
  color: #b45309;
  font-size: 12px;
  margin-top: 8px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary, #ddd);
}
</style>
