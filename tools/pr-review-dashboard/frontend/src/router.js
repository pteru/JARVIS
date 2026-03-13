import { createRouter, createWebHistory } from 'vue-router';

import InboxView from './views/InboxView.vue';
import ReviewDetailView from './views/ReviewDetailView.vue';
import PipelineView from './views/PipelineView.vue';
import AnalyticsView from './views/AnalyticsView.vue';

const routes = [
  { path: '/', name: 'inbox', component: InboxView },
  { path: '/reviews/:repo/:number', name: 'review-detail', component: ReviewDetailView, props: true },
  { path: '/pipeline', name: 'pipeline', component: PipelineView },
  { path: '/analytics', name: 'analytics', component: AnalyticsView },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
