import { X } from 'lucide-react';

interface FormatGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FormatGuideModal({ isOpen, onClose }: FormatGuideModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="format-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <h3
            id="format-guide-title"
            className="text-base font-semibold text-slate-900"
          >
            標準 SRT 字幕格式說明
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉說明"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm text-slate-600 leading-relaxed">
          <p>
            SubRip（.srt）是最通用的純文字字幕格式，適用於 Premiere Pro、Final Cut Pro、DaVinci Resolve、剪映及 YouTube 等平台。每段字幕由四個部分組成：
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-slate-700">
            <li>遞增的整數序號（由 1 開始）</li>
            <li>起訖時間軸，格式為 <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">HH:MM:SS,mmm --{'>'} HH:MM:SS,mmm</code></li>
            <li>一至兩行的繁體中文字幕文字</li>
            <li>一段空白行作為段落分隔</li>
          </ol>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-700 leading-relaxed">
            1<br />
            00:00:01,200 --{'>'} 00:00:04,650<br />
            這是一段標準的繁體中文字幕範例<br />
            <br />
            2<br />
            00:00:04,900 --{'>'} 00:00:08,150<br />
            下載後的檔案可直接匯入剪輯軟體使用
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            了解
          </button>
        </div>
      </div>
    </div>
  );
}
