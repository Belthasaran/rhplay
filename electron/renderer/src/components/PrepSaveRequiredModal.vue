<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop prep-save-required-backdrop" @click.self="emit('cancel')">
      <div class="modal prep-save-required-modal" @click.stop>
        <header class="modal-header">
          <h3>Save Required</h3>
          <button class="close" @click="emit('cancel')">✕</button>
        </header>
        <section class="modal-body">
          <p>
            Win rules were changed after the last Stage and Save. Save the changes to the database and
            staging folder, or run a full Stage and Save to rebuild game files.
          </p>
        </section>
        <footer class="modal-footer prep-save-required-footer">
          <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
          <button class="btn-primary" @click="emit('save-minor')">Save changes</button>
          <button class="btn-primary" @click="emit('stage-and-save')">Stage and Save</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'save-minor'): void;
  (e: 'stage-and-save'): void;
}>();
</script>

<style scoped>
.prep-save-required-backdrop {
  z-index: 25001;
}

.prep-save-required-modal {
  max-width: 520px;
  width: 95%;
}

.prep-save-required-modal .modal-body p {
  margin: 0;
  line-height: 1.45;
}

.prep-save-required-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
