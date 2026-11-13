import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  StoryRow,
  MergedChunk,
  ApiKeyItem,
  GeminiModelOption,
  CharacterItem,
  StoryProject,
  SubtitleMappingItem,
} from '../types';
import {
  cleanSpecialChars,
  exportTranslatedToTxt,
  copyTranslatedTextToClipboard,
  parseSelectionInput,
} from '../utils/textUtils';
import { formatCharactersForPrompt, extractRelevantCharacters } from '../data/defaultCharacters';
import { GEMINI_MODELS } from '../data/models';
import {
  parseSrtFile,
  mergeSrtSubtitlesIntoChunks,
  mapAiResponseToSubtitles,
  exportTranslatedToSrt,
  SAMPLE_SRT_CONTENT,
  parseSrtContent,
  srtSubtitlesToStoryRows,
  getSubtitleDurationInSeconds,
} from '../utils/srtUtils';
import {
  Upload,
  FileText,
  Zap,
  Play,
  Pause,
  Square,
  Download,
  CheckCircle,
  AlertTriangle,
  Scissors,
  Eye,
  RefreshCw,
  Clock,
  CheckSquare,
  Square as SquareOutline,
  Cpu,
  Layers,
  ChevronDown,
  Copy,
  Check,
  Users,
  RotateCcw,
  Pencil,
  Save,
  Undo2,
  FolderOpen,
  BookOpen,
  GitCompare,
  Subtitles,
} from 'lucide-react';
import { BoundarySentenceComparisonModal } from './BoundarySentenceComparisonModal';

interface StoryProcessorProps {
  apiKeys: ApiKeyItem[];
  selectedModel: GeminiModelOption;
  onSelectModel?: (model: GeminiModelOption) => void;
  characters: CharacterItem[];
  promptTemplate: string;
  onIncrementKeyUsage: (keyId: string, modelId: string) => void;
  onMarkKeyExhausted: (keyId: string, modelId: string) => void;
  onMarkKeyError?: (keyId: string, errorMsg: string) => void;
  onResetKeyStatus?: (keyId?: string) => void;
  currentActiveKeyIndex: number;
  setCurrentActiveKeyIndex: React.Dispatch<React.SetStateAction<number>>;
  mergedChunks: MergedChunk[];
  setMergedChunks: React.Dispatch<React.SetStateAction<MergedChunk[]>>;
  originalRows: StoryRow[];
  setOriginalRows: React.Dispatch<React.SetStateAction<StoryRow[]>>;
  fileName: string;
  setFileName: React.Dispatch<React.SetStateAction<string>>;
  currentProject?: StoryProject | null;
  projectsCount?: number;
  onOpenProjectManager?: () => void;
  onNewProjectUploaded?: (fileName: string, rows: StoryRow[], initialChunks?: MergedChunk[]) => void;
  lastSavedTime?: string | null;
}

