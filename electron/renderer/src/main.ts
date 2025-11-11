import { createApp } from 'vue';
import App from './App.vue';
import Provisioner from './Provisioner.vue';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') || 'app';

if (!(typeof process !== 'undefined' && process.env && process.env.RHTOOLS_CLI_MODE)) {
  if (mode === 'provisioner') {
    createApp(Provisioner).mount('#app');
  } else {
    createApp(App).mount('#app');
  }
}
