<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop search-catalog-ack-backdrop" style="z-index: 30000;">
      <div class="modal search-catalog-ack-modal">
        <header class="modal-header search-catalog-ack-header">
          <h2 class="search-catalog-ack-title">Search Catalog Acknowledgement</h2>
        </header>
        
        <section class="modal-body search-catalog-ack-body">
          <div class="acknowledgement-content">
            <p class="acknowledgement-text">
              <strong>WARNING:</strong> Catalog Search examines an unsanitized, unmoderated, unmonitored archive. It is suggested for you to manually confirm hack status on websites such as SMWCentral.net or SMWDB.me before downloading or playing anything from the catalog. This search tool finds raw historic unfiltered files from the internet. To access the function you must acknowledge and agree to the below:
            </p>
            
            <ul class="acknowledgement-list">
              <li class="acknowledgement-item">
                You certify that you are Age 18 or higher and agree to secure your installation against access by minors.
                And you alone take full responsibility for materials inside any games you choose to "get" and run from below.
              </li>
              
              <li class="acknowledgement-item">
                Some SMW hacks might have extremely offensive contents. Reportedly, according to SMWDB.me: this was often the case with "Joke" or "Troll" hacks.
              </li>
              
              <li class="acknowledgement-item">
                Some SMW hacks historically contained Adult Content, Shocking Content, Obscene content, Hateful, or elsewise Inappropriate material, might still be found in the archives. We do not know which ones. Searching the archive is equivalent to an unfiltered search of what was historically available.
              </li>
              
              <li class="acknowledgement-item">
                You agree to report it to rhtools@proton.me If you become aware of any content that is Explicit, Shocking, Obscene, Hateful, Illegal, Violates major social platform rules. Respect email provider policies and NEVER Email any graphic, obscene, or explicit images directly without censoring all graphic portions.  Just give enough information for us to identify the game record, and confirm the issue.   Include a summary of what, when, and where in the hack this is found. Include the catalog_&lt;SHA1&gt;, or SHA1, and SHA256 hash of the unheadered ROM, and author names related to the search data. This is so that we may attempt future updates to restrict or block access.
              </li>
              
              <li class="acknowledgement-item">
                The historical collection is included only for personal study and review purposes. Many of the games in the database could be in a completely unsafe or unstable state, unplayable, or inconsistent in compatibility with official hardware or modern emulators. This includes Demos that never became a stable release, or early unstable versions of hacks that were later leased or updated, possibly under different names or author pseudonyms.
              </li>
              
              <li class="acknowledgement-item">
                None of the records in the catalog are reviewed, nor approved, nor recommended. These hacks were published only by their authors. The developer of this program is not the publisher, and nor responsible for games in the database. Some SMW Hacks could be offensive, highly inappropriate, or dangerous due to Photosensitivity triggers, etc.
              </li>
              
              <li class="acknowledgement-item">
                A hack can currently be blocked from the application's functions by adding a BAN by catalog_&lt;UUID&gt; or by blocking the author name through the gameversion_banlist database table Or gameversion-banmanager.js BAN manager system with a * sense ban. The catalog listing details still appear in search results, even if there is no actual access to game files due to a ban or other reasons (Since catalog search metadata versus found files and installed gameversions are separate).
              </li>
            </ul>
          </div>
        </section>
        
        <footer class="modal-footer search-catalog-ack-footer">
          <button @click="handleAgree" class="btn-agree">
            I Agree
          </button>
          <button @click="handleCancel" class="btn-cancel">
            Cancel
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Teleport } from 'vue';

interface Props {
  visible: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'agree': [];
  'cancel': [];
}>();

function handleAgree() {
  emit('agree');
}

function handleCancel() {
  emit('cancel');
}
</script>

<style scoped>
.search-catalog-ack-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-catalog-ack-modal {
  width: 95vw;
  height: 95vh;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #ffffff);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.search-catalog-ack-header {
  padding: 24px 32px;
  border-bottom: 2px solid var(--border-primary, #ccc);
  background: var(--bg-secondary, #f5f5f5);
  flex-shrink: 0;
}

.search-catalog-ack-title {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary, #333);
  text-align: center;
}

.search-catalog-ack-body {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
  background: var(--bg-primary, #ffffff);
}

.acknowledgement-content {
  max-width: 100%;
}

.acknowledgement-text {
  font-size: 26px;
  line-height: 1.6;
  margin-bottom: 32px;
  color: var(--text-primary, #333);
  font-weight: 500;
}

.acknowledgement-text strong {
  font-size: 26px;
  font-weight: 700;
  color: var(--accent-error, #d32f2f);
}

.acknowledgement-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.acknowledgement-item {
  font-size: 26px;
  line-height: 1.8;
  margin-bottom: 24px;
  padding: 20px;
  background: var(--bg-secondary, #f9f9f9);
  border-left: 4px solid var(--accent-primary, #4CAF50);
  border-radius: 4px;
  color: var(--text-primary, #333);
}

.acknowledgement-item:last-child {
  margin-bottom: 0;
}

.search-catalog-ack-footer {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 24px 32px;
  border-top: 2px solid var(--border-primary, #ccc);
  background: var(--bg-secondary, #f5f5f5);
  flex-shrink: 0;
}

.btn-agree,
.btn-cancel {
  padding: 16px 48px;
  font-size: 24px;
  font-weight: 700;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 180px;
}

.btn-agree {
  background: var(--accent-primary, #4CAF50);
  color: white;
}

.btn-agree:hover {
  background: var(--accent-hover, #45a049);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
}

.btn-cancel {
  background: var(--bg-tertiary, #e0e0e0);
  color: var(--text-primary, #333);
  border: 2px solid var(--border-primary, #ccc);
}

.btn-cancel:hover {
  background: var(--bg-quaternary, #d0d0d0);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* Ensure text is readable and scrollable */
.acknowledgement-content {
  color: var(--text-primary, #333);
}

/* Custom scrollbar styling */
.search-catalog-ack-body::-webkit-scrollbar {
  width: 12px;
}

.search-catalog-ack-body::-webkit-scrollbar-track {
  background: var(--bg-secondary, #f5f5f5);
}

.search-catalog-ack-body::-webkit-scrollbar-thumb {
  background: var(--border-primary, #ccc);
  border-radius: 6px;
}

.search-catalog-ack-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary, #999);
}
</style>
