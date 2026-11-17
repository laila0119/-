import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import { formatCuesToSrt, sanitizeCues } from './src/utils/srt.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB (支援 150MB 以上大型影音檔)
const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB per chunk (避開反向代理單次請求 32MB 上限)
const INLINE_THRESHOLD_BYTES = 15 * 1024 * 1024; // 15 MB

function getGenAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const uploadDir = path.join(os.tmpdir(), 'srt-studio-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

interface UploadSession {
  id: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  expectedSize: number;
  receivedBytes: number;
  expectedChunkIndex: number;
  createdAt: number;
}

const uploadSessions = new Map<string, UploadSession>();

// Clean up stale partial uploads older than 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of uploadSessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      uploadSessions.delete(id);
      fs.promises.unlink(session.filePath).catch(() => {});
    }
  }
}, 5 * 60 * 1000).unref();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `media-${uniqueSuffix}${ext}`);
  },
});

function resolveMediaMimeTypeByMeta(fileName: string, mimeType?: string): string | null {
  const ext = path.extname(fileName || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (ext === '.mp4' || mime === 'video/mp4') {
    return 'video/mp4';
  }
  if (ext === '.mp3' || mime === 'audio/mpeg' || mime === 'audio/mp3') {
    return 'audio/mp3';
  }
  return null;
}

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const resolvedMime = resolveMediaMimeTypeByMeta(file.originalname, file.mimetype);
    if (!resolvedMime) {
      cb(new Error('僅支援上傳 MP4 影片 (.mp4) 或 MP3 音訊 (.mp3) 檔案。'));
      return;
    }
    cb(null, true);
  },
});

async function waitForFileActive(ai: GoogleGenAI, fileName: string) {
  const maxAttempts = 120; // Up to ~4 minutes for large 150MB+ videos
  for (let i = 0; i < maxAttempts; i++) {
    const fileInfo = await ai.files.get({ name: fileName });
    if (fileInfo.state === 'ACTIVE') {
      return fileInfo;
    }
    if (fileInfo.state === 'FAILED') {
      throw new Error('媒體檔案在雲端處理失敗，請確認檔案未損毀後再試一次。');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('媒體檔案處理逾時，請嘗試剪輯為較短片段或稍後再試。');
}

function mapGeminiError(error: unknown): { status: number; message: string } {
  const errObj = error as { status?: number; message?: string; code?: string };
  const rawMessage = errObj?.message || String(error || '');
  const status = typeof errObj?.status === 'number' ? errObj.status : 500;

  if (!process.env.GEMINI_API_KEY) {
    return {
      status: 500,
      message: '系統尚未偵測到 GEMINI_API_KEY，請於 Settings > Secrets 面板確認金鑰設定。',
    };
  }
  if (status === 400 || rawMessage.includes('API_KEY_INVALID')) {
    return {
      status: 400,
      message: 'API 金鑰無效或請求格式錯誤，請於 Settings > Secrets 面板檢查您的 GEMINI_API_KEY。',
    };
  }
  if (status === 403 || rawMessage.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message: '目前金鑰權限不足（403），請於 Settings > Secrets 面板檢查您的 API 金鑰權限。',
    };
  }
  if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: '已達 Gemini API 速率或配額上限（429），請稍候再試或升級方案。',
    };
  }
  if (status === 404 || rawMessage.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: '找不到指定模型 gemini-4-hydrogen（404），請確認模型存取狀態。',
    };
  }
  return {
    status: 500,
    message: rawMessage || '語音辨識過程中發生未預期的錯誤，請稍後再試。',
  };
}

