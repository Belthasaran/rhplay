<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop screenshot-gallery-backdrop" @click.self="close" style="z-index: 30000;">
      <div class="modal screenshot-gallery-modal">
        <header class="modal-header">
          <h3>Screenshots - {{ gameName || `Game ${gameId}` }}</h3>
          <button @click="close" class="close">✕</button>
        </header>
        <section class="modal-body screenshot-gallery-body">
          <div v-if="loading" class="loading-state">
            <p>Loading screenshots...</p>
          </div>
          <div v-else-if="error" class="error-state">
            <p class="error-message">{{ error }}</p>
            <button @click="loadScreenshots" class="btn-retry">Retry</button>
          </div>
          <div v-else-if="screenshots.length === 0" class="empty-state">
            <p>No screenshots available for this game.</p>
          </div>
          <div v-else class="screenshot-gallery">
            <div class="gallery-grid">
              <div
                v-for="(screenshot, index) in screenshots"
                :key="screenshot.rsuuid || index"
                class="gallery-item"
                @click="openLightbox(index)"
              >
                <div v-if="screenshot.loading" class="screenshot-loading">
                  <p>Loading...</p>
                </div>
                <div v-else-if="screenshot.error" class="screenshot-error">
                  <p>Failed to load</p>
                </div>
                <img
                  v-else-if="screenshot.dataUrl"
                  :src="screenshot.dataUrl"
                  :alt="screenshot.file_name || `Screenshot ${index + 1}`"
                  class="screenshot-thumbnail"
                  @error="handleImageError(index)"
                />
                <div class="screenshot-info">
                  <span class="screenshot-name">{{ screenshot.file_name || `Screenshot ${index + 1}` }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      
      <!-- Lightbox Modal -->
      <div v-if="lightboxVisible && currentImageIndex !== null" class="lightbox-backdrop" @click="closeLightbox">
        <div class="lightbox-container" @click.stop>
          <button @click="closeLightbox" class="lightbox-close">✕</button>
          <button @click="previousImage" class="lightbox-nav lightbox-prev" :disabled="screenshots.length <= 1">‹</button>
          <button @click="nextImage" class="lightbox-nav lightbox-next" :disabled="screenshots.length <= 1">›</button>
          <div class="lightbox-content">
            <img
              v-if="currentScreenshot?.dataUrl"
              :src="currentScreenshot.dataUrl"
              :alt="currentScreenshot.file_name || 'Screenshot'"
              class="lightbox-image"
              :style="{ transform: `scale(${imageScale})` }"
              @load="handleImageLoad"
            />
            <div class="lightbox-info">
              <p class="lightbox-title">{{ currentScreenshot?.file_name || `Screenshot ${(currentImageIndex ?? 0) + 1}` }}</p>
              <p v-if="currentScreenshot?.source_url" class="lightbox-url">{{ currentScreenshot.source_url }}</p>
              <p class="lightbox-counter">{{ (currentImageIndex ?? 0) + 1 }} / {{ screenshots.length }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Teleport } from 'vue';

interface Screenshot {
  rsuuid: string;
  gameid: string;
  gvuuid?: string;
  file_name?: string;
  file_ext?: string;
  source_url?: string;
  screenshot_type?: string;
  encrypted_data?: Buffer;
  fernet_key?: string;
  kind?: string;
  dataUrl?: string;
  loading?: boolean;
  error?: string;
}

interface Props {
  visible: boolean;
  gameId: string | number;
  gameName?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'close': [];
}>();

const screenshots = ref<Screenshot[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const lightboxVisible = ref(false);
const currentImageIndex = ref<number | null>(null);
const imageScale = ref(1);
const imageDimensions = ref<{ width: number; height: number } | null>(null);

const currentScreenshot = computed(() => {
  if (currentImageIndex.value === null) return null;
  return screenshots.value[currentImageIndex.value] || null;
});

function calculateImageScale(width: number, height: number): number {
  // For images 256x224 or smaller, use 400% zoom
  if (width <= 256 && height <= 224) {
    return 4.0;
  }
  
  // For larger images, scale to fit within 1024x896 while maintaining aspect ratio
  // Scale range: 1.01 to 4.0
  const maxWidth = 1024;
  const maxHeight = 896;
  
  const scaleX = maxWidth / width;
  const scaleY = maxHeight / height;
  const scale = Math.min(scaleX, scaleY);
  
  // Clamp between 1.01 and 4.0
  return Math.max(1.01, Math.min(4.0, scale));
}

function handleImageLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  if (img) {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    imageDimensions.value = { width, height };
    imageScale.value = calculateImageScale(width, height);
  }
}

async function loadScreenshots() {
  if (!props.gameId) return;
  
  loading.value = true;
  error.value = null;
  screenshots.value = [];
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getGameScreenshots) {
      throw new Error('getGameScreenshots API not available');
    }
    
    const result = await api.getGameScreenshots({
      gameid: String(props.gameId),
    });
    
    if (result?.success && Array.isArray(result.screenshots)) {
      screenshots.value = result.screenshots.map((s: any) => ({
        ...s,
        loading: s.encrypted_data ? true : false,
      }));
      
      // Decrypt and load images
      for (let i = 0; i < screenshots.value.length; i++) {
        await loadScreenshotImage(i);
      }
    } else {
      screenshots.value = [];
    }
  } catch (err: any) {
    console.error('Error loading screenshots:', err);
    error.value = err.message || 'Failed to load screenshots';
  } finally {
    loading.value = false;
  }
}

