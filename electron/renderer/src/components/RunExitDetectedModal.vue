<template>
  <div v-if="visible" class="modal-backdrop run-exit-modal-backdrop" @click.stop>
    <div class="modal run-exit-detected-modal" @click.stop>
      <header class="modal-header">
        <h3>Exit detected. Did you win or skip?</h3>
      </header>
      <section class="modal-body">
        <div class="run-exit-info">
          <p v-if="gameId"><strong>Game ID:</strong> {{ gameId }}</p>
          <p v-if="gameName"><strong>Name:</strong> {{ gameName }}</p>
          <p v-if="gameDifficulty !== null && gameDifficulty !== undefined">
            <strong>Difficulty:</strong> {{ gameDifficulty }} {{ gameDifficultyLabel }}
          </p>
          <p v-if="stageId"><strong>Stage ID:</strong> {{ stageId }}</p>
          <p v-if="stageName"><strong>Stage:</strong> {{ stageName }}</p>
          <p v-if="stageDifficulty !== null && stageDifficulty !== undefined">
            <strong>Stage Difficulty:</strong> {{ stageDifficulty }} {{ stageDifficultyLabel }}
          </p>
        </div>

        <div v-if="showStageFeedback && showFullFeedbackForm" class="run-exit-feedback">
          <StageFeedbackForm
            ref="feedbackFormRef"
            mode="full"
            :initial-stage="initialStage"
            :model-value="initialFeedbackValue"
            :show-comment="true"
          />
          <div class="run-exit-button-row run-exit-outcome-row">
            <button class="btn-primary" @click="emitFullChoice('win')">I won — Save</button>
            <button class="btn-secondary" @click="emitFullChoice('skip')">Skipped — Save</button>
          </div>
        </div>

        <div v-else-if="showStageFeedback" class="run-exit-feedback">
          <div v-if="showDifficultyTiles" class="run-exit-difficulty-section">
            <label class="run-exit-difficulty-label">Stage difficulty (optional)</label>
            <StageDifficultyGrid v-model="selectedDifficulty" compact />
          </div>

          <h4>I won</h4>
          <div class="run-exit-button-row">
            <button
              v-for="btn in wonButtons"
              :key="btn.key"
              type="button"
              class="run-exit-feedback-btn"
              :class="toneClass(btn.tone)"
              @click="emitPresetChoice(btn)"
            >
              {{ btn.label }}
            </button>
          </div>

          <h4>I Skipped it / I lost</h4>
          <div class="run-exit-button-row">
            <button
              v-for="btn in lostButtons"
              :key="btn.key"
              type="button"
              class="run-exit-feedback-btn"
              :class="toneClass(btn.tone)"
              @click="emitPresetChoice(btn)"
            >
              {{ btn.label }}
            </button>
          </div>
        </div>

        <div v-else class="run-exit-feedback">
          <div class="run-exit-button-row">
            <button class="btn-primary" @click="emitChoice('win', null, '')">Win</button>
            <button class="btn-secondary" @click="emitChoice('skip', null, '')">Skip</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import StageDifficultyGrid from '@/components/StageDifficultyGrid.vue';
import StageFeedbackForm, {
  type StageFeedbackFormStage,
  type StageFeedbackFormValue,
} from '@/components/StageFeedbackForm.vue';

type FeedbackTone = 'pass' | 'fail' | 'minor';
type TestResult = 'no_action' | 'reject' | 'accept';

interface PresetButton {
  key: string;
  label: string;
  outcome: 'win' | 'skip';
  difficulty: number | null;
  comment: string;
  tone: FeedbackTone;
  test_result: TestResult;
}

const props = defineProps<{
  visible: boolean;
  gameId?: string | number | null;
  gameName?: string;
  gameDifficulty?: number | null;
  gameDifficultyLabel?: string;
  stageId?: string | number | null;
  stageName?: string;
  stageDifficulty?: number | null;
  stageDifficultyLabel?: string;
  showStageFeedback?: boolean;
  showFullFeedbackForm?: boolean;
  showDifficultyTiles?: boolean;
  initialStage?: StageFeedbackFormStage | null;
  initialFeedbackValue?: Partial<StageFeedbackFormValue> | null;
}>();

const emit = defineEmits<{
  (e: 'choice', payload: {
    outcome: 'win' | 'skip';
    difficultyFeedback: number | null;
    comment: string;
    test_result?: TestResult | null;
    tag_feedback?: string | null;
  }): void;
}>();

const feedbackFormRef = ref<InstanceType<typeof StageFeedbackForm> | null>(null);
const selectedDifficulty = ref<number | null>(null);

