import React, { useState, useEffect, useRef } from 'react';
import {
  ApiKeyItem,
  GeminiModelOption,
  CharacterItem,
  MergedChunk,
  StoryRow,
  StoryProject,
} from './types';
import { GEMINI_MODELS } from './data/models';
import { INITIAL_CHARACTERS } from './data/defaultCharacters';
import { DEFAULT_TRANSLATION_PROMPT } from './data/defaultPrompt';
import { ApiKeyManager } from './components/ApiKeyManager';
import { StoryProcessor } from './components/StoryProcessor';
import { CharacterTableModal } from './components/CharacterTableModal';
import { PromptEditorModal } from './components/PromptEditorModal';
import { ProjectManagerModal } from './components/ProjectManagerModal';
import {
  getAllProjects,
  saveProject,
  deleteProject,
  getProjectById,
  getProjectByFileName,
  getLastActiveProjectId,
  setLastActiveProjectId,
  cleanProjectNameFromFile,
} from './utils/projectStorage';
import { Headphones, Users, FileText, FolderOpen, CheckCircle, Info } from 'lucide-react';

const STORAGE_KEYS = {
  API_KEYS: 'truyen_ai_api_keys',
  SELECTED_MODEL_ID: 'truyen_ai_selected_model_id',
  CHARACTERS: 'truyen_ai_characters',
  PROMPT: 'truyen_ai_prompt_template',
};

