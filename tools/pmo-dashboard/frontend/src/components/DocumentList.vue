<template>
  <div>
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem;"></i>
    </div>

    <div v-else-if="groupedDocs.length === 0" class="empty-state">
      <i class="pi pi-folder-open"></i>
      <p>No documents found</p>
    </div>

    <div v-else class="doc-groups">
      <div v-for="group in groupedDocs" :key="group.folder" class="doc-group">
        <div class="group-header" @click="toggleGroup(group.folder)">
          <i :class="isExpanded(group.folder) ? 'pi pi-folder-open' : 'pi pi-folder'"></i>
          <span class="group-name">{{ group.folder || 'Root' }}</span>
          <span class="group-count">{{ group.files.length }}</span>
          <i :class="isExpanded(group.folder) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="group-chevron"></i>
        </div>
        <div v-if="isExpanded(group.folder)" class="group-files">
          <div v-for="doc in group.files" :key="doc.path || doc.name" class="doc-item">
            <i :class="getFileIcon(doc.name)" class="doc-icon"></i>
            <div class="doc-info">
              <span class="doc-name">{{ doc.name }}</span>
              <span v-if="doc.size_bytes" class="doc-size">{{ formatSize(doc.size_bytes) }}</span>
            </div>
            <a
              v-if="doc.download_url || doc.path"
              :href="doc.download_url || `/api/projects/${projectCode}/documents/${encodeURIComponent(doc.path)}`"
              target="_blank"
              class="doc-download"
              title="Download"
            >
              <i class="pi pi-download"></i>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getDocuments } from '../api.js'

const props = defineProps({
  projectCode: { type: String, required: true }
})

const documents = ref([])
const loading = ref(true)
const expandedGroups = ref(new Set())

const groupedDocs = computed(() => {
  const groups = {}
  for (const doc of documents.value) {
    const folder = doc.directory || doc.folder || doc.category || 'Root'
    if (!groups[folder]) {
      groups[folder] = []
    }
    groups[folder].push(doc)
  }
  return Object.entries(groups).map(([folder, files]) => ({
    folder,
    files: files.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''))
  })).sort((a, b) => a.folder.localeCompare(b.folder))
})

function isExpanded(folder) {
  return expandedGroups.value.has(folder)
}

function toggleGroup(folder) {
  if (expandedGroups.value.has(folder)) {
    expandedGroups.value.delete(folder)
  } else {
    expandedGroups.value.add(folder)
  }
}

function getFileIcon(filename) {
  if (!filename) return 'pi pi-file'
  const ext = filename.split('.').pop().toLowerCase()
  const iconMap = {
    pdf: 'pi pi-file-pdf',
    doc: 'pi pi-file-word',
    docx: 'pi pi-file-word',
    xls: 'pi pi-file-excel',
    xlsx: 'pi pi-file-excel',
    csv: 'pi pi-file-excel',
    ppt: 'pi pi-file',
    pptx: 'pi pi-file',
    png: 'pi pi-image',
    jpg: 'pi pi-image',
    jpeg: 'pi pi-image',
    gif: 'pi pi-image',
    svg: 'pi pi-image',
    zip: 'pi pi-box',
    rar: 'pi pi-box',
    tar: 'pi pi-box',
    gz: 'pi pi-box',
    md: 'pi pi-file-edit',
    txt: 'pi pi-file-edit',
    json: 'pi pi-code',
    xml: 'pi pi-code',
    dxf: 'pi pi-compass',
    step: 'pi pi-compass',
    stp: 'pi pi-compass',
    stl: 'pi pi-compass',
    dwg: 'pi pi-compass'
  }
  return iconMap[ext] || 'pi pi-file'
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(async () => {
  try {
    documents.value = await getDocuments(props.projectCode)
    // Auto-expand all groups
    for (const group of groupedDocs.value) {
      expandedGroups.value.add(group.folder)
    }
  } catch (err) {
    console.error('Failed to load documents:', err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.doc-groups {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.doc-group {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background-color: var(--color-bg-secondary);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}

.group-header:hover {
  background-color: var(--color-bg-card);
}

.group-name {
  font-weight: 600;
  font-size: 0.9rem;
  flex: 1;
}

.group-count {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-card);
  padding: 0.1rem 0.45rem;
  border-radius: 10px;
}

.group-chevron {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.group-files {
  border-top: 1px solid var(--color-border);
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem 0.6rem 1.75rem;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.1s ease;
}

.doc-item:last-child {
  border-bottom: none;
}

.doc-item:hover {
  background-color: var(--color-bg-secondary);
}

.doc-icon {
  font-size: 1.1rem;
  color: var(--color-text-secondary);
  width: 24px;
  text-align: center;
}

.doc-info {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.doc-name {
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.doc-size {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.doc-download {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.doc-download:hover {
  background-color: var(--color-bg-card);
  color: var(--color-accent);
}
</style>
