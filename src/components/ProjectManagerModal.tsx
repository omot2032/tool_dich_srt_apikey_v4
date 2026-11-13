import React, { useState } from 'react';
import { StoryProject } from '../types';
import {
  FolderOpen,
  Clock,
  CheckCircle2,
  Trash2,
  Edit3,
  Check,
  X,
  Subtitles,
  Users,
  Plus,
  BookOpen,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: StoryProject[];
  currentProjectId: string | null;
  onSelectProject: (project: StoryProject) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  onStartNewProject: () => void;
}

export const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onDeleteProject,
  onRenameProject,
  onStartNewProject,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartRename = (p: StoryProject) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const handleSaveRename = async (id: string) => {
    if (editingName.trim()) {
      await onRenameProject(id, editingName.trim());
    }
    setEditingId(null);
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return 'Chưa rõ';
    const date = new Date(timestamp);
    return date.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>Dự Án Đang Làm Dở</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {projects.length} dự án
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Tự động lưu tiến độ dịch và Bảng nhân vật riêng biệt cho từng truyện
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 text-lg font-bold transition-colors cursor-pointer"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {projects.length === 0 ? (
            <div className="text-center py-12 px-4 border border-dashed border-slate-300 rounded-xl bg-slate-50">
              <BookOpen className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-700 mb-1">Chưa có dự án nào được lưu</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                Khi bạn tải file Excel truyện lên, hệ thống sẽ tự động tạo một dự án mới kèm Bảng nhân vật và tiến độ dịch để bạn có thể tắt máy và quay lại làm tiếp bất kỳ lúc nào!
              </p>
              <button
                onClick={() => {
                  onClose();
                  onStartNewProject();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Bắt đầu dự án mới ngay</span>
              </button>
            </div>
          ) : (
            projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const completed = p.completedChunks ?? 0;
              const total = p.totalChunks ?? 0;
              const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
              const isEditing = editingId === p.id;
              const isDeleting = confirmDeleteId === p.id;

              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isCurrent
                      ? 'border-blue-500 bg-blue-50/40 shadow-xs ring-1 ring-blue-400/50'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-2xs'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Left: Project Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 flex-1 max-w-md">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="px-2 py-1 border border-blue-400 rounded text-sm font-bold w-full outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveRename(p.id)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                              title="Lưu tên"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                              title="Hủy"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-sm sm:text-base font-bold text-slate-800 truncate">
                              {p.name}
                            </h3>
                            <button
                              onClick={() => handleStartRename(p)}
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                              title="Đổi tên dự án"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {isCurrent && (
                              <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
                                Đang mở
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      {/* File Name & Metadata */}
                      <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500 mb-2.5">
                        <span className="flex items-center gap-1 font-mono text-slate-600">
                          <Subtitles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="truncate max-w-[200px]">{p.fileName}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          <span>{p.characters?.length || 0} nhân vật</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>{formatDate(p.lastUpdatedAt)}</span>
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-slate-600">
                            Tiến độ dịch:{' '}
                            <strong className="text-slate-800">
                              {completed}/{total} cụm
                            </strong>
                          </span>
                          <span className={`${percent === 100 ? 'text-emerald-600' : 'text-blue-600'}`}>
                            {percent}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 rounded-full ${
                              percent === 100 ? 'bg-emerald-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                      {isDeleting ? (
                        <div className="flex items-center gap-2 p-2 bg-rose-50 border border-rose-200 rounded-lg">
                          <span className="text-xs text-rose-700 font-medium">Xác nhận xóa?</span>
                          <button
                            onClick={async () => {
                              await onDeleteProject(p.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded cursor-pointer"
                          >
                            Xóa
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded cursor-pointer"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmDeleteId(p.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Xóa dự án này"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              onSelectProject(p);
                              onClose();
                            }}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-2xs ${
                              isCurrent
                                ? 'bg-slate-800 hover:bg-slate-900 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            <span>{isCurrent ? 'Đang làm tiếp' : 'Mở tiếp tục'}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              onStartNewProject();
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 text-blue-600" />
            <span>Tạo dự án mới (hoặc tải file khác)</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
