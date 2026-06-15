<template>
  <Teleport to="body">
    <div v-if="visible" class="twitch-prep-overlay" @click="emit('close')">
      <div class="twitch-prep-dropdown" :style="dropdownStyle" @click.stop>
        <div class="twitch-prep-header">
          <h3>Twitch Predictions</h3>
          <button class="close" @click="emit('close')">✕</button>
        </div>

        <div class="twitch-prep-body">
          <button type="button" class="setup-row" @click="emit('setup')">
            Setup
          </button>

          <div class="predictions-heading">Predictions:</div>

          <div class="prediction-tiles">
            <button
              type="button"
              class="prediction-tile"
              :class="{ selected: selectedMode === 'none' }"
              @click="emit('select-mode', 'none')"
            >
              None
            </button>
            <button
              type="button"
              class="prediction-tile"
              :class="{ selected: selectedMode === 'same_item' }"
              @click="emit('select-mode', 'same_item')"
            >
              Per-Item
            </button>
            <button
              type="button"
              class="prediction-tile"
              :class="{ selected: selectedMode === 'whole_challenge' }"
              @click="emit('select-mode', 'whole_challenge')"
            >
              Per-Run
            </button>
          </div>

          <div v-if="selectedMode === 'same_item'" class="subtype-row">
            <label for="twitch-prep-subtype">Prediction style:</label>
            <select
              id="twitch-prep-subtype"
              :value="individualSubtype"
              @change="onSubtypeChange"
            >
              <option value="yes_no">Two option: Win/Lose</option>
              <option value="time_range">Time Range: ({{ timeRangeOutcomeCount }}) options</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PrepPredictionsMode } from '../utils/twitch-prep-status';
import type { IndividualPredictionSubtype } from '../utils/twitch-predictions-template';

const props = defineProps<{
  visible: boolean;
  position: { x: number; y: number } | null;
  selectedMode: PrepPredictionsMode;
  individualSubtype: IndividualPredictionSubtype;
  timeRangeOutcomeCount: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'setup'): void;
  (e: 'select-mode', mode: PrepPredictionsMode): void;
  (e: 'select-subtype', subtype: IndividualPredictionSubtype): void;
}>();

const dropdownStyle = computed(() => {
  if (!props.position) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  return {
    right: `${window.innerWidth - props.position.x}px`,
    top: `${props.position.y}px`,
  };
});

function onSubtypeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit('select-subtype', value === 'time_range' ? 'time_range' : 'yes_no');
}
</script>

<style scoped>
.twitch-prep-overlay {
  position: fixed;
  inset: 0;
  z-index: 24000;
  background: transparent;
}

.twitch-prep-dropdown {
  position: fixed;
  min-width: 300px;
  max-width: 360px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-secondary, #d1d5db);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 24001;
}

.twitch-prep-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-secondary, #e5e7eb);
}

.twitch-prep-header h3 {
  margin: 0;
  font-size: 1rem;
}

.twitch-prep-header .close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
}

.twitch-prep-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setup-row {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--border-secondary, #d1d5db);
  border-radius: 6px;
  background: var(--button-bg, #f9fafb);
  cursor: pointer;
  font-weight: 600;
}

.setup-row:hover {
  background: var(--bg-hover, #f3f4f6);
}

.predictions-heading {
  font-weight: 600;
  color: var(--text-secondary, #4b5563);
}

.prediction-tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.prediction-tile {
  padding: 10px 6px;
  border: 2px solid var(--border-secondary, #d1d5db);
  border-radius: 6px;
  background: var(--button-bg, #fff);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
}

.prediction-tile.selected {
  border-color: #7c3aed;
  background: #f3e8ff;
  color: #5b21b6;
}

.prediction-tile:hover:not(.selected) {
  background: var(--bg-hover, #f9fafb);
}

.subtype-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.subtype-row label {
  font-weight: 600;
  font-size: 0.9rem;
}

.subtype-row select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-secondary, #d1d5db);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
}
</style>
