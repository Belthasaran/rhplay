<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop" @click.self="handleCancel" style="z-index: 25000;">
      <div class="modal acknowledgment-dialog">
        <header class="modal-header">
          <h3>{{ title }}</h3>
          <button @click="handleCancel" class="close">✕</button>
        </header>
        
        <!-- Game Info Header -->
        <div class="game-info-header">
          <div class="game-info-item">
            <strong>Game ID:</strong> {{ gameId }}
          </div>
          <div class="game-info-item">
            <strong>Name:</strong> {{ gameName }}
          </div>
          <div class="game-info-item">
            <strong>Author:</strong> {{ gameAuthor || '—' }}
          </div>
        </div>
        
        <section class="modal-body acknowledgment-body">
          <div v-if="warningText" class="warning-text">
            <strong>Warning:</strong> {{ warningText }}
          </div>
          
          <div v-if="reason" class="reason-text">
            <strong>Reason:</strong> {{ reason }}
          </div>
          
          <div v-if="acknowledgments.length > 0" class="acknowledgments-section">
            <h4>Required Acknowledgments</h4>
            <p class="acknowledgment-intro">
              You must acknowledge the following content warnings to proceed:
            </p>
            <ul class="acknowledgment-list">
              <li v-for="ack in acknowledgments" :key="ack.name" class="acknowledgment-item">
                <label class="acknowledgment-label">
                  <input
                    type="checkbox"
                    :checked="acknowledged.has(ack.name)"
                    @change="toggleAcknowledgment(ack.name, ($event.target as HTMLInputElement).checked)"
                    :disabled="hardBlock"
                    class="acknowledgment-checkbox"
                  />
                  <span class="acknowledgment-name">
                    {{ ack.name }}{{ ack.alwaysRequired ? '*' : '' }}
                  </span>
                  <span class="acknowledgment-description">{{ ack.description }}</span>
                </label>
              </li>
            </ul>
          </div>
          
          <div v-if="hardBlock" class="hard-block-message">
            The game listed above is hard banned from this app function. Choose the close button to continue.
          </div>
        </section>
        
        <footer class="modal-footer">
          <button
            v-if="!hardBlock"
            @click="handleConfirm"
            :disabled="!canConfirm"
            class="btn-primary"
          >
            Confirm
          </button>
          <button @click="handleCancel" class="btn-secondary">
            {{ hardBlock ? 'Close' : 'Cancel' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Teleport } from 'vue';

interface Props {
  visible: boolean;
  title?: string;
  gameId: string;
  gameName: string;
  gameAuthor?: string;
  warningText?: string;
  reason?: string;
  requiredAcknowledgments?: string | null;
  hardBlock?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Content Warning',
  gameAuthor: '',
  warningText: '',
  reason: '',
  requiredAcknowledgments: null,
  hardBlock: false
});

const emit = defineEmits<{
  'confirm': [];
  'cancel': [];
}>();

const acknowledged = ref<Set<string>>(new Set());

// Acknowledgment descriptions
const acknowledgmentMap: Record<string, string> = {
  'Photosensitivity_Triggers': 'Content may contain flashing lights, rapid color changes, or other visual effects that could trigger photosensitive epilepsy or seizures',
  'Mature_Content': 'Content is intended for mature audiences and may contain adult themes',
  'Violence': 'Content contains depictions of violence, combat, or graphic imagery',
  'Suggestive_Content': 'Content contains suggestive themes, innuendo, or mild sexual references',
  'Crude_Content_or_Language': 'Content contains crude humor, profanity, or offensive language',
  'Sexual_Content': 'Content contains sexual themes, imagery, or explicit content',
  'Extreme_Frustration_Warning': 'Game contains trolls or extreme time-consuming or frustrating content even for players of a grandmaster+ skill level',
  'Extreme_Difficulty': 'Contains difficulty extremely higher than expected for its type/rating'
};

