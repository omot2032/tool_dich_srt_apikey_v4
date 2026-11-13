import React, { useState } from 'react';
import { ApiKeyItem, GeminiModelOption } from '../types';
import { GEMINI_MODELS } from '../data/models';
import { Key, RotateCcw, CheckCircle2, AlertCircle, ShieldAlert, Plus, Trash2, Zap, Info, Clock } from 'lucide-react';

interface ApiKeyManagerProps {
  apiKeys: ApiKeyItem[];
  selectedModel: GeminiModelOption;
  onSelectModel: (model: GeminiModelOption) => void;
  onUpdateKeys: (keys: ApiKeyItem[]) => void;
  onResetKeyCounts: (onlyCurrentModel?: boolean) => void;
  onResetKeyStatus?: (keyId?: string) => void;
  currentActiveKeyIndex: number;
}

export const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({
  apiKeys,
  selectedModel,
  onSelectModel,
  onUpdateKeys,
  onResetKeyCounts,
  onResetKeyStatus,
  currentActiveKeyIndex,
}) => {
  const [rawKeyInput, setRawKeyInput] = useState('');
  const [showInputModal, setShowInputModal] = useState(false);
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null);
  const [statusToast, setStatusToast] = useState<{ msg: string; type?: 'success' | 'info' } | null>(null);

  const handleResetAllStatus = () => {
    if (onResetKeyStatus) {
      onResetKeyStatus();
    } else {
      const updated = apiKeys.map((k) => {
        const updatedModelStatus = { ...(k.modelStatus || {}) };
        updatedModelStatus[selectedModel.id] = 'ready';
        const updatedUsedByModel = { ...(k.usedByModel || {}) };
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
      });
      onUpdateKeys(updated);
    }
    setStatusToast({
      msg: `Đã đặt lại trạng thái tất cả ${apiKeys.length} API Key về "Sẵn sàng"!`,
      type: 'success',
    });
    setTimeout(() => setStatusToast(null), 4000);
  };

  const handleResetSingleKeyStatus = (keyId: string, index: number) => {
    if (onResetKeyStatus) {
      onResetKeyStatus(keyId);
    } else {
      const updated = apiKeys.map((k) => {
        if (k.id !== keyId) return k;
        const updatedModelStatus = { ...(k.modelStatus || {}) };
        updatedModelStatus[selectedModel.id] = 'ready';
        const updatedUsedByModel = { ...(k.usedByModel || {}) };
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
      });
      onUpdateKeys(updated);
    }
    setStatusToast({
      msg: `Đã đặt lại trạng thái API Key #${index + 1} về "Sẵn sàng"!`,
      type: 'success',
    });
    setTimeout(() => setStatusToast(null), 3000);
  };

  const handleSaveRawKeys = () => {
    const lines = rawKeyInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 10);

    if (lines.length === 0) {
      setStatusToast({
        msg: 'Vui lòng nhập ít nhất một API Key hợp lệ (mỗi dòng 1 key).',
        type: 'info',
      });
      setTimeout(() => setStatusToast(null), 3000);
      return;
    }

    // Preserve existing counts if key already exists
    const existingKeyMap = new Map<string, ApiKeyItem>(apiKeys.map((k) => [k.key, k]));

    const newKeys: ApiKeyItem[] = lines.map((key, idx) => {
      const existing = existingKeyMap.get(key);
      const masked = key.length > 12 ? `${key.substring(0, 7)}...${key.substring(key.length - 5)}` : key;
      return {
        id: existing?.id || `key-${idx + 1}-${Date.now()}`,
        key,
        maskedKey: masked,
        usedToday: existing?.usedToday || 0,
        usedByModel: existing?.usedByModel || {},
        modelStatus: existing?.modelStatus || {},
        status: existing?.status || 'ready',
        lastUsedAt: existing?.lastUsedAt,
        lastError: existing?.lastError,
      };
    });

    onUpdateKeys(newKeys);
    setShowInputModal(false);
    setRawKeyInput('');
  };

  const handleTestKey = async (item: ApiKeyItem) => {
    setTestingKeyId(item.id);
    setTestResult(null);

    try {
      const res = await fetch('/api/gemini/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: item.key, model: selectedModel.modelCode }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setTestResult({ id: item.id, success: true, msg: 'Hợp lệ! Kết nối thành công.' });
        const updated = apiKeys.map((k) => {
          if (k.id === item.id) {
            const updatedModelStatus = { ...(k.modelStatus || {}), [selectedModel.id]: 'ready' as const };
            return { ...k, status: 'ready' as const, modelStatus: updatedModelStatus, lastError: undefined };
          }
          return k;
        });
        onUpdateKeys(updated);
      } else {
        setTestResult({ id: item.id, success: false, msg: data.error || 'Lỗi API Key' });
        const updated = apiKeys.map((k) => {
          if (k.id === item.id) {
            const updatedModelStatus = { ...(k.modelStatus || {}), [selectedModel.id]: 'error' as const };
            return { ...k, status: 'error' as const, modelStatus: updatedModelStatus, lastError: data.error };
          }
          return k;
        });
        onUpdateKeys(updated);
      }
    } catch (err: any) {
      setTestResult({ id: item.id, success: false, msg: err.message || 'Lỗi mạng' });
    } finally {
      setTestingKeyId(null);
    }
  };

  const handleDeleteKey = (id: string) => {
    const updated = apiKeys.filter((k) => k.id !== id);
    onUpdateKeys(updated);
  };

  const totalUsedForModel = apiKeys.reduce(
    (sum, k) => sum + (k.usedByModel?.[selectedModel.id] ?? 0),
    0
  );
  const totalMaxQuota = apiKeys.length * selectedModel.dailyLimit;
  const remainingTotal = Math.max(0, totalMaxQuota - totalUsedForModel);

  return (
    <div id="api-key-manager-section" className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
      {/* Top Header: Model Selector & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <Key className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-slate-800">Quản Lý Gemini API Keys & Model</h2>
          </div>
          <p className="text-xs text-slate-500">
            Hỗ trợ nhập 30-40 API Key, tự động xoay vòng khi hết quota ({selectedModel.dailyLimit} lượt/key/ngày)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Model Selection Dropdown */}
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <label htmlFor="model-select" className="text-xs font-semibold text-slate-600 whitespace-nowrap">
              Model:
            </label>
            <select
              id="model-select"
              value={selectedModel.id}
              onChange={(e) => {
                const found = GEMINI_MODELS.find((m) => m.id === e.target.value);
                if (found) onSelectModel(found);
              }}
              className="text-xs font-bold text-blue-700 bg-transparent outline-none cursor-pointer pr-2"
            >
              <optgroup label="Flash Lite (500 lượt/ngày)">
                {GEMINI_MODELS.filter((m) => m.dailyLimit === 500).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (500 lượt / ngày)
                  </option>
                ))}
              </optgroup>
              <optgroup label="Flash (20 lượt/ngày)">
                {GEMINI_MODELS.filter((m) => m.dailyLimit === 20).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (20 lượt / ngày)
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Add / Import Keys Button */}
          <button
            id="btn-open-add-keys"
            onClick={() => {
              setRawKeyInput(apiKeys.map((k) => k.key).join('\n'));
              setShowInputModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nhập danh sách Key ({apiKeys.length})</span>
          </button>

          {/* Reset Status to Ready Button */}
          <button
            id="btn-reset-all-status-ready"
            onClick={handleResetAllStatus}
            disabled={apiKeys.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs cursor-pointer"
            title="Đặt lại trạng thái tất cả API Key về Sẵn sàng (xóa cờ lỗi, cooldown, mở lại quota)"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Reset trạng thái về Sẵn sàng</span>
          </button>

          {/* Reset Counter Buttons: Current Model vs All Models */}
          <div className="inline-flex rounded-lg shadow-xs">
            <button
              id="btn-reset-current-model"
              onClick={() => {
                if (confirm(`Đặt lại số lượt đếm của riêng Model "${selectedModel.name}" về 0?`)) {
                  onResetKeyCounts(true);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold rounded-l-lg border border-amber-200 transition-colors"
              title={`Đặt lại lượt đếm của model ${selectedModel.name}`}
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Reset lượt ({selectedModel.name.replace('Gemini ', '')})</span>
            </button>
            <button
              id="btn-reset-all-models"
              onClick={() => {
                if (confirm('Đặt lại số lượt đếm của TẤT CẢ các Model về 0?')) {
                  onResetKeyCounts(false);
                }
              }}
              className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold rounded-r-lg border-t border-r border-b border-amber-200 border-l border-amber-300 transition-colors"
              title="Đặt lại toàn bộ lượt đếm của tất cả các model về 0"
            >
              Tất cả
            </button>
          </div>
        </div>
      </div>

      {/* Informative Note: Independent Per-Model Quota Rule */}
      <div className="flex items-start gap-2.5 p-3 bg-gradient-to-r from-blue-50/90 to-indigo-50/70 border border-blue-200 rounded-xl text-xs text-blue-950 shadow-2xs">
        <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg shrink-0 mt-0.5">
          <Info className="w-4 h-4" />
        </span>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-blue-900 text-xs">
              📌 Ghi chú hạn mức: Tính độc lập riêng biệt cho từng Model
            </span>
            <span className="bg-blue-200/80 text-blue-900 font-semibold px-2 py-0.5 rounded-full text-[10px]">
              Đang chọn: {selectedModel.name} ({selectedModel.dailyLimit} lượt/ngày)
            </span>
          </div>
          <p className="text-blue-800 text-[11px] leading-relaxed">
            Hạn mức sử dụng được tính riêng cho từng Model (không gộp chung). Ví dụ: Khi bạn dùng <strong>Gemini 3.5 Flash</strong> 1 lượt (còn 19 lượt), nếu chuyển sang <strong>Gemini 3.6 Flash</strong> thì hạn mức của model mới vẫn nguyên vẹn <strong>20 lượt</strong>. Tương tự đối với các dòng <strong>Flash Lite</strong> vẫn tính riêng <strong>500 lượt/ngày</strong> cho mỗi model.
          </p>
        </div>
      </div>

      {/* Quota Overview Card */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200/80 text-center">
        <div>
          <span className="text-[11px] text-slate-500 block uppercase tracking-wider font-semibold">Tổng số Key</span>
          <span className="text-base font-bold text-slate-800">{apiKeys.length} keys</span>
        </div>
        <div>
          <span className="text-[11px] text-slate-500 block uppercase tracking-wider font-semibold">
            Hạn mức ({selectedModel.name.replace('Gemini ', '')})
          </span>
          <span className="text-base font-bold text-blue-600">{selectedModel.dailyLimit} lượt / key</span>
        </div>
        <div>
          <span className="text-[11px] text-slate-500 block uppercase tracking-wider font-semibold">
            Đã dùng ({selectedModel.name.replace('Gemini ', '')})
          </span>
          <span className="text-base font-bold text-slate-700">{totalUsedForModel.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-[11px] text-slate-500 block uppercase tracking-wider font-semibold">
            Còn lại ({selectedModel.name.replace('Gemini ', '')})
          </span>
          <span className="text-base font-bold text-emerald-600">{remainingTotal.toLocaleString()} lượt</span>
        </div>
      </div>

      {/* Key Table / List */}
      {apiKeys.length === 0 ? (
        <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          <Key className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-600">Chưa có API Key nào được nhập</p>
          <p className="text-xs text-slate-400 mt-1">
            Bấm "Nhập danh sách Key" để dán 30-40 API Key Gemini (mỗi key 1 dòng).
          </p>
          <button
            onClick={() => setShowInputModal(true)}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm"
          >
            + Nhập API Keys ngay
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-60 border border-slate-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/80 text-slate-600 font-semibold border-b border-slate-200 sticky top-0">
              <tr>
                <th className="py-2.5 px-3 w-12 text-center">STT</th>
                <th className="py-2.5 px-3">API Key</th>
                <th className="py-2.5 px-3 text-center">
                  Đã dùng ({selectedModel.name.replace('Gemini ', '')})
                </th>
                <th className="py-2.5 px-3 text-center">Còn lại</th>
                <th className="py-2.5 px-3">Tiến độ ({selectedModel.name.replace('Gemini ', '')})</th>
                <th className="py-2.5 px-3 text-center">Trạng thái</th>
                <th className="py-2.5 px-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {apiKeys.map((item, index) => {
                const limit = selectedModel.dailyLimit;
                const modelUsage = item.usedByModel?.[selectedModel.id] ?? 0;
                const remaining = Math.max(0, limit - modelUsage);
                const percent = Math.min(100, Math.round((modelUsage / limit) * 100));
                const isActive = index === currentActiveKeyIndex;
                const isModelExhausted =
                  item.modelStatus?.[selectedModel.id] === 'quota_exceeded' || modelUsage >= limit;

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isActive ? 'bg-blue-50/60 font-medium' : ''
                    }`}
                  >
                    <td className="py-2 px-3 text-center font-semibold text-slate-500">
                      {isActive ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px]">
                          {index + 1}
                        </span>
                      ) : (
                        index + 1
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <span>{item.maskedKey}</span>
                        {isActive && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded font-sans font-bold">
                            Đang dùng
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center font-bold text-slate-700">
                      {modelUsage} / {limit}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`font-bold ${
                          isModelExhausted ? 'text-red-500' : remaining <= 5 ? 'text-amber-500' : 'text-emerald-600'
                        }`}
                      >
                        {remaining}
                      </span>
                    </td>
                    <td className="py-2 px-3 w-40">
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full ${
                            percent >= 100 ? 'bg-red-500' : percent > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {isModelExhausted ? (
                        <button
                          type="button"
                          onClick={() => handleResetSingleKeyStatus(item.id, index)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 hover:bg-emerald-50 text-red-700 hover:text-emerald-700 border border-red-200 hover:border-emerald-300 rounded text-[11px] font-medium transition-colors cursor-pointer group"
                          title="Hết quota ngày của model này. Bấm vào đây để reset về Sẵn sàng"
                        >
                          <ShieldAlert className="w-3 h-3 group-hover:hidden" />
                          <RotateCcw className="w-3 h-3 hidden group-hover:inline text-emerald-600" />
                          <span className="group-hover:hidden">Hết Quota</span>
                          <span className="hidden group-hover:inline font-bold text-emerald-700">Về Sẵn sàng</span>
                        </button>
                      ) : item.status === 'error' ? (
                        <button
                          type="button"
                          onClick={() => handleResetSingleKeyStatus(item.id, index)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-50 hover:bg-emerald-50 text-rose-700 hover:text-emerald-700 border border-rose-200 hover:border-emerald-300 rounded text-[11px] font-medium transition-colors cursor-pointer group"
                          title={item.lastError ? `Lỗi: ${item.lastError}. Bấm để reset về Sẵn sàng` : 'Bấm để reset về Sẵn sàng'}
                        >
                          <AlertCircle className="w-3 h-3 group-hover:hidden" />
                          <RotateCcw className="w-3 h-3 hidden group-hover:inline text-emerald-600" />
                          <span className="group-hover:hidden">Lỗi</span>
                          <span className="hidden group-hover:inline font-bold text-emerald-700">Về Sẵn sàng</span>
                        </button>
                      ) : item.status === 'cooldown' ? (
                        <button
                          type="button"
                          onClick={() => handleResetSingleKeyStatus(item.id, index)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 hover:bg-emerald-50 text-amber-700 hover:text-emerald-700 border border-amber-200 hover:border-emerald-300 rounded text-[11px] font-medium transition-colors cursor-pointer group"
                          title="Đang tạm dừng giãn cách RPM. Bấm để bỏ qua và về Sẵn sàng ngay"
                        >
                          <Clock className="w-3 h-3 group-hover:hidden" />
                          <RotateCcw className="w-3 h-3 hidden group-hover:inline text-emerald-600" />
                          <span className="group-hover:hidden">Giãn cách</span>
                          <span className="hidden group-hover:inline font-bold text-emerald-700">Về Sẵn sàng</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[11px] font-medium">
                          <CheckCircle2 className="w-3 h-3" /> Sẵn sàng
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleResetSingleKeyStatus(item.id, index)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            isModelExhausted || item.status === 'error' || item.status === 'cooldown'
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold shadow-2xs'
                              : 'bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600'
                          }`}
                          title="Đặt lại trạng thái key này về Sẵn sàng"
                        >
                          <RotateCcw className="w-3 h-3 text-emerald-600" />
                          <span>Sẵn sàng</span>
                        </button>
                        <button
                          onClick={() => handleTestKey(item)}
                          disabled={testingKeyId === item.id}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors"
                          title="Kiểm tra kết nối key"
                        >
                          {testingKeyId === item.id ? 'Đang test...' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleDeleteKey(item.id)}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Xóa key này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {statusToast && (
        <div className="p-2.5 rounded-lg text-xs flex items-center justify-between bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{statusToast.msg}</span>
          </div>
          <button
            onClick={() => setStatusToast(null)}
            className="text-emerald-500 hover:text-emerald-700 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {testResult && (
        <div
          className={`p-2.5 rounded-lg text-xs flex items-center justify-between ${
            testResult.success
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{testResult.msg}</span>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Modal / Dialog for Raw Key Input */}
      {showInputModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                  <Key className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-slate-800">Nhập danh sách Gemini API Keys</h3>
              </div>
              <button
                onClick={() => setShowInputModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="raw-keys-textarea" className="block text-xs font-semibold text-slate-700">
                Dán 30-40 API Key của bạn (mỗi dòng 1 key):
              </label>
              <textarea
                id="raw-keys-textarea"
                rows={10}
                value={rawKeyInput}
                onChange={(e) => setRawKeyInput(e.target.value)}
                placeholder={`AIzaSyA123456789...
AIzaSyB987654321...
AIzaSyC112233445...`}
                className="w-full font-mono text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <p className="text-[11px] text-slate-500">
                Mỗi key sẽ được kiểm tra và tự động phân bổ theo số lượt của model đang chọn ({selectedModel.name}).
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowInputModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveRawKeys}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
              >
                Lưu danh sách Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
