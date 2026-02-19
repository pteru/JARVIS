import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import router from './router.js'
import App from './App.vue'
import './assets/theme.css'

const app = createApp(App)

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark-mode',
      cssLayer: false
    }
  }
})

app.use(router)

document.documentElement.classList.add('dark-mode')

app.mount('#app')
