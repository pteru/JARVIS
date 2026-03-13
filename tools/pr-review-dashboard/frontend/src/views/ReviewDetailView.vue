<template>
  <div>
    <!-- Back button -->
    <div style="margin-bottom: 1rem;">
      <router-link to="/" style="color: var(--text-color-secondary); text-decoration: none; font-size: 0.85rem;">
        <i class="pi pi-arrow-left" style="margin-right: 0.35rem;"></i> Back to Inbox
      </router-link>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-message">
      <i class="pi pi-exclamation-triangle"></i> {{ error }}
    </div>

    <!-- Review content -->
    <div v-else class="review-layout">
      <!-- Left sidebar -->
      <div class="review-sidebar">
        <!-- PR Info card -->
        <div class="info-card">
          <h3>PR Info</h3>
          <div class="info-row">
            <span class="label">Repo</span>
            <span class="value">{{ repo }}</span>
          </div>
          <div class="info-row">
            <span class="label">Number</span>
            <span class="value">#{{ number }}</span>
          </div>
          <div class="info-row" v-if="review.metadata">
            <span class="label">SHA</span>
            <span class="value sha-value">{{ (review.metadata.current_head_sha || '').slice(0, 7) }}</span>
          </div>
          <div class="info-row" v-if="review.complexity">
            <span class="label">Complexity</span>
            <span class="value">{{ review.complexity }}</span>
          </div>
          <div class="info-row">
            <span class="label">Verdict</span>
            <VerdictBadge :verdict="review.verdict" />
          </div>
        </div>

        <!-- Findings -->
        <div class="info-card" v-if="review.findings">
          <h3>Findings</h3>
          <div class="finding-chips">
            <span v-if="review.findings.critical" class="finding-chip critical">
              <i class="pi pi-times-circle"></i> {{ review.findings.critical }} critical
            </span>
            <span v-if="review.findings.warnings" class="finding-chip warning">
              <i class="pi pi-exclamation-triangle"></i> {{ review.findings.warnings }} warnings
            </span>
            <span v-if="review.findings.suggestions" class="finding-chip suggestion">
              <i class="pi pi-info-circle"></i> {{ review.findings.suggestions }} suggestions
            </span>
            <span
              v-if="!review.findings.critical && !review.findings.warnings && !review.findings.suggestions"
              style="color: var(--text-color-secondary); font-size: 0.85rem;"
            >No findings</span>
          </div>
        </div>

        <!-- Version history -->
        <div class="info-card" v-if="historyVersions.length">
          <h3>Version History</h3>
          <ReviewTimeline
            :versions="historyVersions"
            :current-version="selectedVersion"
            @select="loadVersion"
          />
        </div>

        <!-- Actions -->
        <div class="info-card">
          <h3>Actions</h3>
          <div class="action-buttons">
            <button class="action-btn action-btn-primary" @click="confirmPost" :disabled="actionLoading">
              <i class="pi pi-send"></i> Post to GitHub
            </button>
            <button class="action-btn action-btn-secondary" @click="applyLabels" :disabled="actionLoading">
              <i class="pi pi-tags"></i> Apply Labels
            </button>
            <button class="action-btn action-btn-danger" @click="confirmMerge" :disabled="actionLoading">
              <i class="pi pi-check-circle"></i> Merge (Squash)
            </button>
          </div>
          <div v-if="actionMessage" class="action-message" :class="{ success: actionSuccess, failure: !actionSuccess }">
            {{ actionMessage }}
          </div>
        </div>
      </div>

      <!-- Right panel: rendered review -->
      <div class="review-content" v-html="renderedContent"></div>
    </div>

    <!-- Confirm dialogs -->
    <ConfirmDialog
      :visible="showPostConfirm"
      title="Post Review to GitHub"
      :message="`Post the review for ${repo}#${number} as a GitHub PR comment?`"
      confirm-label="Post"
      severity="warning"
      @confirm="doPost"
      @cancel="showPostConfirm = false"
    />

    <ConfirmDialog
      :visible="showMergeConfirm"
      title="Merge Pull Request"
      :message="`Are you sure you want to squash-merge ${repo}#${number}? This cannot be undone.`"
      confirm-label="Merge"
      severity="danger"
      @confirm="doMerge"
      @cancel="showMergeConfirm = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.min.css';
import api from '../api.js';
import VerdictBadge from '../components/VerdictBadge.vue';
import ReviewTimeline from '../components/ReviewTimeline.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const props = defineProps({
  repo: { type: String, required: true },
  number: { type: [String, Number], required: true },
});

