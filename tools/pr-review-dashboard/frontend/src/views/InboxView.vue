<template>
  <div>
    <div class="page-header">
      <h1>PR Inbox</h1>
      <span v-if="fetchedAt" class="fetched-at">
        Updated: {{ formatDate(fetchedAt) }}
      </span>
    </div>

    <!-- Filters -->
    <div style="display: flex; gap: 1.5rem; margin-bottom: 1.25rem; flex-wrap: wrap; align-items: center;">
      <div>
        <label style="font-size: 0.8rem; color: var(--text-color-secondary); margin-bottom: 0.35rem; display: block;">Product</label>
        <div class="filter-chips">
          <span
            v-for="p in products"
            :key="p.value"
            class="filter-chip"
            :class="{ active: productFilter === p.value }"
            @click="productFilter = p.value"
          >{{ p.label }}</span>
        </div>
      </div>
      <div>
        <label style="font-size: 0.8rem; color: var(--text-color-secondary); margin-bottom: 0.35rem; display: block;">Status</label>
        <div class="filter-chips">
          <span
            v-for="s in statuses"
            :key="s.value"
            class="filter-chip"
            :class="{ active: statusFilter === s.value }"
            @click="statusFilter = s.value"
          >{{ s.label }}</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-message">
      <i class="pi pi-exclamation-triangle"></i> {{ error }}
    </div>

    <!-- Table -->
    <div v-else>
      <table class="inbox-table">
        <thead>
          <tr>
            <th style="width: 60px;">#</th>
            <th>Repo</th>
            <th>Title</th>
            <th>Author</th>
            <th style="width: 100px;">Age</th>
            <th style="width: 70px;">Size</th>
            <th style="width: 180px;">Verdict</th>
            <th style="width: 100px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="pr in filteredPRs"
            :key="`${pr.repo}-${pr.number}`"
            class="inbox-row"
            @click="goToReview(pr)"
          >
            <td class="pr-number">{{ pr.number }}</td>
            <td>
              <span class="repo-name">{{ pr.repo }}</span>
            </td>
            <td>
              <div class="pr-title">
                {{ pr.title }}
                <span v-if="pr.is_draft" class="draft-badge">Draft</span>
              </div>
            </td>
            <td class="author-cell">{{ pr.author }}</td>
            <td class="age-cell">{{ relativeAge(pr.created_at) }}</td>
            <td>
              <span class="size-badge" :class="sizeClass(pr)">{{ sizeLabel(pr) }}</span>
            </td>
            <td>
              <VerdictBadge :verdict="pr.verdict" />
            </td>
            <td>
              <a
                :href="pr.url"
                target="_blank"
                rel="noopener"
                class="action-link"
                title="Open on GitHub"
                @click.stop
              >
                <i class="pi pi-external-link"></i>
              </a>
            </td>
          </tr>
          <tr v-if="filteredPRs.length === 0">
            <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-color-secondary);">
              No pull requests match the current filters.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import VerdictBadge from '../components/VerdictBadge.vue';

const router = useRouter();

const loading = ref(true);
const error = ref(null);
const pullRequests = ref([]);
const fetchedAt = ref('');
const productFilter = ref('all');
const statusFilter = ref('all');

let refreshTimer = null;

const products = [
  { label: 'All', value: 'all' },
  { label: 'DieMaster', value: 'diemaster' },
  { label: 'SpotFusion', value: 'spotfusion' },
  { label: 'VisionKing', value: 'visionking' },
];

const statuses = [
  { label: 'All', value: 'all' },
  { label: 'Needs Review', value: 'needs_review' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'Draft', value: 'draft' },
];

const filteredPRs = computed(() => {
  let prs = pullRequests.value;

  if (productFilter.value !== 'all') {
    prs = prs.filter((pr) => {
      const repo = pr.repo.toLowerCase();
      return repo.includes(productFilter.value);
    });
  }

  if (statusFilter.value === 'needs_review') {
    prs = prs.filter((pr) => !pr.has_review && !pr.is_draft);
  } else if (statusFilter.value === 'reviewed') {
    prs = prs.filter((pr) => pr.has_review);
  } else if (statusFilter.value === 'draft') {
    prs = prs.filter((pr) => pr.is_draft);
  }

  return prs;
});

async function fetchInbox() {
  try {
    const res = await api.get('/inbox');
    pullRequests.value = res.data.pull_requests || [];
    fetchedAt.value = res.data.fetched_at || '';
    error.value = null;
  } catch (e) {
    error.value = `Failed to load inbox: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

function goToReview(pr) {
  router.push({ name: 'review-detail', params: { repo: pr.repo, number: pr.number } });
}

function relativeAge(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const created = new Date(dateStr).getTime();
  const diffMs = now - created;
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return '<1h';
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  return `${Math.floor(diffD / 30)}mo`;
}

function sizeLabel(pr) {
  const total = (pr.additions || 0) + (pr.deletions || 0);
  if (total < 100) return 'S';
  if (total < 500) return 'M';
  return 'L';
}

function sizeClass(pr) {
  const label = sizeLabel(pr);
  if (label === 'S') return 'size-s';
  if (label === 'M') return 'size-m';
  return 'size-l';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

onMounted(() => {
  fetchInbox();
  refreshTimer = setInterval(fetchInbox, 60000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.inbox-table {
  width: 100%;
  border-collapse: collapse;
  background-color: var(--surface-card);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #333;
}

.inbox-table thead th {
  background-color: var(--surface-overlay);
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-color-secondary);
  border-bottom: 1px solid #333;
}

.inbox-table tbody td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid #2a2a2a;
  font-size: 0.87rem;
}

.inbox-row {
  cursor: pointer;
  transition: background-color 0.1s;
}

.inbox-row:hover {
  background-color: var(--surface-overlay);
}

.pr-number {
  color: var(--text-color-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.repo-name {
  color: var(--primary-color);
  font-size: 0.83rem;
}

.pr-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.draft-badge {
  font-size: 0.68rem;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background-color: rgba(160, 160, 160, 0.15);
  color: #a0a0a0;
  text-transform: uppercase;
  font-weight: 600;
}

.author-cell {
  color: var(--text-color-secondary);
}

.age-cell {
  color: var(--text-color-secondary);
  font-size: 0.83rem;
}

.action-link {
  color: var(--text-color-secondary);
  padding: 0.25rem;
  transition: color 0.15s;
}

.action-link:hover {
  color: var(--primary-color);
}
</style>