const wonButtons: PresetButton[] = [
  { key: 'won-good', label: 'I won (Good)', outcome: 'win', difficulty: null, comment: '', tone: 'pass', test_result: 'accept' },
  { key: 'won-no-gameplay', label: 'No gameplay (Fail)', outcome: 'win', difficulty: null, comment: 'No gameplay', tone: 'fail', test_result: 'reject' },
  { key: 'won-too-easy', label: 'Too Easy (Small Problems)', outcome: 'win', difficulty: 0, comment: 'Too Easy', tone: 'minor', test_result: 'no_action' },
  { key: 'won-vanilla', label: 'Vanilla (Fail)', outcome: 'win', difficulty: 3, comment: 'Vanilla', tone: 'fail', test_result: 'reject' },
  { key: 'won-crash', label: 'Crash (Fail)', outcome: 'win', difficulty: 8, comment: 'Crash', tone: 'fail', test_result: 'reject' },
  { key: 'won-not-working', label: 'Not Working (Fail)', outcome: 'win', difficulty: 8, comment: 'Not Working', tone: 'fail', test_result: 'reject' },
  { key: 'won-invalid', label: 'Invalid / Unintended Level (Fail)', outcome: 'win', difficulty: 10, comment: 'Invalid/Test', tone: 'fail', test_result: 'reject' },
];

const lostButtons: PresetButton[] = [
  { key: 'lost-skipped', label: 'Skipped (Small Problems)', outcome: 'skip', difficulty: null, comment: 'Skipped', tone: 'minor', test_result: 'no_action' },
  { key: 'lost-no-gameplay', label: 'No gameplay (Fail)', outcome: 'skip', difficulty: null, comment: 'No gameplay', tone: 'fail', test_result: 'reject' },
  { key: 'lost-vanilla', label: 'Vanilla (Fail)', outcome: 'skip', difficulty: 3, comment: 'Vanilla', tone: 'fail', test_result: 'reject' },
  { key: 'lost-crash', label: 'Crash (Fail)', outcome: 'skip', difficulty: 8, comment: 'Crash', tone: 'fail', test_result: 'reject' },
  { key: 'lost-not-working', label: 'Not Working (Fail)', outcome: 'skip', difficulty: 8, comment: 'Not Working', tone: 'fail', test_result: 'reject' },
  { key: 'lost-invalid', label: 'Invalid / Unintended Level (Fail)', outcome: 'skip', difficulty: 10, comment: 'Invalid/Test Level', tone: 'fail', test_result: 'reject' },
  { key: 'lost-too-hard', label: 'Too Hard (Small Problems)', outcome: 'skip', difficulty: 7, comment: 'Too Hard', tone: 'minor', test_result: 'no_action' },
  { key: 'lost-unwinnable', label: 'Unwinnable (Fail)', outcome: 'skip', difficulty: 10, comment: 'Unwinnable', tone: 'fail', test_result: 'reject' },
];

watch(() => props.visible, (visible) => {
  if (visible) {
    selectedDifficulty.value = props.initialFeedbackValue?.difficulty_feedback ?? null;
  }
});

function toneClass(tone: FeedbackTone): string {
  if (tone === 'pass') return 'run-exit-btn-pass';
  if (tone === 'fail') return 'run-exit-btn-fail';
  return 'run-exit-btn-minor';
}

function resolveDifficulty(preset: number | null): number | null {
  if (preset !== null) return preset;
  return selectedDifficulty.value;
}

function emitPresetChoice(btn: PresetButton) {
  emit('choice', {
    outcome: btn.outcome,
    difficultyFeedback: resolveDifficulty(btn.difficulty),
    comment: btn.comment,
    test_result: btn.test_result,
  });
}

function emitChoice(outcome: 'win' | 'skip', difficultyFeedback: number | null, comment: string) {
  emit('choice', { outcome, difficultyFeedback, comment });
}

function emitFullChoice(outcome: 'win' | 'skip') {
  const formValue = feedbackFormRef.value?.getValue();
  if (!formValue) {
    emit('choice', { outcome, difficultyFeedback: null, comment: '' });
    return;
  }
  emit('choice', {
    outcome,
    difficultyFeedback: formValue.difficulty_feedback,
    comment: formValue.comment || '',
    test_result: formValue.test_result,
    tag_feedback: JSON.stringify(formValue.tag_feedback),
  });
}
</script>

<style scoped>
.run-exit-modal-backdrop {
  z-index: 25000;
}

.run-exit-detected-modal {
  max-width: 720px;
  width: 95%;
}

.run-exit-info p {
  margin: 4px 0;
}

.run-exit-feedback h4 {
  margin: 16px 0 8px;
}

.run-exit-difficulty-section {
  margin-bottom: 12px;
}

.run-exit-difficulty-label {
  display: block;
  font-size: 0.85em;
  opacity: 0.9;
  margin-bottom: 4px;
}

.run-exit-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.run-exit-feedback-btn {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 0.9em;
  line-height: 1.25;
  cursor: pointer;
  color: #fff;
  min-height: 32px;
}

.run-exit-feedback-btn:hover {
  filter: brightness(1.08);
}

.run-exit-btn-pass {
  background: #2e7d32;
  border-color: #1b5e20;
}

.run-exit-btn-fail {
  background: #c62828;
  border-color: #b71c1c;
}

.run-exit-btn-minor {
  background: #ef6c00;
  border-color: #e65100;
}

.run-exit-outcome-row {
  margin-top: 16px;
}
</style>
