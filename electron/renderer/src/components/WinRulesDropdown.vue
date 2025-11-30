<template>
  <Teleport to="body">
    <div v-if="visible" class="win-rules-dropdown-overlay" @click="handleOverlayClick">
      <div class="win-rules-dropdown" :style="dropdownStyle" @click.stop>
        <div class="win-rules-header">
          <h3>Set Win Rules</h3>
          <button class="close" @click="handleClose">✕</button>
        </div>
        <div class="win-rules-body">
          <!-- Challenge Time -->
          <div class="win-rule-section">
            <label class="win-rule-toggle">
              <input type="checkbox" v-model="winRules.challengeTime.enabled" />
              <span class="win-rule-title">Challenge Time</span>
            </label>
            <div v-if="winRules.challengeTime.enabled" class="win-rule-content">
              <label>
                Time Limit (minutes):
                <select v-model.number="winRules.challengeTime.minutes">
                  <option :value="2">2</option>
                  <option :value="3">3</option>
                  <option :value="5">5</option>
                  <option :value="10">10</option>
                  <option :value="15">15</option>
                  <option :value="25">25</option>
                  <option :value="30">30</option>
                  <option :value="60">60</option>
                </select>
              </label>
              <label>
                Allow Rollover Minutes:
                <select v-model.number="winRules.challengeTime.rolloverMaxMinutes">
                  <option :value="0">No Rollover</option>
                  <option :value="1">1</option>
                  <option :value="2">2</option>
                  <option :value="3">3</option>
                  <option :value="5">5</option>
                  <option :value="10">10</option>
                  <option :value="20">20</option>
                  <option :value="30">30</option>
                  <option :value="60">60</option>
                  <option :value="90">90</option>
                  <option :value="120">120</option>
                </select>
              </label>
              <label v-if="winRules.challengeTime.rolloverMaxMinutes > 0">
                Extra Minutes (starting rollover time):
                <input 
                  type="number" 
                  v-model.number="winRules.challengeTime.rolloverStartMinutes" 
                  :min="0" 
                  :max="winRules.challengeTime.rolloverMaxMinutes"
                />
              </label>
              <p class="win-rule-description">
                Each challenge must complete within the time limit. Grace period: 1% of limit (min 2s, max 60s).
                <span v-if="winRules.challengeTime.rolloverMaxMinutes > 0">
                  Early completions add to rollover pool (up to max). Late completions deduct from rollover. Grace period time does not add to rollover.
                </span>
              </p>
            </div>
          </div>

          <!-- Run Time Limit -->
          <div class="win-rule-section">
            <label class="win-rule-toggle">
              <input type="checkbox" v-model="winRules.runTimeLimit.enabled" />
              <span class="win-rule-title">Run Time Limit</span>
            </label>
            <div v-if="winRules.runTimeLimit.enabled" class="win-rule-content">
              <label>
                Total Time Limit (minutes):
                <input type="number" v-model.number="winRules.runTimeLimit.minutes" min="1" />
              </label>
              <p class="win-rule-description">
                Sets a time limit for the entire run in addition to or instead of individual challenge limits.
              </p>
            </div>
          </div>

          <!-- No Game Overs -->
          <div class="win-rule-section">
            <label class="win-rule-toggle">
              <input type="checkbox" v-model="winRules.noGameOvers.enabled" />
              <span class="win-rule-title">No Game Overs</span>
            </label>
            <div v-if="winRules.noGameOvers.enabled" class="win-rule-content">
              <p class="win-rule-description">
                You are on your honor to click Skip if you game over - which records a loss. (Display purposes only, not yet enforced)
              </p>
            </div>
          </div>

          <!-- No Hits -->
          <div class="win-rule-section">
            <label class="win-rule-toggle">
              <input type="checkbox" v-model="winRules.noHits.enabled" :disabled="!canEnableNoHits" />
              <span class="win-rule-title">No Hits</span>
            </label>
            <div v-if="winRules.noHits.enabled" class="win-rule-content">
              <p class="win-rule-description">
                Only enabled when One-hit-KO and nolives are already chosen as global conditions. 
                You are on your honor to click the Skip button if you get hit.
              </p>
              <p v-if="!canEnableNoHits" class="win-rule-warning">
                ⚠️ No Hits requires One-hit-KO and nolives global conditions to be enabled.
              </p>
            </div>
          </div>
        </div>
        <div class="win-rules-footer">
          <button @click="handleSave" class="btn-primary">Save</button>
          <button @click="handleClose" class="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