const loading = ref(true);
const error = ref(null);
const review = ref({});
const historyVersions = ref([]);
const selectedVersion = ref(1);
const actionLoading = ref(false);
const actionMessage = ref('');
const actionSuccess = ref(false);
const showPostConfirm = ref(false);
const showMergeConfirm = ref(false);

const marked = new Marked({
  renderer: {
    code({ text, lang }) {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      }
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code>${escaped}</code></pre>`;
    },
  },
});

const renderedContent = computed(() => {
  if (!review.value.content) return '<p style="color: var(--text-color-secondary);">No review content available.</p>';
  return marked.parse(review.value.content);
});

async function fetchReview() {
  try {
    loading.value = true;
    const [reviewRes, historyRes] = await Promise.all([
      api.get(`/reviews/${props.repo}/${props.number}`),
      api.get(`/reviews/${props.repo}/${props.number}/history`).catch(() => ({ data: { versions: [] } })),
    ]);
    review.value = reviewRes.data;
    historyVersions.value = historyRes.data.versions || [];
    selectedVersion.value = historyRes.data.current_version || review.value.metadata?.current_version || 1;
    error.value = null;
  } catch (e) {
    error.value = `Failed to load review: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

async function loadVersion(version) {
  selectedVersion.value = version;
  // Find the version in history and load its content if available
  const ver = historyVersions.value.find((v) => v.version === version);
  if (ver && ver.content) {
    review.value = { ...review.value, content: ver.content };
  } else {
    // Reload the current version from the API
    try {
      const res = await api.get(`/reviews/${props.repo}/${props.number}`);
      review.value = res.data;
    } catch {
      // Ignore — keep current content
    }
  }
}

function confirmPost() {
  showPostConfirm.value = true;
}

function confirmMerge() {
  showMergeConfirm.value = true;
}

async function doPost() {
  showPostConfirm.value = false;
  actionLoading.value = true;
  actionMessage.value = '';
  try {
    const res = await api.post(`/actions/reviews/${props.repo}/${props.number}/post`);
    actionMessage.value = res.data.message || 'Posted successfully';
    actionSuccess.value = res.data.success;
  } catch (e) {
    actionMessage.value = e.response?.data?.detail || e.message;
    actionSuccess.value = false;
  } finally {
    actionLoading.value = false;
  }
}

async function doMerge() {
  showMergeConfirm.value = false;
  actionLoading.value = true;
  actionMessage.value = '';
  try {
    const res = await api.post(`/actions/prs/${props.repo}/${props.number}/merge`, { confirm: true });
    actionMessage.value = res.data.message || 'Merged successfully';
    actionSuccess.value = res.data.success;
  } catch (e) {
    actionMessage.value = e.response?.data?.detail || e.message;
    actionSuccess.value = false;
  } finally {
    actionLoading.value = false;
  }
}

async function applyLabels() {
  actionLoading.value = true;
  actionMessage.value = '';
  try {
    // Derive labels from the verdict
    const labels = [];
    if (review.value.verdict) {
      const v = review.value.verdict.toUpperCase();
      if (v === 'APPROVE') labels.push('ai-approved');
      else if (v.includes('CHANGES')) labels.push('ai-changes-requested');
      else labels.push('ai-reviewed');
    }
    if (review.value.complexity) {
      labels.push(`size/${review.value.complexity.toLowerCase()}`);
    }
    if (!labels.length) labels.push('ai-reviewed');

    const res = await api.post(`/actions/prs/${props.repo}/${props.number}/labels`, { labels });
    actionMessage.value = res.data.message || 'Labels applied';
    actionSuccess.value = res.data.success;
  } catch (e) {
    actionMessage.value = e.response?.data?.detail || e.message;
    actionSuccess.value = false;
  } finally {
    actionLoading.value = false;
  }
}

onMounted(fetchReview);
</script>

<style scoped>
.sha-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.83rem;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #444;
  font-size: 0.83rem;
  cursor: pointer;
  transition: all 0.15s;
  background-color: var(--surface-overlay);
  color: var(--text-color);
}

.action-btn:hover:not(:disabled) {
  background-color: #3a3a3a;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn-primary {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.action-btn-primary:hover:not(:disabled) {
  background-color: rgba(96, 165, 250, 0.1);
}

.action-btn-danger {
  border-color: var(--red-500);
  color: var(--red-500);
}

.action-btn-danger:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.1);
}

.action-btn-secondary {
  border-color: #555;
}

.action-message {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
}

.action-message.success {
  background-color: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.action-message.failure {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}
</style>
