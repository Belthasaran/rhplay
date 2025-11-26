<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleCancel">
    <div class="modal alert-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Alert' }}</h3>
        <button class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <p>{{ message }}</p>
      </section>
      <footer class="modal-footer">
        <button @click="handleConfirm" class="btn-primary" autofocus>OK</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
  title?: string;
  message: string;
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

// Handle Escape key
import { onMounted, onUnmounted } from 'vue';

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    handleCancel();
  } else if (event.key === 'Enter' && props.visible) {
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
.alert-dialog {
  max-width: 500px;
  width: 90%;
}

.alert-dialog .modal-body p {
  margin: 0;
  word-wrap: break-word;
}
</style>

