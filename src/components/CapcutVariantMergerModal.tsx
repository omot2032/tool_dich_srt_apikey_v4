import React, { useState } from 'react';
import { CharacterItem, ApiKeyItem, GeminiModelOption, StoryRow } from '../types';
import { GEMINI_MODELS } from '../data/models';
import {
  mergeChineseVariants,
  extractChineseVariants,
  extractContextSample,
  sanitizeSingleHanViet,
  hasMultipleHanViets,
  extractHanVietList,
  splitMultiCharacterRow,
  cleanNoteWithoutFormsOfAddress,
} from '../utils/characterUtils';
import {
  Sparkles,
  Layers,
  Check,
  X,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Info,
  CheckCircle2,
  Users,
} from 'lucide-react';

export interface GroupedVariantCluster {
  id: string;
  selected: boolean;
  standardHanViet: string;
  mergedChinese: string;
  gender: string;
  note: string;
  originalCharacters: {
    id?: string;
    hanViet: string;
    chinese: string;
    gender?: string;
    note?: string;
  }[];
  reason?: string;
}

interface CapcutVariantMergerModalProps {
  isOpen: boolean;
  onClose: () => void;
  characters: CharacterItem[];
  onApplyMergedCharacters: (updatedCharacters: CharacterItem[]) => void;
  preloadedRows?: StoryRow[];
  apiKeys?: ApiKeyItem[];
  selectedModel?: GeminiModelOption;
  onIncrementKeyUsage?: (keyId: string, modelId: string) => void;
  onMarkKeyExhausted?: (keyId: string, modelId: string, isRateLimit?: boolean, cooldownSeconds?: number) => void;
  onMarkKeyError?: (keyId: string, errorMsg: string) => void;
}

