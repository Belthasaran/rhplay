<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleCancel">
    <div class="modal confirm-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Confirm' }}</h3>
        <button class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <p>{{ message }}</p>
      </section>
      <footer class="modal-footer">
        <button @click="handleCancel" class="btn-secondary">{{ cancelText || 'Cancel' }}</button>
        <button @click="handleConfirm" class="btn-primary" autofocus>{{ confirmText || 'OK' }}</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
}

// Handle Escape key and Enter key
import { onMounted, onUnmounted } from 'vue';

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    handleCancel();
  } else if (event.key === 'Enter' && props.visible && event.target === document.body) {
    // Only trigger on Enter if focus is on body (not in an input field)
    handleConfirm();
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
.confirm-dialog {
  max-width: 500px;
  width: 90%;
}

.confirm-dialog .modal-body p {
  margin: 0;
  word-wrap: break-word;
}

.confirm-dialog .modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

