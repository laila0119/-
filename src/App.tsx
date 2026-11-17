import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormatGuideModal } from './components/FormatGuideModal';
import {
  LineDensity,
  MediaUploadPanel,
  TranscriptionMode,
  UploadProgress,
} from './components/MediaUploadPanel';
import { SubtitleResultPanel } from './components/SubtitleResultPanel';
import {
  SrtCue,
  formatCuesToSrt,
  parseSrtToCues,
  srtToVtt,
  timestampToSeconds,
} from './utils/srt';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<'video' | 'audio' | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  const [mode, setMode] = useState<TranscriptionMode>('traditional');
  const [lineDensity, setLineDensity] = useState<LineDensity>('standard');

  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [srtText, setSrtText] = useState('');
  const [cues, setCues] = useState<SrtCue[]>([]);
  const [currentPlayTime, setCurrentPlayTime] = useState(0);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastAutoTriggeredFileRef = useRef<File | null>(null);

  // Clean up Object URLs on unmount or file change
  useEffect(() => {
    return () => {
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl);
      }
    };
  }, [mediaUrl]);

  const vttUrl = useMemo(() => {
    if (!srtText.trim()) return null;
    const vtt = srtToVtt(srtText);
    const blob = new Blob([vtt], { type: 'text/vtt;charset=utf-8' });
    return URL.createObjectURL(blob);
  }, [srtText]);

  useEffect(() => {
    return () => {
      if (vttUrl) {
        URL.revokeObjectURL(vttUrl);
      }
    };
  }, [vttUrl]);

  const activeCue = useMemo(() => {
    if (cues.length === 0) return null;
    return (
      cues.find((cue) => {
        const start = timestampToSeconds(cue.startTime);
        const end = timestampToSeconds(cue.endTime);
        return currentPlayTime >= start && currentPlayTime <= end;
      }) || null
    );
  }, [cues, currentPlayTime]);

  const runTranscription = useCallback(
    async (
      targetFile: File,
      targetDuration: number | null,
      targetMode: TranscriptionMode,
      targetDensity: LineDensity
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsProcessing(true);
      setUploadProgress(null);
      setErrorMessage(null);

      const CHUNK_THRESHOLD_BYTES = 8 * 1024 * 1024;
      let activeUploadId: string | null = null;

      try {
        let data: { srtText?: string; cues?: SrtCue[]; error?: string } = {};

        if (targetFile.size <= CHUNK_THRESHOLD_BYTES) {
          const formData = new FormData();
          formData.append('media', targetFile);
          formData.append('mode', targetMode);
          formData.append('lineDensity', targetDensity);
          if (targetDuration !== null && Number.isFinite(targetDuration)) {
            formData.append('durationSeconds', String(targetDuration));
          }

          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });

          data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(
              data?.error || `伺服器回應錯誤（${response.status}），請稍後再試。`
            );
          }
        } else {
          // Chunked upload in 8 MB slices to support 150MB - 500MB files through proxies without 413
          setUploadProgress({ uploadedBytes: 0, totalBytes: targetFile.size });

          const initRes = await fetch('/api/upload/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: targetFile.name,
              fileSize: targetFile.size,
              mimeType: targetFile.type,
            }),
            signal: controller.signal,
          });
          const initJson = await initRes.json().catch(() => ({}));
          if (!initRes.ok || !initJson.uploadId) {
            throw new Error(
              initJson?.error || `無法初始化分片上傳（${initRes.status}）。`
            );
          }

          activeUploadId = initJson.uploadId as string;
          const chunkSize = Number(initJson.chunkSize) || CHUNK_THRESHOLD_BYTES;
          let offset = 0;
          let chunkIndex = 0;

          while (offset < targetFile.size) {
            const end = Math.min(offset + chunkSize, targetFile.size);
            const slice = targetFile.slice(offset, end);

            const chunkRes = await fetch(`/api/upload/chunk/${activeUploadId}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'x-chunk-index': String(chunkIndex),
              },
              body: slice,
              signal: controller.signal,
            });
            const chunkJson = await chunkRes.json().catch(() => ({}));
            if (!chunkRes.ok) {
              throw new Error(
                chunkJson?.error || `檔案分片上傳失敗（${chunkRes.status}）。`
              );
            }

            offset = end;
            chunkIndex += 1;
            setUploadProgress({
              uploadedBytes: offset,
              totalBytes: targetFile.size,
            });
          }

          setUploadProgress(null);

          const transcribeRes = await fetch('/api/transcribe/chunked', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uploadId: activeUploadId,
              mode: targetMode,
              lineDensity: targetDensity,
              durationSeconds:
                targetDuration !== null && Number.isFinite(targetDuration)
                  ? targetDuration
                  : undefined,
            }),
            signal: controller.signal,
          });
          activeUploadId = null;

          data = await transcribeRes.json().catch(() => ({}));
          if (!transcribeRes.ok) {
            throw new Error(
              data?.error || `伺服器回應錯誤（${transcribeRes.status}），請稍後再試。`
            );
          }
        }

        const receivedSrt = typeof data.srtText === 'string' ? data.srtText : '';
        const receivedCues = Array.isArray(data.cues)
          ? (data.cues as SrtCue[])
          : parseSrtToCues(receivedSrt);

        setCues(receivedCues);
        setSrtText(receivedSrt || formatCuesToSrt(receivedCues));
      } catch (err) {
        if (activeUploadId) {
          fetch(`/api/upload/abort/${activeUploadId}`, {
            method: 'POST',
            keepalive: true,
          }).catch(() => {});
        }
        if ((err as Error)?.name === 'AbortError') {
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : '語音辨識請求失敗，請檢查網路連線或檔案格式。';
        setErrorMessage(message);
      } finally {
        if (abortControllerRef.current === controller) {
          setUploadProgress(null);
          setIsProcessing(false);
        }
      }
    },
    []
  );

  const handleFileSelected = useCallback(
    (selectedFile: File) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const lower = selectedFile.name.toLowerCase();
      const isVideo =
        lower.endsWith('.mp4') || selectedFile.type === 'video/mp4';

      const objectUrl = URL.createObjectURL(selectedFile);
      setFile(selectedFile);
      setMediaUrl(objectUrl);
      setMediaKind(isVideo ? 'video' : 'audio');
      setDurationSeconds(null);
      setSrtText('');
      setCues([]);
      setErrorMessage(null);
      setCurrentPlayTime(0);
      lastAutoTriggeredFileRef.current = null;
    },
    []
  );

  const handleMediaDurationLoaded = useCallback(
    (duration: number) => {
      setDurationSeconds(duration);
      if (file && lastAutoTriggeredFileRef.current !== file) {
        lastAutoTriggeredFileRef.current = file;
        runTranscription(file, duration, mode, lineDensity);
      }
    },
    [file, mode, lineDensity, runTranscription]
  );

  // Fallback: if browser takes longer or metadata doesn't fire duration for an edge file, trigger transcription safely
  useEffect(() => {
    if (!file) return;
    const timer = setTimeout(() => {
      if (lastAutoTriggeredFileRef.current !== file) {
        lastAutoTriggeredFileRef.current = file;
        runTranscription(file, durationSeconds, mode, lineDensity);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [file, durationSeconds, mode, lineDensity, runTranscription]);

  const handleClearFile = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);
    setFile(null);
    setMediaUrl(null);
    setMediaKind(null);
    setDurationSeconds(null);
    setSrtText('');
    setCues([]);
    setErrorMessage(null);
    setCurrentPlayTime(0);
    lastAutoTriggeredFileRef.current = null;
  };

  const handleManualGenerate = () => {
    if (!file) return;
    lastAutoTriggeredFileRef.current = file;
    runTranscription(file, durationSeconds, mode, lineDensity);
  };

  const handleSrtTextChange = (nextSrt: string) => {
    setSrtText(nextSrt);
    setCues(parseSrtToCues(nextSrt));
  };

  const handleCueTextChange = (cueIndex: number, nextText: string) => {
    const updatedCues = cues.map((cue) =>
      cue.index === cueIndex ? { ...cue, text: nextText } : cue
    );
    setCues(updatedCues);
    setSrtText(formatCuesToSrt(updatedCues));
  };

  const handleSeekToSeconds = (seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play().catch(() => {});
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <a
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            字幕工坊
          </a>

          {/* Zone 2: Concise functional links */}
          <nav
            aria-label="主導覽"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              匯入影音
            </button>
            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              SRT 格式規範
            </button>
            {file && (
              <button
                type="button"
                onClick={handleClearFile}
                disabled={isProcessing}
                className="hover:text-slate-900 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                重設工作區
              </button>
            )}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              選取 MP4 / MP3
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight text-balance">
              影片與音訊轉繁體中文 SRT 字幕
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              上傳 MP4 或 MP3 後自動以 Gemini 4 Hydrogen 模型辨識語音並校準時間軸，支援線上預覽編輯與匯出。
            </p>
          </div>
          <p className="text-xs text-slate-500 whitespace-nowrap shrink-0">
            識別引擎：Gemini 4 Hydrogen · 繁體中文標準時間軸
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5">
            <MediaUploadPanel
              file={file}
              mediaUrl={mediaUrl}
              mediaKind={mediaKind}
              durationSeconds={durationSeconds}
              vttUrl={vttUrl}
              activeSubtitleText={activeCue?.text || ''}
              mode={mode}
              lineDensity={lineDensity}
              isProcessing={isProcessing}
              uploadProgress={uploadProgress}
              onModeChange={setMode}
              onLineDensityChange={setLineDensity}
              onFileSelected={handleFileSelected}
              onClearFile={handleClearFile}
              onGenerate={handleManualGenerate}
              onMediaDurationLoaded={handleMediaDurationLoaded}
              onTimeUpdate={setCurrentPlayTime}
              mediaRef={mediaRef}
              fileInputRef={fileInputRef}
            />
          </div>

          <div className="lg:col-span-7">
            <SubtitleResultPanel
              srtText={srtText}
              cues={cues}
              isProcessing={isProcessing}
              uploadProgress={uploadProgress}
              errorMessage={errorMessage}
              fileName={file?.name || null}
              activeCueIndex={activeCue?.index ?? null}
              hasMedia={Boolean(mediaUrl)}
              onSrtTextChange={handleSrtTextChange}
              onCueTextChange={handleCueTextChange}
              onSeekToSeconds={handleSeekToSeconds}
              onRetry={handleManualGenerate}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>字幕工坊 · 支援 MP4 影片與 MP3 音訊轉繁體中文 SRT</span>
          <button
            type="button"
            onClick={() => setIsGuideOpen(true)}
            className="hover:text-slate-800 transition-colors"
          >
            查看 SRT 時間軸格式說明
          </button>
        </div>
      </footer>

      <FormatGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
}
