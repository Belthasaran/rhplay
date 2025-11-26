<template>
  <TransitionGroup name="toast" tag="div" class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', `toast-${toast.type}`]"
      @click="removeToast(toast.id)"
    >
      <span class="toast-icon">{{ getToastIcon(toast.type) }}</span>
      <span class="toast-message">{{ toast.message }}</span>
      <button class="toast-close" @click.stop="removeToast(toast.id)" :aria-label="'Close'">✕</button>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

function getToastIcon(type: Toast['type']): string {
  switch (type) {
    case 'success': return '✓';
    case 'error': return '✗';
    case 'warning': return '⚠';
    case 'info': return 'ℹ';
    default: return 'ℹ';
  }
}

function showToast(message: string, type: Toast['type'] = 'info', duration: number = 3000) {
  const id = nextId++;
  console.log(`[Toast Notification] [${type.toUpperCase()}] ${message} (duration: ${duration}ms)`);
  toasts.value.push({ id, message, type, duration });
  
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }
  
  return id;
}

function removeToast(id: number) {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.value.splice(index, 1);
  }
}

// Expose for use in parent component
defineExpose({ showToast, removeToast });
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 300px;
  max-width: 500px;
  pointer-events: auto;
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}

.toast:hover {
  transform: translateX(-4px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.toast-success {
  border-left: 4px solid #4caf50;
}

.toast-error {
  border-left: 4px solid #f44336;
}

.toast-info {
  border-left: 4px solid #2196f3;
}

.toast-warning {
  border-left: 4px solid #ff9800;
}

.toast-icon {
  font-size: 18px;
  font-weight: bold;
  flex-shrink: 0;
}

.toast-success .toast-icon {
  color: #4caf50;
}

.toast-error .toast-icon {
  color: #f44336;
}

.toast-info .toast-icon {
  color: #2196f3;
}

.toast-warning .toast-icon {
  color: #ff9800;
}

.toast-message {
  flex: 1;
  word-wrap: break-word;
  font-size: var(--base-font-size);
  color: var(--text-primary);
}

.toast-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.toast-close:hover {
  opacity: 1;
}

/* Transition animations */
.toast-enter-active {
  transition: all 0.3s ease;
}

.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>

