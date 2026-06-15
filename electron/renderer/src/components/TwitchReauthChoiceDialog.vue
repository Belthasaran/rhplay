<template>
  <div v-if="visible" class="modal-backdrop">
    <div class="modal twitch-reauth-choice-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Twitch Re-authentication Required' }}</h3>
        <button class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <p>{{ message }}</p>
      </section>
      <footer class="modal-footer">
        <button @click="handleCancel" class="btn-secondary">Cancel</button>
        <button @click="handleSystemBrowser" class="btn-primary">Open In System Browser</button>
        <button @click="handleInApp" class="btn-secondary">Open In App</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
  title?: string;
  message: string;
}>();

const emit = defineEmits<{
  (e: 'choice', value: 'cancel' | 'system_browser' | 'in_app'): void;
}>();

function handleCancel() {
  emit('choice', 'cancel');
}

function handleSystemBrowser() {
  emit('choice', 'system_browser');
}

function handleInApp() {
  emit('choice', 'in_app');
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.visible) return;
  if (event.key === 'Escape') {
    handleCancel();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.twitch-reauth-choice-dialog {
  max-width: 560px;
  width: 90%;
}

.twitch-reauth-choice-dialog .modal-body p {
  margin: 0;
  word-wrap: break-word;
}

.twitch-reauth-choice-dialog .modal-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
