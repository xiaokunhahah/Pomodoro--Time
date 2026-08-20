import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

// 应用入口：仅做挂载，业务逻辑在各模块按需引入
createApp(App).mount('#app')
