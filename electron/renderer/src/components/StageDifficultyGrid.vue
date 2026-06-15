<template>
  <div class="difficulty-grid" :class="{ compact }">
    <div
      v-for="diff in difficultyValues"
      :key="diff"
      class="difficulty-grid-item"
      :class="{
        active: modelValue === diff,
        broken: diff === 8,
        bugged: diff === 10,
      }"
      @click="$emit('update:modelValue', diff)"
    >
      <span class="difficulty-number">{{ diff }}</span>
      <span v-if="!compact" class="difficulty-label">{{ getDifficultyLabel(diff) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { DIFFICULTY_VALUES, getDifficultyLabel } from '@/utils/stage-difficulty';

withDefaults(defineProps<{
  modelValue: number | null;
  compact?: boolean;
}>(), {
  compact: false,
});

defineEmits<{
  'update:modelValue': [value: number];
}>();

const difficultyValues = DIFFICULTY_VALUES;
</script>

<style scoped>
.difficulty-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.difficulty-grid-item {
  border: 1px solid var(--border-color, #444);
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  background: var(--bg-secondary, #2a2a2a);
  transition: border-color 0.15s, background 0.15s;
}

.difficulty-grid-item:hover {
  border-color: var(--accent-color, #4a90d9);
}

.difficulty-grid-item.active {
  border-color: var(--accent-color, #4a90d9);
  background: rgba(74, 144, 217, 0.15);
}

.difficulty-grid-item.broken.active {
  border-color: #e67e22;
}

.difficulty-grid-item.bugged.active {
  border-color: #e74c3c;
}

.difficulty-number {
  display: block;
  font-weight: 700;
  font-size: 1.1em;
}

.difficulty-label {
  display: block;
  font-size: 0.75em;
  opacity: 0.85;
  margin-top: 2px;
  line-height: 1.2;
}

.difficulty-grid.compact {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  margin-top: 0;
}

.difficulty-grid.compact .difficulty-grid-item {
  flex: 1 1 0;
  min-width: 0;
  padding: 4px 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.difficulty-grid.compact .difficulty-number {
  font-size: 0.85em;
  font-weight: 600;
}
</style>