interface WinRules {
  challengeTime: {
    enabled: boolean;
    minutes: number;
    rolloverStartMinutes: number;
    rolloverMaxMinutes: number; // 0 = no rollover, otherwise max allowed rollover
    gracePeriodPercent: number;
    gracePeriodMinSeconds: number;
    gracePeriodMaxSeconds: number;
  };
  runTimeLimit: {
    enabled: boolean;
    minutes: number;
  };
  noGameOvers: {
    enabled: boolean;
  };
  noHits: {
    enabled: boolean;
    requiresOneHitKO: boolean;
    requiresNoLives: boolean;
  };
}

const props = defineProps<{
  visible: boolean;
  position: { x: number; y: number } | null;
  currentWinRules?: string | null; // JSON string
  globalConditions?: string[]; // Global patch codes for checking One-hit-KO and nolives
}>();

const emit = defineEmits<{
  (e: 'save', winRulesJson: string): void;
  (e: 'close'): void;
}>();

const defaultWinRules: WinRules = {
  challengeTime: {
    enabled: false,
    minutes: 10,
    rolloverStartMinutes: 0,
    rolloverMaxMinutes: 0, // 0 = No Rollover (default)
    gracePeriodPercent: 1.0,
    gracePeriodMinSeconds: 2,
    gracePeriodMaxSeconds: 60,
  },
  runTimeLimit: {
    enabled: false,
    minutes: 60,
  },
  noGameOvers: {
    enabled: false,
  },
  noHits: {
    enabled: false,
    requiresOneHitKO: true,
    requiresNoLives: true,
  },
};

const winRules = ref<WinRules>({ ...defaultWinRules });

const canEnableNoHits = computed(() => {
  if (!props.globalConditions) return false;
  const hasOneHitKO = props.globalConditions.includes('One-hit-KO') || props.globalConditions.includes('one-hit-ko');
  const hasNoLives = props.globalConditions.includes('nolives') || props.globalConditions.includes('No Lives');
  return hasOneHitKO && hasNoLives;
});

const dropdownStyle = computed(() => {
  if (!props.position) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  // Position using right and top to align right edge with button
  // position.x is the button's right edge X coordinate
  // Calculate right offset: window width - button right edge
  return {
    right: `${window.innerWidth - props.position.x}px`,
    top: `${props.position.y}px`,
  };
});

// Load win rules from prop
watch(() => props.currentWinRules, (newValue) => {
  if (newValue) {
    try {
      const parsed = JSON.parse(newValue);
      
      // Migrate old format to new format if needed
      if (parsed.challengeTimeCap || parsed.challengeTimeWithRollover) {
        // Convert old format to new unified challengeTime format
        const oldCap = parsed.challengeTimeCap;
        const oldRollover = parsed.challengeTimeWithRollover;
        
        if (oldCap && oldCap.enabled) {
          parsed.challengeTime = {
            enabled: true,
            minutes: oldCap.minutes || 10,
            rolloverStartMinutes: 0,
            rolloverMaxMinutes: 0,
            gracePeriodPercent: oldCap.gracePeriodPercent || 1.0,
            gracePeriodMinSeconds: oldCap.gracePeriodMinSeconds || 2,
            gracePeriodMaxSeconds: oldCap.gracePeriodMaxSeconds || 60,
          };
        } else if (oldRollover && oldRollover.enabled) {
          parsed.challengeTime = {
            enabled: true,
            minutes: oldRollover.minutes || 10,
            rolloverStartMinutes: oldRollover.rolloverStartMinutes || 0,
            rolloverMaxMinutes: oldRollover.rolloverMaxMinutes || 0,
            gracePeriodPercent: oldRollover.gracePeriodPercent || 1.0,
            gracePeriodMinSeconds: oldRollover.gracePeriodMinSeconds || 2,
            gracePeriodMaxSeconds: oldRollover.gracePeriodMaxSeconds || 60,
          };
        }
        
        // Remove old properties
        delete parsed.challengeTimeCap;
        delete parsed.challengeTimeWithRollover;
      }
      
      winRules.value = { ...defaultWinRules, ...parsed };
      
      // Ensure rolloverStartMinutes doesn't exceed rolloverMaxMinutes
      if (winRules.value.challengeTime.rolloverStartMinutes > winRules.value.challengeTime.rolloverMaxMinutes) {
        winRules.value.challengeTime.rolloverStartMinutes = winRules.value.challengeTime.rolloverMaxMinutes;
      }
    } catch (e) {
      console.error('Failed to parse win rules:', e);
      winRules.value = { ...defaultWinRules };
    }
  } else {
    winRules.value = { ...defaultWinRules };
  }
}, { immediate: true });

