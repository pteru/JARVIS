import axios from 'axios'

const api = axios.create({
  baseURL: ''
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// --- Projects ---
export function getProjects() {
  return api.get('/api/projects').then(r => r.data)
}

export function getProject(code) {
  return api.get(`/api/projects/${code}`).then(r => r.data)
}

export function getProjectEmails(code, params = {}) {
  return api.get(`/api/projects/${code}/emails`, { params }).then(r => r.data)
}

export function getEmailDetail(code, hash) {
  return api.get(`/api/projects/${code}/emails/${hash}`).then(r => r.data)
}

// --- Documents ---
export function getDocuments(code) {
  return api.get(`/api/projects/${code}/documents`).then(r => r.data)
}

// --- Timeline ---
export function getTimeline(code) {
  return api.get(`/api/projects/${code}/timeline`).then(r => r.data)
}

// --- Suppliers ---
export function getSuppliers(params = {}) {
  return api.get('/api/suppliers', { params }).then(r => r.data)
}

export function createSupplier(data) {
  return api.post('/api/suppliers', data).then(r => r.data)
}

export function getSupplier(id) {
  return api.get(`/api/suppliers/${id}`).then(r => r.data)
}

export function updateSupplier(id, data) {
  return api.put(`/api/suppliers/${id}`, data).then(r => r.data)
}

export function deleteSupplier(id) {
  return api.delete(`/api/suppliers/${id}`)
}

// --- Contacts ---
export function addContact(supplierId, data) {
  return api.post(`/api/suppliers/${supplierId}/contacts`, data).then(r => r.data)
}

export function updateContact(supplierId, cid, data) {
  return api.put(`/api/suppliers/${supplierId}/contacts/${cid}`, data).then(r => r.data)
}

export function deleteContact(supplierId, cid) {
  return api.delete(`/api/suppliers/${supplierId}/contacts/${cid}`)
}

// --- Catalogs ---
export function addCatalog(supplierId, data) {
  return api.post(`/api/suppliers/${supplierId}/catalogs`, data).then(r => r.data)
}

export function deleteCatalog(supplierId, cid) {
  return api.delete(`/api/suppliers/${supplierId}/catalogs/${cid}`)
}

// --- Quotes ---
export function getQuotes(supplierId) {
  return api.get(`/api/suppliers/${supplierId}/quotes`).then(r => r.data)
}

export function addQuote(supplierId, data) {
  return api.post(`/api/suppliers/${supplierId}/quotes`, data).then(r => r.data)
}

export function updateQuote(supplierId, qid, data) {
  return api.put(`/api/suppliers/${supplierId}/quotes/${qid}`, data).then(r => r.data)
}

export function deleteQuote(supplierId, qid) {
  return api.delete(`/api/suppliers/${supplierId}/quotes/${qid}`)
}

// --- Supplier Projects ---
export function addSupplierProject(supplierId, data) {
  return api.post(`/api/suppliers/${supplierId}/projects`, data).then(r => r.data)
}

// --- Schedule ---
export function getSchedule(code) {
  return api.get(`/api/projects/${code}/schedule`).then(r => r.data)
}

export function createTask(code, data) {
  return api.post(`/api/projects/${code}/schedule/tasks`, data).then(r => r.data)
}

export function updateTask(code, taskId, data) {
  return api.put(`/api/projects/${code}/schedule/tasks/${taskId}`, data).then(r => r.data)
}

// --- Alerts ---
export function getAlerts(params = {}) {
  return api.get('/api/alerts', { params }).then(r => r.data)
}

export function dismissAlert(id) {
  return api.put(`/api/alerts/${id}/dismiss`).then(r => r.data)
}

// --- Search ---
export function search(params = {}) {
  return api.get('/api/search', { params }).then(r => r.data)
}

// --- Sheet Sync ---
export function syncToSheet() {
  return api.post('/api/suppliers/sync-to-sheet').then(r => r.data)
}

export function syncFromSheet() {
  return api.post('/api/suppliers/sync-from-sheet').then(r => r.data)
}

export default api
