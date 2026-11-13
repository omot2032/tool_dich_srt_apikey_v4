import React, { useState, useMemo, useRef } from 'react';
import { CharacterItem, ApiKeyItem, GeminiModelOption, StoryRow } from '../types';
import { GEMINI_MODELS } from '../data/models';
import { exportCharactersToTxt, parseCharactersFromTxt } from '../utils/textUtils';
import {
  mergeChineseVariants,
  extractChineseVariants,
  sanitizeSingleHanViet,
  hasMultipleHanViets,
  splitMultiCharacterRow,
} from '../utils/characterUtils';
import { ImportGlossaryModal } from './ImportGlossaryModal';
import { CapcutVariantMergerModal } from './CapcutVariantMergerModal';
import {
  Users,
  Plus,
  Trash2,
  Search,
  Copy,
  Check,
  UploadCloud,
  Upload,
  Download,
  Sparkles,
  Layers,
  Split,
  Eraser,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  Pencil,
  X,
  Save,
  Maximize2,
  BookOpen,
} from 'lucide-react';

interface CharacterTableModalProps {
  characters: CharacterItem[];
  onUpdateCharacters: (chars: CharacterItem[]) => void;
  isOpen: boolean;
  onClose: () => void;
  apiKeys?: ApiKeyItem[];
  selectedModel?: GeminiModelOption;
  onIncrementKeyUsage?: (keyId: string, modelId: string) => void;
  onMarkKeyExhausted?: (keyId: string, modelId: string) => void;
  onMarkKeyError?: (keyId: string, errorMsg: string) => void;
  preloadedRows?: StoryRow[];
  preloadedFileName?: string;
  projectName?: string;
}