async function transcribeMediaFile(params: {
  filePath: string;
  fileSize: number;
  originalName: string;
  mimeType: string;
  mode: 'traditional' | 'bilingual';
  lineDensity: 'standard' | 'long';
  durationSeconds?: number;
}) {
  const {
    filePath,
    fileSize,
    originalName,
    mimeType,
    mode,
    lineDensity,
    durationSeconds,
  } = params;

  const ai = getGenAIClient();
  let uploadedRemoteName: string | null = null;

  try {
    let mediaPart:
      | { inlineData: { mimeType: string; data: string } }
      | { fileData: { fileUri: string; mimeType: string } };

    if (fileSize <= INLINE_THRESHOLD_BYTES) {
      const buffer = await fs.promises.readFile(filePath);
      mediaPart = {
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      };
    } else {
      const uploaded = await ai.files.upload({
        file: filePath,
        config: {
          mimeType,
          displayName: originalName,
        },
      });
      uploadedRemoteName = uploaded.name || null;

      const readyFile =
        uploaded.state === 'ACTIVE'
          ? uploaded
          : await waitForFileActive(ai, uploaded.name!);

      if (!readyFile.uri) {
        throw new Error('雲端檔案 URI 取得失敗，請再試一次。');
      }

      mediaPart = {
        fileData: {
          fileUri: readyFile.uri,
          mimeType: readyFile.mimeType || mimeType,
        },
      };
    }

    const maxCharsHint = lineDensity === 'long' ? '22 至 30 字' : '12 至 18 字';
    const durationHint = durationSeconds
      ? `此媒體總長度約為 ${durationSeconds.toFixed(2)} 秒，所有結束時間不得超過此總長度。`
      : '';

    const modeInstruction =
      mode === 'bilingual'
        ? '若語音為外語，請在每條字幕的 text 欄位以兩行呈現：第一行為原音精準轉錄，第二行為自然流暢的繁體中文翻譯；若原音本就為中文，則輸出單行繁體中文即可。'
        : '所有語音內容皆須輸出為台灣習慣使用的標準繁體中文（Traditional Chinese）。若原音為華語、台語或粵語，請精準聽打並轉換為標準繁體中文書面表達；若原音為外語（如英語、日語等），請精準辨識語意並翻譯為自然流暢的繁體中文字幕。';

    const systemInstruction = [
      '你是一位專精於影視後期製作的專業聽打員與繁體中文 SRT 字幕工程師。',
      '任務：針對提供的影片或音訊進行高精準度語音辨識，產生時間軸完全對齊說話聲調的字幕陣列。',
      modeInstruction,
      `斷句原則：依據講者自然停頓與語意斷句，每條單語字幕建議長度約 ${maxCharsHint}，避免過長影響畫面閱讀。`,
      '時間軸嚴格規範：',
      '1. startTime 與 endTime 必須嚴格遵守 SRT 格式「HH:MM:SS,mmm」（例如 00:00:03,420），小時、分、秒皆為兩位數，毫秒為三位數並以半形逗號分隔。',
      '2. 時間軸必須精準貼合實際語音發聲的開始與結束瞬間，不可整體偏移，也不可在純音樂或靜音段落憑空生成對話。',
      '3. 下一條字幕的 startTime 不得早於上一條字幕的 endTime，確保時間軸單調遞增且不重疊。',
      '4. 字幕標點應簡潔易讀，句尾通常不加句號，句中停頓可使用全形逗號或半形空格。',
      durationHint,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          mediaPart,
          {
            text: '請完整辨識此影音檔案中的所有語音對話，並依照時間軸順序輸出繁體中文字幕 JSON 陣列。',
          },
        ],
      },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: '依時間軸順序排列的標準字幕陣列',
          items: {
            type: Type.OBJECT,
            properties: {
              startTime: {
                type: Type.STRING,
                description: '開始時間，格式為 HH:MM:SS,mmm',
              },
              endTime: {
                type: Type.STRING,
                description: '結束時間，格式為 HH:MM:SS,mmm',
              },
              text: {
                type: Type.STRING,
                description: '繁體中文字幕文字內容',
              },
            },
            required: ['startTime', 'endTime', 'text'],
          },
        },
      },
    });

    const rawJson = (response.text || '[]').trim();
    let parsed: Array<{ startTime?: string; endTime?: string; text?: string }> = [];
    try {
      parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) {
        parsed = [];
      }
    } catch {
      throw new Error('模型回傳格式解析失敗，請再試一次。');
    }

    const cues = sanitizeCues(parsed, durationSeconds);
    if (cues.length === 0) {
      return { empty: true as const };
    }

    const srtText = formatCuesToSrt(cues);
    return {
      empty: false as const,
      model: 'gemini-4-hydrogen',
      cues,
      srtText,
    };
  } finally {
    if (uploadedRemoteName) {
      await ai.files.delete({ name: uploadedRemoteName }).catch(() => {});
    }
    await fs.promises.unlink(filePath).catch(() => {});
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      model: 'gemini-4-hydrogen',
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      chunkSizeBytes: CHUNK_SIZE_BYTES,
    });
  });

  // 1. Initialize chunked upload session (supports 150MB - 500MB files through reverse proxies)
  app.post('/api/upload/init', async (req: Request, res: Response) => {
    const fileName = String(req.body?.fileName || '');
    const mimeTypeInput = String(req.body?.mimeType || '');
    const fileSize = Number(req.body?.fileSize || 0);

    const mimeType = resolveMediaMimeTypeByMeta(fileName, mimeTypeInput);
    if (!mimeType) {
      res.status(400).json({ error: '僅支援上傳 MP4 影片 (.mp4) 或 MP3 音訊 (.mp3) 檔案。' });
      return;
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      res.status(400).json({ error: '無效的檔案大小。' });
      return;
    }

    if (fileSize > MAX_FILE_SIZE_BYTES) {
      res.status(413).json({ error: '檔案大小超過 500 MB 上限，請壓縮或剪輯後再上傳。' });
      return;
    }

    const id = crypto.randomUUID();
    const ext = mimeType === 'video/mp4' ? '.mp4' : '.mp3';
    const filePath = path.join(uploadDir, `chunked-${id}${ext}`);

    await fs.promises.writeFile(filePath, Buffer.alloc(0));

    uploadSessions.set(id, {
      id,
      filePath,
      originalName: fileName || `media${ext}`,
      mimeType,
      expectedSize: fileSize,
      receivedBytes: 0,
      expectedChunkIndex: 0,
      createdAt: Date.now(),
    });

    res.json({
      uploadId: id,
      chunkSize: CHUNK_SIZE_BYTES,
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    });
  });

  // 2. Receive binary chunk (<= 16 MB per HTTP request)
  app.post(
    '/api/upload/chunk/:uploadId',
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    async (req: Request, res: Response) => {
      const uploadId = String(req.params.uploadId || '');
      const session = uploadSessions.get(uploadId);
      if (!session) {
        res.status(404).json({ error: '找不到對應的上傳工作階段或已過期，請重新上傳。' });
        return;
      }

      const chunkIndex = Number(req.header('x-chunk-index'));
      if (!Number.isInteger(chunkIndex) || chunkIndex !== session.expectedChunkIndex) {
        res.status(409).json({
          error: `分片順序異常（預期第 ${session.expectedChunkIndex} 片），請重新上傳。`,
        });
        return;
      }

      const chunk = req.body;
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
        res.status(400).json({ error: '上傳分片內容為空。' });
        return;
      }

      if (session.receivedBytes + chunk.length > MAX_FILE_SIZE_BYTES) {
        uploadSessions.delete(uploadId);
        await fs.promises.unlink(session.filePath).catch(() => {});
        res.status(413).json({ error: '檔案大小超過 500 MB 上限，已中止上傳。' });
        return;
      }

      await fs.promises.appendFile(session.filePath, chunk);
      session.receivedBytes += chunk.length;
      session.expectedChunkIndex += 1;

      res.json({
        ok: true,
        receivedBytes: session.receivedBytes,
      });
    }
  );

  // 3. Abort and cleanup partial upload
  app.post('/api/upload/abort/:uploadId', async (req: Request, res: Response) => {
    const uploadId = String(req.params.uploadId || '');
    const session = uploadSessions.get(uploadId);
    if (session) {
      uploadSessions.delete(uploadId);
      await fs.promises.unlink(session.filePath).catch(() => {});
    }
    res.json({ ok: true });
  });

  // 4. Transcribe assembled chunked file
  app.post('/api/transcribe/chunked', async (req: Request, res: Response) => {
    const uploadId = String(req.body?.uploadId || '');
    const session = uploadSessions.get(uploadId);
    if (!session) {
      res.status(404).json({ error: '找不到對應的上傳檔案或工作階段已過期，請重新上傳。' });
      return;
    }

    uploadSessions.delete(uploadId);

    const mode = req.body?.mode === 'bilingual' ? 'bilingual' : 'traditional';
    const lineDensity = req.body?.lineDensity === 'long' ? 'long' : 'standard';
    const rawDuration = parseFloat(String(req.body?.durationSeconds || '0'));
    const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

    try {
      const stat = await fs.promises.stat(session.filePath);
      const result = await transcribeMediaFile({
        filePath: session.filePath,
        fileSize: stat.size,
        originalName: session.originalName,
        mimeType: session.mimeType,
        mode,
        lineDensity,
        durationSeconds,
      });

      if (result.empty) {
        res.status(422).json({
          error: '未在檔案中偵測到可辨識的語音內容，請確認影音檔案包含清晰人聲。',
        });
        return;
      }

      res.json({
        model: result.model,
        cues: result.cues,
        srtText: result.srtText,
      });
    } catch (error) {
      const mapped = mapGeminiError(error);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  // Direct multipart upload endpoint (for smaller files or direct API usage, up to 500 MB)
  app.post('/api/transcribe', upload.single('media'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '請選擇要上傳的 MP4 影片或 MP3 音訊檔案。' });
      return;
    }

    const mimeType = resolveMediaMimeTypeByMeta(file.originalname, file.mimetype);
    if (!mimeType) {
      await fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({ error: '僅支援 MP4 影片或 MP3 音訊格式。' });
      return;
    }

    const mode = req.body?.mode === 'bilingual' ? 'bilingual' : 'traditional';
    const lineDensity = req.body?.lineDensity === 'long' ? 'long' : 'standard';
    const rawDuration = parseFloat(req.body?.durationSeconds || '0');
    const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

    try {
      const result = await transcribeMediaFile({
        filePath: file.path,
        fileSize: file.size,
        originalName: file.originalname,
        mimeType,
        mode,
        lineDensity,
        durationSeconds,
      });

      if (result.empty) {
        res.status(422).json({
          error: '未在檔案中偵測到可辨識的語音內容，請確認影音檔案包含清晰人聲。',
        });
        return;
      }

      res.json({
        model: result.model,
        cues: result.cues,
        srtText: result.srtText,
      });
    } catch (error) {
      const mapped = mapGeminiError(error);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  // Multer & API error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: '檔案大小超過 500 MB 上限，請壓縮或剪輯後再上傳。' });
        return;
      }
      res.status(400).json({ error: `檔案上傳失敗：${err.message}` });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: '單次傳輸資料量過大，系統已自動改採分片上傳處理，請重新嘗試。' });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: '伺服器發生未預期錯誤。' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Subtitle Studio server running on http://0.0.0.0:${PORT}`);
  });

  // Disable short request timeouts so large 150MB+ media uploads and transcription never drop
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 120_000;
  httpServer.keepAliveTimeout = 120_000;
}

startServer();
