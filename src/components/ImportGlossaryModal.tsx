import React, { useState, useRef } from 'react';
import { CharacterItem } from '../types';
import {
  parseGlossaryContent,
  ParsedGlossaryResult,
} from '../utils/glossaryUtils';
import {
  BookOpen,
  Upload,
  FileText,
  Check,
  X,
  Layers,
  Sparkles,
  Users,
  MapPin,
  Tag,
  Award,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';

interface ImportGlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyGlossary: (items: CharacterItem[], mode: 'replace' | 'append') => void;
  existingCount: number;
}

export const ImportGlossaryModal: React.FC<ImportGlossaryModalProps> = ({
  isOpen,
  onClose,
  onApplyGlossary,
  existingCount,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [parsedResult, setParsedResult] = useState<ParsedGlossaryResult | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  // Handle file select
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setErrorMsg(null);
      setSelectedFileName(file.name);
      const text = await file.text();
      const result = parseGlossaryContent(text);
      if (result.totalItems === 0) {
        setErrorMsg('Không tìm thấy dòng từ điển hợp lệ trong file. Vui lòng kiểm tra định dạng (Ví dụ: 三才 = Tam Tài [Male]: Lý Tam Tài...).');
        setParsedResult(null);
      } else {
        setParsedResult(result);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi khi đọc file Glossary');
      setParsedResult(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle parsing pasted text
  const handleParsePastedText = () => {
    if (!pastedText.trim()) {
      setErrorMsg('Vui lòng dán nội dung Glossary vào ô văn bản.');
      return;
    }
    setErrorMsg(null);
    const result = parseGlossaryContent(pastedText);
    if (result.totalItems === 0) {
      setErrorMsg('Không nhận diện được dòng Glossary hợp lệ nào. Cần có định dạng: Tên_Gốc = Tên_Dịch [Giới_tính]: Mô_tả');
      setParsedResult(null);
    } else {
      setSelectedFileName('Nội dung đã dán');
      setParsedResult(result);
    }
  };

  // Apply to character dictionary
  const handleConfirmApply = () => {
    if (!parsedResult || parsedResult.characters.length === 0) {
      setErrorMsg('Chưa có danh sách từ điển nào để áp dụng.');
      return;
    }
    onApplyGlossary(parsedResult.characters, importMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>Nhập Bảng Tên & Thuật Ngữ Từ File Glossary</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Chuẩn hóa SRT
                </span>
              </h2>
              <p className="text-xs text-slate-600">
                Tự động nhận diện Nhân vật, Thuật ngữ, Địa danh, Họ, Chức danh để AI dịch chuẩn xác 100%
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/80 text-lg font-bold transition-colors cursor-pointer"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex border-b border-slate-200 bg-slate-50/70 px-4 pt-2 gap-2 text-xs font-bold">
          <button
            onClick={() => setActiveTab('upload')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'upload'
                ? 'border-emerald-600 text-emerald-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-sky-600" />
            <span>Tải lên file (.txt, .tsv, .csv)</span>
          </button>
          <button
            onClick={() => setActiveTab('paste')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'paste'
                ? 'border-emerald-600 text-emerald-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            <span>Dán nội dung trực tiếp</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

          {/* Tab 2: File Upload */}
          {activeTab === 'upload' && (
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50 hover:bg-slate-100/60 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.tsv,.csv,.json"
                onChange={handleFileChange}
                className="hidden"
                id="glossary-file-input"
              />
              <label
                htmlFor="glossary-file-input"
                className="cursor-pointer flex flex-col items-center justify-center gap-2"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700">
                    Nhấp vào đây để chọn file Glossary từ máy tính
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Hỗ trợ file văn bản (.txt, .tsv, .csv) định dạng "raw_name = translated_name [gender]: description"
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Tab 3: Paste text */}
          {activeTab === 'paste' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                Dán nội dung từ file Glossary vào đây:
              </label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={`=== CHARACTERS ===\n三才 = Tam Tài [Male]: Lý Tam Tài, đại thần triều đình\n\n=== TERMS ===\n子母铳 = Tử Mẫu Xung: Loại hỏa khí thời nhà Minh\n\n=== LOCATIONS ===\n东森书院 = Đông Sâm Thư Viện: Thư viện do Tôn Kế Nghiệp thành lập...`}
                className="w-full h-36 text-xs p-3 font-mono border border-slate-300 rounded-xl outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={handleParsePastedText}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
              >
                Phân tích nội dung đã dán
              </button>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Parsed Preview Section */}
          {parsedResult && parsedResult.totalItems > 0 && (
            <div className="space-y-3 pt-2">
              {/* Summary Stats */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>Đã nhận diện: <strong>{parsedResult.totalItems} mục</strong> ({selectedFileName})</span>
                  </h4>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {parsedResult.sections.map((sec, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-2xs"
                      >
                        {sec.name === 'Nhân vật' && <Users className="w-3 h-3 text-indigo-600" />}
                        {sec.name === 'Thuật ngữ' && <Tag className="w-3 h-3 text-emerald-600" />}
                        {sec.name === 'Địa danh' && <MapPin className="w-3 h-3 text-amber-600" />}
                        {sec.name === 'Họ' && <Users className="w-3 h-3 text-sky-600" />}
                        {sec.name === 'Chức danh' && <Award className="w-3 h-3 text-purple-600" />}
                        <span>{sec.name}: {sec.items.length}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Import Mode Selector */}
                <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-slate-200 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="text-emerald-600"
                    />
                    <span>Thay thế bảng hiện tại</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      className="text-emerald-600"
                    />
                    <span>Gộp thêm ({existingCount} mục hiện có)</span>
                  </label>
                </div>
              </div>

              {/* Table Preview (max 10 rows preview) */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 w-12 text-center">STT</th>
                      <th className="py-2 px-3 w-32">Chữ Hán / Gốc</th>
                      <th className="py-2 px-3 w-40">Tên Hán Việt / Bản dịch</th>
                      <th className="py-2 px-3 w-28">Phân loại / Giới tính</th>
                      <th className="py-2 px-3">Ghi chú / Giải nghĩa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedResult.characters.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900 font-serif">
                          {item.chinese}
                        </td>
                        <td className="py-2 px-3 font-bold text-indigo-700">
                          {item.hanViet}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.gender === 'Nam' ? 'bg-blue-100 text-blue-800' :
                            item.gender === 'Nữ' ? 'bg-rose-100 text-rose-800' :
                            item.gender === 'Địa danh' ? 'bg-amber-100 text-amber-800' :
                            item.gender === 'Thuật ngữ' ? 'bg-emerald-100 text-emerald-800' :
                            item.gender === 'Họ' ? 'bg-sky-100 text-sky-800' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {item.gender}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600 text-[11px] truncate max-w-xs">
                          {item.note || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={handleConfirmApply}
            disabled={!parsedResult || parsedResult.totalItems === 0}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>
              {importMode === 'replace'
                ? `Áp dụng ${parsedResult?.totalItems || 0} mục (Thay thế bảng)`
                : `Gộp thêm ${parsedResult?.totalItems || 0} mục vào bảng`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
