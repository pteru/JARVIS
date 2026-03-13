import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import Tooltip from 'primevue/tooltip';

import 'primeicons/primeicons.css';
import './assets/theme.css';

import App from './App.vue';
import router from './router.js';

const app = createApp(App);

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.p-dark',
    },
  },
});

app.directive('tooltip', Tooltip);

app.use(router);
app.mount('#app');

// Force dark mode
document.documentElement.classList.add('p-dark');