// Prevent enabling No Hits if conditions not met
watch(() => winRules.value.noHits.enabled, (enabled) => {
  if (enabled && !canEnableNoHits.value) {
    winRules.value.noHits.enabled = false;
  }
});

watch(() => canEnableNoHits.value, (canEnable) => {
  if (!canEnable && winRules.value.noHits.enabled) {
    winRules.value.noHits.enabled = false;
  }
});

// Ensure rolloverStartMinutes doesn't exceed rolloverMaxMinutes
watch(() => winRules.value.challengeTime.rolloverMaxMinutes, (newMax) => {
  if (winRules.value.challengeTime.rolloverStartMinutes > newMax) {
    winRules.value.challengeTime.rolloverStartMinutes = newMax;
  }
});

watch(() => winRules.value.challengeTime.rolloverStartMinutes, (newStart) => {
  const max = winRules.value.challengeTime.rolloverMaxMinutes;
  if (max > 0 && newStart > max) {
    winRules.value.challengeTime.rolloverStartMinutes = max;
  }
});

function handleSave() {
  const json = JSON.stringify(winRules.value);
  emit('save', json);
  emit('close');
}

function handleClose() {
  emit('close');
}

function handleOverlayClick() {
  handleClose();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    handleClose();
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
.win-rules-dropdown-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20010;
  background: rgba(0, 0, 0, 0.3);
}

.win-rules-dropdown {
  position: fixed;
  background: var(--bg-primary, #2a2a2a);
  border: 2px solid var(--border-primary, #444);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  min-width: 400px;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  z-index: 20011;
}

.win-rules-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary, #444);
}

.win-rules-header h3 {
  margin: 0;
  font-size: 18px;
  color: var(--text-primary, #e0e0e0);
}

.win-rules-header .close {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.win-rules-header .close:hover {
  color: var(--text-primary, #e0e0e0);
}

.win-rules-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.win-rule-section {
  margin-bottom: 20px;
  padding: 12px;
  background: var(--bg-secondary, #1e1e1e);
  border-radius: 6px;
}

.win-rule-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: bold;
  color: var(--text-primary, #e0e0e0);
  margin-bottom: 8px;
}

.win-rule-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.win-rule-title {
  font-size: 16px;
}

.win-rule-content {
  margin-top: 12px;
  padding-left: 26px;
}

.win-rule-content label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary, #aaa);
  font-size: 14px;
}

.win-rule-content select,
.win-rule-content input[type="number"] {
  margin-left: 8px;
  padding: 4px 8px;
  background: var(--bg-primary, #2a2a2a);
  border: 1px solid var(--border-primary, #444);
  border-radius: 4px;
  color: var(--text-primary, #e0e0e0);
  font-size: 14px;
}

.win-rule-description {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  line-height: 1.4;
}

.win-rule-warning {
  margin-top: 8px;
  font-size: 12px;
  color: #ffaa00;
  line-height: 1.4;
}

.win-rules-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary, #444);
}

.win-rules-footer button {
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: var(--accent-primary, #4CAF50);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-primary-hover, #45a049);
}

.btn-secondary {
  background: var(--bg-secondary, #1e1e1e);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border-primary, #444);
}

.btn-secondary:hover {
  background: var(--bg-tertiary, #333);
}
</style>

