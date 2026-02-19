import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import ProjectDetailView from './views/ProjectDetailView.vue'
import EmailBrowserView from './views/EmailBrowserView.vue'
import SupplierListView from './views/SupplierListView.vue'
import SupplierDetailView from './views/SupplierDetailView.vue'
import ScheduleView from './views/ScheduleView.vue'

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: DashboardView
  },
  {
    path: '/projects/:code',
    name: 'project-detail',
    component: ProjectDetailView,
    props: true
  },
  {
    path: '/projects/:code/emails',
    name: 'email-browser',
    component: EmailBrowserView,
    props: true
  },
  {
    path: '/suppliers',
    name: 'supplier-list',
    component: SupplierListView
  },
  {
    path: '/suppliers/:id',
    name: 'supplier-detail',
    component: SupplierDetailView,
    props: true
  },
  {
    path: '/projects/:code/schedule',
    name: 'schedule',
    component: ScheduleView,
    props: true
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
