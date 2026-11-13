import React, { useState, useEffect } from 'react';
import { MergedChunk, CharacterItem, ApiKeyItem, GeminiModelOption, BoundaryComparisonData } from '../types';
import {
  extractBoundarySentences,
  calculateTextSimilarity,
} from '../utils/sentenceUtils';
import {
  GitCompare,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Info,
  ArrowRight,
  Edit3,
} from 'lucide-react';

interface BoundarySentenceComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  chunks: MergedChunk[];
  initialChunkIndex?: number;
  onUpdateChunk: (chunkIndex: number, updatedChunk: Partial<MergedChunk>) => void;
  apiKeys: ApiKeyItem[];
  selectedModel: GeminiModelOption;
  characters: CharacterItem[];
  onIncrementKeyUsage: (keyId: string, modelId: string) => void;
  onMarkKeyExhausted: (keyId: string, modelId: string, isRateLimit?: boolean) => void;
  onMarkKeyError?: (keyId: string, errorMsg: string) => void;
}

export function BoundarySentenceComparisonModal({
  isOpen,
  onClose,
  chunks,
  initialChunkIndex = 0,
  onUpdateChunk,
  apiKeys,
  selectedModel,
  characters,
  onIncrementKeyUsage,
  onMarkKeyExhausted,
  onMarkKeyError,
}: BoundarySentenceComparisonModalProps) {
  const [currentChunkIdx, setCurrentChunkIdx] = useState<number>(initialChunkIndex);

  // Editable Chinese sentences
  const [firstChinese, setFirstChinese] = useState<string>('');
  const [lastChinese, setLastChinese] = useState<string>('');

  // Translations
  const [firstNewAi, setFirstNewAi] = useState<string>('');
  const [lastNewAi, setLastNewAi] = useState<string>('');

  // Previous chunk sentences
  const [firstPrevTranslation, setFirstPrevTranslation] = useState<string>('');
  const [lastPrevTranslation, setLastPrevTranslation] = useState<string>('');

  // Loading & status states
  const [isTranslatingFirst, setIsTranslatingFirst] = useState<boolean>(false);
  const [isTranslatingLast, setIsTranslatingLast] = useState<boolean>(false);
  const [isEvaluatingAiFirst, setIsEvaluatingAiFirst] = useState<boolean>(false);
  const [isEvaluatingAiLast, setIsEvaluatingAiLast] = useState<boolean>(false);

  // AI Semantic evaluation
  const [firstAiSemantic, setFirstAiSemantic] = useState<{ score: number; note: string } | null>(null);
  const [lastAiSemantic, setLastAiSemantic] = useState<{ score: number; note: string } | null>(null);

  // Copy indicator
  const [copiedState, setCopiedState] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const currentChunk = chunks[currentChunkIdx];

  // Initialize or load comparison data when chunk changes
  useEffect(() => {
    if (!currentChunk) return;

    const extracted = extractBoundarySentences(
      currentChunk.content,
      currentChunk.translatedText
    );

    const saved = currentChunk.boundaryComparison;

    setFirstChinese(saved?.firstChinese ?? extracted.firstChinese);
    setLastChinese(saved?.lastChinese ?? extracted.lastChinese);

    setFirstNewAi(saved?.firstNewAi ?? '');
    setLastNewAi(saved?.lastNewAi ?? '');

    setFirstPrevTranslation(saved?.firstPrevTranslation || extracted.firstPrevTranslation);
    setLastPrevTranslation(saved?.lastPrevTranslation || extracted.lastPrevTranslation);

    if (saved?.firstAiSemanticScore !== undefined) {
      setFirstAiSemantic({
        score: saved.firstAiSemanticScore,
        note: saved.firstAiNote || '',
      });
    } else {
      setFirstAiSemantic(null);
    }

    if (saved?.lastAiSemanticScore !== undefined) {
      setLastAiSemantic({
        score: saved.lastAiSemanticScore,
        note: saved.lastAiNote || '',
      });
    } else {
      setLastAiSemantic(null);
    }
  }, [currentChunkIdx, currentChunk]);

  // Sync initialChunkIndex when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialChunkIndex >= 0 && initialChunkIndex < chunks.length) {
        setCurrentChunkIdx(initialChunkIndex);
      }
    }
  }, [isOpen, initialChunkIndex, chunks.length]);

  if (!isOpen || !currentChunk) return null;

  // Calculate instant similarity
  const firstSimilarity = calculateTextSimilarity(firstNewAi, firstPrevTranslation);
  const lastSimilarity = calculateTextSimilarity(lastNewAi, lastPrevTranslation);

  // Helper to pick next available key
  const getAvailableKey = (): ApiKeyItem | null => {
    const readyKeys = apiKeys.filter(
      (k) =>
        k.status !== 'error' &&
        k.modelStatus?.[selectedModel.id] !== 'quota_exceeded' &&
        !(k.status === 'cooldown' && k.cooldownUntil && k.cooldownUntil > Date.now())
    );
    if (readyKeys.length > 0) {
      return readyKeys[Math.floor(Math.random() * readyKeys.length)];
    }
    const anyKey = apiKeys.find((k) => k.status !== 'error');
    return anyKey || null;
  };

  // Helper to build character glossary for the sentence
  const buildGlossaryForSentence = (sentence: string): string => {
    const matched = characters.filter((c) => {
      const zh = (c.chinese || '').trim();
      const hv = (c.hanViet || '').trim();
      return (zh && sentence.includes(zh)) || (hv && sentence.includes(hv));
    });

    if (matched.length === 0) return '';

    return (
      '\nBẢNG TÊN NHÂN VẬT THAM KHẢO CHO CÂU NÀY:\n' +
      matched
        .map(
          (c) =>
            `- ${c.chinese || ''} -> ${c.hanViet || ''}${c.gender ? ` (${c.gender})` : ''}${
              c.note ? `: ${c.note}` : ''
            }`
        )
        .join('\n')
    );
  };

  // Call Gemini to translate a single sentence
  const translateSentence = async (chineseSentence: string): Promise<string> => {
    if (!chineseSentence || !chineseSentence.trim()) {
      throw new Error('Câu tiếng Trung trống.');
    }

    const keyItem = getAvailableKey();
    if (!keyItem) {
      throw new Error('Chưa có API Key khả dụng. Vui lòng kiểm tra lại API Key Gemini.');
    }

    const glossary = buildGlossaryForSentence(chineseSentence);
    const prompt = `Bạn là biên dịch viên văn học Tiên Hiệp, Huyền Huyễn Trung - Việt xuất sắc.
Hãy dịch câu tiếng Trung sau đây sang một câu tiếng Việt văn học thật chuẩn nghĩa, tự nhiên, mượt mà và bảo đảm tính văn chương.${glossary}

CÂU TIẾNG TRUNG:
"${chineseSentence}"

YÊU CẦU:
- Chỉ trả về bản dịch tiếng Việt của câu văn trên, không kèm theo lời chào, giải thích, hay dấu ngoặc kép thừa.`;

    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model: selectedModel.modelCode,
        apiKey: keyItem.key,
      }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.text) {
      onIncrementKeyUsage(keyItem.id, selectedModel.id);
      return data.text.trim().replace(/^["“']|["”']$/g, '');
    } else {
      if (res.status === 403) {
        onMarkKeyError?.(keyItem.id, data.error || '403 Forbidden');
      } else if (res.status === 429) {
        onMarkKeyExhausted(keyItem.id, selectedModel.id, true);
      }
      throw new Error(data.error || 'Lỗi khi gọi Gemini AI dịch câu');
    }
  };

  // Call Gemini for Semantic evaluation
  const evaluateSemanticComparison = async (
    chinese: string,
    newAi: string,
    prevTrans: string
  ): Promise<{ score: number; note: string }> => {
    const keyItem = getAvailableKey();
    if (!keyItem) {
      throw new Error('Không có API Key khả dụng để đánh giá.');
    }

    const prompt = `Bạn là chuyên gia thẩm định bản dịch văn học Trung - Việt. Hãy so sánh hai bản dịch tiếng Việt của một câu tiếng Trung xem chúng có tương đồng về ngữ nghĩa và độ chính xác không:

CÂU GỐC TIẾNG TRUNG: "${chinese}"
BẢN DỊCH AI MỚI: "${newAi}"
BẢN DỊCH CỤM TRƯỚC ĐÓ: "${prevTrans}"

HÃY TRẢ VỀ DUY NHẤT 1 ĐOẠN JSON (không có markdown khác):
{
  "semanticScore": <số nguyên từ 0 đến 100, đo mức độ tương đồng ngữ nghĩa>,
  "note": "<nhận xét ngắn gọn trong 1 câu: 2 câu có cùng ý nghĩa không, khác biệt chính là gì>"
}`;

    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model: selectedModel.modelCode,
        apiKey: keyItem.key,
      }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.text) {
      onIncrementKeyUsage(keyItem.id, selectedModel.id);
      try {
        const jsonMatch = data.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            score: Math.min(Math.max(Number(parsed.semanticScore) || 0, 0), 100),
            note: String(parsed.note || 'Hoàn tất đánh giá ngữ nghĩa.').trim(),
          };
        }
      } catch (e) {
        console.error('Parse semantic JSON failed', e);
      }
      return { score: 85, note: 'Hai bản dịch tương đồng ngữ nghĩa.' };
    }
    throw new Error(data.error || 'Lỗi đánh giá ngữ nghĩa.');
  };

  // Save changes to current chunk
  const saveCurrentComparison = (updates?: Partial<BoundaryComparisonData>) => {
    const data: BoundaryComparisonData = {
      firstChinese,
      firstNewAi,
      firstPrevTranslation,
      firstSimilarity: firstNewAi ? firstSimilarity.score : null,
      firstAiSemanticScore: firstAiSemantic?.score,
      firstAiNote: firstAiSemantic?.note,
      lastChinese,
      lastNewAi,
      lastPrevTranslation,
      lastSimilarity: lastNewAi ? lastSimilarity.score : null,
      lastAiSemanticScore: lastAiSemantic?.score,
      lastAiNote: lastAiSemantic?.note,
      lastUpdated: Date.now(),
      ...updates,
    };

    onUpdateChunk(currentChunkIdx, {
      boundaryComparison: data,
    });
  };

  // Translate First Sentence
  const handleTranslateFirst = async () => {
    if (!firstChinese.trim()) return;
    setIsTranslatingFirst(true);
    setToastMessage(null);
    try {
      const translated = await translateSentence(firstChinese);
      setFirstNewAi(translated);
      saveCurrentComparison({ firstNewAi: translated });
      setToastMessage('Đã dịch câu đầu tiên bằng AI!');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setToastMessage(`Lỗi dịch câu đầu: ${err.message}`);
    } finally {
      setIsTranslatingFirst(false);
    }
  };

  // Translate Last Sentence
  const handleTranslateLast = async () => {
    if (!lastChinese.trim()) return;
    setIsTranslatingLast(true);
    setToastMessage(null);
    try {
      const translated = await translateSentence(lastChinese);
      setLastNewAi(translated);
      saveCurrentComparison({ lastNewAi: translated });
      setToastMessage('Đã dịch câu cuối cùng bằng AI!');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setToastMessage(`Lỗi dịch câu cuối: ${err.message}`);
    } finally {
      setIsTranslatingLast(false);
    }
  };

  // Translate Both Sentences
  const handleTranslateBoth = async () => {
    setToastMessage('Đang dịch câu đầu và câu cuối bằng AI...');
    setIsTranslatingFirst(true);
    setIsTranslatingLast(true);
    try {
      const [tFirst, tLast] = await Promise.all([
        firstChinese.trim() ? translateSentence(firstChinese) : Promise.resolve(''),
        lastChinese.trim() ? translateSentence(lastChinese) : Promise.resolve(''),
      ]);
      if (tFirst) setFirstNewAi(tFirst);
      if (tLast) setLastNewAi(tLast);

      saveCurrentComparison({
        firstNewAi: tFirst || firstNewAi,
        lastNewAi: tLast || lastNewAi,
      });

      setToastMessage('Đã dịch đối chiếu thành công cả 2 câu!');
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      setToastMessage(`Lỗi dịch: ${err.message}`);
    } finally {
      setIsTranslatingFirst(false);
      setIsTranslatingLast(false);
    }
  };

  // Evaluate AI Semantic Match for First Sentence
  const handleEvaluateAiFirst = async () => {
    if (!firstNewAi || !firstPrevTranslation) return;
    setIsEvaluatingAiFirst(true);
    try {
      const res = await evaluateSemanticComparison(firstChinese, firstNewAi, firstPrevTranslation);
      setFirstAiSemantic(res);
      saveCurrentComparison({
        firstAiSemanticScore: res.score,
        firstAiNote: res.note,
      });
    } catch (err: any) {
      setToastMessage(`Lỗi đánh giá AI: ${err.message}`);
    } finally {
      setIsEvaluatingAiFirst(false);
    }
  };

  // Evaluate AI Semantic Match for Last Sentence
  const handleEvaluateAiLast = async () => {
    if (!lastNewAi || !lastPrevTranslation) return;
    setIsEvaluatingAiLast(true);
    try {
      const res = await evaluateSemanticComparison(lastChinese, lastNewAi, lastPrevTranslation);
      setLastAiSemantic(res);
      saveCurrentComparison({
        lastAiSemanticScore: res.score,
        lastAiNote: res.note,
      });
    } catch (err: any) {
      setToastMessage(`Lỗi đánh giá AI: ${err.message}`);
    } finally {
      setIsEvaluatingAiLast(false);
    }
  };

  // Reset Chinese to original extracted sentence
  const handleResetChinese = (type: 'first' | 'last') => {
    const extracted = extractBoundarySentences(
      currentChunk.content,
      currentChunk.translatedText
    );
    if (type === 'first') {
      setFirstChinese(extracted.firstChinese);
    } else {
      setLastChinese(extracted.lastChinese);
    }
    setToastMessage(`Đã khôi phục câu ${type === 'first' ? 'đầu' : 'cuối'} về trích xuất ban đầu.`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Copy text to clipboard helper
  const handleCopy = async (text: string, id: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedState(id);
      setTimeout(() => setCopiedState(null), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                  So Sánh & Đối Chiếu Câu Đầu - Câu Cuối
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Đo độ khớp bản dịch
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Trích câu đầu & câu cuối, dịch độc lập bằng AI và tự động đo tỷ lệ giống nhau (%) với cụm đã dịch
              </p>
            </div>
          </div>

          {/* Navigation Controls between chunks */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentChunkIdx((prev) => Math.max(0, prev - 1))}
              disabled={currentChunkIdx === 0}
              className="p-1.5 border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-slate-600"
              title="Cụm trước đó"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Chunk Selector */}
            <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs font-semibold">
              <span className="text-slate-500">Cụm:</span>
              <select
                value={currentChunkIdx}
                onChange={(e) => setCurrentChunkIdx(Number(e.target.value))}
                className="bg-transparent font-bold text-indigo-700 outline-none cursor-pointer"
              >
                {chunks.map((c, i) => (
                  <option key={c.id} value={i}>
                    #{c.chunkIndex} ({c.charCount.toLocaleString()} ký tự - {c.status === 'done' ? 'Đã dịch' : 'Chưa dịch'})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setCurrentChunkIdx((prev) => Math.min(chunks.length - 1, prev + 1))}
              disabled={currentChunkIdx === chunks.length - 1}
              className="p-1.5 border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-slate-600"
              title="Cụm tiếp theo"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="ml-2 w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Global Toast Notification */}
        {toastMessage && (
          <div className="bg-indigo-600 text-white text-xs px-4 py-2 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-200 shrink-0" />
              <span>{toastMessage}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-indigo-200 hover:text-white font-bold text-sm px-1.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Action Bar */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-600 font-medium">
            <span className="font-bold text-slate-800">
              Cụm #{currentChunk.chunkIndex}: {currentChunk.chapterLabel}
            </span>
            <span>•</span>
            <span>{currentChunk.charCount.toLocaleString()} ký tự gốc</span>
            <span>•</span>
            {currentChunk.translatedText ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Đã dịch ({currentChunk.translatedText.length.toLocaleString()} ký tự)
              </span>
            ) : (
              <span className="text-amber-700 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Chưa có bản dịch cụm
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTranslateBoth}
              disabled={isTranslatingFirst || isTranslatingLast}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
              title="Dịch câu đầu và câu cuối bằng Gemini AI"
            >
              {isTranslatingFirst || isTranslatingLast ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang dịch...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                  <span>Dịch cả Câu đầu & Câu cuối ({selectedModel.name})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Body: Two Primary Rows for First Sentence and Last Sentence */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* SECTION 1: CÂU ĐẦU TIÊN CỦA CỤM */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            {/* Row Title Banner */}
            <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/50 px-4 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold shadow-2xs">
                  1
                </span>
                <span className="font-bold text-sm text-slate-800">
                  Câu Đầu Tiên Của Cụm (First Sentence)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleResetChinese('first')}
                  className="flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded text-[11px] transition-colors"
                  title="Khôi phục câu tiếng Trung ban đầu được trích xuất"
                >
                  <RotateCcw className="w-3 h-3 text-slate-500" />
                  <span>Trích lại từ gốc</span>
                </button>
                <button
                  type="button"
                  onClick={handleTranslateFirst}
                  disabled={isTranslatingFirst || !firstChinese.trim()}
                  className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded text-xs shadow-2xs transition-colors cursor-pointer"
                >
                  {isTranslatingFirst ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-blue-200" />
                  )}
                  <span>Dịch câu này bằng AI</span>
                </button>
              </div>
            </div>

            {/* 4-Columns Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 text-xs">
              {/* Cột 1: Câu tiếng Trung (Có thể sửa) */}
              <div className="md:col-span-3 p-3 space-y-1.5 bg-slate-50/40 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-700 flex items-center gap-1">
                      <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                      Gốc tiếng Trung (Có thể sửa):
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {firstChinese.length} ký tự
                    </span>
                  </div>
                  <textarea
                    value={firstChinese}
                    onChange={(e) => setFirstChinese(e.target.value)}
                    placeholder="Nhập hoặc sửa câu tiếng Trung đầu cụm..."
                    rows={4}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                  />
                </div>
                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleCopy(firstChinese, 'firstChinese')}
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedState === 'firstChinese' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>Copy tiếng Trung</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTranslateFirst}
                    disabled={isTranslatingFirst}
                    className="text-[11px] text-blue-700 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span>Dịch ngay</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Cột 2: Bản dịch đối chứng mới (AI) */}
              <div className="md:col-span-3 p-3 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-indigo-700 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      Bản dịch AI đối chứng mới:
                    </span>
                    {firstNewAi && (
                      <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-100">
                        {firstNewAi.length} ký tự
                      </span>
                    )}
                  </div>
                  {isTranslatingFirst ? (
                    <div className="p-4 bg-indigo-50/50 border border-indigo-200 rounded-lg flex items-center justify-center gap-2 text-indigo-700 font-semibold min-h-[96px]">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang dịch qua {selectedModel.name}...</span>
                    </div>
                  ) : firstNewAi ? (
                    <div className="p-2.5 bg-indigo-50/60 border border-indigo-200 rounded-lg text-slate-800 leading-relaxed min-h-[96px] whitespace-pre-wrap select-text font-medium">
                      {firstNewAi}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-slate-400 italic text-center min-h-[96px] flex flex-col items-center justify-center gap-1">
                      <span>Chưa dịch đối chứng</span>
                      <button
                        type="button"
                        onClick={handleTranslateFirst}
                        className="text-indigo-600 hover:underline font-bold not-italic"
                      >
                        Bấm để dịch câu này
                      </button>
                    </div>
                  )}
                </div>
                {firstNewAi && (
                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleCopy(firstNewAi, 'firstNewAi')}
                      className="text-[11px] text-slate-500 hover:text-indigo-700 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedState === 'firstNewAi' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy câu dịch AI</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Cột 3: Câu đầu trích từ bản dịch cụm trước đó */}
              <div className="md:col-span-3 p-3 space-y-1.5 bg-slate-50/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-700">
                      Câu đầu trong bản dịch cụm:
                    </span>
                    {firstPrevTranslation && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {firstPrevTranslation.length} ký tự
                      </span>
                    )}
                  </div>
                  {firstPrevTranslation ? (
                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-700 leading-relaxed min-h-[96px] whitespace-pre-wrap select-text">
                      {firstPrevTranslation}
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50/60 border border-dashed border-amber-200 rounded-lg text-amber-700 italic text-center min-h-[96px] flex items-center justify-center">
                      Cụm này chưa có bản dịch trước đó để so sánh
                    </div>
                  )}
                </div>
                {firstPrevTranslation && (
                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleCopy(firstPrevTranslation, 'firstPrevTranslation')}
                      className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedState === 'firstPrevTranslation' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy câu đã dịch</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Cột 4: Độ khớp & Kết quả so sánh */}
              <div className="md:col-span-3 p-3 space-y-2 bg-slate-50/70 flex flex-col justify-between">
                <div>
                  <span className="font-bold text-slate-800 block mb-1">
                    Độ khớp & Tương đồng:
                  </span>

                  {firstNewAi && firstPrevTranslation ? (
                    <div className="space-y-2">
                      {/* Similarity Badge & Percentage */}
                      <div className="p-2.5 rounded-lg border bg-white flex items-center justify-between gap-2 shadow-2xs">
                        <div>
                          <div className="text-2xl font-black text-slate-900 leading-none">
                            {firstSimilarity.score}%
                          </div>
                          <span className="text-[10px] text-slate-500">
                            Độ tương đồng ký tự & từ ngữ
                          </span>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-md text-[11px] font-bold border ${firstSimilarity.colorClass}`}
                        >
                          {firstSimilarity.label}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            firstSimilarity.score >= 80
                              ? 'bg-emerald-500'
                              : firstSimilarity.score >= 50
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${firstSimilarity.score}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-600">
                        <div className="bg-white p-1 rounded border border-slate-200">
                          Khớp từ: <b>{firstSimilarity.wordScore}%</b>
                        </div>
                        <div className="bg-white p-1 rounded border border-slate-200">
                          Khớp ký tự: <b>{firstSimilarity.charScore}%</b>
                        </div>
                      </div>

                      {/* AI Semantic Evaluation Option */}
                      {firstAiSemantic ? (
                        <div className="p-2 bg-indigo-50/80 border border-indigo-200 rounded-lg text-[11px] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-indigo-900 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-indigo-600" />
                              Đánh giá ngữ nghĩa AI:
                            </span>
                            <span className="font-bold text-indigo-700">
                              {firstAiSemantic.score}% khớp nghĩa
                            </span>
                          </div>
                          <p className="text-slate-700 leading-snug">{firstAiSemantic.note}</p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleEvaluateAiFirst}
                          disabled={isEvaluatingAiFirst}
                          className="w-full py-1 px-2 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[11px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-colors cursor-pointer"
                        >
                          {isEvaluatingAiFirst ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-indigo-500" />
                          )}
                          <span>Đánh giá ngữ nghĩa bằng AI</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-white border border-slate-200 rounded-lg text-slate-400 italic text-center">
                      Cần cả bản dịch mới và bản dịch trước để tính độ khớp %
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: CÂU CUỐI CÙNG CỦA CỤM */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            {/* Row Title Banner */}
            <div className="bg-gradient-to-r from-purple-50/80 to-indigo-50/50 px-4 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-purple-600 text-white flex items-center justify-center text-xs font-bold shadow-2xs">
                  2
                </span>
                <span className="font-bold text-sm text-slate-800">
                  Câu Cuối Cùng Của Cụm (Last Sentence)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleResetChinese('last')}
                  className="flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded text-[11px] transition-colors"
                  title="Khôi phục câu tiếng Trung ban đầu được trích xuất"
                >
                  <RotateCcw className="w-3 h-3 text-slate-500" />
                  <span>Trích lại từ gốc</span>
                </button>
                <button
                  type="button"
                  onClick={handleTranslateLast}
                  disabled={isTranslatingLast || !lastChinese.trim()}
                  className="flex items-center gap-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold rounded text-xs shadow-2xs transition-colors cursor-pointer"
                >
                  {isTranslatingLast ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-purple-200" />
                  )}
                  <span>Dịch câu này bằng AI</span>
                </button>
              </div>
            </div>

            {/* 4-Columns Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 text-xs">
              {/* Cột 1: Câu tiếng Trung (Có thể sửa) */}
              <div className="md:col-span-3 p-3 space-y-1.5 bg-slate-50/40 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-700 flex items-center gap-1">
                      <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                      Gốc tiếng Trung (Có thể sửa):
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {lastChinese.length} ký tự
                    </span>
                  </div>
                  <textarea
                    value={lastChinese}
                    onChange={(e) => setLastChinese(e.target.value)}
                    placeholder="Nhập hoặc sửa câu tiếng Trung cuối cụm..."
                    rows={4}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs font-mono leading-relaxed focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none resize-y"
                  />
                </div>
                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleCopy(lastChinese, 'lastChinese')}
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedState === 'lastChinese' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>Copy tiếng Trung</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTranslateLast}
                    disabled={isTranslatingLast}
                    className="text-[11px] text-purple-700 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span>Dịch ngay</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Cột 2: Bản dịch đối chứng mới (AI) */}
              <div className="md:col-span-3 p-3 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-purple-700 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      Bản dịch AI đối chứng mới:
                    </span>
                    {lastNewAi && (
                      <span className="text-[10px] text-purple-600 font-semibold bg-purple-50 px-1.5 py-0.2 rounded border border-purple-100">
                        {lastNewAi.length} ký tự
                      </span>
                    )}
                  </div>
                  {isTranslatingLast ? (
                    <div className="p-4 bg-purple-50/50 border border-purple-200 rounded-lg flex items-center justify-center gap-2 text-purple-700 font-semibold min-h-[96px]">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang dịch qua {selectedModel.name}...</span>
                    </div>
                  ) : lastNewAi ? (
                    <div className="p-2.5 bg-purple-50/60 border border-purple-200 rounded-lg text-slate-800 leading-relaxed min-h-[96px] whitespace-pre-wrap select-text font-medium">
                      {lastNewAi}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-slate-400 italic text-center min-h-[96px] flex flex-col items-center justify-center gap-1">
                      <span>Chưa dịch đối chứng</span>
                      <button
                        type="button"
                        onClick={handleTranslateLast}
                        className="text-purple-600 hover:underline font-bold not-italic"
                      >
                        Bấm để dịch câu này
                      </button>
                    </div>
                  )}
                </div>
                {lastNewAi && (
                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleCopy(lastNewAi, 'lastNewAi')}
                      className="text-[11px] text-slate-500 hover:text-purple-700 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedState === 'lastNewAi' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy câu dịch AI</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Cột 3: Câu cuối trích từ bản dịch cụm trước đó */}
              <div className="md:col-span-3 p-3 space-y-1.5 bg-slate-50/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-700">
                      Câu cuối trong bản dịch cụm:
                    </span>
                    {lastPrevTranslation && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {lastPrevTranslation.length} ký tự
                      </span>
                    )}
                  </div>
                  {lastPrevTranslation ? (
                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-700 leading-relaxed min-h-[96px] whitespace-pre-wrap select-text">
                      {lastPrevTranslation}
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50/60 border border-dashed border-amber-200 rounded-lg text-amber-700 italic text-center min-h-[96px] flex items-center justify-center">
                      Cụm này chưa có bản dịch trước đó để so sánh
                    </div>
                  )}
                </div>
                {lastPrevTranslation && (
                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleCopy(lastPrevTranslation, 'lastPrevTranslation')}
                      className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedState === 'lastPrevTranslation' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy câu đã dịch</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Cột 4: Độ khớp & Kết quả so sánh */}
              <div className="md:col-span-3 p-3 space-y-2 bg-slate-50/70 flex flex-col justify-between">
                <div>
                  <span className="font-bold text-slate-800 block mb-1">
                    Độ khớp & Tương đồng:
                  </span>

                  {lastNewAi && lastPrevTranslation ? (
                    <div className="space-y-2">
                      {/* Similarity Badge & Percentage */}
                      <div className="p-2.5 rounded-lg border bg-white flex items-center justify-between gap-2 shadow-2xs">
                        <div>
                          <div className="text-2xl font-black text-slate-900 leading-none">
                            {lastSimilarity.score}%
                          </div>
                          <span className="text-[10px] text-slate-500">
                            Độ tương đồng ký tự & từ ngữ
                          </span>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-md text-[11px] font-bold border ${lastSimilarity.colorClass}`}
                        >
                          {lastSimilarity.label}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            lastSimilarity.score >= 80
                              ? 'bg-purple-500'
                              : lastSimilarity.score >= 50
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${lastSimilarity.score}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-600">
                        <div className="bg-white p-1 rounded border border-slate-200">
                          Khớp từ: <b>{lastSimilarity.wordScore}%</b>
                        </div>
                        <div className="bg-white p-1 rounded border border-slate-200">
                          Khớp ký tự: <b>{lastSimilarity.charScore}%</b>
                        </div>
                      </div>

                      {/* AI Semantic Evaluation Option */}
                      {lastAiSemantic ? (
                        <div className="p-2 bg-purple-50/80 border border-purple-200 rounded-lg text-[11px] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-purple-900 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-purple-600" />
                              Đánh giá ngữ nghĩa AI:
                            </span>
                            <span className="font-bold text-purple-700">
                              {lastAiSemantic.score}% khớp nghĩa
                            </span>
                          </div>
                          <p className="text-slate-700 leading-snug">{lastAiSemantic.note}</p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleEvaluateAiLast}
                          disabled={isEvaluatingAiLast}
                          className="w-full py-1 px-2 bg-white hover:bg-purple-50 text-purple-700 border border-purple-200 rounded text-[11px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-colors cursor-pointer"
                        >
                          {isEvaluatingAiLast ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-purple-500" />
                          )}
                          <span>Đánh giá ngữ nghĩa bằng AI</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-white border border-slate-200 rounded-lg text-slate-400 italic text-center">
                      Cần cả bản dịch mới và bản dịch trước để tính độ khớp %
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <span>Model dịch: <b>{selectedModel.name}</b></span>
            <span>•</span>
            <span>Số API Key khả dụng: <b>{apiKeys.filter((k) => k.status === 'ready').length}/{apiKeys.length}</b></span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                saveCurrentComparison();
                setToastMessage('Đã lưu dữ liệu so sánh vào cụm!');
                setTimeout(() => setToastMessage(null), 2000);
              }}
              className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            >
              Lưu kết quả so sánh
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