const acknowledgments = computed(() => {
  if (!props.requiredAcknowledgments) return [];
  
  return props.requiredAcknowledgments.split(',').map(a => a.trim()).filter(a => a).map(ack => {
    const alwaysRequired = ack.endsWith('*');
    const name = alwaysRequired ? ack.slice(0, -1) : ack;
    return {
      name,
      alwaysRequired,
      description: acknowledgmentMap[name] || 'Content warning'
    };
  });
});

const canConfirm = computed(() => {
  if (props.hardBlock) return false;
  if (acknowledgments.value.length === 0) return true;
  return acknowledged.value.size === acknowledgments.value.length;
});

function toggleAcknowledgment(name: string, checked: boolean) {
  if (checked) {
    acknowledged.value.add(name);
  } else {
    acknowledged.value.delete(name);
  }
}

function handleConfirm() {
  if (canConfirm.value) {
    emit('confirm');
  }
}

function handleCancel() {
  emit('cancel');
}

// Reset acknowledgments when dialog opens/closes or props change
watch(() => props.visible, (newVal) => {
  if (newVal) {
    acknowledged.value.clear();
  }
});

watch(() => props.requiredAcknowledgments, () => {
  acknowledged.value.clear();
});
</script>

<style scoped>
.acknowledgment-dialog {
  max-width: 90vw;
  width: 600px;
  max-height: 90vh;
}

.game-info-header {
  padding: 16px 20px;
  background: var(--bg-secondary, #f5f5f5);
  border-bottom: 1px solid var(--border-primary, #ccc);
}

.game-info-item {
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 1.5;
}

.game-info-item:last-child {
  margin-bottom: 0;
}

.game-info-item strong {
  color: var(--text-secondary, #666);
  margin-right: 8px;
}

.acknowledgment-body {
  max-height: calc(90vh - 250px);
  overflow-y: auto;
  padding: 20px;
}

.warning-text,
.reason-text {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-warning, #fff3cd);
  border-left: 4px solid var(--accent-warning, #ffc107);
  border-radius: 4px;
  line-height: 1.6;
  color: #1a1a1a; /* Dark color for high visibility */
  font-weight: 600; /* Bold text */
}

.warning-text strong,
.reason-text strong {
  color: #000000; /* Even darker for strong text */
  font-weight: 700; /* Extra bold */
}

.reason-text {
  background: var(--bg-info, #e7f3ff);
  border-left-color: var(--accent-info, #2196F3);
  color: #1a1a1a; /* Dark color for high visibility */
  font-weight: 600; /* Bold text */
}

.acknowledgments-section {
  margin-top: 20px;
}

.acknowledgments-section h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
}

.acknowledgment-intro {
  margin-bottom: 12px;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

.acknowledgment-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.acknowledgment-item {
  margin-bottom: 12px;
  padding: 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-secondary, #e0e0e0);
  border-radius: 4px;
}

.acknowledgment-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}

.acknowledgment-checkbox {
  margin-top: 2px;
  cursor: pointer;
  flex-shrink: 0;
}

.acknowledgment-checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.acknowledgment-name {
  font-weight: 600;
  color: var(--text-primary, #333);
  flex-shrink: 0;
  min-width: 200px;
}

.acknowledgment-description {
  color: var(--text-secondary, #666);
  font-size: 13px;
  line-height: 1.5;
  flex: 1;
}

.hard-block-message {
  margin-top: 20px;
  padding: 12px;
  background: var(--bg-error, #ffebee);
  border: 1px solid var(--accent-error, #f44336);
  border-radius: 4px;
  color: var(--accent-error, #d32f2f);
  font-weight: 600;
  text-align: center;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-primary, #ccc);
}

.btn-primary {
  padding: 10px 20px;
  background: var(--accent-primary, #4CAF50);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  transition: background-color 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #45a049);
}

.btn-primary:disabled {
  background: var(--bg-disabled, #ccc);
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-secondary {
  padding: 10px 20px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary, #333);
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  transition: background-color 0.2s;
}

.btn-secondary:hover {
  background: var(--bg-tertiary, #e0e0e0);
}
</style>