export const CharacterTableModal: React.FC<CharacterTableModalProps> = ({
  characters,
  onUpdateCharacters,
  isOpen,
  onClose,
  apiKeys = [],
  selectedModel = GEMINI_MODELS[0],
  onIncrementKeyUsage = () => {},
  onMarkKeyExhausted = () => {},
  onMarkKeyError,
  preloadedRows = [],
  preloadedFileName = '',
  projectName = '',
}) => {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Glossary Import modal state
  const [showGlossaryModal, setShowGlossaryModal] = useState(false);
  // Clear confirm modal state
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);

  // TXT Import modal & ref state
  const txtFileInputRef = useRef<HTMLInputElement>(null);
  const [importModalData, setImportModalData] = useState<{
    chars: CharacterItem[];
    fileName: string;
    mode: 'append' | 'replace';
  } | null>(null);

  // New character form state
  const [newChinese, setNewChinese] = useState('');
  const [newHanViet, setNewHanViet] = useState('');
  const [newGender, setNewGender] = useState('Chưa rõ');
  const [newNote, setNewNote] = useState('');

  // Inline edit state
  const [editingInlineId, setEditingInlineId] = useState<string | null>(null);
  const [editChinese, setEditChinese] = useState('');
  const [editHanViet, setEditHanViet] = useState('');
  const [editGender, setEditGender] = useState('Chưa rõ');
  const [editNote, setEditNote] = useState('');

  // Detail Modal edit state
  const [editingModalChar, setEditingModalChar] = useState<CharacterItem | null>(null);

  // Bulk modal mode
  const [bulkMode, setBulkMode] = useState<'edit_all' | 'append_new'>('append_new');

  // CapCut Homophones Merger modal state
  const [showCapcutMergerModal, setShowCapcutMergerModal] = useState(false);
  // Row selection for batch actions or manual merge
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(new Set());
  // Manual merge modal
  const [manualMergeModalData, setManualMergeModalData] = useState<{
    items: CharacterItem[];
    standardHanViet: string;
    mergedChinese: string;
    gender: string;
    note: string;
  } | null>(null);

  const toggleSelectChar = (id: string) => {
    setSelectedCharIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCharIds(new Set(filteredCharacters.map((c) => c.id)));
    } else {
      setSelectedCharIds(new Set());
    }
  };

  const handleOpenManualMerge = () => {
    const selectedItems = characters.filter((c) => selectedCharIds.has(c.id));
    if (selectedItems.length < 2) return;

    const mergedChinese = mergeChineseVariants(...selectedItems.map((c) => c.chinese));
    const standardHanViet = selectedItems[0].hanViet;
    const gender = selectedItems.find((c) => c.gender && c.gender !== 'Chưa rõ')?.gender || 'Chưa rõ';
    const note = selectedItems.map((c) => c.note).filter(Boolean).join('; ');

    setManualMergeModalData({
      items: selectedItems,
      standardHanViet,
      mergedChinese,
      gender,
      note,
    });
  };

  const handleConfirmManualMerge = () => {
    if (!manualMergeModalData) return;

    const removeIds = new Set(manualMergeModalData.items.map((i) => i.id));
    const remaining = characters.filter((c) => !removeIds.has(c.id));

    const mergedChar: CharacterItem = {
      id: `char-manual-merged-${Date.now()}`,
      stt: remaining.length + 1,
      chinese: manualMergeModalData.mergedChinese,
      hanViet: sanitizeSingleHanViet(manualMergeModalData.standardHanViet),
      gender: manualMergeModalData.gender || 'Chưa rõ',
      note: manualMergeModalData.note.trim(),
    };

    const nextList = [...remaining, mergedChar].map((c, idx) => ({
      ...c,
      stt: idx + 1,
    }));

    onUpdateCharacters(nextList);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify(nextList));
    } catch (e) {}
    setSelectedCharIds(new Set());
    setManualMergeModalData(null);
    showToast(`Đã gộp ${manualMergeModalData.items.length} nhân vật thành "${mergedChar.hanViet}" (${mergedChar.chinese})`);
  };

  // Tìm các dòng bị dính nhiều tên Hán Việt (như: Cơ Vô Thường / Âm Tước Tình)
  const multiNameRows = useMemo(() => {
    return characters.filter((c) => hasMultipleHanViets(c.hanViet));
  }, [characters]);

  // Xử lý tự động tách toàn bộ các dòng bị dính nhiều tên Hán Việt thành các nhân vật riêng biệt
  const handleAutoSplitAllMultiNameRows = () => {
    if (multiNameRows.length === 0) return;

    let splitAddedCount = 0;
    const nextList: CharacterItem[] = [];

    characters.forEach((c) => {
      if (hasMultipleHanViets(c.hanViet)) {
        const separated = splitMultiCharacterRow(c);
        nextList.push(...separated);
        splitAddedCount += (separated.length - 1);
      } else {
        nextList.push({
          ...c,
          hanViet: sanitizeSingleHanViet(c.hanViet),
        });
      }
    });

    const reindexed = nextList.map((c, idx) => ({ ...c, stt: idx + 1 }));
    onUpdateCharacters(reindexed);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify(reindexed));
    } catch (e) {}
    showToast(`Đã tự động tách ${multiNameRows.length} dòng bị gộp chung thành các nhân vật riêng biệt (tạo thêm ${splitAddedCount} dòng mới).`);
  };

  // Tách 1 dòng cụ thể thành các nhân vật riêng biệt
  const handleSplitSingleRow = (char: CharacterItem) => {
    const separated = splitMultiCharacterRow(char);
    if (separated.length <= 1) return;

    const charIdx = characters.findIndex((c) => c.id === char.id);
    if (charIdx === -1) return;

    const nextList = [...characters];
    nextList.splice(charIdx, 1, ...separated);

    const reindexed = nextList.map((c, idx) => ({ ...c, stt: idx + 1 }));
    onUpdateCharacters(reindexed);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify(reindexed));
    } catch (e) {}
    showToast(`Đã tách thành ${separated.length} nhân vật riêng biệt: ${separated.map((s) => s.hanViet).join(', ')}`);
  };

  const filteredCharacters = useMemo(() => {
    if (!search.trim()) return characters;
    const term = search.toLowerCase();
    return characters.filter(
      (c) =>
        c.chinese.toLowerCase().includes(term) ||
        c.hanViet.toLowerCase().includes(term) ||
        c.note.toLowerCase().includes(term)
    );
  }, [characters, search]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHanViet.trim() && !newChinese.trim()) {
      alert('Vui lòng nhập tên tiếng Trung hoặc tên Hán Việt.');
      return;
    }

    const nextStt = characters.length + 1;
    const singleHanViet = sanitizeSingleHanViet(newHanViet);
    const newChar: CharacterItem = {
      id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      stt: nextStt,
      chinese: newChinese.trim(),
      hanViet: singleHanViet,
      gender: newGender.trim() || 'Chưa rõ',
      note: newNote.trim(),
    };

    onUpdateCharacters([...characters, newChar]);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify([...characters, newChar]));
    } catch (e) {}
    setNewChinese('');
    setNewHanViet('');
    setNewGender('Chưa rõ');
    setNewNote('');
    setShowAddForm(false);
    showToast(`Đã thêm nhân vật "${newChar.hanViet || newChar.chinese}"`);
  };

  const handleDeleteCharacter = (id: string) => {
    // When deleting a character, the remaining characters automatically shift up and preserve 1-based sequential order
    const remaining = characters.filter((c) => c.id !== id);
    const reordered = remaining.map((c, idx) => ({
      ...c,
      stt: idx + 1,
    }));
    onUpdateCharacters(reordered);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify(reordered));
    } catch (e) {
      console.error('Error saving updated characters to localStorage', e);
    }
  };

  // 1. "Khôi phục gốc sửa thành bảng trống" (Sử dụng Modal xác nhận giao diện thay vì window.confirm)
  const handleClearToEmpty = () => {
    if (characters.length === 0) {
      showToast('Bảng tên nhân vật hiện tại đã trống rồi.');
      return;
    }
    setShowClearConfirmModal(true);
  };

  const handleConfirmClear = () => {
    onUpdateCharacters([]);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify([]));
    } catch (e) {
      console.error('Failed to save empty characters to localStorage', e);
    }
    setShowClearConfirmModal(false);
    showToast('Đã làm trống toàn bộ Bảng tên nhân vật thành công!');
  };

  // 2. "có chức năng xuất file txt bảng tên nhân vật"
  const handleExportTxt = () => {
    if (characters.length === 0) {
      showToast('Bảng tên nhân vật đang trống. Không có dữ liệu để xuất file TXT.');
      return;
    }

    try {
      const baseName = preloadedFileName
        ? `Bang_Ten_Nhan_Vat_${preloadedFileName.replace(/\.[^/.]+$/, '')}`
        : 'Bang_Ten_Nhan_Vat';
      exportCharactersToTxt(characters, baseName);
      showToast(`Đã xuất thành công file TXT với ${characters.length} nhân vật!`);
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi xuất file TXT');
    }
  };

  // 3. Import bảng tên nhân vật từ file TXT
  const handleTriggerImportTxt = () => {
    if (txtFileInputRef.current) {
      txtFileInputRef.current.value = '';
      txtFileInputRef.current.click();
    }
  };

  const handleImportTxtFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) {
        showToast('File TXT không có nội dung.');
        return;
      }

      const parsed = parseCharactersFromTxt(content);
      if (parsed.length === 0) {
        showToast('Không tìm thấy nhân vật hợp lệ trong file TXT.');
        return;
      }

      setImportModalData({
        chars: parsed,
        fileName: file.name,
        mode: characters.length === 0 ? 'replace' : 'append',
      });
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleConfirmTxtImport = () => {
    if (!importModalData) return;
    const { chars: newChars, mode } = importModalData;

    if (mode === 'replace') {
      const sequential = newChars.map((item, idx) => ({ ...item, stt: idx + 1 }));
      onUpdateCharacters(sequential);
      try {
        localStorage.setItem('truyen_ai_characters', JSON.stringify(sequential));
      } catch (e) {
        console.error('Failed to save to localStorage', e);
      }
      showToast(`Đã nạp mới ${sequential.length} nhân vật từ file TXT!`);
    } else {
      // Append mode with deduplication & smart note enrichment
      const updated = [...characters];
      let addedCount = 0;
      let updatedCount = 0;

      newChars.forEach((incoming) => {
        const normHanViet = incoming.hanViet.toLowerCase().trim();
        const normChinese = incoming.chinese.toLowerCase().trim();
        if (!normHanViet && !normChinese) return;

        const existingIdx = updated.findIndex((item) => {
          const itemHanViet = item.hanViet.toLowerCase().trim();
          const itemChinese = item.chinese.toLowerCase().trim();
          return (
            (normHanViet && itemHanViet === normHanViet) ||
            (normChinese && itemChinese && itemChinese === normChinese)
          );
        });

        if (existingIdx !== -1) {
          const existing = updated[existingIdx];
          let updatedGender = existing.gender;
          if (
            (!existing.gender || existing.gender === 'Chưa rõ' || existing.gender === '-') &&
            incoming.gender &&
            incoming.gender !== 'Chưa rõ'
          ) {
            updatedGender = incoming.gender;
          }

          const existingNote = existing.note ? existing.note.trim() : '';
          const incomingNote = incoming.note ? incoming.note.trim() : '';
          const existingLower = existingNote.toLowerCase();

          const isExistingSparse =
            !existingNote ||
            existingNote.length < 15 ||
            existingLower.includes('chưa rõ') ||
            existingLower.includes('chưa đủ thông tin') ||
            existingLower.includes('mới được nhắc');

          let newNote = existingNote;
          if (isExistingSparse && incomingNote && incomingNote.length > 5) {
            newNote = incomingNote;
            updatedCount++;
          } else if (
            incomingNote &&
            !existingLower.includes(incomingNote.toLowerCase()) &&
            !incomingNote.toLowerCase().includes(existingLower) &&
            existingNote.length + incomingNote.length < 90
          ) {
            newNote = `${existingNote}; ${incomingNote}`;
            updatedCount++;
          }

          updated[existingIdx] = {
            ...existing,
            gender: updatedGender || 'Chưa rõ',
            chinese: existing.chinese || incoming.chinese,
            hanViet: existing.hanViet || incoming.hanViet,
            note: newNote,
          };
        } else {
          updated.push({
            ...incoming,
            stt: updated.length + 1,
          });
          addedCount++;
        }
      });

      onUpdateCharacters(updated);
      try {
        localStorage.setItem('truyen_ai_characters', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save to localStorage', e);
      }
      showToast(
        `Đã nhập file TXT: Thêm mới ${addedCount} nhân vật` +
          (updatedCount > 0 ? `, cập nhật bổ sung ${updatedCount} nhân vật.` : '.')
      );
    }

    setImportModalData(null);
  };

  const handleCopyTable = () => {
    if (characters.length === 0) {
      showToast('Bảng đang trống, không có dữ liệu để sao chép.');
      return;
    }
    const header = 'STT\tTên gốc tiếng Trung\tTên Hán Việt\tGiới tính\tGhi chú/ Thân phận\n';
    const body = characters
      .map((c, i) => `${i + 1}\t${c.chinese}\t${c.hanViet}\t${c.gender || 'Chưa rõ'}\t${c.note}`)
      .join('\n');
    navigator.clipboard.writeText(header + body);
    setCopied(true);
    showToast('Đã sao chép toàn bộ bảng vào bộ nhớ tạm');
    setTimeout(() => setCopied(false), 2000);
  };

  // Inline editing handlers
  const handleStartInlineEdit = (char: CharacterItem) => {
    setEditingInlineId(char.id);
    setEditChinese(char.chinese || '');
    setEditHanViet(char.hanViet || '');
    setEditGender(char.gender || 'Chưa rõ');
    setEditNote(char.note || '');
  };

  const handleCancelInlineEdit = () => {
    setEditingInlineId(null);
  };

  const handleSaveInlineEdit = (id: string) => {
    if (!editHanViet.trim() && !editChinese.trim()) {
      showToast('Vui lòng nhập tên tiếng Trung hoặc tên Hán Việt.');
      return;
    }

    const singleHanViet = sanitizeSingleHanViet(editHanViet);
    const updated = characters.map((c) => {
      if (c.id === id) {
        return {
          ...c,
          chinese: editChinese.trim(),
          hanViet: singleHanViet,
          gender: editGender.trim() || 'Chưa rõ',
          note: editNote.trim(),
        };
      }
      return c;
    });

    onUpdateCharacters(updated);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving updated characters to localStorage', e);
    }
    setEditingInlineId(null);
    showToast(`Đã cập nhật nhân vật "${singleHanViet || editChinese.trim()}"`);
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveInlineEdit(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelInlineEdit();
    }
  };

  // Modal editing handlers
  const handleOpenEditModal = (char: CharacterItem) => {
    setEditingModalChar(char);
    setEditChinese(char.chinese || '');
    setEditHanViet(char.hanViet || '');
    setEditGender(char.gender || 'Chưa rõ');
    setEditNote(char.note || '');
  };

  const handleCloseEditModal = () => {
    setEditingModalChar(null);
  };

  const handleSaveModalEdit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingModalChar) return;
    if (!editHanViet.trim() && !editChinese.trim()) {
      showToast('Vui lòng nhập tên tiếng Trung hoặc tên Hán Việt.');
      return;
    }

    const singleHanViet = sanitizeSingleHanViet(editHanViet);
    const updated = characters.map((c) => {
      if (c.id === editingModalChar.id) {
        return {
          ...c,
          chinese: editChinese.trim(),
          hanViet: singleHanViet,
          gender: editGender.trim() || 'Chưa rõ',
          note: editNote.trim(),
        };
      }
      return c;
    });

    onUpdateCharacters(updated);
    try {
      localStorage.setItem('truyen_ai_characters', JSON.stringify(updated));
    } catch (err) {
      console.error('Error saving updated characters to localStorage', err);
    }
    setEditingModalChar(null);
    showToast(`Đã lưu thay đổi nhân vật "${editHanViet.trim() || editChinese.trim()}"`);
  };

  // Bulk Edit / Append handlers
  const handleOpenBulkEdit = () => {
    const textLines = characters
      .map((c, i) => `${i + 1}\t${c.chinese}\t${c.hanViet}\t${c.gender || 'Chưa rõ'}\t${c.note || ''}`)
      .join('\n');
    setBulkInput(textLines);
    setBulkMode('edit_all');
    setShowBulkModal(true);
  };

  const handleOpenBulkAppend = () => {
    setBulkInput('');
    setBulkMode('append_new');
    setShowBulkModal(true);
  };

  const handleSaveBulk = () => {
    const lines = bulkInput.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      if (bulkMode === 'edit_all') {
        onUpdateCharacters([]);
        setShowBulkModal(false);
        setBulkInput('');
        showToast('Đã làm trống bảng nhân vật.');
        return;
      }
      showToast('Nội dung nhập đang trống.');
      return;
    }

    const parsed: CharacterItem[] = [];
    lines.forEach((line, index) => {
      const parts = line.includes('\t')
        ? line.split('\t')
        : line.split(/\s{2,}/);

      if (parts.length >= 2) {
        let chinese = parts[0].trim();
        let hanViet = parts[1]?.trim() || '';
        let gender = 'Chưa rõ';
        let note = parts[2]?.trim() || '';
        let stt = index + 1;

        if (/^\d+$/.test(chinese) && parts.length >= 3) {
          stt = parseInt(chinese, 10) || index + 1;
          chinese = parts[1].trim();
          hanViet = parts[2].trim();
          if (parts.length >= 5) {
            gender = parts[3].trim() || 'Chưa rõ';
            note = parts.slice(4).join(' ').trim();
          } else {
            // Check if parts[3] is gender
            const p3 = parts[3]?.trim() || '';
            if (['Nam', 'Nữ', 'Chưa rõ', 'Linh thú', 'Ma vật', 'Khác'].includes(p3)) {
              gender = p3;
              note = '';
            } else {
              note = p3;
            }
          }
        }

        if (hasMultipleHanViets(hanViet)) {
          const splitItems = splitMultiCharacterRow({
            id: `char-bulk-${index}-${Date.now()}`,
            stt: index + 1,
            chinese,
            hanViet,
            gender,
            note,
          });
          parsed.push(...splitItems);
        } else {
          parsed.push({
            id: `char-bulk-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            stt: index + 1,
            chinese,
            hanViet: sanitizeSingleHanViet(hanViet),
            gender,
            note,
          });
        }
      }
    });

    if (parsed.length > 0) {
      if (bulkMode === 'edit_all') {
        const sequential = parsed.map((item, i) => ({ ...item, stt: i + 1 }));
        onUpdateCharacters(sequential);
        try {
          localStorage.setItem('truyen_ai_characters', JSON.stringify(sequential));
        } catch (e) {}
        showToast(`Đã cập nhật toàn bộ bảng thành công (${sequential.length} nhân vật).`);
      } else {
        const merged = [...characters, ...parsed].map((item, i) => ({ ...item, stt: i + 1 }));
        onUpdateCharacters(merged);
        try {
          localStorage.setItem('truyen_ai_characters', JSON.stringify(merged));
        } catch (e) {}
        showToast(`Đã thêm ${parsed.length} nhân vật mới vào bảng.`);
      }
      setShowBulkModal(false);
      setBulkInput('');
    } else {
      showToast('Không nhận diện được định dạng dòng hợp lệ (cần phân tách bằng tab hoặc 2 dấu cách).');
    }
  };

  // Handle Glossary items apply (Characters, Terms, Locations, Surnames, Titles)
  const handleApplyGlossary = (newChars: CharacterItem[], mode: 'replace' | 'append') => {
    // Ensure all multi-character rows are cleanly separated
    const sanitizedChars: CharacterItem[] = [];
    newChars.forEach((nc) => {
      if (hasMultipleHanViets(nc.hanViet)) {
        sanitizedChars.push(...splitMultiCharacterRow(nc));
      } else {
        sanitizedChars.push({
          ...nc,
          hanViet: sanitizeSingleHanViet(nc.hanViet),
        });
      }
    });

    if (mode === 'replace') {
      const sequential = sanitizedChars.map((item, i) => ({ ...item, stt: i + 1 }));
      onUpdateCharacters(sequential);
      try {
        localStorage.setItem('truyen_ai_characters', JSON.stringify(sequential));
      } catch (e) {}
      showToast(`Đã thiết lập bảng với ${sequential.length} mục từ file Glossary.`);
    } else {
      const updated = [...characters];
      let addedCount = 0;
      let updatedCount = 0;

      sanitizedChars.forEach((incoming) => {
        const normHanViet = incoming.hanViet.toLowerCase().trim();
        const normChinese = incoming.chinese.toLowerCase().trim();
        if (!normHanViet && !normChinese) return;

        const existingIdx = updated.findIndex((item) => {
          const itemHanViet = item.hanViet.toLowerCase().trim();
          const itemChinese = item.chinese.toLowerCase().trim();
          return (
            (normChinese && itemChinese && itemChinese === normChinese) ||
            (normHanViet && itemHanViet === normHanViet)
          );
        });

        if (existingIdx !== -1) {
          const existing = updated[existingIdx];
          let updatedGender = existing.gender;
          if (
            (!existing.gender || existing.gender === 'Chưa rõ' || existing.gender === '-') &&
            incoming.gender &&
            incoming.gender !== 'Chưa rõ'
          ) {
            updatedGender = incoming.gender;
          }

          let newNote = existing.note ? existing.note.trim() : '';
          const incomingNote = incoming.note ? incoming.note.trim() : '';
          if (incomingNote && (!newNote || newNote.length < incomingNote.length)) {
            newNote = incomingNote;
            updatedCount++;
          }

          updated[existingIdx] = {
            ...existing,
            gender: updatedGender || 'Chưa rõ',
            chinese: existing.chinese || incoming.chinese,
            hanViet: existing.hanViet || incoming.hanViet,
            note: newNote,
          };
        } else {
          updated.push({
            ...incoming,
            id: `char-glossary-${Date.now()}-${updated.length + 1}-${Math.random().toString(36).substring(2, 5)}`,
            stt: updated.length + 1,
          });
          addedCount++;
        }
      });

      const sequential = updated.map((item, i) => ({ ...item, stt: i + 1 }));
      onUpdateCharacters(sequential);
      try {
        localStorage.setItem('truyen_ai_characters', JSON.stringify(sequential));
      } catch (e) {}
      showToast(
        `Đã gộp Glossary: thêm ${addedCount} mục mới` +
          (updatedCount > 0 ? ` và cập nhật thông tin ${updatedCount} mục.` : '.')
      );
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
            <div className="flex items-center gap-3">
              <span className="p-2 bg-indigo-500/20 border border-indigo-400/30 rounded-xl">
                <Users className="w-5 h-5 text-indigo-400" />
              </span>
              <div>
                <h2 className="text-base font-bold flex flex-wrap items-center gap-2">
                  <span>Kho Dữ Liệu Bảng Tên Nhân Vật</span>
                  {projectName && (
                    <span className="px-2 py-0.5 bg-emerald-500/30 border border-emerald-400/40 rounded-md text-xs font-semibold text-emerald-200 truncate max-w-xs">
                      Truyện: {projectName}
                    </span>
                  )}
                  <span className="px-2 py-0.5 bg-indigo-500/30 border border-indigo-400/30 rounded-full text-xs font-semibold text-indigo-200">
                    {characters.length} nhân vật
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Bảng tên chuẩn xác (Tên gốc tiếng Trung → Tên Hán Việt → Thân phận) hỗ trợ AI dịch & xưng hô đồng nhất
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 text-lg font-bold"
            >
              ✕
            </button>
          </div>

          {/* Toast Notice */}
          {toastMessage && (
            <div className="bg-indigo-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between animate-in fade-in slide-in-from-top-1">
              <span>{toastMessage}</span>
              <button onClick={() => setToastMessage(null)} className="text-white/70 hover:text-white">
                ✕
              </button>
            </div>
          )}

          {/* Hidden File Input for TXT Import */}
          <input
            ref={txtFileInputRef}
            type="file"
            accept=".txt"
            onChange={handleImportTxtFile}
            className="hidden"
          />

          {/* Toolbar */}
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm kiếm nhân vật, Hán Việt, ghi chú..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 1. Import Glossary from file or text */}
              <button
                onClick={() => setShowGlossaryModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer"
                title="Nhập bảng tên nhân vật, thuật ngữ, địa danh, tước vị từ file Glossary"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Nhập file Glossary</span>
              </button>

              {/* Gom biến thể CapCut (AI) */}
              <button
                onClick={() => setShowCapcutMergerModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition-all"
                title="Dựa vào phiên âm Pinyin và ngữ cảnh file SRT, gom các chữ Hán bị CapCut nghe nhầm thành 1 dòng duy nhất"
              >
                <Layers className="w-3.5 h-3.5 text-amber-300" />
                <span>Gom biến thể CapCut (AI)</span>
              </button>

              {/* 2. Export TXT */}
              <button
                onClick={handleExportTxt}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold transition-colors"
                title="Xuất bảng tên nhân vật ra file .txt để lưu trữ hoặc xem trong Notepad"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                <span>Xuất file TXT</span>
              </button>

              {/* 3. Import TXT */}
              <button
                onClick={handleTriggerImportTxt}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 border border-sky-300 hover:bg-sky-100 text-sky-800 rounded-lg text-xs font-semibold transition-colors"
                title="Nhập bảng tên nhân vật từ file .txt đã xuất ra trước đó"
              >
                <Upload className="w-3.5 h-3.5 text-sky-600" />
                <span>Nhập file TXT</span>
              </button>

              {/* 4. Add Single Character */}
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5 text-slate-500" />
                <span>Thêm nhân vật</span>
              </button>

              {/* 5. Edit as Raw Text (Bulk) */}
              <button
                onClick={handleOpenBulkEdit}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition-colors"
                title="Chỉnh sửa toàn bộ bảng nhân vật dạng văn bản (sửa nhanh, tìm kiếm & thay thế hàng loạt)"
              >
                <Pencil className="w-3.5 h-3.5 text-indigo-600" />
                <span>Sửa dạng văn bản</span>
              </button>

              {/* 6. Bulk Paste */}
              <button
                onClick={handleOpenBulkAppend}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                title="Dán thêm danh sách nhân vật mới từ clipboard"
              >
                <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
                <span>Dán thêm hàng loạt</span>
              </button>

              {/* 7. Copy Table */}
              <button
                onClick={handleCopyTable}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                title="Sao chép toàn bộ bảng vào bộ nhớ tạm"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
              </button>

              {/* 8. Clear Table (Replaced 'Khôi phục gốc') */}
              <button
                onClick={handleClearToEmpty}
                className="flex items-center gap-1 px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-medium transition-colors"
                title="Xóa toàn bộ nhân vật để bắt đầu với một bảng trống"
              >
                <Eraser className="w-3.5 h-3.5 text-rose-600" />
                <span>Bảng trống</span>
              </button>
            </div>
          </div>

          {/* Optimization & Status Banner */}
          <div className="px-4 py-2 bg-gradient-to-r from-indigo-50 via-blue-50 to-indigo-50 border-b border-indigo-100 flex flex-wrap items-center justify-between text-xs text-indigo-900 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
              <span>
                <strong>Cơ chế lọc nhân vật tự động:</strong> Khi dịch từng đoạn, hệ thống <strong>chỉ trích xuất các nhân vật thực sự có tên trong đoạn đó</strong> để tối ưu token.
              </span>
            </div>
            <div className="text-[11px] text-indigo-700 font-medium flex items-center gap-1.5">
              <span>💡 <em>Nhấn ✏️ hoặc nhấp đúp vào dòng để sửa. Nhấn Enter để lưu, Esc để hủy.</em></span>
            </div>
          </div>

          {/* Add Form Inline */}
          {showAddForm && (
            <form onSubmit={handleAddCharacter} className="p-3 bg-indigo-50/50 border-b border-indigo-100 flex flex-wrap gap-2 items-end">
              <div className="w-36">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Tên tiếng Trung</label>
                <input
                  type="text"
                  placeholder="VD: 常青"
                  value={newChinese}
                  onChange={(e) => setNewChinese(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none"
                />
              </div>
              <div className="w-48">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Tên Hán Việt (*)</label>
                <input
                  type="text"
                  placeholder="VD: Thường Thanh"
                  value={newHanViet}
                  onChange={(e) => setNewHanViet(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none font-bold text-indigo-700"
                />
              </div>
              <div className="w-28">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Giới tính</label>
                <select
                  value={newGender}
                  onChange={(e) => setNewGender(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none font-medium"
                >
                  <option value="Chưa rõ">Chưa rõ</option>
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                  <option value="Linh thú">Linh thú</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Ghi chú / Thân phận</label>
                <input
                  type="text"
                  placeholder="VD: Nam chính, người xuyên không; Sư phụ của Tô Niệm Tuyết; Gia chủ Tô gia..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs"
                >
                  Hủy
                </button>
              </div>
            </form>
          )}

          {/* Selection Banner for Manual Merge */}
          {selectedCharIds.size >= 2 && (
            <div className="mx-3 my-2 p-2.5 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 text-white rounded-xl flex items-center justify-between text-xs animate-in slide-in-from-top-1 shadow-md">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-300" />
                <span className="font-semibold">
                  Đang chọn <strong>{selectedCharIds.size}</strong> nhân vật để gom biến thể
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenManualMerge}
                  className="flex items-center gap-1.5 px-3 py-1 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-lg font-bold shadow-xs transition-colors"
                  title="Gộp các nhân vật đã chọn thành 1 dòng, gom các chữ Hán vào cùng 1 dòng"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Gộp thành 1 dòng (Gom biến thể)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCharIds(new Set())}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
          )}

          {/* Warning Banner for Multi-Name Rows (e.g. "Cơ Vô Thường / Âm Tước Tình") */}
          {multiNameRows.length > 0 && (
            <div className="mx-3 my-2 p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-xs text-amber-900 shadow-xs animate-in slide-in-from-top-1">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="font-bold text-amber-900">
                    Phát hiện {multiNameRows.length} dòng đang bị gộp chung nhiều tên Hán Việt (Ví dụ: "{multiNameRows[0]?.hanViet}")
                  </p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Tên Hán Việt chuẩn chỉ nên có 1 tên duy nhất cho mỗi nhân vật. Nếu là các người khác nhau thì nên tách ra thành các dòng riêng biệt để tránh dùng chung.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAutoSplitAllMultiNameRows}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold shadow-xs transition-colors shrink-0"
                title="Tự động phân tách các nhân vật bị gom chung tên thành các dòng riêng biệt"
              >
                <Split className="w-3.5 h-3.5" />
                <span>Tách thành các dòng riêng ({multiNameRows.length})</span>
              </button>
            </div>
          )}

          {/* Character Table Content */}
          <div className="flex-1 overflow-y-auto p-2">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0 z-10 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-2.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedCharIds.size === filteredCharacters.length && filteredCharacters.length > 0}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      title="Chọn tất cả để gộp"
                    />
                  </th>
                  <th className="py-2.5 px-2 w-10 text-center">STT</th>
                  <th className="py-2.5 px-3 w-40">Tên gốc & Biến thể CapCut</th>
                  <th className="py-2.5 px-3 w-48">Tên Hán Việt chuẩn</th>
                  <th className="py-2.5 px-2.5 w-24 text-center">Giới tính</th>
                  <th className="py-2.5 px-3">Ghi chú / Thân phận</th>
                  <th className="py-2.5 px-3 w-28 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {characters.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center">
                      <div className="max-w-md mx-auto space-y-3 text-slate-500">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-indigo-500 shadow-xs">
                          <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-800 text-sm">Bảng tên nhân vật & Glossary đang trống</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Dự án mới bắt đầu với bảng trống theo mặc định. Bạn có thể tải lên file Glossary riêng, nhập từ file TXT, hoặc thêm thủ công từng nhân vật:
                          </p>
                        </div>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                          <button
                            onClick={() => setShowGlossaryModal(true)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer"
                          >
                            <BookOpen className="w-4 h-4" />
                            <span>Nhập file Glossary</span>
                          </button>
                          <button
                            onClick={handleTriggerImportTxt}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-50 border border-sky-300 hover:bg-sky-100 text-sky-800 rounded-xl text-xs font-semibold cursor-pointer"
                          >
                            <Upload className="w-3.5 h-3.5 text-sky-600" />
                            <span>Nhập file TXT</span>
                          </button>
                          <button
                            onClick={() => setShowAddForm(true)}
                            className="flex items-center gap-1 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> Thêm thủ công
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : filteredCharacters.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Không tìm thấy nhân vật nào phù hợp với từ khóa "{search}".
                    </td>
                  </tr>
                ) : (
                  filteredCharacters.map((c, idx) => {
                    const isInlineEditing = editingInlineId === c.id;

                    if (isInlineEditing) {
                      return (
                        <tr key={c.id} className="bg-indigo-50/90 border-y-2 border-indigo-400 ring-2 ring-indigo-200/50 transition-all">
                          <td className="py-2 px-2 text-center text-slate-300">
                            -
                          </td>
                          <td className="py-2 px-2 text-center text-indigo-700 font-mono font-bold text-xs">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={editChinese}
                              onChange={(e) => setEditChinese(e.target.value)}
                              onKeyDown={(e) => handleInlineKeyDown(e, c.id)}
                              placeholder="VD: 常青 hoặc 常青 / 长青"
                              className="w-full text-xs px-2 py-1 bg-white border border-indigo-300 rounded font-mono outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={editHanViet}
                              onChange={(e) => setEditHanViet(e.target.value)}
                              onKeyDown={(e) => handleInlineKeyDown(e, c.id)}
                              placeholder="Tên Hán Việt (*)"
                              autoFocus
                              className="w-full text-xs px-2 py-1 bg-white border border-indigo-300 rounded font-bold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="py-2 px-1 text-center">
                            <select
                              value={editGender}
                              onChange={(e) => setEditGender(e.target.value)}
                              className="w-full text-xs px-1.5 py-1 bg-white border border-indigo-300 rounded font-medium outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="Chưa rõ">Chưa rõ</option>
                              <option value="Nam">Nam</option>
                              <option value="Nữ">Nữ</option>
                              <option value="Linh thú">Linh thú</option>
                              <option value="Khác">Khác</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              onKeyDown={(e) => handleInlineKeyDown(e, c.id)}
                              placeholder="Ghi chú / Thân phận"
                              className="w-full text-xs px-2 py-1 bg-white border border-indigo-300 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSaveInlineEdit(c.id)}
                                className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-xs transition-colors"
                                title="Lưu thay đổi (Enter)"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelInlineEdit}
                                className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md transition-colors"
                                title="Hủy bỏ (Esc)"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleCancelInlineEdit();
                                  handleOpenEditModal(c);
                                }}
                                className="p-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-md transition-colors"
                                title="Mở hộp thoại chỉnh sửa chi tiết"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const variants = extractChineseVariants(c.chinese);
                    const isSelected = selectedCharIds.has(c.id);

                    return (
                      <tr
                        key={c.id}
                        onDoubleClick={() => handleStartInlineEdit(c)}
                        className={`transition-colors group cursor-pointer ${
                          isSelected ? 'bg-indigo-50/80 font-medium' : 'hover:bg-indigo-50/40'
                        }`}
                        title="Nhấp đúp chuột để chỉnh sửa nhanh nhân vật này"
                      >
                        <td className="py-2 px-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectChar(c.id)}
                            className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-2 text-center text-slate-400 font-mono font-medium">{idx + 1}</td>
                        <td className="py-2 px-3 font-semibold text-slate-800 font-mono">
                          {variants.length <= 1 ? (
                            <span>{c.chinese || '-'}</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-slate-900">{variants[0]}</span>
                              {variants.slice(1).map((v, vIdx) => (
                                <span
                                  key={vIdx}
                                  className="px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 text-[10px] rounded-md font-mono"
                                  title={`Biến thể CapCut nghe nhầm: ${v}`}
                                >
                                  {v}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 font-bold text-indigo-700">
                          <div>{c.hanViet}</div>
                          {hasMultipleHanViets(c.hanViet) && (
                            <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <span className="text-[10px] text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                Nhiều người
                              </span>
                              <button
                                type="button"
                                onClick={() => handleSplitSingleRow(c)}
                                className="text-[10px] text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded font-bold transition-colors flex items-center gap-1"
                                title="Tách ngay dòng này thành các nhân vật riêng biệt (1 người / dòng)"
                              >
                                <Split className="w-3 h-3 text-indigo-600" />
                                Tách dòng
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-full border ${
                            c.gender === 'Nam' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                            c.gender === 'Nữ' ? 'bg-pink-50 text-pink-700 border-pink-200' :
                            c.gender === 'Linh thú' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-slate-50 text-slate-600 border-slate-200'
                          }`}>
                            {c.gender || 'Chưa rõ'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600 leading-relaxed max-w-sm break-words">{c.note || '-'}</td>
                        <td className="py-2 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {hasMultipleHanViets(c.hanViet) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSplitSingleRow(c);
                                }}
                                className="text-amber-600 hover:text-amber-800 p-1 hover:bg-amber-100 rounded transition-colors"
                                title="Tách thành các nhân vật riêng biệt (1 người / dòng)"
                              >
                                <Split className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartInlineEdit(c);
                              }}
                              className="text-slate-400 hover:text-indigo-600 p-1 hover:bg-indigo-50 rounded transition-colors"
                              title="Chỉnh sửa nhân vật này (hoặc nhấp đúp dòng)"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCharacter(c.id);
                              }}
                              className="text-slate-300 hover:text-red-600 p-1 hover:bg-red-50 rounded transition-colors"
                              title="Xóa nhân vật này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-slate-200 flex items-center justify-between bg-slate-50 text-xs">
            <span className="text-slate-500">
              {characters.length > 0 ? (
                <>
                  Hiển thị <strong>{filteredCharacters.length}</strong> / <strong>{characters.length}</strong> nhân vật
                </>
              ) : (
                <>Bảng trống (0 nhân vật)</>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTriggerImportTxt}
                className="flex items-center gap-1 px-3 py-1.5 bg-sky-50 border border-sky-300 hover:bg-sky-100 text-sky-800 rounded-lg text-xs font-semibold transition-colors"
                title="Nhập bảng tên nhân vật từ file TXT"
              >
                <Upload className="w-3.5 h-3.5 text-sky-600" />
                <span>Nhập TXT</span>
              </button>
              <button
                onClick={handleExportTxt}
                disabled={characters.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Xuất TXT</span>
              </button>
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>

        {/* Clear Table Confirmation Dialog */}
        {showClearConfirmModal && (
          <div className="fixed inset-0 bg-slate-950/70 z-70 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-slate-100">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="p-3 bg-rose-100/80 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-rose-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Xác nhận làm trống bảng</h3>
                  <p className="text-xs text-slate-500">Thao tác này sẽ xóa sạch danh sách hiện tại</p>
                </div>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-900 space-y-1.5">
                <p className="font-semibold">
                  Bạn có chắc chắn muốn xóa toàn bộ <span className="text-rose-700 underline font-bold">{characters.length} nhân vật</span> trong bảng?
                </p>
                <p className="text-rose-700/80">
                  Bảng sẽ trở về trạng thái trống hoàn toàn để bạn bắt đầu bộ truyện mới hoặc quét nhân vật mới từ file Excel.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowClearConfirmModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmClear}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Eraser className="w-4 h-4" />
                  Xác nhận làm trống
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dedicated Edit Character Modal */}
        {editingModalChar && (
          <div className="fixed inset-0 bg-slate-950/70 z-70 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-4 border border-slate-100">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-100 rounded-xl text-indigo-700">
                    <Pencil className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">
                        Chỉnh sửa thông tin nhân vật
                      </h3>
                      {(() => {
                        const charIndex = characters.findIndex((x) => x.id === editingModalChar.id);
                        if (charIndex >= 0) {
                          return (
                            <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md">
                              STT #{charIndex + 1}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <p className="text-xs text-slate-500">
                      Cập nhật tên gốc, tên Hán Việt chuẩn xác và thân phận
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseEditModal}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveModalEdit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Tên gốc tiếng Trung
                    </label>
                    <input
                      type="text"
                      value={editChinese}
                      onChange={(e) => setEditChinese(e.target.value)}
                      placeholder="VD: 常青"
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none font-mono focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Tên Hán Việt (*)
                    </label>
                    <input
                      type="text"
                      value={editHanViet}
                      onChange={(e) => setEditHanViet(e.target.value)}
                      placeholder="VD: Thường Thanh"
                      autoFocus
                      required
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none font-bold text-indigo-700 focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Giới tính
                    </label>
                    <select
                      value={editGender}
                      onChange={(e) => setEditGender(e.target.value)}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none font-medium focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="Chưa rõ">Chưa rõ</option>
                      <option value="Nam">Nam</option>
                      <option value="Nữ">Nữ</option>
                      <option value="Linh thú">Linh thú</option>
                      <option value="Khác">Khác</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">
                      Ghi chú / Thân phận
                    </label>
                    <span className="text-[11px] text-slate-400">
                      {editNote.length} ký tự
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    placeholder="VD: Nam chính, người xuyên không; Sư phụ của Tô Niệm Tuyết; Tông chủ Kiếm Các..."
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 leading-relaxed"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    💡 <em>Ghi chú ngắn gọn, súc tích (10-25 từ) về thân phận, vai vế và mối quan hệ để AI hiểu rõ vai vế và duy trì sự nhất quán văn phong, tên gọi xuyên suốt tác phẩm.</em>
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteCharacter(editingModalChar.id);
                      handleCloseEditModal();
                      showToast(`Đã xóa nhân vật "${editingModalChar.hanViet || editingModalChar.chinese}"`);
                    }}
                    className="flex items-center gap-1 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa nhân vật</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCloseEditModal}
                      className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-medium"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Lưu thay đổi</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TXT Import Confirmation Dialog */}
        {importModalData && (
          <div className="fixed inset-0 bg-slate-950/70 z-70 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-5 space-y-4 border border-slate-100 flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-sky-100 rounded-xl text-sky-700">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Nhập bảng tên nhân vật từ file TXT
                    </h3>
                    <p className="text-xs text-slate-500">
                      Tệp tin: <span className="font-semibold text-sky-700">{importModalData.fileName}</span> (Phát hiện{' '}
                      <strong>{importModalData.chars.length}</strong> nhân vật)
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setImportModalData(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">
                  Chọn phương thức nạp vào bảng:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setImportModalData({ ...importModalData, mode: 'append' })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      importModalData.mode === 'append'
                        ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-indigo-900 mb-1">
                      <Plus className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Bổ sung vào bảng hiện có</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Giữ nguyên {characters.length} nhân vật cũ. Trùng tên sẽ bỏ qua, nếu nhân vật cũ chưa đủ thông tin thì tự động cập nhật bổ sung.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportModalData({ ...importModalData, mode: 'replace' })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      importModalData.mode === 'replace'
                        ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-indigo-900 mb-1">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Thay thế toàn bộ bảng</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Xóa toàn bộ {characters.length} nhân vật cũ và dùng danh sách {importModalData.chars.length} nhân vật mới từ file TXT.
                    </p>
                  </button>
                </div>
              </div>

              {/* Preview List */}
              <div className="flex-1 overflow-y-auto max-h-48 border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-1.5 px-2.5 w-10 text-center">STT</th>
                      <th className="py-1.5 px-2.5 w-28">Tên gốc</th>
                      <th className="py-1.5 px-2.5 w-32">Tên Hán Việt</th>
                      <th className="py-1.5 px-2 w-20 text-center">Giới tính</th>
                      <th className="py-1.5 px-2.5">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importModalData.chars.slice(0, 10).map((c, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="py-1 px-2.5 text-center text-slate-400 font-mono">{i + 1}</td>
                        <td className="py-1 px-2.5 font-mono text-slate-700">{c.chinese || '-'}</td>
                        <td className="py-1 px-2.5 font-bold text-indigo-700">{c.hanViet}</td>
                        <td className="py-1 px-2 text-center text-slate-500">{c.gender || 'Chưa rõ'}</td>
                        <td className="py-1 px-2.5 text-slate-600 truncate max-w-[150px]">{c.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importModalData.chars.length > 10 && (
                  <p className="p-2 text-center text-[11px] text-slate-400 bg-slate-50 border-t border-slate-100">
                    ...và {importModalData.chars.length - 10} nhân vật khác
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-xs text-slate-500">
                  Tổng: <strong>{importModalData.chars.length}</strong> nhân vật từ file TXT
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setImportModalData(null)}
                    className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-medium"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmTxtImport}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Xác nhận nạp dữ liệu</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Import / Edit Modal */}
        {showBulkModal && (
          <div className="fixed inset-0 bg-slate-950/60 z-60 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-5 space-y-3.5 border border-slate-100">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    {bulkMode === 'edit_all' ? <Pencil className="w-4 h-4" /> : <UploadCloud className="w-4 h-4" />}
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      {bulkMode === 'edit_all' ? 'Chỉnh sửa toàn bộ danh sách (Dạng văn bản)' : 'Dán thêm nhân vật mới'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {bulkMode === 'edit_all'
                        ? 'Chỉnh sửa trực tiếp, tìm kiếm thay thế hoặc thêm bớt các dòng'
                        : 'Dán danh sách nhân vật mới từ clipboard để bổ sung vào bảng'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowBulkModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mode switch pills */}
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setBulkMode('edit_all');
                    const textLines = characters
                      .map((c, i) => `${c.stt || i + 1}\t${c.chinese}\t${c.hanViet}\t${c.note || ''}`)
                      .join('\n');
                    setBulkInput(textLines);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-semibold transition-all ${
                    bulkMode === 'edit_all'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sửa toàn bộ bảng ({characters.length} nhân vật)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkMode('append_new');
                    setBulkInput('');
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-semibold transition-all ${
                    bulkMode === 'append_new'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Dán thêm nhân vật mới
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Mỗi dòng một nhân vật, phân tách bằng tab hoặc nhiều dấu cách: <br />
                <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded text-indigo-700">
                  [STT] &lt;tab&gt; [Tên Trung] &lt;tab&gt; [Tên Hán Việt] &lt;tab&gt; [Ghi chú]
                </code>
              </p>

              <textarea
                rows={9}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={`1\t常青\tThường Thanh\tNam chính\n2\t蘇念雪\tTô Niệm Tuyết\tNữ chính`}
                className="w-full font-mono text-xs p-3 border border-slate-300 rounded-xl outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
              />

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-400">
                  {bulkInput.split('\n').filter((l) => l.trim()).length} dòng dữ liệu
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowBulkModal(false)}
                    className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-medium"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleSaveBulk}
                    className="px-4 py-1.5 text-xs bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-xs flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{bulkMode === 'edit_all' ? 'Lưu cập nhật toàn bộ bảng' : 'Thêm vào bảng'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Import Glossary Modal */}
      {showGlossaryModal && (
        <ImportGlossaryModal
          isOpen={showGlossaryModal}
          onClose={() => setShowGlossaryModal(false)}
          onApplyGlossary={handleApplyGlossary}
          existingCount={characters.length}
        />
      )}

      {/* CapCut Homophones Merger Modal */}
      {showCapcutMergerModal && (
        <CapcutVariantMergerModal
          isOpen={showCapcutMergerModal}
          onClose={() => setShowCapcutMergerModal(false)}
          characters={characters}
          onApplyMergedCharacters={(updated) => {
            onUpdateCharacters(updated);
            showToast('Đã áp dụng gom nhóm biến thể CapCut vào bảng nhân vật thành công!');
          }}
          preloadedRows={preloadedRows}
          apiKeys={apiKeys}
          selectedModel={selectedModel}
          onIncrementKeyUsage={onIncrementKeyUsage}
          onMarkKeyExhausted={onMarkKeyExhausted}
          onMarkKeyError={onMarkKeyError}
        />
      )}

      {/* Manual Merge Modal */}
      {manualMergeModalData && (
        <div className="fixed inset-0 bg-slate-950/60 z-60 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-4 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Layers className="w-5 h-5 text-indigo-600" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Gộp {manualMergeModalData.items.length} nhân vật thành 1 dòng (Gom biến thể)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Gom các chữ Hán bị CapCut nghe nhầm thành 1 dòng để Glossary dịch đồng nhất
                  </p>
                </div>
              </div>
              <button
                onClick={() => setManualMergeModalData(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Chọn Tên Hán Việt chuẩn (*):
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {manualMergeModalData.items.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setManualMergeModalData((prev) =>
                          prev ? { ...prev, standardHanViet: item.hanViet } : null
                        )
                      }
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                        manualMergeModalData.standardHanViet === item.hanViet
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {item.hanViet}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={manualMergeModalData.standardHanViet}
                  onChange={(e) =>
                    setManualMergeModalData((prev) =>
                      prev ? { ...prev, standardHanViet: e.target.value } : null
                    )
                  }
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold text-indigo-700 outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="Hoặc tự nhập tên Hán Việt chuẩn"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Tất cả chữ Hán & Biến thể CapCut nghe nhầm (cách nhau bởi /):
                </label>
                <input
                  type="text"
                  value={manualMergeModalData.mergedChinese}
                  onChange={(e) =>
                    setManualMergeModalData((prev) =>
                      prev ? { ...prev, mergedChinese: e.target.value } : null
                    )
                  }
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono text-slate-800 outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                  placeholder="VD: 常青 / 长青 / 尝青"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Giới tính:</label>
                  <select
                    value={manualMergeModalData.gender}
                    onChange={(e) =>
                      setManualMergeModalData((prev) =>
                        prev ? { ...prev, gender: e.target.value } : null
                      )
                    }
                    className="w-full text-xs px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none"
                  >
                    <option value="Chưa rõ">Chưa rõ</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Linh thú">Linh thú</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="font-semibold text-slate-700 block mb-1">Thân phận sau khi gộp:</label>
                  <input
                    type="text"
                    value={manualMergeModalData.note}
                    onChange={(e) =>
                      setManualMergeModalData((prev) =>
                        prev ? { ...prev, note: e.target.value } : null
                      )
                    }
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none"
                    placeholder="VD: Nam chính, người xuyên không"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setManualMergeModalData(null)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-medium"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmManualMerge}
                disabled={!manualMergeModalData.standardHanViet.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Xác nhận gộp dòng</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
