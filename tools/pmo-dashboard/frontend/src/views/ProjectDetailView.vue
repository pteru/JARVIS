<template>
  <div class="page-container">
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <template v-else-if="project">
      <div class="page-header">
        <div class="flex-row">
          <router-link to="/" class="back-link">
            <i class="pi pi-arrow-left"></i>
          </router-link>
          <div>
            <div class="flex-row">
              <h1>{{ project.name }}</h1>
              <span class="product-badge" :class="productBadgeClass">
                {{ project.product_line }}
              </span>
            </div>
            <p class="project-meta">
              {{ project.code }}
              <span v-if="project.phase"> &middot; {{ project.phase }}</span>
              <span v-if="project.language"> &middot; {{ project.language }}</span>
            </p>
          </div>
        </div>
      </div>

      <Tabs :value="activeTab" @update:value="activeTab = $event">
        <TabList>
          <Tab value="overview">
            <i class="pi pi-file-edit"></i> Overview
          </Tab>
          <Tab value="emails">
            <i class="pi pi-envelope"></i> Emails ({{ project.email_count }})
          </Tab>
          <Tab value="documents">
            <i class="pi pi-folder"></i> Documents ({{ project.document_count }})
          </Tab>
          <Tab value="timeline">
            <i class="pi pi-clock"></i> Timeline
          </Tab>
          <Tab value="schedule">
            <i class="pi pi-calendar"></i> Schedule
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="overview">
            <div class="tab-content">
              <div v-if="technicalReport" class="report-content markdown-body" v-html="renderMarkdown(technicalReport)">
              </div>
              <div v-else class="empty-state">
                <i class="pi pi-file"></i>
                <p>No technical report available</p>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="emails">
            <div class="tab-content">
              <EmailTable :project-code="code" />
              <div class="mt-2">
                <router-link :to="`/projects/${code}/emails`" class="view-all-link">
                  <i class="pi pi-external-link"></i> Open full email browser
                </router-link>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="documents">
            <div class="tab-content">
              <DocumentList :project-code="code" />
            </div>
          </TabPanel>

          <TabPanel value="timeline">
            <div class="tab-content">
              <div v-if="timelineLoading" class="loading-container">
                <i class="pi pi-spin pi-spinner"></i>
              </div>
              <div v-else-if="timeline.length === 0" class="empty-state">
                <i class="pi pi-clock"></i>
                <p>No timeline events</p>
              </div>
              <div v-else class="timeline-list">
                <div v-for="(event, idx) in timeline" :key="idx" class="timeline-item">
                  <div class="timeline-marker">
                    <div class="marker-dot"></div>
                    <div v-if="idx < timeline.length - 1" class="marker-line"></div>
                  </div>
                  <div class="timeline-content">
                    <div class="timeline-date">{{ event.date }}</div>
                    <div class="timeline-title">{{ event.title || event.event }}</div>
                    <div v-if="event.description" class="timeline-desc">{{ event.description }}</div>
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="schedule">
            <div class="tab-content">
              <router-link :to="`/projects/${code}/schedule`" class="schedule-link pmo-card">
                <i class="pi pi-calendar" style="font-size: 2rem;"></i>
                <span>Open Gantt Chart Schedule</span>
                <i class="pi pi-arrow-right"></i>
              </router-link>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>

    <div v-else class="empty-state">
      <i class="pi pi-exclamation-circle"></i>
      <p>Project not found</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import { getProject, getTimeline } from '../api.js'
import EmailTable from '../components/EmailTable.vue'
import DocumentList from '../components/DocumentList.vue'

const props = defineProps({
  code: { type: String, required: true }
})

const project = ref(null)
const loading = ref(true)
const activeTab = ref('overview')
const technicalReport = ref(null)
const timeline = ref([])
const timelineLoading = ref(false)

const productBadgeClass = computed(() => {
  if (!project.value) return ''
  const line = project.value.product_line
  if (line === 'VisionKing') return 'badge-visionking'
  if (line === 'DieMaster') return 'badge-diemaster'
  return 'badge-spotfusion'
})