async function loadScreenshotImage(index: number) {
  const screenshot = screenshots.value[index];
  if (!screenshot) return;
  
  // If it's a URL-based screenshot, try to load from URL
  if (screenshot.kind === 'url' && screenshot.source_url) {
    try {
      screenshot.loading = true;
      screenshot.error = undefined;
      
      // For URL screenshots, we'd need to fetch them
      // For now, we'll just mark them as having the URL
      screenshot.dataUrl = screenshot.source_url;
      screenshot.loading = false;
    } catch (err: any) {
      screenshot.error = err.message || 'Failed to load image';
      screenshot.loading = false;
    }
    return;
  }
  
  // For file-based screenshots with encrypted data
  if (screenshot.encrypted_data && screenshot.fernet_key) {
    try {
      screenshot.loading = true;
      screenshot.error = undefined;
      
      // Decrypt the image
      const api = (window as any)?.electronAPI;
      if (!api?.decryptScreenshot) {
        throw new Error('decryptScreenshot API not available');
      }
      
      const decryptedResult = await api.decryptScreenshot({
        encryptedData: screenshot.encrypted_data,
        fernetKey: screenshot.fernet_key,
        screenshotType: screenshot.screenshot_type || 'image/png',
      });
      
      if (decryptedResult?.success && decryptedResult.dataUrl) {
        screenshot.dataUrl = decryptedResult.dataUrl;
      } else {
        throw new Error(decryptedResult?.error || 'Failed to decrypt screenshot');
      }
    } catch (err: any) {
      console.error(`Error loading screenshot ${index}:`, err);
      screenshot.error = err.message || 'Failed to load image';
    } finally {
      screenshot.loading = false;
    }
  }
}

function handleImageError(index: number) {
  const screenshot = screenshots.value[index];
  if (screenshot) {
    screenshot.error = 'Failed to display image';
  }
}

function openLightbox(index: number) {
  currentImageIndex.value = index;
  lightboxVisible.value = true;
  // Reset scale when opening new image
  imageScale.value = 1;
  imageDimensions.value = null;
}

function closeLightbox() {
  lightboxVisible.value = false;
  currentImageIndex.value = null;
}

function previousImage() {
  if (currentImageIndex.value === null || screenshots.value.length === 0) return;
  currentImageIndex.value = (currentImageIndex.value - 1 + screenshots.value.length) % screenshots.value.length;
  // Reset scale when changing images
  imageScale.value = 1;
  imageDimensions.value = null;
}

function nextImage() {
  if (currentImageIndex.value === null || screenshots.value.length === 0) return;
  currentImageIndex.value = (currentImageIndex.value + 1) % screenshots.value.length;
  // Reset scale when changing images
  imageScale.value = 1;
  imageDimensions.value = null;
}

function close() {
  closeLightbox();
  emit('close');
}

watch(() => props.visible, (newVal) => {
  if (newVal && props.gameId) {
    loadScreenshots();
  }
});

watch(() => props.gameId, () => {
  if (props.visible && props.gameId) {
    loadScreenshots();
  }
});

onMounted(() => {
  if (props.visible && props.gameId) {
    loadScreenshots();
  }
});
</script>

<style scoped>
.screenshot-gallery-modal {
  max-width: 95vw;
  width: 1200px;
  max-height: 95vh;
}

.screenshot-gallery-body {
  max-height: calc(95vh - 120px);
  overflow-y: auto;
  padding: 20px;
}

.loading-state,
.error-state,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary, #666);
}

.error-message {
  color: var(--error-color, #d32f2f);
  margin-bottom: 16px;
}

.btn-retry {
  padding: 8px 16px;
  background-color: var(--accent-primary, #4CAF50);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.gallery-item {
  position: relative;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s, transform 0.2s;
  background-color: var(--bg-secondary, #f5f5f5);
}

.gallery-item:hover {
  border-color: var(--accent-primary, #4CAF50);
  transform: scale(1.02);
}

.screenshot-thumbnail {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
}

.screenshot-loading,
.screenshot-error {
  width: 100%;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-tertiary, #e0e0e0);
  color: var(--text-secondary, #666);
  font-size: 12px;
}

.screenshot-error {
  color: var(--error-color, #d32f2f);
}

.screenshot-info {
  padding: 8px;
  background-color: var(--bg-primary, white);
}

.screenshot-name {
  font-size: 12px;
  color: var(--text-primary, #333);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

/* Lightbox Styles */
.lightbox-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.9);
  z-index: 30001;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.lightbox-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100vw;
  min-height: 100vh;
}

.lightbox-close {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  font-size: 24px;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-close:hover {
  background: rgba(0, 0, 0, 0.9);
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  font-size: 32px;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.lightbox-nav:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.9);
}

.lightbox-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.lightbox-prev {
  left: 20px;
}

.lightbox-next {
  right: 20px;
}

.lightbox-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
}

.lightbox-image {
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.2s ease;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
}

.lightbox-info {
  padding: 16px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  text-align: center;
  width: 100%;
}

.lightbox-title {
  font-size: 16px;
  font-weight: bold;
  margin: 0 0 8px 0;
}

.lightbox-url {
  font-size: 12px;
  color: #ccc;
  margin: 0 0 8px 0;
  word-break: break-all;
}

.lightbox-counter {
  font-size: 14px;
  color: #ccc;
  margin: 0;
}
</style>

