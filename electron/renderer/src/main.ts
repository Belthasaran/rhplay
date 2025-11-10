import { createApp } from 'vue';
import App from './App.vue';

if (!(typeof process !== 'undefined' && process.env && process.env.RHTOOLS_CLI_MODE)) {
  createApp(App).mount('#app');
}


