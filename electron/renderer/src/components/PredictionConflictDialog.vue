<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleCancelOperation">
    <div class="modal prediction-conflict-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Conflicting Prediction' }}</h3>
        <button class="close" @click="handleCancelOperation">✕</button>
      </header>
      <section class="modal-body">
        <p class="conflict-message">{{ message }}</p>
        
        <div v-if="outcomes.length > 0" class="outcomes-section">
          <p class="outcomes-label">Select an outcome to resolve this prediction:</p>
          <div class="outcomes-list">
            <button
              v-for="(outcome, index) in outcomes"
              :key="outcome.id || index"
              class="outcome-button"
              @click="handlePickOutcome(index)"
            >
              <span class="outcome-title">{{ outcome.title }}</span>
              <span v-if="outcome.channelPoints !== undefined" class="outcome-stats">
                {{ formatChannelPoints(outcome.channelPoints) }} points
              </span>
            </button>
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <button @click="handleCancelAndRefund" class="btn-secondary">
          Cancel and Refund
        </button>
        <button @click="handleCancelOperation" class="btn-secondary">
          Cancel Operation
        </button>
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
  outcomes?: Array<{
    id: string;
    title: string;
    channelPoints?: number;
    users?: number;
  }>;
}>();

const emit = defineEmits<{
  (e: 'pick-outcome', index: number): void;
  (e: 'cancel-and-refund'): void;
  (e: 'cancel-operation'): void;
}>();

function handlePickOutcome(index: number) {
  emit('pick-outcome', index);
}

function handleCancelAndRefund() {
  emit('cancel-and-refund');
}

function handleCancelOperation() {
  emit('cancel-operation');
}

function formatChannelPoints(points: number): string {
  if (points >= 1000000) {
    return (points / 1000000).toFixed(1) + 'M';
  } else if (points >= 1000) {
    return (points / 1000).toFixed(1) + 'K';
  }
  return points.toString();
}

// Handle Escape key
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    handleCancelOperation();
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
.prediction-conflict-dialog {
  max-width: 600px;
  width: 90%;
}

.conflict-message {
  margin: 0 0 20px 0;
  word-wrap: break-word;
  white-space: pre-line;
  line-height: 1.5;
}

.outcomes-section {
  margin-top: 20px;
}

.outcomes-label {
  margin: 0 0 12px 0;
  font-weight: 500;
  color: var(--text-primary);
}

.outcomes-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.outcome-button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border: 2px solid var(--border-primary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.outcome-button:hover {
  background: var(--bg-tertiary);
  border-color: var(--accent-color, #2196F3);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.outcome-button:active {
  transform: translateY(0);
}

.outcome-title {
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

.outcome-stats {
  font-size: 0.9em;
  color: var(--text-secondary);
  margin-left: 12px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.btn-secondary {
  padding: 8px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: var(--base-font-size);
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: var(--bg-tertiary);
}

.btn-secondary:active {
  background: var(--bg-primary);
}
</style>

