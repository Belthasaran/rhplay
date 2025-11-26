<template>
  <div v-if="visible" class="modal-backdrop">
    <div class="modal prompt-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Input' }}</h3>
        <button class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <p v-if="message" class="prompt-message">{{ message }}</p>
        <input
          ref="inputRef"
          v-model="inputValue"
          :type="inputType"
          :placeholder="placeholder"
          class="prompt-input"
          @keydown.enter="handleConfirm"
          @keydown.escape="handleCancel"
        />
      </section>
      <footer class="modal-footer">
        <button @click="handleCancel" class="btn-secondary">{{ cancelText || 'Cancel' }}</button>
        <button @click="handleConfirm" class="btn-primary" :disabled="!inputValue || (required && !inputValue.trim())">
          {{ confirmText || 'OK' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: string;
  required?: boolean;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm', value: string): void;
  (e: 'cancel'): void;
}>();

const inputValue = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

// Reset input when dialog opens/closes
watch(() => props.visible, (newVal) => {
  if (newVal) {
    inputValue.value = props.defaultValue || '';
    // Focus input after dialog is rendered
    nextTick(() => {
      if (inputRef.value) {
        inputRef.value.focus();
        inputRef.value.select();
      }
    });
  } else {
    inputValue.value = '';
  }
});

function handleConfirm() {
  if (props.required && !inputValue.value.trim()) {
    return;
  }
  emit('confirm', inputValue.value);
}

function handleCancel() {
  emit('cancel');
}

// Handle Escape key
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
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
.prompt-dialog {
  max-width: 500px;
  width: 90%;
}

.prompt-message {
  margin: 0 0 12px 0;
  word-wrap: break-word;
}

.prompt-input {
  width: 100%;
  padding: 8px 12px;
  font-size: var(--base-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-sizing: border-box;
}

.prompt-input:focus {
  outline: none;
  border-color: var(--border-primary);
  box-shadow: 0 0 0 2px rgba(var(--accent-color-rgb, 33, 150, 243), 0.2);
}

.prompt-dialog .modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

