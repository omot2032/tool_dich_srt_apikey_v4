import { StoryProject } from '../types';

const DB_NAME = 'TruyenAudioStudio_DB';
const DB_VERSION = 1;
const STORE_NAME = 'story_projects';
const LAST_ACTIVE_PROJECT_KEY = 'truyen_ai_last_active_project_id';

/**
 * Open or upgrade IndexedDB database for Story Projects
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB không được hỗ trợ trên trình duyệt này.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('fileName', 'fileName', { unique: false });
        store.createIndex('lastUpdatedAt', 'lastUpdatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Không thể mở IndexedDB.'));
    };
  });
}

/**
 * Get all story projects, ordered by lastUpdatedAt descending
 */
export async function getAllProjects(): Promise<StoryProject[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const list: StoryProject[] = request.result || [];
        // Sort newest updated first
        list.sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));
        resolve(list);
      };

      request.onerror = () => {
        reject(request.error || new Error('Lỗi khi đọc danh sách dự án'));
      };
    });
  } catch (err) {
    console.warn('IndexedDB getAllProjects fallback to localStorage', err);
    return loadProjectsFromLocalStorage();
  }
}

/**
 * Get project by ID
 */
export async function getProjectById(id: string): Promise<StoryProject | null> {
  if (!id) return null;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error || new Error('Lỗi khi lấy thông tin dự án'));
      };
    });
  } catch (err) {
    console.warn('IndexedDB getProjectById fallback', err);
    const all = loadProjectsFromLocalStorage();
    return all.find((p) => p.id === id) || null;
  }
}

/**
 * Find project by fileName
 */
export async function getProjectByFileName(fileName: string): Promise<StoryProject | null> {
  if (!fileName) return null;
  const all = await getAllProjects();
  return (
    all.find(
      (p) =>
        p.fileName.trim().toLowerCase() === fileName.trim().toLowerCase() ||
        p.name.trim().toLowerCase() === fileName.trim().toLowerCase()
    ) || null
  );
}

/**
 * Save or update a project
 */
export async function saveProject(project: StoryProject): Promise<void> {
  if (!project.id) return;

  // Calculate completed count
  const completed = (project.mergedChunks || []).filter(
    (c) => c.status === 'done' && Boolean(c.translatedText && c.translatedText.trim())
  ).length;

  const projectToSave: StoryProject = {
    ...project,
    totalChunks: project.mergedChunks?.length || 0,
    completedChunks: completed,
    lastUpdatedAt: Date.now(),
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(projectToSave);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Lỗi khi lưu dự án vào IndexedDB'));
    });
  } catch (err) {
    console.warn('IndexedDB saveProject error, using localStorage fallback', err);
    saveProjectToLocalStorage(projectToSave);
  }
}

/**
 * Delete a project by ID
 */
export async function deleteProject(id: string): Promise<void> {
  if (!id) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Lỗi khi xóa dự án'));
    });
  } catch (err) {
    console.warn('IndexedDB deleteProject error, using localStorage fallback', err);
    deleteProjectFromLocalStorage(id);
  }

  // Clear last active if it was deleted
  if (getLastActiveProjectId() === id) {
    setLastActiveProjectId(null);
  }
}

/**
 * LocalStorage Fallbacks for environment safety
 */
const LS_FALLBACK_KEY = 'truyen_ai_projects_fallback';

function loadProjectsFromLocalStorage(): StoryProject[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading fallback projects from localStorage', e);
  }
  return [];
}

function saveProjectToLocalStorage(project: StoryProject) {
  try {
    const list = loadProjectsFromLocalStorage().filter((p) => p.id !== project.id);
    list.unshift(project);
    // Keep max 5 projects in localStorage fallback to prevent quota exceeded
    const trimmed = list.slice(0, 5);
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Error saving fallback project to localStorage', e);
  }
}

function deleteProjectFromLocalStorage(id: string) {
  try {
    const list = loadProjectsFromLocalStorage().filter((p) => p.id !== id);
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Error deleting fallback project from localStorage', e);
  }
}

/**
 * Tracking the last active project ID
 */
export function getLastActiveProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveProjectId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id);
    } else {
      localStorage.removeItem(LAST_ACTIVE_PROJECT_KEY);
    }
  } catch (e) {
    console.error('Error setting last active project id', e);
  }
}

/**
 * Generate a clean project name from file name
 */
export function cleanProjectNameFromFile(fileName: string): string {
  if (!fileName) return 'Dự án mới';
  return fileName
    .replace(/\.(xlsx|xls|csv)$/i, '')
    .replace(/[_\-]+/g, ' ')
    .trim();
}
