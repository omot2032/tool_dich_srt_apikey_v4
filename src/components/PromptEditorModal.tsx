import React, { useState } from 'react';
import { FileText, RotateCcw, Eye, Save, Sparkles, Subtitles, BookOpen } from 'lucide-react';
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_STORY_PROMPT } from '../data/defaultPrompt';
import { CharacterItem } from '../types';
import { formatCharactersForPrompt } from '../data/defaultCharacters';

interface PromptEditorModalProps {
  promptTemplate: string;
  onSavePrompt: (prompt: string) => void;
  characters: CharacterItem[];
  isOpen: boolean;
  onClose: () => void;
}

export const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
  promptTemplate,
  onSavePrompt,
  characters,
  isOpen,
  onClose,
}) => {
  const [currentPrompt, setCurrentPrompt] = useState(promptTemplate);
  const [showPreview, setShowPreview] = useState(false);

  if (!isOpen) return null;

  const charactersTableStr = formatCharactersForPrompt(characters);
  const previewPrompt = currentPrompt
    .replace('{{CHARACTERS_TABLE}}', charactersTableStr)
    .replace(
      '{{CONTENT}}',
      `[1] ( 3.3s): 常青缓缓睁开双眼，看着周围熟悉的陈设。\n[2] ( 1.8s): 九天十地的青帝，竟然真的重生在常家了。\n[3] ( 2.5s): “这一世，我绝不会让当年的悲剧重演。”`
    );

  const handleSelectSrtPreset = () => {
    setCurrentPrompt(DEFAULT_TRANSLATION_PROMPT);
  };

  const handleSelectStoryPreset = () => {
    setCurrentPrompt(DEFAULT_STORY_PROMPT);
  };

  const handleReset = () => {
    if (confirm('Khôi phục lại prompt dịch phụ đề SRT mặc định?')) {
      setCurrentPrompt(DEFAULT_TRANSLATION_PROMPT);
    }
  };

  const handleSave = () => {
    onSavePrompt(currentPrompt);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-4xl w-full flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <FileText className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-800">Tùy Biến Prompt Dịch Phụ Đề SRT / Truyện</h2>
              <p className="text-xs text-slate-500">
                Chỉnh sửa prompt gửi đến Gemini. Sử dụng thẻ <code className="text-emerald-700 bg-emerald-50 px-1 rounded">{'{{CHARACTERS_TABLE}}'}</code> và <code className="text-emerald-700 bg-emerald-50 px-1 rounded">{'{{CONTENT}}'}</code>.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Presets & Action bar */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                showPreview ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {showPreview ? 'Chế độ chỉnh sửa' : 'Xem trước Prompt thực tế'}
            </button>
            <button
              onClick={handleSelectSrtPreset}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 rounded-lg font-medium"
              title="Prompt tối ưu cho file SRT, bảo toàn thẻ [1], [2]... để ghép timecode 100% chính xác"
            >
              <Subtitles className="w-3.5 h-3.5 text-blue-600" /> Mẫu: Dịch Phụ Đề SRT (Khuyên dùng)
            </button>
            <button
              onClick={handleSelectStoryPreset}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 hover:bg-purple-100 text-purple-800 rounded-lg font-medium"
              title="Prompt dịch tiểu thuyết / truyện văn học dài"
            >
              <BookOpen className="w-3.5 h-3.5 text-purple-600" /> Mẫu: Dịch Tiểu Thuyết
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 rounded-lg font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Mặc định
            </button>
          </div>

          <div className="text-slate-500 text-[11px] hidden sm:block">
            Bao gồm {characters.length} nhân vật từ Bảng tên
          </div>
        </div>

        {/* Body Editor or Preview */}
        <div className="flex-1 overflow-y-auto p-4">
          {showPreview ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>Đây là toàn bộ nội dung prompt sẽ được gửi cho Gemini khi gọi dịch:</span>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl font-mono text-xs whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {previewPrompt}
              </pre>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Nội dung mẫu prompt:</span>
                <span className="text-[11px]">Độ dài: {currentPrompt.length.toLocaleString()} ký tự</span>
              </div>
              <textarea
                rows={18}
                value={currentPrompt}
                onChange={(e) => setCurrentPrompt(e.target.value)}
                className="w-full p-4 font-mono text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 leading-relaxed"
                placeholder="Nhập prompt dịch tại đây..."
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium"
          >
            Đóng
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-xs transition-colors"
          >
            <Save className="w-4 h-4" /> Lưu Prompt
          </button>
        </div>
      </div>
    </div>
  );
};