export const CapcutVariantMergerModal: React.FC<CapcutVariantMergerModalProps> = ({
  isOpen,
  onClose,
  characters,
  onApplyMergedCharacters,
  preloadedRows = [],
  apiKeys = [],
  selectedModel = GEMINI_MODELS[0],
  onIncrementKeyUsage,
  onMarkKeyExhausted,
  onMarkKeyError,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedClusters, setDetectedClusters] = useState<GroupedVariantCluster[]>([]);
  const [unmodifiedCharacters, setUnmodifiedCharacters] = useState<CharacterItem[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  if (!isOpen) return null;

  // Helper to pick next available key
  const pickNextApiKey = (failedIds: Set<string>): ApiKeyItem | null => {
    const readyKeys = apiKeys.filter(
      (k) =>
        !failedIds.has(k.id) &&
        k.status !== 'error' &&
        k.modelStatus?.[selectedModel.id] !== 'quota_exceeded' &&
        (!k.cooldownUntil || k.cooldownUntil <= Date.now())
    );
    if (readyKeys.length > 0) return readyKeys[0];
    const candidate = apiKeys.find((k) => !failedIds.has(k.id) && k.status !== 'error');
    return candidate || null;
  };

  const handleStartAnalysis = async () => {
    if (characters.length === 0) {
      setErrorMessage('Bảng tên nhân vật hiện đang trống, chưa có nhân vật nào để phân tích.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    setStatusMessage('Đang chuẩn bị dữ liệu và phân tích ngữ cảnh file SRT...');
    setDetectedClusters([]);
    setUnmodifiedCharacters([]);

    try {
      // 1. Chuẩn hóa & tách trước bất kỳ dòng nào vốn đang bị dính nhiều tên trong bảng
      const normalizedCharacters: CharacterItem[] = [];
      characters.forEach((c) => {
        if (hasMultipleHanViets(c.hanViet)) {
          normalizedCharacters.push(...splitMultiCharacterRow(c));
        } else {
          normalizedCharacters.push({
            ...c,
            hanViet: sanitizeSingleHanViet(c.hanViet),
          });
        }
      });

      const charListInput = normalizedCharacters.map((c, idx) => ({
        id: c.id,
        stt: idx + 1,
        chinese: c.chinese || '',
        hanViet: c.hanViet || '',
        gender: c.gender || 'Chưa rõ',
        note: c.note || '',
      }));

      // Extract sample context from Cột B (SRT text)
      const contextSample = extractContextSample(preloadedRows, 25000);

      const prompt = `Bạn là chuyên gia ngôn ngữ học tiếng Trung và biên tập viên dịch thuật truyện audio chuyên nghiệp.
File phụ đề (.srt) này được tạo bằng tính năng Auto Caption (nhận diện giọng nói ASR từ âm thanh tiếng Trung) của CapCut.
Do CapCut tự động chuyển âm thanh thành văn bản nên có RẤT NHIỀU LỖI NGHE NHẦM các chữ Hán đồng âm hoặc cận âm (cùng Pinyin hoặc sai thanh điệu/phụ âm đầu).

Ví dụ kinh điển về lỗi nghe nhầm của CapCut:
- 常青 (cháng qīng) bị nghe nhầm thành: 长青, 尝青, 畅清... (cùng là Thường Thanh)
- 端沧海 (duān cāng hǎi) bị nghe nhầm thành: 段沧海, 端苍海... (Đoan Thương Hải)
- 薛洪裕 (xuē hóng yù) bị nghe nhầm thành: 薛鸿裕, 薛红玉...
- 尹竹琴 (yǐn zhú qín) bị nghe nhầm thành: 尹竹芹, 尹竹卿...
- 南宫瑶 (nán gōng yáo) bị nghe nhầm thành: 南功瑶, 蓝宫瑶...

NGỮ CẢNH TRÍCH XUẤT TỪ FILE SRT:
---
${contextSample || '(Không có sẵn ngữ cảnh, hãy tập trung phân tích sâu dựa vào Pinyin và âm Hán Việt)'}
---

DANH SÁCH NHÂN VẬT HIỆN TẠI TRONG BẢNG:
${JSON.stringify(charListInput, null, 2)}

NHIỆM VỤ CỦA BẠN:
1. Dựa vào phiên âm Pinyin, âm đọc tiếng Trung và ngữ cảnh trong file SRT, hãy tìm ra những dòng nào thực chất CHỈ LÀ 1 NHÂN VẬT / ĐỊA DANH DUY NHẤT nhưng bị CapCut nghe nhầm thành nhiều chữ Hán khác nhau.
2. Với mỗi nhóm bị nghe nhầm:
   - QUY TẮC BẮT BUỘC: "standardHanViet" PHẢI LÀ ĐÚNG 1 TÊN DUY NHẤT (Ví dụ: "Thường Thanh" hoặc "Cơ Vô Thường"). TUYỆT ĐỐI CẤM chứa dấu gạch chéo "/", phẩy ",", hoặc ghép nhiều tên như "Cơ Vô Thường / Âm Tước Tình".
   - Gom TẤT CẢ các chữ Hán đúng và các chữ Hán bị CapCut nghe nhầm của CÙNG 1 NGƯỜI ĐÓ vào trường 'chinese', cách nhau bằng dấu gạch chéo ' / ' (Ví dụ: '常青 / 长青 / 尝青' hoặc '姬无常 / 姬常 / 希吴苍'). Chữ Hán chuẩn xác nhất đứng đầu tiên.
   - Xác định giới tính chuẩn.
   - Ghi chú súc tích về thân phận (TUYỆT ĐỐI LOẠI BỎ PHẦN XƯNG HÔ như xưng ta, gọi đồ nhi...).
   - Nêu lý do gom ngắn gọn (ví dụ: 'Cùng Pinyin cháng qīng, CapCut nghe nhầm giữa 常 và 长').
3. CẢNH BÁO TỐI QUAN TRỌNG VỀ TÁCH BIỆT CÁC NHÂN VẬT KHÁC NHAU:
   - TUYỆT ĐỐI KHÔNG ĐƯỢC GOM CÁC NHÂN VẬT KHÁC NHAU VÀO CÙNG MỘT DÒNG!
   - VÍ DỤ CẤM PHẠM PHẢI:
     * Dữ liệu có: 姬无常, 姬常, 希吴苍 (Cơ Vô Thường) và 阴爵情, 阴发情 (Âm Tước Tình).
     * AI gom chung thành: "Cơ Vô Thường / Âm Tước Tình / Âm Phát Tình" -> ĐÂY LÀ LỖI CỰC KỲ SAI TRÁI!
     * "姬无常" (Cơ Vô Thường, jī wú cháng, họ Cơ) và "阴爵情" (Âm Tước Tình, yīn jué qíng, họ Âm) là 2 NGƯỜI HOÀN TOÀN KHÁC NHAU về âm đọc, danh tính và vai vế.
     * BẮT BUỘC PHẢI TÁCH RIÊNG THÀNH 2 NHÓM ĐỘC LẬP TRONG MẢNG:
       Nhóm 1: standardHanViet: "Cơ Vô Thường", mergedChinese: "姬无常 / 姬常 / 希吴苍"
       Nhóm 2: standardHanViet: "Âm Tước Tình", mergedChinese: "阴爵情 / 阴发情"
   - Nếu trong danh sách có 2 người khác nhau, TUYỆT ĐỐI KHÔNG GOM CHUNG VÀO 1 CLUSTER!
4. Trả về kết quả JSON duy nhất theo định dạng:
{
  "clusters": [
    {
      "originalIds": ["id1", "id2"],
      "originalHanViets": ["Thường Thanh", "Trường Thanh"],
      "standardHanViet": "Thường Thanh",
      "mergedChinese": "常青 / 长青",
      "gender": "Nam",
      "note": "Nam chính, người xuyên không",
      "reason": "Đồng âm Pinyin cháng qīng, ngữ cảnh cùng là nam chính"
    }
  ]
}

Nếu không có cặp nhân vật nào bị CapCut nghe nhầm, trả về: {"clusters": []}.
CHÚ Ý: Chỉ gom những dòng thực sự là CÙNG 1 NGƯỜI bị nghe nhầm. Nếu là 2 người khác nhau thì BẮT BUỘC PHẢI TÁCH RA, KHÔNG ĐƯỢC DÙNG CHUNG.`;

      setStatusMessage(`Đang gửi yêu cầu đến Gemini AI (${selectedModel.name}) để phân tích Pinyin và ngữ cảnh...`);

      // Call API with rotation
      const failedKeyIds = new Set<string>();
      let attempts = 0;
      let rawResponse = '';

      while (attempts < Math.max(apiKeys.length * 2, 4)) {
        const keyItem = pickNextApiKey(failedKeyIds);
        const apiKeyToUse = keyItem?.key || '';

        try {
          const res = await fetch('/api/gemini/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              model: selectedModel.modelCode,
              apiKey: apiKeyToUse,
              responseMimeType: 'application/json',
            }),
          });

          const data = await res.json();

          if (res.ok && data.text) {
            if (keyItem && onIncrementKeyUsage) {
              onIncrementKeyUsage(keyItem.id, selectedModel.id);
            }
            rawResponse = data.text;
            break;
          } else {
            if (res.status === 403 || data.isPermissionDenied) {
              if (keyItem) {
                onMarkKeyError?.(keyItem.id, data.error || '403 Forbidden');
                failedKeyIds.add(keyItem.id);
              }
              continue;
            }
            if (res.status === 429 || data.isRateLimit) {
              if (keyItem && onMarkKeyExhausted) {
                onMarkKeyExhausted(keyItem.id, selectedModel.id, true, 10);
                failedKeyIds.add(keyItem.id);
              }
              continue;
            }
            throw new Error(data.error || 'Lỗi khi gọi Gemini API.');
          }
        } catch (err: any) {
          attempts++;
          if (attempts >= Math.max(apiKeys.length * 2, 4)) throw err;
        }
      }

      if (!rawResponse) {
        throw new Error('Không nhận được phản hồi từ AI hoặc tất cả API Key đều bận.');
      }

      // Parse JSON response
      let cleanJson = rawResponse.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '');
      const firstBrace = cleanJson.indexOf('{');
      const lastBrace = cleanJson.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
      }

      let parsedClusters: any[] = [];
      try {
        const parsed = JSON.parse(cleanJson);
        if (parsed.clusters && Array.isArray(parsed.clusters)) {
          parsedClusters = parsed.clusters;
        } else if (Array.isArray(parsed)) {
          parsedClusters = parsed;
        }
      } catch (parseErr) {
        console.error('Failed to parse clusters JSON:', cleanJson);
        throw new Error('Phản hồi từ AI không đúng cấu trúc JSON chuẩn. Vui lòng thử lại.');
      }

      // Build Cluster Objects and find unmodified items
      const mergedOriginalIds = new Set<string>();
      const clusters: GroupedVariantCluster[] = [];

      parsedClusters.forEach((c: any, cIdx: number) => {
        const originalIds: string[] = Array.isArray(c.originalIds) ? c.originalIds : [];
        const matchedChars = characters.filter((char) =>
          originalIds.includes(char.id) ||
          (c.originalHanViets && Array.isArray(c.originalHanViets) && c.originalHanViets.includes(char.hanViet))
        );

        if (matchedChars.length >= 2) {
          // Kiểm tra xem cluster này có bị nhét nhiều người khác nhau không (dựa vào tên chuẩn hoặc họ của matchedChars)
          const rawStdHanViet = String(c.standardHanViet || '').trim();
          const hasMultiNames = hasMultipleHanViets(rawStdHanViet);

          // Phân nhóm matchedChars theo họ
          const surnameGroups = new Map<string, typeof matchedChars>();
          matchedChars.forEach((m) => {
            const surname = sanitizeSingleHanViet(m.hanViet).toLowerCase().trim().split(/\s+/)[0] || 'unknown';
            if (!surnameGroups.has(surname)) surnameGroups.set(surname, []);
            surnameGroups.get(surname)!.push(m);
          });

          if (hasMultiNames || surnameGroups.size > 1) {
            // TÁCH RA THÀNH CÁC CLUSTER RIÊNG BIỆT CHO TỪNG NGƯỜI! TUYỆT ĐỐI KHÔNG DÙNG CHUNG!
            let sIdx = 0;
            surnameGroups.forEach((subChars, _surname) => {
              if (subChars.length >= 2) {
                subChars.forEach((m) => mergedOriginalIds.add(m.id));
                const subChinese = mergeChineseVariants(...subChars.map((m) => m.chinese));
                const singleName = sanitizeSingleHanViet(subChars[0].hanViet);
                clusters.push({
                  id: `cluster-${cIdx}-${sIdx++}-${Date.now()}`,
                  selected: true,
                  standardHanViet: singleName,
                  mergedChinese: subChinese,
                  gender: String(subChars[0].gender || 'Chưa rõ').trim(),
                  note: cleanNoteWithoutFormsOfAddress(String(subChars[0].note || c.note || '')),
                  reason: `Đã tự động tách riêng nhân vật "${singleName}" để không dùng chung dòng`,
                  originalCharacters: subChars.map((m) => ({
                    id: m.id,
                    hanViet: sanitizeSingleHanViet(m.hanViet),
                    chinese: m.chinese,
                    gender: m.gender,
                    note: m.note,
                  })),
                });
              } else if (subChars.length === 1) {
                // Chỉ có 1 người với họ này, giữ nguyên độc lập không gộp chung bậy bạ
                mergedOriginalIds.delete(subChars[0].id);
              }
            });
          } else {
            // Chỉ là 1 nhân vật duy nhất bị CapCut nghe nhầm các biến thể chữ Hán
            matchedChars.forEach((m) => mergedOriginalIds.add(m.id));

            // Merge all Chinese variants
            const allChinese = mergeChineseVariants(
              c.mergedChinese,
              ...matchedChars.map((m) => m.chinese)
            );

            // BẮT BUỘC chỉ lấy ĐÚNG 1 TÊN DUY NHẤT:
            const singleStandardHanViet = sanitizeSingleHanViet(
              String(c.standardHanViet || matchedChars[0].hanViet)
            );

            clusters.push({
              id: `cluster-${cIdx}-${Date.now()}`,
              selected: true,
              standardHanViet: singleStandardHanViet,
              mergedChinese: allChinese,
              gender: String(c.gender || matchedChars[0].gender || 'Chưa rõ').trim(),
              note: cleanNoteWithoutFormsOfAddress(String(c.note || matchedChars[0].note || '')),
              reason: c.reason || 'Biến thể đồng âm / nghe nhầm Pinyin',
              originalCharacters: matchedChars.map((m) => ({
                id: m.id,
                hanViet: sanitizeSingleHanViet(m.hanViet),
                chinese: m.chinese,
                gender: m.gender,
                note: m.note,
              })),
            });
          }
        }
      });

      // Filter characters that were not touched by any cluster
      const untouched = characters.filter((c) => !mergedOriginalIds.has(c.id));

      setDetectedClusters(clusters);
      setUnmodifiedCharacters(untouched);
      setHasAnalyzed(true);
      setStatusMessage(null);
    } catch (err: any) {
      console.error('Error analyzing CapCut variants:', err);
      setErrorMessage(err.message || 'Có lỗi xảy ra khi phân tích biến thể CapCut.');
      setStatusMessage(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleClusterSelection = (clusterId: string) => {
    setDetectedClusters((prev) =>
      prev.map((cl) => (cl.id === clusterId ? { ...cl, selected: !cl.selected } : cl))
    );
  };

  const handleApply = () => {
    const finalCharacters: CharacterItem[] = [...unmodifiedCharacters];

    detectedClusters.forEach((cl) => {
      if (cl.selected) {
        // Add merged character
        finalCharacters.push({
          id: `char-merged-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          stt: finalCharacters.length + 1,
          chinese: cl.mergedChinese,
          hanViet: cl.standardHanViet,
          gender: cl.gender || 'Chưa rõ',
          note: cl.note,
        });
      } else {
        // If user unselected this cluster, keep the original characters
        cl.originalCharacters.forEach((orig) => {
          finalCharacters.push({
            id: orig.id || `char-restored-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            stt: finalCharacters.length + 1,
            chinese: orig.chinese,
            hanViet: orig.hanViet,
            gender: orig.gender || 'Chưa rõ',
            note: orig.note || '',
          });
        });
      }
    });

    // Re-index STT
    const reindexed = finalCharacters.map((c, idx) => ({
      ...c,
      stt: idx + 1,
    }));

    onApplyMergedCharacters(reindexed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-violet-700 via-indigo-700 to-blue-700 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shadow-xs">
              <Layers className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">Gom nhóm biến thể lỗi CapCut (Pinyin & Ngữ cảnh)</h2>
                <span className="px-2 py-0.5 bg-amber-400/20 border border-amber-300/30 text-amber-200 text-[10px] font-semibold rounded-full">
                  AI Auto-Caption Homophones
                </span>
              </div>
              <p className="text-xs text-indigo-100 mt-0.5">
                Xác định các tên cùng 1 nhân vật bị CapCut nghe nhầm thành nhiều chữ Hán khác nhau và gom vào cùng 1 dòng
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Info Banner */}
        <div className="p-3 bg-amber-50/70 border-b border-amber-200/60 text-xs text-amber-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              <strong>Cơ chế hoạt động:</strong> CapCut tự động nghe âm thanh để tạo chữ Hán nên thường nhầm giữa các từ đồng âm (Pinyin giống nhau nhưng chữ Hán khác, ví dụ: <em>常青 vs 长青</em>, <em>端沧海 vs 段沧海</em>).
            </p>
            <p className="text-amber-800">
              AI sẽ phân tích Pinyin + ngữ cảnh file SRT để chọn <strong>1 tên Hán Việt chuẩn</strong>, sau đó gom toàn bộ các chữ Hán bị nghe nhầm vào cột <code>chinese</code> (dạng <code>常青 / 长青 / 尝青</code>). Nhờ đó, Glossary sẽ tự động nhận diện dù CapCut viết chữ Hán nào cũng đều dịch thống nhất ra 1 tên chuẩn!
            </p>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Action trigger button */}
          {!hasAnalyzed && !isAnalyzing && (
            <div className="py-10 text-center space-y-4 max-w-lg mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-indigo-600 shadow-xs">
                <Sparkles className="w-7 h-7 text-indigo-500 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Sẵn sàng phân tích {characters.length} nhân vật trong bảng
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  AI sẽ đối chiếu phiên âm Pinyin của từng tên kết hợp ngữ cảnh câu trong file SRT ({preloadedRows.length} dòng Cột B) để tự động gom nhóm.
                </p>
              </div>
              <button
                onClick={handleStartAnalysis}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-200 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>Bắt đầu phân tích & Gom nhóm biến thể</span>
              </button>
            </div>
          )}

          {/* Loading status */}
          {isAnalyzing && (
            <div className="py-14 text-center space-y-3">
              <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-700">{statusMessage}</p>
              <p className="text-[11px] text-slate-400">
                Đang sử dụng model <strong>{selectedModel.name}</strong> để phân tích ngữ cảnh và đối chiếu âm đọc Pinyin...
              </p>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Đã xảy ra lỗi:</p>
                <p className="mt-0.5">{errorMessage}</p>
              </div>
              <button
                onClick={handleStartAnalysis}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium"
              >
                Thử lại
              </button>
            </div>
          )}

          {/* Result Clusters */}
          {hasAnalyzed && !isAnalyzing && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold text-slate-700">
                    Kết quả: Phát hiện {detectedClusters.length} nhóm nhân vật bị CapCut nghe nhầm
                  </span>
                  <span className="text-xs text-slate-500">
                    ({unmodifiedCharacters.length} nhân vật khác không bị lỗi, được giữ nguyên)
                  </span>
                </div>
                <button
                  onClick={handleStartAnalysis}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                >
                  <RefreshCw className="w-3 h-3 text-slate-500" />
                  <span>Phân tích lại</span>
                </button>
              </div>

              {detectedClusters.length === 0 ? (
                <div className="py-8 text-center text-slate-500 space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <p className="text-sm font-semibold text-slate-700">
                    Không phát hiện biến thể nghe nhầm nào!
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Các nhân vật trong bảng hiện tại có phiên âm Pinyin và danh tính độc lập, không có dấu hiệu bị CapCut nhận diện trùng lặp.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {detectedClusters.map((cluster, idx) => (
                    <div
                      key={cluster.id}
                      className={`border rounded-xl p-3 transition-all ${
                        cluster.selected
                          ? 'bg-indigo-50/40 border-indigo-300 ring-1 ring-indigo-200'
                          : 'bg-slate-50/50 border-slate-200 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={cluster.selected}
                            onChange={() => toggleClusterSelection(cluster.id)}
                            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                          />
                          <span className="text-xs font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-md">
                            Nhóm {idx + 1}
                          </span>
                          <span className="text-sm font-bold text-indigo-900">
                            {cluster.standardHanViet}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {cluster.mergedChinese}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {cluster.gender}
                          </span>
                        </div>
                        {cluster.reason && (
                          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                            💡 {cluster.reason}
                          </span>
                        )}
                      </div>

                      {/* Comparison: Original vs Merged */}
                      <div className="pl-6 space-y-1.5">
                        <div className="text-[11px] text-slate-500 font-medium">
                          Các dòng gốc bị CapCut nghe nhầm được sáp nhập vào dòng này:
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {cluster.originalCharacters.map((orig, oIdx) => (
                            <div
                              key={oIdx}
                              className="text-xs p-2 bg-white rounded-lg border border-slate-200 flex flex-col justify-between"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-800">{orig.hanViet}</span>
                                <span className="font-mono text-slate-500">{orig.chinese || '-'}</span>
                              </div>
                              {orig.note && (
                                <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                                  {orig.note}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Note preview */}
                        {cluster.note && (
                          <div className="mt-2 text-xs text-slate-600 bg-white/70 p-2 rounded border border-slate-200/80">
                            <span className="font-semibold text-slate-700">Thân phận sau khi gộp: </span>
                            {cluster.note}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Đóng
          </button>

          {hasAnalyzed && detectedClusters.length > 0 && (
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-200 transition-all hover:scale-[1.01]"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                Áp dụng {detectedClusters.filter((c) => c.selected).length} nhóm vào Bảng nhân vật
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
