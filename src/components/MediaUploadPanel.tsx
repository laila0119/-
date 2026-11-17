import React, { useRef, useState } from 'react';
import {
  FileAudio,
  FileVideo,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { secondsToTimestamp } from '../utils/srt';

export type TranscriptionMode = 'traditional' | 'bilingual';
export type LineDensity = 'standard' | 'long';

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
}

interface MediaUploadPanelProps {
  file: File | null;
  mediaUrl: string | null;
  mediaKind: 'video' | 'audio' | null;
  durationSeconds: number | null;
  vttUrl: string | null;
  activeSubtitleText: string;
  mode: TranscriptionMode;
  lineDensity: LineDensity;
  isProcessing: boolean;
  uploadProgress: UploadProgress | null;
  onModeChange: (mode: TranscriptionMode) => void;
  onLineDensityChange: (density: LineDensity) => void;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
  onGenerate: () => void;
  onMediaDurationLoaded: (duration: number) => void;
  onTimeUpdate: (currentTime: number) => void;
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaUploadPanel({
  file,
  mediaUrl,
  mediaKind,
  durationSeconds,
  vttUrl,
  activeSubtitleText,
  mode,
  lineDensity,
  isProcessing,
  uploadProgress,
  onModeChange,
  onLineDensityChange,
  onFileSelected,
  onClearFile,
  onGenerate,
  onMediaDurationLoaded,
  onTimeUpdate,
  mediaRef,
  fileInputRef,
}: MediaUploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const validateAndAccept = (candidate: File | undefined | null) => {
    if (!candidate) return;
    const lowerName = candidate.name.toLowerCase();
    const isMp4 = lowerName.endsWith('.mp4') || candidate.type === 'video/mp4';
    const isMp3 =
      lowerName.endsWith('.mp3') ||
      candidate.type === 'audio/mpeg' ||
      candidate.type === 'audio/mp3';

    if (!isMp4 && !isMp3) {
      setValidationError('僅支援 MP4 影片 (.mp4) 或 MP3 音訊 (.mp3) 檔案格式。');
      return;
    }

    if (candidate.size > MAX_FILE_SIZE_BYTES) {
      setValidationError('檔案大小超過 500 MB 上限，請壓縮或裁切後再上傳。');
      return;
    }

    setValidationError(null);
    onFileSelected(candidate);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    validateAndAccept(droppedFile);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    validateAndAccept(selected);
    e.target.value = '';
  };

  return (
    <section
      aria-label="檔案上傳與媒體預覽"
      className="flex flex-col bg-white border border-slate-200 rounded-xl p-6 gap-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            匯入影音檔案
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            支援 MP4 影片或 MP3 音訊，檔案上限 500 MB
          </p>
        </div>
        {file && (
          <button
            type="button"
            onClick={onClearFile}
            disabled={isProcessing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>清除檔案</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,audio/mpeg,audio/mp3,.mp4,.mp3"
        onChange={handleInputChange}
        className="sr-only"
        aria-label="選擇 MP4 或 MP3 檔案"
      />

      {!file ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`group flex flex-col items-center justify-center text-center border border-dashed rounded-xl px-6 py-12 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
            isDragging
              ? 'border-blue-600 bg-blue-50/50'
              : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 group-hover:text-blue-600 transition-colors">
            <UploadCloud className="w-6 h-6" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-900">
            將 MP4 或 MP3 檔案拖曳至此，或點擊瀏覽本機檔案
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            上傳後自動呼叫 Gemini 4 Hydrogen 模型辨識語音並生成繁體中文 SRT 字幕
          </p>
          <span className="mt-5 inline-flex items-center px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg group-hover:border-slate-300 transition-colors whitespace-nowrap shrink-0">
            選擇影音檔案
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* File Metadata Row — unboxed text with typographic separators */}
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
              {mediaKind === 'video' ? (
                <FileVideo className="w-5 h-5" aria-hidden="true" />
              ) : (
                <FileAudio className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 truncate" title={file.name}>
                {file.name}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                <span>{mediaKind === 'video' ? 'MP4 影片' : 'MP3 音訊'}</span>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(file.size)}</span>
                {durationSeconds !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>長度 {secondsToTimestamp(durationSeconds).slice(0, 8)}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              更換檔案
            </button>
          </div>

          {/* Media Player Preview */}
          {mediaUrl && mediaKind === 'video' && (
            <div className="overflow-hidden rounded-lg bg-slate-950 border border-slate-200 aspect-video">
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                src={mediaUrl}
                controls
                playsInline
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration;
                  if (Number.isFinite(dur) && dur > 0) {
                    onMediaDurationLoaded(dur);
                  }
                }}
                onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                className="w-full h-full object-contain"
              >
                {vttUrl && (
                  <track
                    kind="subtitles"
                    src={vttUrl}
                    srcLang="zh-Hant"
                    label="繁體中文"
                    default
                  />
                )}
              </video>
            </div>
          )}

          {mediaUrl && mediaKind === 'audio' && (
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-slate-50 border border-slate-200">
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={mediaUrl}
                controls
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration;
                  if (Number.isFinite(dur) && dur > 0) {
                    onMediaDurationLoaded(dur);
                  }
                }}
                onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                className="w-full"
              />
              {activeSubtitleText ? (
                <p className="text-sm text-center font-medium text-slate-800 px-3 py-2 bg-white border border-slate-200 rounded-md min-h-[2.5rem] flex items-center justify-center">
                  {activeSubtitleText}
                </p>
              ) : (
                <p className="text-xs text-center text-slate-400 min-h-[2.5rem] flex items-center justify-center">
                  播放音訊時將同步顯示當前時間軸字幕
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {validationError && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {validationError}
        </p>
      )}

      {/* Transcription Options */}
      <div className="flex flex-col gap-4 pt-2 border-t border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-700">輸出語言模式</span>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => onModeChange('traditional')}
              disabled={isProcessing}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'traditional'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              純繁體中文
            </button>
            <button
              type="button"
              onClick={() => onModeChange('bilingual')}
              disabled={isProcessing}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'bilingual'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              原文 + 繁中對照
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-700">單句斷句長度</span>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => onLineDensityChange('standard')}
              disabled={isProcessing}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                lineDensity === 'standard'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              標準短句（12–18 字）
            </button>
            <button
              type="button"
              onClick={() => onLineDensityChange('long')}
              disabled={isProcessing}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                lineDensity === 'long'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              較長句段（22–30 字）
            </button>
          </div>
        </div>
      </div>

      {/* Primary Action */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!file || isProcessing}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 tabular-nums"
      >
        <RefreshCw
          className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        <span>
          {isProcessing
            ? uploadProgress && uploadProgress.totalBytes > 0
              ? `正在上傳檔案 (${Math.min(100, Math.round((uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100))}%)...`
              : 'Gemini 4 Hydrogen 正在辨識語音...'
            : '重新辨識並生成 SRT 字幕'}
        </span>
      </button>
    </section>
  );
}
