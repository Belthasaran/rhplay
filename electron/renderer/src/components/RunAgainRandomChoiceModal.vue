<template>
  <div v-if="visible" class="modal-backdrop run-again-choice-backdrop" @click.stop>
    <div class="modal run-again-choice-modal" @click.stop>
      <header class="modal-header">
        <h3>Run Again</h3>
        <button class="close" @click="emit('cancel')">✕</button>
      </header>
      <section class="modal-body">
        <p>
          Do you want to reseed and reroll Random Game/Random Stage entries or keep the same Games/Stages?
        </p>
      </section>
      <footer class="modal-footer run-again-choice-footer">
        <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn-primary" @click="emit('keep')">Keep seeds and Selections</button>
        <button class="btn-primary" @click="emit('reseed')">Reseed and Reroll</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'reseed'): void;
  (e: 'keep'): void;
}>();
</script>

<style scoped>
.run-again-choice-backdrop {
  z-index: 26000;
}

.run-again-choice-modal {
  max-width: 520px;
  width: 95%;
}

.run-again-choice-modal .modal-body p {
  margin: 0;
  line-height: 1.45;
}

.run-again-choice-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