function renderMarkdown(text) {
  if (!text) return ''
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) => {
    return esc(s)
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }

  const lines = text.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (line.trim() === '') { i++; continue }

    // Table: detect pipe-delimited rows
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines = []
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim())
        i++
      }
      if (tableLines.length >= 2) {
        const parseRow = (r) => r.slice(1, -1).split('|').map(c => c.trim())
        const headers = parseRow(tableLines[0])
        // Skip separator row (index 1)
        const startRow = /^[\s|:-]+$/.test(tableLines[1]) ? 2 : 1
        let tbl = '<table><thead><tr>'
        for (const h of headers) tbl += `<th>${inline(h)}</th>`
        tbl += '</tr></thead><tbody>'
        for (let r = startRow; r < tableLines.length; r++) {
          const cells = parseRow(tableLines[r])
          tbl += '<tr>'
          for (let c = 0; c < headers.length; c++) tbl += `<td>${inline(cells[c] || '')}</td>`
          tbl += '</tr>'
        }
        tbl += '</tbody></table>'
        out.push(tbl)
      }
      continue
    }

    // Headers
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (hMatch) {
      const lvl = hMatch[1].length
      out.push(`<h${lvl}>${inline(hMatch[2])}</h${lvl}>`)
      i++; continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue }

    // Unordered list
    if (/^\s*[-*]\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*]\s+/, '')))
        i++
      }
      out.push('<ul>' + items.map(it => `<li>${it}</li>`).join('') + '</ul>')
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*\d+\.\s+/, '')))
        i++
      }
      out.push('<ol>' + items.map(it => `<li>${it}</li>`).join('') + '</ol>')
      continue
    }

    // Paragraph (collect consecutive non-blank, non-special lines)
    const para = []
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].match(/^#{1,4}\s/) && !lines[i].match(/^---+$/) &&
           !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) &&
           !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i])) {
      para.push(inline(lines[i]))
      i++
    }
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`)
  }

  return out.join('\n')
}

async function loadProject() {
  loading.value = true
  try {
    const data = await getProject(props.code)
    project.value = data
    technicalReport.value = data.technical_report || null
  } catch (err) {
    console.error('Failed to load project:', err)
  } finally {
    loading.value = false
  }
}

async function loadTimeline() {
  timelineLoading.value = true
  try {
    timeline.value = await getTimeline(props.code)
  } catch (err) {
    console.error('Failed to load timeline:', err)
    timeline.value = []
  } finally {
    timelineLoading.value = false
  }
}

watch(() => activeTab.value, (tab) => {
  if (tab === 'timeline' && timeline.value.length === 0) {
    loadTimeline()
  }
})

onMounted(() => {
  loadProject()
})
</script>

<style scoped>
.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.back-link:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}

.product-badge {
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.project-meta {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-top: 0.25rem;
}

.tab-content {
  padding: 1.25rem 0;
}

.report-content {
  background-color: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.5rem 2rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--color-text-primary);
  max-height: 700px;
  overflow-y: auto;
}

.markdown-body :deep(h1) { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.75rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.3rem; }
.markdown-body :deep(h2) { font-size: 1.25rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
.markdown-body :deep(h3) { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.4rem; color: var(--color-accent); }
.markdown-body :deep(h4) { font-size: 1rem; font-weight: 600; margin: 0.75rem 0 0.3rem; }
.markdown-body :deep(strong) { font-weight: 600; }
.markdown-body :deep(em) { font-style: italic; }
.markdown-body :deep(code) { background-color: var(--color-bg-card); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85em; font-family: monospace; }
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--color-border); margin: 1.25rem 0; }
.markdown-body :deep(ul) { padding-left: 1.5rem; margin: 0.5rem 0; }
.markdown-body :deep(li) { margin-bottom: 0.25rem; }
.markdown-body :deep(ol) { padding-left: 1.5rem; margin: 0.5rem 0; }
.markdown-body :deep(p) { margin-bottom: 0.5rem; }
.markdown-body :deep(table) { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.85rem; }
.markdown-body :deep(th) { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--color-border); font-weight: 600; color: var(--color-text-secondary); background-color: var(--color-bg-card); }
.markdown-body :deep(td) { padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--color-border); }
.markdown-body :deep(tr:hover td) { background-color: var(--color-bg-card); }

.view-all-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--color-accent);
  font-size: 0.9rem;
}

.view-all-link:hover {
  color: var(--color-accent-hover);
}

/* Timeline */
.timeline-list {
  padding-left: 0.5rem;
}

.timeline-item {
  display: flex;
  gap: 1rem;
  min-height: 70px;
}

.timeline-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}

.marker-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--color-accent);
  margin-top: 4px;
}

.marker-line {
  width: 2px;
  flex: 1;
  background-color: var(--color-border);
  margin-top: 4px;
}

.timeline-content {
  padding-bottom: 1.25rem;
}

.timeline-date {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.15rem;
}

.timeline-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.timeline-desc {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-top: 0.25rem;
}

/* Schedule link */
.schedule-link {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  cursor: pointer;
  text-decoration: none;
  color: var(--color-text-primary);
  font-size: 1.1rem;
  font-weight: 500;
}

.schedule-link .pi-arrow-right {
  margin-left: auto;
  color: var(--color-text-secondary);
}
</style>
