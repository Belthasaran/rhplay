<template>
  <div class="stage-feedback-form">
    <div v-if="showDifficulty" class="feedback-section">
      <label class="section-label">Difficulty</label>
      <StageDifficultyGrid v-model="selectedDifficulty" />
    </div>

    <div v-if="mode === 'full'" class="feedback-section">
      <label class="section-label">Tags</label>
      <div class="tag-chips">
        <button
          v-for="chip in tagChips"
          :key="chip.key"
          type="button"
          class="tag-chip"
          :class="{ active: tagFeedback[chip.key] }"
          @click="toggleTag(chip.key)"
        >
          {{ chip.label }}
        </button>
      </div>
    </div>

    <div v-if="mode === 'full'" class="feedback-section">
      <label class="section-label">Did this level pass testing?</label>
      <div class="test-result-tiles">
        <button
          v-for="opt in testResultOptions"
          :key="opt.value"
          type="button"
          class="test-result-tile"
          :class="{ active: testResult === opt.value }"
          @click="testResult = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div v-if="mode === 'simple'" class="feedback-section simple-presets">
      <label class="section-label">Quick feedback</label>
      <div class="simple-preset-row">
        <button
          v-for="preset in simplePresets"
          :key="preset.label"
          type="button"
          class="simple-preset-btn"
          :class="{ active: selectedDifficulty === preset.difficulty && comment === preset.comment }"
          @click="applySimplePreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div v-if="showComment" class="feedback-section">
      <label class="section-label">Comment</label>
      <textarea v-model="comment" class="feedback-comment" rows="3" placeholder="Optional notes..." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import StageDifficultyGrid from '@/components/StageDifficultyGrid.vue';
import {
  defaultTagFeedbackFromStage,
  type TagFeedbackMap,
} from '@/utils/stage-test-utils';

export interface StageFeedbackFormStage {
  difficulty?: number;
  water?: number;
  castle?: number;
  boss?: number;
  secret?: number;
  troll?: number;
  final?: number;
  stagetags?: string | null;
}

export interface StageFeedbackFormValue {
  difficulty_feedback: number | null;
  test_result: 'no_action' | 'reject' | 'accept';
  tag_feedback: TagFeedbackMap;
  comment: string;
}

const props = withDefaults(defineProps<{
  mode: 'full' | 'simple';
  initialStage?: StageFeedbackFormStage | null;
  showDifficulty?: boolean;
  showComment?: boolean;
  modelValue?: Partial<StageFeedbackFormValue> | null;
}>(), {
  initialStage: null,
  showDifficulty: true,
  showComment: true,
  modelValue: null,
});

const selectedDifficulty = ref<number | null>(null);
const testResult = ref<'no_action' | 'reject' | 'accept'>('no_action');
const comment = ref('');
const tagFeedback = reactive<TagFeedbackMap>({
  kaizo: false,
  non_kaizo: false,
  water: false,
  castle: false,
  boss: false,
  secret: false,
  troll: false,
  final: false,
});

const tagChips: { key: keyof TagFeedbackMap; label: string }[] = [
  { key: 'kaizo', label: 'Kaizo' },
  { key: 'non_kaizo', label: 'Non-kaizo' },
  { key: 'water', label: 'Water' },
  { key: 'castle', label: 'Castle' },
  { key: 'boss', label: 'Boss' },
  { key: 'secret', label: 'Secret' },
  { key: 'troll', label: 'Troll' },
  { key: 'final', label: 'Final' },
];

const testResultOptions = [
  { value: 'no_action' as const, label: 'No Action' },
  { value: 'reject' as const, label: 'Reject' },
  { value: 'accept' as const, label: 'Accept' },
];

const simplePresets = [
  { label: 'Too Easy', difficulty: 0, comment: 'Too Easy' },
  { label: 'Vanilla', difficulty: 3, comment: 'Vanilla' },
  { label: 'Crash', difficulty: 8, comment: 'Crash' },
  { label: 'Not Working', difficulty: 8, comment: 'Not Working' },
  { label: 'Invalid/Test', difficulty: 10, comment: 'Invalid/Test' },
  { label: 'Too Hard', difficulty: 7, comment: 'Too Hard' },
  { label: 'Unwinnable', difficulty: 10, comment: 'Unwinnable' },
];

function resetFromStage(stage: StageFeedbackFormStage | null | undefined) {
  selectedDifficulty.value = stage?.difficulty ?? null;
  testResult.value = 'no_action';
  comment.value = '';
  const defaults = defaultTagFeedbackFromStage(stage || {});
  for (const key of Object.keys(defaults) as (keyof TagFeedbackMap)[]) {
    tagFeedback[key] = defaults[key];
  }
}

function applyModelValue(value: Partial<StageFeedbackFormValue> | null | undefined) {
  if (!value) return;
  if (value.difficulty_feedback !== undefined) {
    selectedDifficulty.value = value.difficulty_feedback;
  }
  if (value.test_result) testResult.value = value.test_result;
  if (value.comment !== undefined) comment.value = value.comment || '';
  if (value.tag_feedback) {
    for (const key of Object.keys(value.tag_feedback) as (keyof TagFeedbackMap)[]) {
      tagFeedback[key] = value.tag_feedback[key];
    }
  }
}

function toggleTag(key: keyof TagFeedbackMap) {
  if (key === 'kaizo' && !tagFeedback.kaizo) tagFeedback.non_kaizo = false;
  else if (key === 'non_kaizo' && !tagFeedback.non_kaizo) tagFeedback.kaizo = false;
  tagFeedback[key] = !tagFeedback[key];
}

function applySimplePreset(preset: { difficulty: number; comment: string }) {
  selectedDifficulty.value = preset.difficulty;
  comment.value = preset.comment;
}

function getValue(): StageFeedbackFormValue {
  return {
    difficulty_feedback: selectedDifficulty.value,
    test_result: testResult.value,
    tag_feedback: { ...tagFeedback },
    comment: comment.value,
  };
}

watch(
  () => props.initialStage,
  (stage) => {
    resetFromStage(stage);
    applyModelValue(props.modelValue);
  },
  { immediate: true }
);

watch(
  () => props.modelValue,
  (value) => applyModelValue(value),
  { deep: true }
);

defineExpose({ getValue, resetFromStage });
</script>

<style scoped>
.feedback-section {
  margin-bottom: 16px;
}

.section-label {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
}

.tag-chips,
.simple-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip,
.simple-preset-btn {
  border: 1px solid var(--border-color, #555);
  border-radius: 16px;
  padding: 4px 12px;
  background: var(--bg-secondary, #2a2a2a);
  cursor: pointer;
  font-size: 0.9em;
}

.tag-chip.active,
.simple-preset-btn.active {
  border-color: var(--accent-color, #4a90d9);
  background: rgba(74, 144, 217, 0.2);
}

.test-result-tiles {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.test-result-tile {
  flex: 1;
  min-width: 100px;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #555);
  border-radius: 6px;
  background: var(--bg-secondary, #2a2a2a);
  cursor: pointer;
  text-align: center;
}

.test-result-tile.active {
  border-color: var(--accent-color, #4a90d9);
  background: rgba(74, 144, 217, 0.15);
}

.feedback-comment {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-color, #555);
  border-radius: 6px;
  padding: 8px;
  background: var(--bg-secondary, #2a2a2a);
  color: inherit;
  resize: vertical;
}
</style>