export default function App() {
  // 1. API Keys State
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.API_KEYS);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load api keys from localStorage', e);
    }
    return [];
  });

  // 2. Selected Model State
  const [selectedModel, setSelectedModel] = useState<GeminiModelOption>(() => {
    try {
      const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL_ID);
      if (savedId) {
        const found = GEMINI_MODELS.find((m) => m.id === savedId);
        if (found) return found;
      }
    } catch (e) {
      console.error('Failed to load model from localStorage', e);
    }
    return GEMINI_MODELS[0]; // Default: Gemini 3.1 Flash Lite (500 lượt/ngày)
  });

  // 3. Characters Dictionary State - default is empty for new projects
  const [characters, setCharacters] = useState<CharacterItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CHARACTERS);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error('Failed to load characters from localStorage', e);
    }
    return [];
  });

  // 4. Prompt Template State
  // 4. Prompt Template State - default to SRT translation prompt and migrate legacy story prompt if found
  const [promptTemplate, setPromptTemplate] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PROMPT);
      if (saved && saved.trim()) {
        // If the saved prompt still has old timestamp syntax or lacks strict subtitle tag lock rules, upgrade to DEFAULT_TRANSLATION_PROMPT
        if (
          saved.includes('00:00:01,200 --> 00:00:04,500') ||
          (!saved.includes('KHÓA CHÍNH XÁC MÃ SỐ THỨ TỰ') &&
            (!saved.includes('phụ đề') || saved.includes('[1] <Nội dung dịch câu 1>')))
        ) {
          localStorage.setItem(STORAGE_KEYS.PROMPT, DEFAULT_TRANSLATION_PROMPT);
          return DEFAULT_TRANSLATION_PROMPT;
        }
        return saved;
      }
    } catch (e) {
      console.error('Failed to load prompt from localStorage', e);
    }
    return DEFAULT_TRANSLATION_PROMPT;
  });

  // 5. Story Rows & Merged Chunks State
  const [originalRows, setOriginalRows] = useState<StoryRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [mergedChunks, setMergedChunks] = useState<MergedChunk[]>([]);

  const [currentActiveKeyIndex, setCurrentActiveKeyIndex] = useState<number>(0);

  // 6. Project Management State
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [currentProject, setCurrentProject] = useState<StoryProject | null>(null);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [projectToast, setProjectToast] = useState<{ type: 'success' | 'info'; message: string } | null>(null);

  // Modal visibility states
  const [isCharactersOpen, setIsCharactersOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  // Load saved projects on initial mount & restore last active project
  useEffect(() => {
    let isMounted = true;
    const initProjects = async () => {
      try {
        const list = await getAllProjects();
        if (!isMounted) return;
        setProjects(list);

        const lastId = getLastActiveProjectId();
        if (lastId) {
          const found = list.find((p) => p.id === lastId);
          if (found) {
            setCurrentProject(found);
            setFileName(found.fileName);
            setOriginalRows(found.originalRows || []);
            setMergedChunks(found.mergedChunks || []);
            if (found.characters && found.characters.length > 0) {
              setCharacters(found.characters);
            }
            const completed = (found.mergedChunks || []).filter(
              (c) => c.status === 'done' && Boolean(c.translatedText && c.translatedText.trim())
            ).length;
            setProjectToast({
              type: 'info',
              message: `Đã khôi phục dự án "${found.name}" (${completed}/${found.mergedChunks?.length || 0} cụm đã dịch, ${found.characters?.length || 0} nhân vật).`,
            });
            setTimeout(() => setProjectToast(null), 6000);
          }
        }
      } catch (err) {
        console.error('Failed to load projects from storage', err);
      }
    };

    initProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-sync active project to IndexedDB with 1s debounce
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Only auto-save if we have a project or an uploaded file with content
    if (!currentProject && !fileName && originalRows.length === 0) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      const projId = currentProject?.id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const projName = currentProject?.name || cleanProjectNameFromFile(fileName || 'Dự án truyện mới');

      const completed = mergedChunks.filter(
        (c) => c.status === 'done' && Boolean(c.translatedText && c.translatedText.trim())
      ).length;

      const updatedProj: StoryProject = {
        id: projId,
        name: projName,
        fileName: fileName || currentProject?.fileName || 'Truyen.xlsx',
        createdAt: currentProject?.createdAt || Date.now(),
        lastUpdatedAt: Date.now(),
        maxCharsLimit: currentProject?.maxCharsLimit || 35000,
        characters: characters,
        originalRows: originalRows,
        mergedChunks: mergedChunks,
        totalChunks: mergedChunks.length,
        completedChunks: completed,
      };

      try {
        await saveProject(updatedProj);
        setCurrentProject(updatedProj);
        setLastActiveProjectId(projId);
        setLastSavedTime(
          new Date().toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        );
        const list = await getAllProjects();
        setProjects(list);
      } catch (err) {
        console.error('Error auto-saving project', err);
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [mergedChunks, characters, originalRows, fileName]);

  // Sync general settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.API_KEYS, JSON.stringify(apiKeys));
    } catch (e) {
      console.error('Error saving api keys to localStorage', e);
    }
  }, [apiKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL_ID, selectedModel.id);
    } catch (e) {
      console.error('Error saving model to localStorage', e);
    }
  }, [selectedModel]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CHARACTERS, JSON.stringify(characters));
    } catch (e) {
      console.error('Error saving characters to localStorage', e);
    }
  }, [characters]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PROMPT, promptTemplate);
    } catch (e) {
      console.error('Error saving prompt to localStorage', e);
    }
  }, [promptTemplate]);

  // Handle uploading / parsing a new subtitle SRT file
  const handleNewProjectUploaded = async (
    newFileName: string,
    newRows: StoryRow[],
    initialChunks?: MergedChunk[]
  ) => {
    const existing = await getProjectByFileName(newFileName);
    if (existing) {
      setCurrentProject(existing);
      setFileName(existing.fileName);
      setOriginalRows(existing.originalRows && existing.originalRows.length > 0 ? existing.originalRows : newRows);
      const chunksToUse =
        existing.mergedChunks && existing.mergedChunks.length > 0
          ? existing.mergedChunks
          : (initialChunks || []);
      setMergedChunks(chunksToUse);
      if (existing.characters && existing.characters.length > 0) {
        setCharacters(existing.characters);
      }
      setLastActiveProjectId(existing.id);
      setProjectToast({
        type: 'success',
        message: `Đã mở dự án phụ đề "${existing.name}" (${existing.completedChunks || 0}/${existing.totalChunks || chunksToUse.length} cụm, ${existing.characters?.length || 0} nhân vật).`,
      });
      setTimeout(() => setProjectToast(null), 6000);
      return;
    }

    // Create a new project for this SRT subtitle file with EMPTY character table by default
    const newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const projName = cleanProjectNameFromFile(newFileName);
    const chunksToSave = initialChunks || [];
    const newProject: StoryProject = {
      id: newId,
      name: projName,
      fileName: newFileName,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      maxCharsLimit: 15000,
      characters: [], // New project character table defaults to EMPTY
      originalRows: newRows,
      mergedChunks: chunksToSave,
      totalChunks: chunksToSave.length,
      completedChunks: 0,
    };

    try {
      await saveProject(newProject);
      setCurrentProject(newProject);
      setFileName(newFileName);
      setOriginalRows(newRows);
      setMergedChunks(chunksToSave);
      setCharacters([]);
      setLastActiveProjectId(newId);
      const list = await getAllProjects();
      setProjects(list);
      setProjectToast({
        type: 'success',
        message: `Đã tạo dự án mới cho file phụ đề "${projName}" (Bảng nhân vật mặc định trống). Toàn bộ ${chunksToSave.length} cụm đã sẵn sàng!`,
      });
      setTimeout(() => setProjectToast(null), 6000);
    } catch (err) {
      console.error('Error creating new project', err);
    }
  };

  const handleSelectProject = (project: StoryProject) => {
    setCurrentProject(project);
    setFileName(project.fileName);
    setOriginalRows(project.originalRows || []);
    setMergedChunks(project.mergedChunks || []);
    setCharacters(project.characters || []);
    setLastActiveProjectId(project.id);
    setProjectToast({
      type: 'info',
      message: `Đã chuyển sang dự án "${project.name}" (${project.completedChunks || 0}/${project.totalChunks || 0} cụm, ${project.characters?.length || 0} nhân vật).`,
    });
    setTimeout(() => setProjectToast(null), 5000);
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
    if (currentProject?.id === projectId) {
      setCurrentProject(null);
      setFileName('');
      setOriginalRows([]);
      setMergedChunks([]);
      setCharacters([]);
      setLastActiveProjectId(null);
    }
    const list = await getAllProjects();
    setProjects(list);
  };

  const handleRenameProject = async (projectId: string, newName: string) => {
    const proj = await getProjectById(projectId);
    if (proj) {
      const updated: StoryProject = {
        ...proj,
        name: newName,
        lastUpdatedAt: Date.now(),
      };
      await saveProject(updated);
      if (currentProject?.id === projectId) {
        setCurrentProject(updated);
      }
      const list = await getAllProjects();
      setProjects(list);
    }
  };

  const handleStartNewProject = () => {
    setCurrentProject(null);
    setFileName('');
    setOriginalRows([]);
    setMergedChunks([]);
    setCharacters([]); // Character table is reset to empty for new projects
    setLastActiveProjectId(null);
    setIsProjectManagerOpen(false);
    setProjectToast({
      type: 'info',
      message: 'Sẵn sàng! Bảng nhân vật đã được đặt lại trống. Hãy tải lên file phụ đề SRT hoặc nạp Glossary để bắt đầu.',
    });
    setTimeout(() => setProjectToast(null), 5000);
  };

  // Key usage increment per model
  const handleIncrementKeyUsage = (keyId: string, modelId: string) => {
    setApiKeys((prev) =>
      prev.map((k) => {
        if (k.id !== keyId) return k;
        const currentModelUsage = k.usedByModel?.[modelId] ?? 0;
        const updatedUsedByModel = {
          ...(k.usedByModel || {}),
          [modelId]: currentModelUsage + 1,
        };
        const updatedModelStatus = { ...(k.modelStatus || {}) };
        if (updatedModelStatus[modelId] === 'cooldown') {
          updatedModelStatus[modelId] = 'ready';
        }
        return {
          ...k,
          usedToday: (k.usedToday || 0) + 1,
          usedByModel: updatedUsedByModel,
          modelStatus: updatedModelStatus,
          status: k.status === 'cooldown' ? 'ready' : k.status,
          cooldownUntil: undefined,
          lastUsedAt: new Date().toLocaleTimeString(),
        };
      })
    );
  };

  // Mark key as exhausted or in cooldown (differentiating RPM rate limit vs daily quota)
  const handleMarkKeyExhausted = (
    keyId: string,
    modelId: string,
    isRateLimit: boolean = false,
    cooldownSeconds: number = 10
  ) => {
    setApiKeys((prev) =>
      prev.map((k) => {
        if (k.id !== keyId) return k;
        if (isRateLimit) {
          const cooldownUntil = Date.now() + cooldownSeconds * 1000;
          const updatedModelStatus = {
            ...(k.modelStatus || {}),
            [modelId]: 'cooldown' as const,
          };
          return {
            ...k,
            status: 'cooldown' as const,
            cooldownUntil,
            modelStatus: updatedModelStatus,
            lastError: `Tạm giãn cách RPM (${cooldownSeconds}s)`,
          };
        } else {
          const updatedModelStatus = {
            ...(k.modelStatus || {}),
            [modelId]: 'quota_exceeded' as const,
          };
          return {
            ...k,
            status: 'quota_exceeded' as const,
            modelStatus: updatedModelStatus,
            lastError: 'Hết hạn mức ngày (Daily Quota)',
          };
        }
      })
    );
  };

  // Mark key with an error (e.g. 403 project denied or invalid key)
  const handleMarkKeyError = (keyId: string, errorMsg: string) => {
    setApiKeys((prev) =>
      prev.map((k) => {
        if (k.id !== keyId) return k;
        return {
          ...k,
          status: 'error' as const,
          lastError: errorMsg,
        };
      })
    );
  };

  // Reset specifically the status of keys back to 'ready' (clearing errors, cooldown, and unblocking quota)
  const handleResetKeyStatus = (keyId?: string) => {
    setApiKeys((prev) =>
      prev.map((k) => {
        if (keyId && k.id !== keyId) return k;

        const updatedModelStatus = { ...(k.modelStatus || {}) };
        updatedModelStatus[selectedModel.id] = 'ready';

        const updatedUsedByModel = { ...(k.usedByModel || {}) };
        // If it was blocked because usage reached/exceeded dailyLimit, clear it so it's ready to use
        if ((updatedUsedByModel[selectedModel.id] ?? 0) >= selectedModel.dailyLimit) {
          delete updatedUsedByModel[selectedModel.id];
        }

        return {
          ...k,
          status: 'ready' as const,
          modelStatus: updatedModelStatus,
          usedByModel: updatedUsedByModel,
          cooldownUntil: undefined,
          lastError: undefined,
        };
      })
    );
    if (!keyId) {
      setCurrentActiveKeyIndex(0);
    }
  };

  // Reset key counters & status - allows unlocking all keys instantly
  const handleResetKeyCounts = (onlyCurrentModel: boolean = false) => {
    setApiKeys((prev) =>
      prev.map((k) => {
        if (onlyCurrentModel) {
          const updatedUsedByModel = { ...(k.usedByModel || {}) };
          delete updatedUsedByModel[selectedModel.id];
          const updatedModelStatus = { ...(k.modelStatus || {}) };
          delete updatedModelStatus[selectedModel.id];
          return {
            ...k,
            usedByModel: updatedUsedByModel,
            modelStatus: updatedModelStatus,
            status: 'ready' as const,
            cooldownUntil: undefined,
            lastError: undefined,
          };
        } else {
          return {
            ...k,
            usedToday: 0,
            usedByModel: {},
            modelStatus: {},
            status: 'ready' as const,
            cooldownUntil: undefined,
            lastError: undefined,
          };
        }
      })
    );
    setCurrentActiveKeyIndex(0);
  };

  return (
    <div className="min-h-screen bg-slate-100/60 text-slate-800 antialiased flex flex-col font-sans">
      {/* Top Application Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-xs">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-none">
                  Remix Truyện AI Studio
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wider">
                  Dịch SRT Chuẩn Timecode
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Công cụ dịch file phụ đề SRT bảo toàn 100% mốc thời gian (timecode) chính xác & xoay vòng đa API Key Gemini song song
              </p>
            </div>
          </div>

          {/* Quick Header Badges & Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Project Manager Button */}
            <button
              onClick={() => setIsProjectManagerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200 transition-colors shadow-2xs cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
              <span>Dự án đang làm dở</span>
              {projects.length > 0 && (
                <span className="bg-blue-200 text-blue-900 px-1.5 py-0.2 rounded-full text-[10px] font-bold">
                  {projects.length}
                </span>
              )}
            </button>

            {/* Character Table Button */}
            <button
              onClick={() => setIsCharactersOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold border border-indigo-200 transition-colors shadow-2xs"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Bảng tên nhân vật</span>
              <span className="bg-indigo-200 text-indigo-900 px-1.5 py-0.2 rounded-full text-[10px]">
                {characters.length}
              </span>
            </button>

            {/* Prompt Editor Button */}
            <button
              onClick={() => setIsPromptOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors shadow-2xs"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Tùy biến Prompt</span>
            </button>
          </div>
        </div>
      </header>

      {/* Project Status Notification Banner */}
      {projectToast && (
        <div className="bg-blue-600 text-white text-xs px-4 py-2 shadow-xs transition-all animate-in fade-in slide-in-from-top-1">
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-200 shrink-0" />
              <span className="font-medium">{projectToast.message}</span>
            </div>
            <button
              onClick={() => setProjectToast(null)}
              className="text-blue-200 hover:text-white font-bold text-sm px-1.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Module 1: API Keys & Model Management */}
        <ApiKeyManager
          apiKeys={apiKeys}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onUpdateKeys={setApiKeys}
          onResetKeyCounts={handleResetKeyCounts}
          onResetKeyStatus={handleResetKeyStatus}
          currentActiveKeyIndex={currentActiveKeyIndex}
        />

        {/* Module 2: File Upload, Auto Merge Cột B & Gemini Execution */}
        <StoryProcessor
          apiKeys={apiKeys}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          characters={characters}
          promptTemplate={promptTemplate}
          onIncrementKeyUsage={handleIncrementKeyUsage}
          onMarkKeyExhausted={handleMarkKeyExhausted}
          onMarkKeyError={handleMarkKeyError}
          onResetKeyStatus={handleResetKeyStatus}
          currentActiveKeyIndex={currentActiveKeyIndex}
          setCurrentActiveKeyIndex={setCurrentActiveKeyIndex}
          mergedChunks={mergedChunks}
          setMergedChunks={setMergedChunks}
          originalRows={originalRows}
          setOriginalRows={setOriginalRows}
          fileName={fileName}
          setFileName={setFileName}
          currentProject={currentProject}
          projectsCount={projects.length}
          onOpenProjectManager={() => setIsProjectManagerOpen(true)}
          onNewProjectUploaded={handleNewProjectUploaded}
          lastSavedTime={lastSavedTime}
        />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        Remix Truyện AI Studio • Hệ thống dịch phụ đề SRT chuẩn xác mốc thời gian 100% & xoay vòng đa API Key Gemini song song
      </footer>

      {/* Modals */}
      <CharacterTableModal
        characters={characters}
        onUpdateCharacters={setCharacters}
        isOpen={isCharactersOpen}
        onClose={() => setIsCharactersOpen(false)}
        apiKeys={apiKeys}
        selectedModel={selectedModel}
        onIncrementKeyUsage={handleIncrementKeyUsage}
        onMarkKeyExhausted={handleMarkKeyExhausted}
        onMarkKeyError={handleMarkKeyError}
        preloadedRows={originalRows}
        preloadedFileName={fileName}
        projectName={currentProject?.name}
      />

      <PromptEditorModal
        promptTemplate={promptTemplate}
        onSavePrompt={setPromptTemplate}
        characters={characters}
        isOpen={isPromptOpen}
        onClose={() => setIsPromptOpen(false)}
      />

      <ProjectManagerModal
        isOpen={isProjectManagerOpen}
        onClose={() => setIsProjectManagerOpen(false)}
        projects={projects}
        currentProjectId={currentProject?.id || null}
        onSelectProject={handleSelectProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        onStartNewProject={handleStartNewProject}
      />
    </div>
  );
}
