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
          <h4>I won</h4>
          <div class="run-exit-button-row">
            <button class="btn-action" @click="emitChoice('win', null, '')">I won: No comment</button>
            <button class="btn-action" @click="emitChoice('win', null, 'No gameplay')">No gameplay</button>
            <button class="btn-action" @click="emitChoice('win', 0, 'Too Easy')">Too Easy</button>
            <button class="btn-action" @click="emitChoice('win', 3, 'Vanilla')">Vanilla</button>
            <button class="btn-action" @click="emitChoice('win', 8, 'Crash')">Crash</button>
            <button class="btn-action" @click="emitChoice('win', 8, 'Not Working')">Not Working</button>
            <button class="btn-action" @click="emitChoice('win', 10, 'Invalid/Test')">Invalid/Test</button>
          </div>

          <h4>I Skipped it / I lost</h4>
          <div class="run-exit-button-row">
            <button class="btn-action" @click="emitChoice('skip', null, '')">Skipped</button>
            <button class="btn-action" @click="emitChoice('skip', null, 'No gameplay')">No gameplay</button>
            <button class="btn-action" @click="emitChoice('skip', 3, 'Vanilla')">Vanilla</button>
            <button class="btn-action" @click="emitChoice('skip', 8, 'Crash')">Crash</button>
            <button class="btn-action" @click="emitChoice('skip', 8, 'Not working')">Not working</button>
            <button class="btn-action" @click="emitChoice('skip', 10, 'Invalid/Test Level')">Invalid/Test Level</button>
            <button class="btn-action" @click="emitChoice('skip', 7, 'Too Hard')">Too Hard</button>
            <button class="btn-action" @click="emitChoice('skip', 10, 'Unwinnable')">Unwinnable</button>
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
import { ref } from 'vue';
import StageFeedbackForm, {
  type StageFeedbackFormStage,
  type StageFeedbackFormValue,
} from '@/components/StageFeedbackForm.vue';

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
  initialStage?: StageFeedbackFormStage | null;
  initialFeedbackValue?: Partial<StageFeedbackFormValue> | null;
}>();

const emit = defineEmits<{
  (e: 'choice', payload: {
    outcome: 'win' | 'skip';
    difficultyFeedback: number | null;
    comment: string;
    test_result?: 'no_action' | 'reject' | 'accept' | null;
    tag_feedback?: string | null;
  }): void;
}>();

const feedbackFormRef = ref<InstanceType<typeof StageFeedbackForm> | null>(null);

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

.run-exit-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.run-exit-outcome-row {
  margin-top: 16px;
}
</style>
