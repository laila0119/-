import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileText,
  Play,
  RotateCcw,
} from 'lucide-react';
import { SrtCue, timestampToSeconds } from '../utils/srt';

export type ResultViewMode = 'timeline' | 'raw';

interface SubtitleResultPanelProps {
  srtText: string;
  cues: SrtCue[];
  isProcessing: boolean;
  uploadProgress: { uploadedBytes: number; totalBytes: number } | null;
  errorMessage: string | null;
  fileName: string | null;
  activeCueIndex: number | null;
  hasMedia: boolean;
  onSrtTextChange: (nextSrt: string) => void;
  onCueTextChange: (cueIndex: number, nextText: string) => void;
  onSeekToSeconds: (seconds: number) => void;
  onRetry: () => void;
}

const SAMPLE_SRT_PREVIEW = `1
00:00:00,420 --> 00:00:03,180
歡迎來到本期的數位影像製作指南

2
00:00:03,350 --> 00:00:06,900
今天我們將示範如何快速產生精準的繁體中文字幕

3
00:00:07,120 --> 00:00:10,450
上傳 MP4 影片或 MP3 音訊後即可自動校準時間軸`;

export function SubtitleResultPanel({
  srtText,
  cues,
  isProcessing,
  uploadProgress,
  errorMessage,
  fileName,
  activeCueIndex,
  hasMedia,
  onSrtTextChange,
  onCueTextChange,
  onSeekToSeconds,
  onRetry,
}: SubtitleResultPanelProps) {
  const [viewMode, setViewMode] = useState<ResultViewMode>('raw');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const hasResult = srtText.trim().length > 0;
  const lastCueEnd = cues.length > 0 ? cues[cues.length - 1].endTime.slice(0, 8) : null;

  const handleCopy = async () => {
    if (!hasResult) return;
    try {
      await navigator.clipboard.writeText(srtText);
      setCopied(true);
    } catch {
      // Fallback copy via temporary textarea
      const el = document.createElement('textarea');
      el.value = srtText;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
    }
  };

  const handleDownload = () => {
    if (!hasResult) return;
    const baseName = fileName
      ? fileName.replace(/\.(mp4|mp3)$/i, '')
      : 'subtitles';
    // Include UTF-8 BOM so Windows players/editors read Traditional Chinese cleanly
    const blob = new Blob(['\uFEFF' + srtText], {
      type: 'application/x-subrip;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const uploadPercent =
    uploadProgress && uploadProgress.totalBytes > 0
      ? Math.min(100, Math.round((uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100))
      : 0;

  return (
    <section
      aria-label="SRT 字幕生成結果"
      className="flex flex-col bg-white border border-slate-200 rounded-xl p-6 gap-5 min-h-[600px]"
    >
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            SRT 字幕生成結果
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
            {hasResult ? (
              <>
                <span>共 {cues.length} 句字幕</span>
                {lastCueEnd && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>結尾時間 {lastCueEnd}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>標準 UTF-8 SRT 格式</span>
              </>
            ) : (
              <span>等待媒體上傳並進行語音辨識</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Segmented View Mode Switch */}
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'raw'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              SRT 原始碼
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'timeline'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              時間軸檢視
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!hasResult || isProcessing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-45 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span className="text-emerald-700">已複製文字</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>複製文字</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!hasResult || isProcessing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>下載 .srt</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isProcessing ? (
        <div
          aria-busy="true"
          className="flex-1 flex flex-col gap-3 py-2"
        >
          <div className="flex flex-col gap-2 px-4 py-3 bg-blue-50/70 border border-blue-100 rounded-lg text-xs text-blue-800">
            <div className="flex items-center justify-between gap-2 tabular-nums">
              <span className="font-medium">
                {uploadProgress
                  ? `正在分段上傳大型影音檔案（${(uploadProgress.uploadedBytes / (1024 * 1024)).toFixed(1)} / ${(uploadProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB）...`
                  : '正在呼叫 Gemini 4 Hydrogen 模型解析音軌與校準時間軸，請稍候...'}
              </span>
              {uploadProgress && (
                <span className="font-mono font-semibold">{uploadPercent}%</span>
              )}
            </div>
            {uploadProgress && (
              <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-200"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            )}
          </div>
          {[1, 2, 3, 4, 5, 6].map((row) => (
            <div
              key={row}
              className="p-4 border border-slate-100 rounded-lg bg-slate-50/60 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="h-3.5 w-6 bg-slate-200 rounded" />
                <div className="h-3.5 w-48 bg-slate-200 rounded" />
              </div>
              <div className="mt-3 h-4 w-3/4 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      ) : errorMessage ? (
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 bg-red-50/40 border border-red-200 rounded-xl"
        >
          <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
            <AlertCircle className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">
            語音辨識未能完成
          </h3>
          <p className="mt-1.5 text-sm text-red-700 max-w-md leading-relaxed">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>重新嘗試辨識</span>
          </button>
        </div>
      ) : !hasResult ? (
        <div className="flex-1 flex flex-col justify-between gap-6">
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 bg-slate-50/60 border border-slate-200/80 rounded-xl">
            <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">
              尚未生成字幕內容
            </h3>
            <p className="mt-1.5 text-sm text-slate-500 max-w-md leading-relaxed">
              於左側上傳 MP4 影片或 MP3 音訊後，此處將顯示標準繁體中文 SRT 字幕，並可即時編輯內容、複製文字或下載 .srt 檔案。
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-600 mb-2.5">
              標準 SRT 輸出格式預覽
            </p>
            <pre className="font-mono text-xs text-slate-600 leading-relaxed whitespace-pre-wrap select-none">
              {SAMPLE_SRT_PREVIEW}
            </pre>
          </div>
        </div>
      ) : viewMode === 'raw' ? (
        <div className="flex-1 flex flex-col gap-2">
          <textarea
            value={srtText}
            onChange={(e) => onSrtTextChange(e.target.value)}
            spellCheck={false}
            aria-label="SRT 字幕原始碼編輯區"
            className="flex-1 min-h-[480px] w-full p-4 font-mono text-sm text-slate-800 bg-slate-50/70 border border-slate-200 rounded-lg leading-relaxed resize-none focus:outline-none focus:bg-white focus:border-blue-500 transition-colors"
          />
          <p className="text-xs text-slate-500">
            可直接修改上方 SRT 時間軸與文字，右側預覽與匯出檔案將同步更新。
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-2 max-h-[540px] overflow-y-auto pr-1">
          {cues.map((cue) => {
            const isActive = activeCueIndex === cue.index;
            return (
              <div
                key={cue.index}
                className={`p-3.5 rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-blue-50/60 border-blue-300'
                    : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                    <span className="font-semibold text-slate-700">
                      #{String(cue.index).padStart(2, '0')}
                    </span>
                    <span className="text-slate-500">
                      {cue.startTime} {'-->'} {cue.endTime}
                    </span>
                  </div>
                  {hasMedia && (
                    <button
                      type="button"
                      onClick={() =>
                        onSeekToSeconds(timestampToSeconds(cue.startTime))
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-white rounded transition-colors whitespace-nowrap shrink-0"
                      title="跳轉至此時間點播放"
                    >
                      <Play className="w-3 h-3" aria-hidden="true" />
                      <span>定位播放</span>
                    </button>
                  )}
                </div>
                <textarea
                  rows={cue.text.includes('\n') ? 2 : 1}
                  value={cue.text}
                  onChange={(e) => onCueTextChange(cue.index, e.target.value)}
                  aria-label={`第 ${cue.index} 句字幕內容`}
                  className="w-full px-2.5 py-1.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