export const StoryProcessor: React.FC<StoryProcessorProps> = ({
  apiKeys,
  selectedModel,
  onSelectModel,
  characters,
  promptTemplate,
  onIncrementKeyUsage,
  onMarkKeyExhausted,
  onMarkKeyError,
  onResetKeyStatus,
  currentActiveKeyIndex,
  setCurrentActiveKeyIndex,
  mergedChunks,
  setMergedChunks,
  originalRows,
  setOriginalRows,
  fileName,
  setFileName,
  currentProject,
  projectsCount = 0,
  onOpenProjectManager,
  onNewProjectUploaded,
  lastSavedTime,
}) => {
  const [subtitlesPerChunk, setSubtitlesPerChunk] = useState<number>(100);
  const [maxCharsPerChunk, setMaxCharsPerChunk] = useState<number>(15000);
  const [autoCleanChars, setAutoCleanChars] = useState<boolean>(true);
  const [isMerged, setIsMerged] = useState<boolean>(true);

  // Subtitle SRT project indicator
  const isSrtProject = true;

  // Synchronize isMerged state when mergedChunks exists or project is loaded
  useEffect(() => {
    if (mergedChunks.length > 0) {
      setIsMerged(true);
    }
  }, [mergedChunks.length]);

  // Parallel Concurrency & Performance settings
  const [concurrency, setConcurrency] = useState<number>(3); // 1 to 10 parallel workers
  const [requestDelaySec, setRequestDelaySec] = useState<number>(0.5); // Delay between calls in same thread

  // Selection state for choosing chunks to write (e.g. 1, 3, 5...)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [selectionInputText, setSelectionInputText] = useState<string>('');
  const [rangeFrom, setRangeFrom] = useState<string>('');
  const [rangeTo, setRangeTo] = useState<string>('');

  // Batch execution state
  const [isRunningBatch, setIsRunningBatch] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeChunkIndices, setActiveChunkIndices] = useState<Set<number>>(new Set());
  const [previewChunk, setPreviewChunk] = useState<MergedChunk | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);
  const [exportStatusToast, setExportStatusToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Editing translated chunk state
  const [editingChunk, setEditingChunk] = useState<{
    index: number;
    chunk: MergedChunk;
    text: string;
    originalAiText: string;
    showOriginalContent: boolean;
  } | null>(null);
  const [copiedEditModal, setCopiedEditModal] = useState<boolean>(false);

  // Copy state for chunk detail preview modal
  const [copiedOriginalPreview, setCopiedOriginalPreview] = useState<boolean>(false);
  const [copiedCharactersPreview, setCopiedCharactersPreview] = useState<boolean>(false);
  const [copiedNamesOnlyPreview, setCopiedNamesOnlyPreview] = useState<boolean>(false);
  const [copiedTranslatedPreview, setCopiedTranslatedPreview] = useState<boolean>(false);

  // Boundary sentence comparison modal state (Đối chiếu câu đầu - câu cuối)
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState<boolean>(false);
  const [comparisonChunkIndex, setComparisonChunkIndex] = useState<number>(0);

  const handleOpenComparisonModal = (chunkIndex: number = 0) => {
    setComparisonChunkIndex(chunkIndex);
    setIsComparisonModalOpen(true);
  };

  const handleUpdateChunkData = (chunkIndex: number, updatedData: Partial<MergedChunk>) => {
    setMergedChunks((prev) =>
      prev.map((c, i) => (i === chunkIndex ? { ...c, ...updatedData } : c))
    );
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const keyDispatchIndexRef = useRef<number>(0);

  // Open edit modal for a chunk
  const handleOpenEditModal = (chunkIndex: number) => {
    const chunk = mergedChunks[chunkIndex];
    if (!chunk) return;
    setEditingChunk({
      index: chunkIndex,
      chunk,
      text: chunk.translatedText || '',
      originalAiText: chunk.translatedText || '',
      showOriginalContent: true,
    });
    setCopiedEditModal(false);
  };

  // Save edited translation
  const handleSaveEditedChunk = () => {
    if (!editingChunk) return;
    const { index, text } = editingChunk;
    const trimmed = text.trim();

    setMergedChunks((prev) => {
      const copy = [...prev];
      if (!copy[index]) return prev;

      let updatedSubtitles = copy[index].subtitles;
      if (updatedSubtitles && updatedSubtitles.length > 0) {
        const mapping = mapAiResponseToSubtitles(trimmed, updatedSubtitles);
        updatedSubtitles = mapping.updatedSubtitles;
      }

      copy[index] = {
        ...copy[index],
        translatedText: trimmed,
        subtitles: updatedSubtitles,
        status: trimmed.length > 0 ? 'done' : copy[index].status === 'done' ? 'idle' : copy[index].status,
        errorMsg: undefined,
      };
      return copy;
    });

    // If preview chunk modal is currently viewing this chunk, update its preview too
    if (previewChunk && previewChunk.id === editingChunk.chunk.id) {
      setPreviewChunk((prev) =>
        prev
          ? {
              ...prev,
              translatedText: trimmed,
              status: trimmed.length > 0 ? 'done' : prev.status,
            }
          : null
      );
    }

    setExportStatusToast({
      type: 'success',
      message: `Đã lưu bản dịch Cụm #${index + 1} thành công.`,
    });

    setEditingChunk(null);
  };

  // Copy original chunk content from preview modal
  const handleCopyOriginalContent = async () => {
    if (!previewChunk?.content) return;
    try {
      await navigator.clipboard.writeText(previewChunk.content);
      setCopiedOriginalPreview(true);
      setExportStatusToast({
        type: 'success',
        message: `Đã copy nội dung gốc Cụm #${previewChunk.chunkIndex} (${previewChunk.content.length.toLocaleString()} ký tự) vào bộ nhớ tạm!`,
      });
      setTimeout(() => {
        setCopiedOriginalPreview(false);
        setExportStatusToast(null);
      }, 2500);
    } catch (e) {
      console.error('Failed to copy original content', e);
    }
  };

  // Copy relevant characters in import format (TSV format: Chinese \t HanViet \t Gender \t Note)
  const handleCopyImportCharacters = async (charsList: CharacterItem[]) => {
    if (!charsList || charsList.length === 0) {
      setExportStatusToast({
        type: 'error',
        message: 'Không có nhân vật liên quan nào trong cụm này để copy.',
      });
      setTimeout(() => setExportStatusToast(null), 3000);
      return;
    }
    const tsvFormat = charsList
      .map(
        (c) =>
          `${c.chinese || ''}\t${c.hanViet || ''}\t${c.gender || 'Chưa rõ'}\t${c.note || ''}`
      )
      .join('\n');

    try {
      await navigator.clipboard.writeText(tsvFormat);
      setCopiedCharactersPreview(true);
      setExportStatusToast({
        type: 'success',
        message: `Đã copy ${charsList.length} nhân vật dạng bảng import (Tên Trung, Hán Việt, Giới tính, Ghi chú) vào clipboard!`,
      });
      setTimeout(() => {
        setCopiedCharactersPreview(false);
        setExportStatusToast(null);
      }, 2500);
    } catch (e) {
      console.error('Failed to copy characters', e);
    }
  };

  // Copy relevant character names only
  const handleCopyNamesOnly = async (charsList: CharacterItem[]) => {
    if (!charsList || charsList.length === 0) return;
    const namesFormat = charsList
      .map((c) =>
        c.chinese && c.chinese !== c.hanViet ? `${c.hanViet} (${c.chinese})` : c.hanViet || c.chinese
      )
      .join(', ');

    try {
      await navigator.clipboard.writeText(namesFormat);
      setCopiedNamesOnlyPreview(true);
      setExportStatusToast({
        type: 'success',
        message: `Đã copy danh sách tên ${charsList.length} nhân vật vào clipboard!`,
      });
      setTimeout(() => {
        setCopiedNamesOnlyPreview(false);
        setExportStatusToast(null);
      }, 2500);
    } catch (e) {
      console.error('Failed to copy character names', e);
    }
  };

  // Copy translated text from preview modal
  const handleCopyTranslatedPreview = async () => {
    if (!previewChunk?.translatedText) return;
    try {
      await navigator.clipboard.writeText(previewChunk.translatedText);
      setCopiedTranslatedPreview(true);
      setExportStatusToast({
        type: 'success',
        message: `Đã copy bản dịch Cụm #${previewChunk.chunkIndex} (${previewChunk.translatedText.length.toLocaleString()} ký tự) vào bộ nhớ tạm!`,
      });
      setTimeout(() => {
        setCopiedTranslatedPreview(false);
        setExportStatusToast(null);
      }, 2500);
    } catch (e) {
      console.error('Failed to copy translated text', e);
    }
  };

  // Load sample SRT subtitle data for testing
  const handleLoadSampleSrtData = () => {
    try {
      const subtitles = parseSrtContent(SAMPLE_SRT_CONTENT);
      const sampleRows = srtSubtitlesToStoryRows(subtitles);
      // Group sample subtitles into chunks of 10 subtitles (~1500 chars)
      const chunks = mergeSrtSubtitlesIntoChunks(subtitles, subtitlesPerChunk || 10, maxCharsPerChunk || 1500);
      const enriched = chunks.map((c) => {
        const rel = extractRelevantCharacters(c.content, characters);
        return {
          ...c,
          relevantCharactersCount: rel.length,
          matchedCharacterNames: rel.map((ch) => ch.hanViet || ch.chinese),
        };
      });

      const srtSampleName = 'Mau_PhuDe_TienHiep_Demo.srt';
      if (onNewProjectUploaded) {
        onNewProjectUploaded(srtSampleName, sampleRows, enriched);
      } else {
        setOriginalRows(sampleRows);
        setFileName(srtSampleName);
      }
      setMergedChunks(enriched);
      setIsMerged(true);
      setSelectedIndices(new Set(enriched.map((_, i) => i)));
      setErrorMessage(null);
      setExportStatusToast({
        type: 'success',
        message: `Đã nạp thành công file phụ đề SRT mẫu: ${subtitles.length} câu phụ đề, chia làm ${chunks.length} cụm. Mốc thời gian được khóa chuẩn xác 100%!`,
      });
      setTimeout(() => setExportStatusToast(null), 6000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi nạp file SRT mẫu.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setErrorMessage(null);
      const lowerName = file.name.toLowerCase();

      if (!lowerName.endsWith('.srt')) {
        setErrorMessage('Vui lòng chọn file phụ đề định dạng .srt.');
        return;
      }

      // Handle SRT Subtitle File
      const { rows, subtitles, fileName: name } = await parseSrtFile(file);
      // Automatically group into chunks of subtitlesPerChunk subtitles (unlimited custom number)
      const effectiveSubs = subtitlesPerChunk > 0 ? subtitlesPerChunk : 100;
      const chunks = mergeSrtSubtitlesIntoChunks(subtitles, effectiveSubs, Math.max(100000, effectiveSubs * 2000));
      const enriched = chunks.map((c) => {
        const rel = extractRelevantCharacters(c.content, characters);
        return {
          ...c,
          relevantCharactersCount: rel.length,
          matchedCharacterNames: rel.map((ch) => ch.hanViet || ch.chinese),
        };
      });

      if (onNewProjectUploaded) {
        onNewProjectUploaded(name, rows, enriched);
      } else {
        setOriginalRows(rows);
        setFileName(name);
      }
      setMergedChunks(enriched);
      setIsMerged(true);
      setSelectedIndices(new Set(enriched.map((_, i) => i)));
      setExportStatusToast({
        type: 'success',
        message: `Đã nạp file phụ đề SRT (${name}): ${subtitles.length} câu phụ đề, tự động tạo ${chunks.length} cụm (${effectiveSubs} câu/cụm) với mốc thời gian chuẩn xác!`,
      });
      setTimeout(() => setExportStatusToast(null), 6000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi đọc file SRT.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Re-chunk loaded subtitles with updated parameters (unlimited custom subtitle count per chunk)
  const handleRechunkSubtitles = () => {
    if (originalRows.length === 0) {
      setErrorMessage('Vui lòng tải lên file phụ đề SRT trước.');
      return;
    }

    const effectiveSubs = subtitlesPerChunk > 0 ? subtitlesPerChunk : 100;
    const allSubs: SubtitleMappingItem[] = originalRows.map((r, i) => ({
      id: r.id,
      index: r.originalIndex || i + 1,
      startTime: r.startTime || '00:00:00,000',
      endTime: r.endTime || '00:00:03,000',
      originalText: autoCleanChars ? cleanSpecialChars(r.content) : r.content,
      translatedText: '',
    }));

    const chunks = mergeSrtSubtitlesIntoChunks(allSubs, effectiveSubs, Math.max(100000, effectiveSubs * 2000));
    const enriched = chunks.map((c) => {
      const rel = extractRelevantCharacters(c.content, characters);
      return {
        ...c,
        relevantCharactersCount: rel.length,
        matchedCharacterNames: rel.map((ch) => ch.hanViet || ch.chinese),
      };
    });

    setMergedChunks(enriched);
    setIsMerged(true);
    setSelectedIndices(new Set(enriched.map((_, i) => i)));
    setExportStatusToast({
      type: 'success',
      message: `Đã chia lại ${allSubs.length} câu phụ đề thành ${enriched.length} cụm (${effectiveSubs} câu/cụm tùy chỉnh)!`,
    });
    setTimeout(() => setExportStatusToast(null), 5000);
  };

  // Cập nhật lại số lượng và danh sách nhân vật liên quan cho các cụm nếu bảng nhân vật thay đổi
  useEffect(() => {
    if (mergedChunks.length > 0) {
      setMergedChunks((prev) =>
        prev.map((c) => {
          const rel = extractRelevantCharacters(c.content, characters);
          return {
            ...c,
            relevantCharactersCount: rel.length,
            matchedCharacterNames: rel.map((ch) => ch.hanViet || ch.chinese),
          };
        })
      );
    }
  }, [characters]);

  // Selection helpers
  const handleToggleSelectAll = () => {
    if (selectedIndices.size === mergedChunks.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(mergedChunks.map((_, i) => i)));
    }
  };

  const handleToggleSelectIndex = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleSelectUntranslated = () => {
    const untranslated = new Set<number>();
    mergedChunks.forEach((c, idx) => {
      if (c.status !== 'done' || !c.translatedText) {
        untranslated.add(idx);
      }
    });
    setSelectedIndices(untranslated);
  };

  const handleSelectRange = () => {
    const fromNum = parseInt(rangeFrom, 10);
    const toNum = parseInt(rangeTo, 10);
    if (isNaN(fromNum) || isNaN(toNum) || fromNum < 1 || toNum < 1) {
      setErrorMessage('Vui lòng nhập số cụm bắt đầu và kết thúc (ví dụ: từ 5 đến 10).');
      return;
    }
    const min = Math.max(1, Math.min(fromNum, toNum));
    const max = Math.min(mergedChunks.length, Math.max(fromNum, toNum));
    const newSelected = new Set<number>();
    for (let i = min; i <= max; i++) {
      newSelected.add(i - 1);
    }
    setSelectedIndices(newSelected);
    setSelectionInputText(`${min}-${max}`);
    setErrorMessage(null);
  };

  const handleApplySelectionInput = () => {
    if (!selectionInputText.trim()) return;
    const parsed = parseSelectionInput(selectionInputText, mergedChunks.length);
    if (parsed.length === 0) {
      setErrorMessage('Không tìm thấy cụm hợp lệ theo nội dung bạn nhập (Ví dụ: 5-10 hoặc 1, 3, 5-8).');
      return;
    }
    setSelectedIndices(new Set(parsed));
    setErrorMessage(null);
  };

  // Get next available API key from the pool, avoiding exhausted or error keys
  const getNextAvailableKeyForWorker = (excludeKeyIds: Set<string>): ApiKeyItem | null => {
    if (apiKeys.length === 0) return null;

    const totalKeys = apiKeys.length;
    const now = Date.now();

    // Priority 1: Key is ready, not in exclude list, not in error, not in active cooldown, not exhausted
    for (let i = 0; i < totalKeys; i++) {
      const idx = (keyDispatchIndexRef.current + i) % totalKeys;
      const candidate = apiKeys[idx];
      const modelUsage = candidate.usedByModel?.[selectedModel.id] ?? 0;
      const isModelExhausted =
        candidate.modelStatus?.[selectedModel.id] === 'quota_exceeded' ||
        modelUsage >= selectedModel.dailyLimit;
      const isCooldownActive =
        candidate.status === 'cooldown' &&
        candidate.cooldownUntil &&
        candidate.cooldownUntil > now;

      if (
        !excludeKeyIds.has(candidate.id) &&
        candidate.status !== 'error' &&
        !isModelExhausted &&
        !isCooldownActive
      ) {
        keyDispatchIndexRef.current = (idx + 1) % totalKeys;
        return candidate;
      }
    }

    // Priority 2: Key is not in exclude list and not in error, not exhausted (even if usage recorded)
    for (let i = 0; i < totalKeys; i++) {
      const idx = (keyDispatchIndexRef.current + i) % totalKeys;
      const candidate = apiKeys[idx];
      const isModelExhausted = candidate.modelStatus?.[selectedModel.id] === 'quota_exceeded';
      const isCooldownActive =
        candidate.status === 'cooldown' &&
        candidate.cooldownUntil &&
        candidate.cooldownUntil > now;

      if (
        !excludeKeyIds.has(candidate.id) &&
        candidate.status !== 'error' &&
        !isModelExhausted &&
        !isCooldownActive
      ) {
        keyDispatchIndexRef.current = (idx + 1) % totalKeys;
        return candidate;
      }
    }

    // Return null if all keys are exhausted, excluded, or errored
    return null;
  };

  // Translate a single chunk using key rotation and retries
  const translateChunkWithKeyRotation = async (
    rawChunkContent: string
  ): Promise<{ text: string; relevantCharacters: CharacterItem[] }> => {
    // Tự động loại bỏ mốc thời gian chi tiết trong prompt gửi đi (chỉ giữ lại số giây hiển thị: ví dụ ( 3.3s))
    const chunkContent = rawChunkContent.replace(
      /\(\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}\s*\|\s*([\d\.]+s)\s*\)/g,
      '( $1)'
    );

    // Trích xuất CHỈ những nhân vật thực sự xuất hiện trong đoạn truyện này
    const relevantCharacters = extractRelevantCharacters(chunkContent, characters);
    const charactersTable = formatCharactersForPrompt(relevantCharacters);
    const fullPrompt = promptTemplate
      .replace('{{CHARACTERS_TABLE}}', charactersTable)
      .replace('{{CONTENT}}', chunkContent);

    const failedKeyIds = new Set<string>();
    let attempts = 0;
    const maxAttempts = Math.max(apiKeys.length * 2, 4);

    while (attempts < maxAttempts) {
      if (isCancelledRef.current) {
        throw new Error('Quá trình đã bị hủy.');
      }

      let keyItem = getNextAvailableKeyForWorker(failedKeyIds);

      // If no key available right now, check if any key is currently in RPM cooldown
      if (!keyItem) {
        const now = Date.now();
        const coolingKeys = apiKeys.filter(
          (k) => k.status === 'cooldown' && k.cooldownUntil && k.cooldownUntil > now
        );
        if (coolingKeys.length > 0) {
          const waitTime = Math.min(
            Math.max(Math.min(...coolingKeys.map((k) => k.cooldownUntil! - now)), 2000),
            15000
          );
          await new Promise((r) => setTimeout(r, waitTime));
          keyItem = getNextAvailableKeyForWorker(failedKeyIds);
        }
      }

      // If still no key available
      if (!keyItem) {
        if (apiKeys.length === 0) {
          throw new Error('Chưa có API Key nào trong hệ thống. Vui lòng thêm API Key Gemini.');
        }
        const hasBlockedKeys = apiKeys.some((k) => k.status === 'error');
        if (hasBlockedKeys && apiKeys.every((k) => k.status === 'error')) {
          throw new Error(
            'Tất cả API Key đều bị từ chối truy cập (403 Permission Denied: Project bị chặn hoặc chưa kích hoạt Gemini API). Vui lòng kiểm tra lại Key hoặc bấm nút Reset trạng thái.'
          );
        }
        throw new Error(
          `Tất cả API Key đều đã hết hạn mức ngày (Daily Quota) cho model "${selectedModel.name}". Vui lòng đổi sang model khác (như Gemini 3.1 Flash Lite - 500 lượt/ngày) hoặc bấm "Reset API Keys về Sẵn sàng".`
        );
      }

      const apiKeyToUse = keyItem.key;

      try {
        const res = await fetch('/api/gemini/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: fullPrompt,
            model: selectedModel.modelCode,
            apiKey: apiKeyToUse,
          }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
          onIncrementKeyUsage(keyItem.id, selectedModel.id);
          return { text: data.text, relevantCharacters };
        } else {
          // 1. 403 Permission Denied (Project blocked or invalid key)
          if (res.status === 403 || data.isPermissionDenied || data.isKeyBlocked) {
            if (onMarkKeyError) {
              onMarkKeyError(keyItem.id, data.error || 'Project bị từ chối truy cập (403)');
            } else {
              onMarkKeyExhausted(keyItem.id, selectedModel.id);
            }
            failedKeyIds.add(keyItem.id);
            attempts++;
            continue; // rotate to next key
          }

          // 2. Daily Quota Exceeded (Limit 20 or per day reached)
          if (data.isDailyQuotaExceeded || (res.status === 429 && data.isQuotaExceeded)) {
            onMarkKeyExhausted(keyItem.id, selectedModel.id);
            failedKeyIds.add(keyItem.id);
            attempts++;
            continue; // rotate to next key immediately
          }

          // 3. Transient RPM Rate Limit (429)
          if (data.isRateLimit || res.status === 429) {
            onMarkKeyExhausted(keyItem.id, selectedModel.id);
            failedKeyIds.add(keyItem.id);
            attempts++;
            continue; // rotate to next key
          }

          // 4. 503 High Demand (Spikes in demand)
          if (data.isHighDemand || res.status === 503) {
            failedKeyIds.add(keyItem.id);
            await new Promise((r) => setTimeout(r, 2000));
            attempts++;
            continue; // rotate to next key
          }

          // Other errors: mark key failed for this chunk and try next
          failedKeyIds.add(keyItem.id);
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error(data.error || 'Lỗi khi gọi Gemini API');
          }
        }
      } catch (err: any) {
        failedKeyIds.add(keyItem.id);
        attempts++;
        if (attempts >= maxAttempts) {
          throw err;
        }
      }
    }

    throw new Error('Đã thử các API Key có sẵn nhưng đều không thành công. Vui lòng kiểm tra lại API Key hoặc đổi Model.');
  };

  // Helper to translate subtitles and auto-heal missing sentences if AI drops any
  const processAndHealSubtitles = async (
    rawAiText: string,
    subtitles: SubtitleMappingItem[]
  ): Promise<{ updatedSubtitles: SubtitleMappingItem[]; finalTranslatedText: string }> => {
    const mapping = mapAiResponseToSubtitles(rawAiText, subtitles);
    let updatedSubs = mapping.updatedSubtitles;
    let finalText = mapping.formattedTranslatedText;

    const missingSubs = updatedSubs.filter((s) => !s.translatedText || !s.translatedText.trim());
    // If AI dropped some lines (between 1 and 25 lines), automatically translate only those missing lines!
    if (missingSubs.length > 0 && missingSubs.length < subtitles.length && missingSubs.length <= 25) {
      try {
        const missingLines = missingSubs.map((sub) => {
          const durationSec = getSubtitleDurationInSeconds(sub.startTime, sub.endTime);
          const durationStr = `${durationSec.toFixed(1)}s`;
          return `[${sub.index}] ( ${durationStr}): ${sub.originalText}`;
        });
        const missingContent = missingLines.join('\n');
        const healResult = await translateChunkWithKeyRotation(missingContent);
        if (healResult && healResult.text) {
          const healMapping = mapAiResponseToSubtitles(healResult.text, missingSubs);
          const healedMap = new Map<number, string>();
          healMapping.updatedSubtitles.forEach((h) => {
            if (h.translatedText && h.translatedText.trim()) {
              healedMap.set(h.index, h.translatedText.trim());
            }
          });

          if (healedMap.size > 0) {
            updatedSubs = updatedSubs.map((orig) => {
              if ((!orig.translatedText || !orig.translatedText.trim()) && healedMap.has(orig.index)) {
                return {
                  ...orig,
                  translatedText: healedMap.get(orig.index)!,
                };
              }
              return orig;
            });

            finalText = updatedSubs
              .map((sub, i) => {
                const text = sub.translatedText ? sub.translatedText : `[Chưa dịch] ${sub.originalText}`;
                return `[${sub.index || i + 1}] (${sub.startTime} --> ${sub.endTime})\n${text}`;
              })
              .join('\n\n');
          }
        }
      } catch (healErr) {
        console.warn('Auto-heal missing subtitles skipped:', healErr);
      }
    }

    return { updatedSubtitles: updatedSubs, finalTranslatedText: finalText };
  };

  // Translate a single chunk on click
  const handleTranslateSingleChunk = async (chunkIndex: number) => {
    const chunk = mergedChunks[chunkIndex];
    if (!chunk || isRunningBatch) return;

    setActiveChunkIndices(new Set([chunkIndex]));
    setMergedChunks((prev) => {
      const copy = [...prev];
      copy[chunkIndex] = { ...copy[chunkIndex], status: 'processing', errorMsg: undefined };
      return copy;
    });

    try {
      const { text: result, relevantCharacters } = await translateChunkWithKeyRotation(chunk.content);

      let updatedSubtitles = chunk.subtitles;
      let finalTranslatedText = result;

      if (chunk.subtitles && chunk.subtitles.length > 0) {
        const processed = await processAndHealSubtitles(result, chunk.subtitles);
        updatedSubtitles = processed.updatedSubtitles;
        finalTranslatedText = processed.finalTranslatedText;
      }

      setMergedChunks((prev) => {
        const copy = [...prev];
        copy[chunkIndex] = {
          ...copy[chunkIndex],
          status: 'done',
          translatedText: finalTranslatedText,
          subtitles: updatedSubtitles,
          relevantCharactersCount: relevantCharacters.length,
          matchedCharacterNames: relevantCharacters.map((c) => c.hanViet || c.chinese),
        };
        return copy;
      });
    } catch (err: any) {
      setMergedChunks((prev) => {
        const copy = [...prev];
        copy[chunkIndex] = {
          ...copy[chunkIndex],
          status: 'error',
          errorMsg: err.message || 'Lỗi viết lại',
        };
        return copy;
      });
    } finally {
      setActiveChunkIndices(new Set());
    }
  };

  // High-Speed Parallel Batch Execution
  const handleStartParallelBatch = async () => {
    if (mergedChunks.length === 0) {
      setErrorMessage('Vui lòng gộp Cột B trước khi viết lại truyện.');
      return;
    }

    if (apiKeys.length === 0) {
      setErrorMessage('Vui lòng thêm ít nhất một API Key Gemini ở bảng trên.');
      return;
    }

    // Determine target chunks
    let targetIndices: number[] = [];
    if (selectedIndices.size > 0) {
      targetIndices = Array.from(selectedIndices).map((n) => Number(n)).sort((a, b) => a - b);
    } else {
      // If nothing selected, run untranslated or all
      targetIndices = mergedChunks.map((_, i) => i);
    }

    if (targetIndices.length === 0) {
      setErrorMessage('Không có cụm nào được chọn để viết lại.');
      return;
    }

    setIsRunningBatch(true);
    setIsPaused(false);
    isCancelledRef.current = false;
    isPausedRef.current = false;
    setErrorMessage(null);

    const queue = [...targetIndices];
    const actualConcurrency = Math.min(concurrency, queue.length);
    const activeRunningSet = new Set<number>();

    const runWorker = async (workerId: number) => {
      while (queue.length > 0 && !isCancelledRef.current) {
        // Pause handling loop
        while (isPausedRef.current && !isCancelledRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        if (isCancelledRef.current) break;

        const chunkIndex = queue.shift();
        if (chunkIndex === undefined) break;

        const currentChunk = mergedChunks[chunkIndex];
        // If user didn't explicitly select, skip if already done
        if (selectedIndices.size === 0 && currentChunk.status === 'done' && currentChunk.translatedText) {
          continue;
        }

        activeRunningSet.add(chunkIndex);
        setActiveChunkIndices(new Set(activeRunningSet));

        setMergedChunks((prev) => {
          const copy = [...prev];
          copy[chunkIndex] = {
            ...copy[chunkIndex],
            status: 'processing',
            errorMsg: undefined,
          };
          return copy;
        });

        try {
          const { text: result, relevantCharacters } = await translateChunkWithKeyRotation(currentChunk.content);

          let updatedSubtitles = currentChunk.subtitles;
          let finalTranslatedText = result;

          if (currentChunk.subtitles && currentChunk.subtitles.length > 0) {
            const processed = await processAndHealSubtitles(result, currentChunk.subtitles);
            updatedSubtitles = processed.updatedSubtitles;
            finalTranslatedText = processed.finalTranslatedText;
          }

          setMergedChunks((prev) => {
            const copy = [...prev];
            copy[chunkIndex] = {
              ...copy[chunkIndex],
              status: 'done',
              translatedText: finalTranslatedText,
              subtitles: updatedSubtitles,
              relevantCharactersCount: relevantCharacters.length,
              matchedCharacterNames: relevantCharacters.map((c) => c.hanViet || c.chinese),
            };
            return copy;
          });
        } catch (err: any) {
          setMergedChunks((prev) => {
            const copy = [...prev];
            copy[chunkIndex] = {
              ...copy[chunkIndex],
              status: 'error',
              errorMsg: err.message || 'Lỗi viết lại',
            };
            return copy;
          });
        } finally {
          activeRunningSet.delete(chunkIndex);
          setActiveChunkIndices(new Set(activeRunningSet));
        }

        // Small delay between calls in the same worker thread
        if (requestDelaySec > 0 && queue.length > 0 && !isCancelledRef.current) {
          await new Promise((resolve) => setTimeout(resolve, requestDelaySec * 1000));
        }
      }
    };

    // Launch workers in parallel
    const workerPromises: Promise<void>[] = [];
    for (let w = 0; w < actualConcurrency; w++) {
      workerPromises.push(runWorker(w));
    }

    try {
      await Promise.all(workerPromises);
    } catch (err: any) {
      setErrorMessage(err.message || 'Có lỗi xảy ra trong quá trình xử lý song song.');
    } finally {
      setIsRunningBatch(false);
      setIsPaused(false);
      setActiveChunkIndices(new Set());
    }
  };

  const handlePauseBatch = () => {
    isPausedRef.current = true;
    setIsPaused(true);
  };

  const handleResumeBatch = () => {
    isPausedRef.current = false;
    setIsPaused(false);
  };

  const handleStopBatch = () => {
    isCancelledRef.current = true;
    setIsRunningBatch(false);
    setIsPaused(false);
    setActiveChunkIndices(new Set());
  };

  // Export SRT Subtitle file with 100% accurate timecodes
  const handleExportSrt = (bilingual: boolean = false) => {
    if (mergedChunks.length === 0 && originalRows.length === 0) {
      setErrorMessage('Chưa có dữ liệu phụ đề để xuất file SRT.');
      return;
    }
    try {
      const res = exportTranslatedToSrt(mergedChunks, originalRows, fileName || 'PhuDe_Dich', {
        bilingual,
      });
      const translatedInfo =
        res.translatedCount > 0 ? ` (đã dịch ${res.translatedCount}/${res.count} câu)` : '';
      setExportStatusToast({
        type: 'success',
        message: `Đã xuất thành công file phụ đề SRT (${res.downloadFileName}) gồm ${res.count} mốc thời gian chuẩn xác 100%${translatedInfo}!`,
      });
      setTimeout(() => setExportStatusToast(null), 8000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi xuất file SRT');
    } finally {
      setExportMenuOpen(false);
    }
  };

  // Export TXT handlers (only completed / translated chunks)
  const handleExportTxt = (includeHeaders: boolean = true) => {
    if (mergedChunks.length === 0) {
      setErrorMessage('Chưa có dữ liệu để xuất file TXT.');
      return;
    }
    try {
      const res = exportTranslatedToTxt(mergedChunks, fileName || 'Truyen_Audio', {
        includeHeaders,
      });
      setExportStatusToast({
        type: 'success',
        message: `Đã xuất thành công file TXT gồm ${res.count} cụm đã dịch (${res.totalChars.toLocaleString()} ký tự)!`,
      });
      setTimeout(() => setExportStatusToast(null), 6000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi xuất file TXT');
    } finally {
      setExportMenuOpen(false);
    }
  };

  const handleCopyTranslatedTxt = async (includeHeaders: boolean = false) => {
    if (mergedChunks.length === 0) {
      setErrorMessage('Chưa có dữ liệu để sao chép.');
      return;
    }
    try {
      const res = await copyTranslatedTextToClipboard(mergedChunks, { includeHeaders });
      setExportStatusToast({
        type: 'success',
        message: `Đã sao chép toàn bộ ${res.count} cụm bản dịch (${res.totalChars.toLocaleString()} ký tự) vào bộ nhớ tạm!`,
      });
      setTimeout(() => setExportStatusToast(null), 6000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi sao chép bản dịch');
    } finally {
      setExportMenuOpen(false);
    }
  };

  const completedCount = mergedChunks.filter((c) => c.status === 'done' && Boolean(c.translatedText)).length;
  const untranslatedCount = mergedChunks.length - completedCount;
  const totalCharsOriginal = originalRows.reduce((acc, r) => acc + r.charCount, 0);
  const selectedCount = selectedIndices.size;

  return (
    <div className="space-y-5">
      {/* Project Status Banner */}
      {currentProject ? (
        <div className="bg-gradient-to-r from-blue-50 via-indigo-50/40 to-slate-50 border border-blue-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold text-blue-700 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Dự án đang làm dở
                </span>
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  {currentProject.name}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500 mt-1">
                <span className="flex items-center gap-1 font-mono text-slate-700">
                  <Subtitles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  {fileName || currentProject.fileName}
                </span>
                <span>•</span>
                <span className="text-indigo-700 font-semibold flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  Bảng nhân vật riêng: {characters.length} NV
                </span>
                {mergedChunks.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-slate-600">
                      Tiến độ: <strong className="text-emerald-700">{completedCount}</strong>/{mergedChunks.length} cụm đã dịch
                    </span>
                  </>
                )}
                {lastSavedTime && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-700 flex items-center gap-1 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                      Tự động lưu lúc {lastSavedTime}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onOpenProjectManager}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 shadow-2xs transition-colors cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-blue-600" />
              <span>Quản lý / Đổi dự án ({projectsCount})</span>
            </button>
          </div>
        </div>
      ) : projectsCount > 0 ? (
        <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5 text-xs text-slate-700">
            <FolderOpen className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              Hệ thống đang lưu trữ <strong>{projectsCount} dự án phụ đề SRT đang làm dở</strong>. Bạn có thể mở lại dự án cũ hoặc tải file phụ đề SRT mới.
            </span>
          </div>
          <button
            onClick={onOpenProjectManager}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-2xs shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Chọn dự án phụ đề ({projectsCount})</span>
          </button>
        </div>
      ) : null}

      {/* 1. Upload & Subtitle Setup Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 shadow-2xs">
              <Subtitles className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <span>1. Nạp File Phụ Đề SRT (.srt)</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Khóa Chuẩn Mốc Timecode 100%
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Bảo toàn 100% mốc thời gian phụ đề gốc. Tương thích tuyệt đối với CapCut, Premiere Pro, DaVinci Resolve, Aegisub, VLC.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleLoadSampleSrtData}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
              title="Dùng 25 câu phụ đề SRT mẫu tiên hiệp để test nhanh quá trình dịch và xuất file"
            >
              <Subtitles className="w-4 h-4 text-blue-600" />
              <span>Dùng file SRT mẫu test</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".srt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" /> Chọn file phụ đề .srt
            </button>
          </div>
        </div>

        {/* File info summary */}
        {originalRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">Tên file phụ đề:</span>
              <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold flex items-center gap-1 border border-emerald-200">
                <Subtitles className="w-3.5 h-3.5" />
                {fileName}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-slate-600">
              <span>
                Tổng phụ đề: <strong className="text-slate-900">{originalRows.length.toLocaleString()}</strong> câu
              </span>
              <span>•</span>
              <span>
                Tổng ký tự gốc: <strong className="text-slate-900">{totalCharsOriginal.toLocaleString()}</strong> ký tự
              </span>
              <span>•</span>
              <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                ✓ Mốc thời gian (Timecode) được khóa chuẩn xác 100%
              </span>
            </div>
          </div>
        )}

        {/* Function: Subtitle Chunk Settings */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center pt-2">
          <div className="md:col-span-4 flex items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <label htmlFor="subs-per-chunk" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              Số câu phụ đề / cụm:
            </label>
            <input
              id="subs-per-chunk"
              type="number"
              value={subtitlesPerChunk <= 0 ? '' : subtitlesPerChunk}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setSubtitlesPerChunk(0);
                } else {
                  const num = parseInt(val, 10);
                  setSubtitlesPerChunk(isNaN(num) ? 0 : Math.max(1, num));
                }
              }}
              onBlur={() => {
                if (!subtitlesPerChunk || subtitlesPerChunk < 1) {
                  setSubtitlesPerChunk(100);
                }
              }}
              className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 text-center focus:ring-1 focus:ring-indigo-500 outline-none"
              min={1}
              placeholder="VD: 100"
              title="Nhập số câu phụ đề mỗi cụm tùy thích không giới hạn (VD: 50, 100, 200, 500...)"
            />
            <span className="text-[11px] text-slate-500 font-medium">câu (tùy thích)</span>
          </div>

          <div className="md:col-span-4 flex items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <input
              type="checkbox"
              id="clean-chars"
              checked={autoCleanChars}
              onChange={(e) => setAutoCleanChars(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300"
            />
            <label htmlFor="clean-chars" className="text-xs text-slate-700 cursor-pointer">
              Tự động làm sạch ký tự lạ gây lỗi hiển thị
            </label>
          </div>

          <div className="md:col-span-4 flex justify-end">
            <button
              onClick={handleRechunkSubtitles}
              disabled={originalRows.length === 0}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Zap className="w-4 h-4 fill-white" />
              Tự Động Chia Cụm Phụ Đề ({subtitlesPerChunk > 0 ? subtitlesPerChunk : 100} câu/cụm)
            </button>
          </div>
        </div>

        {mergedChunks.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-900">
            <span>
              ✅ Đã chia thành công <strong>{originalRows.length}</strong> câu phụ đề thành{' '}
              <strong>{mergedChunks.length}</strong> cụm dịch (trung bình ~{subtitlesPerChunk > 0 ? subtitlesPerChunk : 100} câu/cụm).
            </span>
            <span className="font-semibold text-emerald-700">
              Sẵn sàng chọn Gemini AI và dịch song song
            </span>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-auto">
            {onSelectModel && selectedModel.id !== 'gemini-3.1-flash-lite' && (
              <button
                type="button"
                onClick={() => {
                  const targetModel = GEMINI_MODELS.find((m) => m.id === 'gemini-3.1-flash-lite');
                  if (targetModel) {
                    onSelectModel(targetModel);
                    if (onResetKeyStatus) onResetKeyStatus();
                    setErrorMessage(null);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                title="Chuyển sang Gemini 3.1 Flash Lite (Hạn mức 500 lượt/ngày)"
              >
                <Zap className="w-3.5 h-3.5 fill-white" />
                <span>Đổi sang Gemini 3.1 Flash Lite (500 lượt/ngày)</span>
              </button>
            )}
            {onResetKeyStatus && (
              <button
                type="button"
                onClick={() => {
                  onResetKeyStatus();
                  setErrorMessage(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                title="Đặt lại trạng thái tất cả API Key về Sẵn sàng"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset API Keys về Sẵn sàng</span>
              </button>
            )}
            <button
              onClick={() => setErrorMessage(null)}
              className="text-slate-400 hover:text-slate-600 font-bold px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Export Status Toast */}
      {exportStatusToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{exportStatusToast.message}</span>
          </div>
          <button onClick={() => setExportStatusToast(null)} className="text-emerald-700 hover:text-emerald-900 font-bold px-1">
            ✕
          </button>
        </div>
      )}

      {/* 2. Main Execution & Selection Section */}
      {mergedChunks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
          {/* Action Header with Concurrency & Performance Settings */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                  <Play className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-slate-800">
                  2. Tiến Hành Viết Lại Truyện (Xoay Vòng & Chạy Song Song)
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Tiến độ: <strong>{completedCount}</strong> / <strong>{mergedChunks.length}</strong> cụm hoàn tất
                {selectedCount > 0 && (
                  <span className="ml-2 font-semibold text-blue-600">
                    • Đang chọn {selectedCount} cụm
                  </span>
                )}
              </p>
            </div>

            {/* Performance & Multi-Thread Concurrency Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Concurrency setting */}
              <div className="flex items-center gap-1.5 bg-indigo-50/80 px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs">
                <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                <span className="text-indigo-900 font-medium text-[11px]">Luồng song song:</span>
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  disabled={isRunningBatch}
                  className="font-bold text-indigo-900 bg-transparent outline-none cursor-pointer"
                >
                  <option value={1}>1 luồng (tuần tự)</option>
                  <option value={2}>2 luồng</option>
                  <option value={3}>3 luồng (khuyên dùng)</option>
                  <option value={4}>4 luồng</option>
                  <option value={5}>5 luồng (rất nhanh)</option>
                  <option value={8}>8 luồng (siêu tốc)</option>
                  <option value={10}>10 luồng (tối đa)</option>
                </select>
              </div>

              {/* Delay control */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-600 text-[11px]">Nghỉ luồng:</span>
                <select
                  value={requestDelaySec}
                  onChange={(e) => setRequestDelaySec(Number(e.target.value))}
                  disabled={isRunningBatch}
                  className="font-bold text-slate-800 bg-transparent outline-none cursor-pointer"
                >
                  <option value={0}>0s (tối đa tốc độ)</option>
                  <option value={0.5}>0.5s (nhanh)</option>
                  <option value={1}>1s</option>
                  <option value={2}>2s</option>
                  <option value={3}>3s</option>
                </select>
              </div>

              {/* Start / Pause / Stop Buttons */}
              {!isRunningBatch ? (
                <button
                  onClick={handleStartParallelBatch}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
                >
                  <Play className="w-4 h-4 fill-white" />
                  {selectedCount > 0
                    ? `🚀 Viết lại ${selectedCount} cụm đã chọn (${concurrency} luồng)`
                    : `🚀 Viết lại toàn bộ truyện (${concurrency} luồng)`}
                </button>
              ) : isPaused ? (
                <button
                  onClick={handleResumeBatch}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
                >
                  <Play className="w-4 h-4 fill-white" /> Tiếp tục chạy
                </button>
              ) : (
                <button
                  onClick={handlePauseBatch}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
                >
                  <Pause className="w-4 h-4" /> Tạm dừng
                </button>
              )}

              {isRunningBatch && (
                <button
                  onClick={handleStopBatch}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-rose-600" /> Hủy
                </button>
              )}

              {/* Export Buttons: SRT (.srt) & TXT */}
              <div className="flex items-center gap-2">
                {/* 1. Quick Export Button: SRT (.srt) */}
                <button
                  type="button"
                  onClick={() => handleExportSrt(false)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  title="Tải ngay file phụ đề SRT (.srt) - Bảo toàn 100% mốc thời gian (timecode) chuẩn xác cho CapCut, Premiere, Aegisub, DaVinci..."
                >
                  <Subtitles className="w-4 h-4" />
                  <span>Xuất Phụ Đề SRT (.srt)</span>
                  {completedCount > 0 && (
                    <span className="ml-0.5 bg-emerald-800/80 px-1.5 py-0.5 rounded text-[10px]">
                      {completedCount}/{mergedChunks.length} cụm
                    </span>
                  )}
                </button>

                {/* 2. Export Dropdown Menu (SRT formats, TXT, Copy) */}
                <div className="relative inline-flex rounded-lg shadow-xs">
                  <button
                    onClick={() => handleExportSrt(false)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-l-lg text-xs font-bold transition-colors cursor-pointer"
                    title="Tải ngay file phụ đề SRT"
                  >
                    <Subtitles className="w-4 h-4 text-emerald-400" />
                    <span>Xuất .SRT</span>
                  </button>
                  <button
                    onClick={() => setExportMenuOpen((prev) => !prev)}
                    className="px-2 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-r-lg border-l border-slate-600 transition-colors cursor-pointer"
                    title="Thêm tùy chọn xuất file SRT, TXT và sao chép"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {exportMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-30"
                        onClick={() => setExportMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1.5 w-84 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 z-40 text-xs">
                        {/* SRT Section */}
                        <div className="px-3 py-1 font-bold text-slate-400 uppercase text-[10px] tracking-wider flex items-center justify-between">
                          <span>Định dạng Phụ đề SRT (Timecode 100%)</span>
                          <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">
                            Chuẩn xác
                          </span>
                        </div>

                        <button
                          onClick={() => handleExportSrt(false)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5 text-slate-700 cursor-pointer"
                        >
                          <Subtitles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>1. Phụ đề SRT Tiếng Việt (.srt)</span>
                              <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded">
                                Khuyên dùng
                              </span>
                            </span>
                            <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                              Khóa 100% mốc thời gian gốc (00:00:00,000), nạp vào CapCut, Premiere, Aegisub, VLC chạy ngay.
                            </span>
                          </div>
                        </button>

                        <button
                          onClick={() => handleExportSrt(true)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5 text-slate-700 border-t border-slate-100 cursor-pointer"
                        >
                          <Subtitles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>2. Phụ đề SRT Song Ngữ (.srt)</span>
                              <span className="text-[9px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.2 rounded">
                                Song ngữ
                              </span>
                            </span>
                            <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                              Dòng 1: Tiếng Việt, Dòng 2: Tiếng gốc. Dùng để đối chiếu, học ngoại ngữ hoặc làm sub đôi.
                            </span>
                          </div>
                        </button>

                        {/* TXT & Copy Section */}
                        <div className="px-3 pt-2.5 pb-1 font-bold text-slate-400 uppercase text-[10px] tracking-wider border-t border-slate-200 mt-1">
                          Tùy chọn xuất file TXT & Bộ nhớ tạm
                        </div>

                        <button
                          onClick={() => handleExportTxt(true)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5 text-slate-700 cursor-pointer"
                        >
                          <FileText className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900 block">3. File TXT (Kèm mốc thời gian câu)</span>
                            <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                              Dễ đọc, phân tách rõ ràng từng câu phụ đề đã dịch kèm mốc thời gian.
                            </span>
                          </div>
                        </button>

                        <button
                          onClick={() => handleExportTxt(false)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5 text-slate-700 border-t border-slate-100 cursor-pointer"
                        >
                          <Download className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900 block">4. File TXT thuần (Chỉ văn bản phụ đề)</span>
                            <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                              Liền mạch, nạp ngay vào công cụ TTS đọc phụ đề hoặc biên kịch.
                            </span>
                          </div>
                        </button>

                        <button
                          onClick={() => handleCopyTranslatedTxt(false)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5 text-slate-700 border-t border-slate-100 cursor-pointer"
                        >
                          <Copy className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900 block">5. Sao chép toàn bộ bản dịch (Ctrl + V)</span>
                            <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                              Dán trực tiếp vào Notepad, Word hoặc các phần mềm chỉnh sửa phụ đề khác.
                            </span>
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* 3. So sánh câu đầu - cuối button */}
                <button
                  type="button"
                  onClick={() => handleOpenComparisonModal(0)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  title="Công cụ kiểm tra & đối chiếu câu đầu - câu cuối của từng cụm với bản dịch mới của AI"
                >
                  <GitCompare className="w-4 h-4" />
                  <span>So sánh câu đầu - cuối</span>
                </button>
              </div>
            </div>
          </div>

          {/* Progress Bar & Real-Time Worker Status */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1.5">
                <span>Tiến độ viết lại</span>
                {isRunningBatch && (
                  <span className="inline-flex items-center gap-1 text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full text-[11px]">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Đang chạy song song {activeChunkIndices.size} luồng
                  </span>
                )}
              </span>
              <span>
                {Math.round((completedCount / mergedChunks.length) * 100)}% ({completedCount}/{mergedChunks.length} cụm)
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${(completedCount / mergedChunks.length) * 100}%` }}
              />
            </div>
          </div>

          {/* 3. Selection Toolbar (Chọn cụm để viết lại) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5 text-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-slate-800 flex items-center gap-1.5 mr-1">
                  <CheckSquare className="w-4 h-4 text-blue-600" />
                  Chọn cụm:
                </span>
                <button
                  onClick={handleToggleSelectAll}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                >
                  {selectedIndices.size === mergedChunks.length ? 'Bỏ chọn hết' : `Tất cả (${mergedChunks.length})`}
                </button>
                <button
                  onClick={handleSelectUntranslated}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-amber-800 rounded-lg text-xs font-semibold transition-colors"
                >
                  Chưa viết ({untranslatedCount})
                </button>
                {selectedCount > 0 && (
                  <button
                    onClick={() => setSelectedIndices(new Set())}
                    className="px-2.5 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    Xóa chọn ({selectedCount})
                  </button>
                )}
              </div>

              {/* Range Selector & Flexible Input (Ví dụ từ 5-10) */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Quick From - To Inputs (VD: từ 5 đến 10) */}
                <div className="flex items-center gap-1.5 bg-white px-2 py-1 border border-slate-300 rounded-lg shadow-2xs">
                  <span className="text-slate-600 font-medium text-[11px]">Từ cụm:</span>
                  <input
                    type="number"
                    min="1"
                    max={mergedChunks.length}
                    placeholder="5"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSelectRange();
                    }}
                    className="w-12 px-1 py-0.5 border border-slate-200 rounded text-center text-xs font-bold focus:border-blue-500 outline-none"
                  />
                  <span className="text-slate-600 font-medium text-[11px]">đến:</span>
                  <input
                    type="number"
                    min="1"
                    max={mergedChunks.length}
                    placeholder="10"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSelectRange();
                    }}
                    className="w-12 px-1 py-0.5 border border-slate-200 rounded text-center text-xs font-bold focus:border-blue-500 outline-none"
                  />
                  <button
                    onClick={handleSelectRange}
                    className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition-colors"
                  >
                    Chọn
                  </button>
                </div>

                <div className="text-slate-300 hidden sm:block">|</div>

                {/* 2. Flexible range/list input (VD: 5-10 hoặc 1, 3, 5-10) */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="VD: 5-10 hoặc 1, 3, 5-8"
                    value={selectionInputText}
                    onChange={(e) => setSelectionInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplySelectionInput();
                    }}
                    className="w-36 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono outline-none focus:border-blue-500 shadow-2xs"
                    title="Nhập khoảng hoặc danh sách cụm, ví dụ: 5-10"
                  />
                  <button
                    onClick={handleApplySelectionInput}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Table of Chunks */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIndices.size > 0 && selectedIndices.size === mergedChunks.length}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                      title="Chọn tất cả / Bỏ chọn"
                    />
                  </th>
                  <th className="py-2.5 px-2 w-12 text-center">Cụm</th>
                  <th className="py-2.5 px-3 w-52">
                    {isSrtProject ? 'Mốc Thời Gian / Đoạn Phụ Đề' : 'Tên Chương / Hàng'}
                  </th>
                  <th className="py-2.5 px-3 w-28 text-center">Ký tự gốc</th>
                  <th className="py-2.5 px-3">
                    {isSrtProject ? 'Bản dịch phụ đề (Cột C)' : 'Bản dịch viết lại (Cột C)'}
                  </th>
                  <th className="py-2.5 px-3 w-28 text-center">Trạng thái</th>
                  <th className="py-2.5 px-3 w-24 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mergedChunks.map((chunk, idx) => {
                  const isProcessing = activeChunkIndices.has(idx) || chunk.status === 'processing';
                  const isDone = chunk.status === 'done' && Boolean(chunk.translatedText);
                  const isError = chunk.status === 'error';
                  const isSelected = selectedIndices.has(idx);

                  return (
                    <tr
                      key={chunk.id}
                      className={`transition-colors ${
                        isProcessing
                          ? 'bg-blue-50/80 font-medium'
                          : isSelected
                          ? 'bg-indigo-50/40 hover:bg-indigo-50/70'
                          : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectIndex(idx)}
                          className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-center font-bold text-slate-600">
                        #{chunk.chunkIndex}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">{chunk.chapterLabel}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          {chunk.subtitles && chunk.subtitles.length > 0 ? (
                            <>
                              <span className="text-[10px] text-emerald-700 font-mono font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                {chunk.subtitles[0]?.startTime} → {chunk.subtitles[chunk.subtitles.length - 1]?.endTime}
                              </span>
                              <span className="text-[10px] text-slate-500 font-medium">
                                ({chunk.subtitles.length} câu)
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              Hàng {chunk.startRowIndex + 1} → {chunk.endRowIndex + 1}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                              (chunk.relevantCharactersCount ?? (chunk.matchedCharacterNames || []).length) > 0
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                            title={
                              chunk.matchedCharacterNames && chunk.matchedCharacterNames.length > 0
                                ? `Nhân vật đưa vào prompt: ${chunk.matchedCharacterNames.join(', ')}`
                                : 'Không phát hiện nhân vật cụ thể trong đoạn này'
                            }
                          >
                            <Users className="w-2.5 h-2.5" />
                            {chunk.relevantCharactersCount ?? (chunk.matchedCharacterNames || []).length} NV
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-700">
                        {chunk.charCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 max-w-md">
                        {chunk.translatedText ? (
                          <div
                            onClick={() => handleOpenEditModal(idx)}
                            className="group/text cursor-pointer space-y-1 p-1 -m-1 rounded-lg hover:bg-slate-100/90 transition-colors"
                            title="Nhấp để chỉnh sửa nội dung bản dịch này"
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <p className="line-clamp-2 text-slate-700 text-xs leading-relaxed group-hover/text:text-slate-900">
                                {chunk.translatedText}
                              </p>
                              <span className="opacity-0 group-hover/text:opacity-100 text-emerald-600 p-0.5 rounded shrink-0 transition-opacity bg-white border border-slate-200 shadow-2xs">
                                <Pencil className="w-3 h-3" />
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-emerald-700 font-semibold">
                                {chunk.translatedText.length.toLocaleString()} ký tự
                              </span>
                              <span className="text-[10px] text-slate-400 group-hover/text:text-emerald-600 font-medium transition-colors">
                                (Nhấp để sửa)
                              </span>
                              {chunk.boundaryComparison && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenComparisonModal(idx);
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-1.5 py-0.5 rounded font-semibold cursor-pointer transition-colors"
                                  title="Bấm để mở bảng đối chiếu câu đầu - câu cuối của cụm này"
                                >
                                  <GitCompare className="w-3 h-3 text-indigo-600" />
                                  <span>
                                    Khớp: {chunk.boundaryComparison.firstSimilarity !== null ? `${chunk.boundaryComparison.firstSimilarity}%` : '--'} / {chunk.boundaryComparison.lastSimilarity !== null ? `${chunk.boundaryComparison.lastSimilarity}%` : '--'}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        ) : isProcessing ? (
                          <div className="flex items-center gap-2 text-blue-600 text-xs font-semibold animate-pulse">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
                            <span>Đang gọi Gemini AI ({selectedModel.name})...</span>
                          </div>
                        ) : isError ? (
                          <div className="text-rose-600 text-xs flex flex-col gap-1 p-1.5 bg-rose-50/80 rounded-lg border border-rose-200">
                            <div className="flex items-start gap-1.5 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600 mt-0.5" />
                              <span className="leading-snug" title={chunk.errorMsg}>
                                {chunk.errorMsg || 'Lỗi không thành công'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5 text-[11px] pt-0.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTranslateSingleChunk(idx);
                                }}
                                disabled={isRunningBatch}
                                className="text-blue-700 hover:text-blue-900 font-bold underline cursor-pointer disabled:opacity-50 flex items-center gap-1"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Thử dịch lại</span>
                              </button>
                              <span className="text-slate-300">•</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditModal(idx);
                                }}
                                className="text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer flex items-center gap-1"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Tự nhập nội dung</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => handleOpenEditModal(idx)}
                            className="text-slate-400 hover:text-emerald-600 italic text-[11px] cursor-pointer flex items-center gap-1"
                            title="Bấm để tự nhập bản dịch cho cụm này"
                          >
                            <span>Chưa viết lại</span>
                            <span className="text-[10px] not-italic text-emerald-600 font-medium underline">
                              (tự nhập)
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {isDone ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[11px] font-semibold border border-emerald-100">
                            <CheckCircle className="w-3 h-3" /> Hoàn tất
                          </span>
                        ) : isProcessing ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[11px] font-semibold border border-blue-200">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Đang chạy
                          </span>
                        ) : isError ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-50 text-rose-700 rounded text-[11px] font-semibold border border-rose-200">
                            <AlertTriangle className="w-3 h-3" /> Lỗi
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px]">
                            Chờ
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenEditModal(idx)}
                            className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                            title="Chỉnh sửa nội dung bản dịch cụm này"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenComparisonModal(idx)}
                            className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                            title="So sánh câu đầu - câu cuối cụm này (Đo độ khớp với AI)"
                          >
                            <GitCompare className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setPreviewChunk(chunk)}
                            className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="Xem chi tiết cụm này"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleTranslateSingleChunk(idx)}
                            disabled={isRunningBatch}
                            className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded disabled:opacity-40 transition-colors cursor-pointer"
                            title="Viết lại cụm này bằng Gemini"
                          >
                            <Play className="w-4 h-4 fill-blue-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Chunk Detail Preview Modal */}
      {previewChunk && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-3xl w-full flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Chi tiết Cụm #{previewChunk.chunkIndex}: {previewChunk.chapterLabel}
                </h3>
                <p className="text-xs text-slate-500">
                  {previewChunk.charCount.toLocaleString()} ký tự gốc •{' '}
                  {previewChunk.translatedText
                    ? `${previewChunk.translatedText.length.toLocaleString()} ký tự viết lại`
                    : 'Chưa có bản viết lại'}
                </p>
              </div>
              <button
                onClick={() => setPreviewChunk(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* Relevant characters detected for this chunk */}
              {(() => {
                const previewRelevantChars = extractRelevantCharacters(previewChunk.content, characters);
                return (
                  <div className="space-y-1.5 bg-slate-50/70 p-3 rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-indigo-600" />
                        Nhân vật liên quan trong đoạn ({previewRelevantChars.length}/{characters.length} nhân vật):
                      </span>
                      <div className="flex items-center gap-1.5">
                        {previewRelevantChars.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopyImportCharacters(previewRelevantChars)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                                copiedCharactersPreview
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                              }`}
                              title="Copy danh sách nhân vật dạng bảng Tab-separated (Tên Trung, Hán Việt, Giới tính, Ghi chú) để dán trực tiếp vào Bảng nhân vật hoặc Excel"
                            >
                              {copiedCharactersPreview ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-white" />
                                  <span>Đã copy nhân vật import!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>Copy tên nhân vật import vào</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyNamesOnly(previewRelevantChars)}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition-all cursor-pointer shadow-2xs ${
                                copiedNamesOnlyPreview
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                              title="Copy danh sách tên nhân vật: Hán Việt (Tên Trung)"
                            >
                              {copiedNamesOnlyPreview ? (
                                <>
                                  <Check className="w-3 h-3 text-white" />
                                  <span>Đã copy tên!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-500" />
                                  <span>Chỉ copy tên</span>
                                </>
                              )}
                            </button>
                          </>
                        )}
                        <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold border border-emerald-200">
                          Chỉ nạp {previewRelevantChars.length} nhân vật vào prompt
                        </span>
                      </div>
                    </div>
                    {previewRelevantChars.length > 0 ? (
                      <div className="p-2.5 bg-white border border-indigo-200 rounded-lg flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                        {previewRelevantChars.map((ch) => (
                          <span
                            key={ch.id}
                            className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-indigo-100 rounded-md text-[11px] text-slate-800 shadow-2xs"
                          >
                            <span className="font-bold text-indigo-700">{ch.hanViet || ch.chinese}</span>
                            {ch.chinese && ch.chinese !== ch.hanViet && (
                              <span className="text-slate-400 font-mono text-[10px]">({ch.chinese})</span>
                            )}
                            <span
                              className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                                ch.gender === 'Nam'
                                  ? 'bg-blue-100 text-blue-700'
                                  : ch.gender === 'Nữ'
                                  ? 'bg-pink-100 text-pink-700'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {ch.gender || 'Chưa rõ'}
                            </span>
                            {ch.note && (
                              <span className="text-slate-500 text-[10px] max-w-[180px] truncate" title={ch.note}>
                                - {ch.note}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-500 italic text-[11px]">
                        Không có nhân vật cụ thể nào trong danh sách xuất hiện ở đoạn này. Gemini nhận bảng trống để tránh tốn token và xưng hô nhầm lẫn.
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 block">Nội dung gốc (Đã gộp từ Cột B):</span>
                  <button
                    type="button"
                    onClick={handleCopyOriginalContent}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                      copiedOriginalPreview
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                    title="Copy toàn bộ nội dung gốc Cột B của cụm này vào bộ nhớ tạm"
                  >
                    {copiedOriginalPreview ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-white" />
                        <span>Đã copy nội dung gốc!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-600" />
                        <span>Copy nội dung gốc</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed font-mono max-h-52 overflow-y-auto whitespace-pre-wrap select-text">
                  {previewChunk.content}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-700 block">Bản dịch viết lại của Gemini (Cột C):</span>
                  <div className="flex items-center gap-2">
                    {previewChunk.translatedText && (
                      <button
                        type="button"
                        onClick={handleCopyTranslatedPreview}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                          copiedTranslatedPreview
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                        }`}
                        title="Copy nội dung bản dịch viết lại của cụm này"
                      >
                        {copiedTranslatedPreview ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-white" />
                            <span>Đã copy bản dịch!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Copy bản dịch</span>
                          </>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const idx = previewChunk.chunkIndex - 1;
                        setPreviewChunk(null);
                        handleOpenEditModal(idx);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                      title="Mở trình chỉnh sửa nội dung bản dịch này"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Chỉnh sửa nội dung</span>
                    </button>
                  </div>
                </div>
                {previewChunk.translatedText ? (
                  <div className="p-3 bg-indigo-50/50 border border-indigo-200 rounded-lg text-slate-800 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap select-text">
                    {previewChunk.translatedText}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-slate-400 text-center">
                    Chưa dịch cụm này. Bạn có thể nhấn nút "Viết lại cụm này" trong bảng chính hoặc bấm "Chỉnh sửa nội dung" để tự nhập.
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const idx = previewChunk.chunkIndex - 1;
                    setPreviewChunk(null);
                    handleOpenEditModal(idx);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Sửa bản dịch cụm này</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyOriginalContent}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                    copiedOriginalPreview
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  }`}
                  title="Copy nội dung gốc Cột B"
                >
                  {copiedOriginalPreview ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span>Đã copy nội dung gốc!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-600" />
                      <span>Copy nội dung gốc</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idx = previewChunk.chunkIndex - 1;
                    setPreviewChunk(null);
                    handleOpenComparisonModal(idx);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  title="Mở bảng so sánh câu đầu và câu cuối cụm này"
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  <span>So sánh câu đầu/cuối</span>
                </button>
              </div>
              <button
                onClick={() => setPreviewChunk(null)}
                className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-900 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chunk Translation Editor Modal */}
      {editingChunk && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-4xl w-full flex flex-col max-h-[92vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-800 flex flex-wrap items-center gap-2">
                    <span>Chỉnh sửa Bản dịch Cột C - Cụm #{editingChunk.chunk.chunkIndex}</span>
                    <span className="text-xs font-normal text-slate-500">
                      ({editingChunk.chunk.chapterLabel})
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Hàng {editingChunk.chunk.startRowIndex + 1} → {editingChunk.chunk.endRowIndex + 1} •{' '}
                    <strong className="text-slate-700">{editingChunk.chunk.charCount.toLocaleString()}</strong> ký tự gốc
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingChunk(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 text-lg font-bold transition-colors cursor-pointer"
                title="Đóng cửa sổ"
              >
                ✕
              </button>
            </div>

            {/* Main Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
              {/* Toggle Original Text Reference */}
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                <button
                  type="button"
                  onClick={() =>
                    setEditingChunk((prev) =>
                      prev ? { ...prev, showOriginalContent: !prev.showOriginalContent } : null
                    )
                  }
                  className="w-full px-3 py-2 flex items-center justify-between bg-slate-100 hover:bg-slate-200/70 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    Nội dung gốc Cột B để đối chiếu ({editingChunk.chunk.charCount.toLocaleString()} ký tự)
                  </span>
                  <span className="text-[11px] text-blue-600 font-medium">
                    {editingChunk.showOriginalContent ? 'Ẩn bớt ▲' : 'Hiện nội dung gốc ▼'}
                  </span>
                </button>
                {editingChunk.showOriginalContent && (
                  <div className="p-3 text-slate-700 font-mono leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap border-t border-slate-200 text-xs bg-white select-text">
                    {editingChunk.chunk.content}
                  </div>
                )}
              </div>

              {/* Textarea for Translation Editing */}
              <div className="space-y-1.5 flex flex-col">
                <div className="flex items-center justify-between">
                  <label htmlFor="edit-translation-textarea" className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="text-emerald-700">●</span>
                    <span>Nội dung bản dịch viết lại (Cột C):</span>
                  </label>
                </div>

                <textarea
                  id="edit-translation-textarea"
                  value={editingChunk.text}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditingChunk((prev) => (prev ? { ...prev, text: val } : null));
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveEditedChunk();
                    }
                  }}
                  placeholder="Nhập hoặc chỉnh sửa bản dịch tiếng Việt hoàn chỉnh cho cụm truyện này..."
                  rows={13}
                  className="w-full p-3.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 leading-relaxed font-sans focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none resize-y min-h-[280px] max-h-[500px]"
                  autoFocus
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 px-1 pt-1">
                  <span>
                    💡 Mẹo: Nhấn phím tắt <strong>Ctrl + Enter</strong> để lưu nhanh nội dung vừa sửa.
                  </span>
                  {editingChunk.originalAiText && editingChunk.text !== editingChunk.originalAiText && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingChunk((prev) =>
                          prev ? { ...prev, text: prev.originalAiText } : null
                        );
                      }}
                      className="text-amber-700 hover:text-amber-800 flex items-center gap-1 font-semibold underline cursor-pointer"
                      title="Khôi phục lại văn bản dịch trước khi chỉnh sửa"
                    >
                      <Undo2 className="w-3 h-3" />
                      Khôi phục bản dịch ban đầu của AI
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!editingChunk.text) return;
                    try {
                      await navigator.clipboard.writeText(editingChunk.text);
                      setCopiedEditModal(true);
                      setTimeout(() => setCopiedEditModal(false), 2000);
                    } catch (err) {
                      console.error('Clipboard copy error', err);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  {copiedEditModal ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Đã chép vào bộ nhớ tạm!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Sao chép bản dịch</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingChunk(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditedChunk}
                  className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Lưu Bản Dịch</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Boundary Sentence Comparison & Similarity Modal (Đối chiếu câu đầu - câu cuối) */}
      <BoundarySentenceComparisonModal
        isOpen={isComparisonModalOpen}
        onClose={() => setIsComparisonModalOpen(false)}
        chunks={mergedChunks}
        initialChunkIndex={comparisonChunkIndex}
        onUpdateChunk={handleUpdateChunkData}
        apiKeys={apiKeys}
        selectedModel={selectedModel}
        characters={characters}
        onIncrementKeyUsage={onIncrementKeyUsage}
        onMarkKeyExhausted={onMarkKeyExhausted}
        onMarkKeyError={onMarkKeyError}
      />
    </div>
  );
};
