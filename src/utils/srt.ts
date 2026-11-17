export interface SrtCue {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

/**
 * Converts a timestamp string (e.g. "00:01:23,450", "01:23.45", "83.5")
 * into canonical SRT format "HH:MM:SS,mmm".
 */
export function normalizeTimestamp(raw: string): string {
  const cleaned = String(raw || '').trim().replace(/\./g, ',');

  // Already HH:MM:SS,mmm (or H:M:S,m)
  const hmsMatch = cleaned.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:,(\d{1,3}))?$/);
  if (hmsMatch) {
    const h = Math.min(99, parseInt(hmsMatch[1], 10));
    const m = Math.min(59, parseInt(hmsMatch[2], 10));
    const s = Math.min(59, parseInt(hmsMatch[3], 10));
    const ms = (hmsMatch[4] || '0').padEnd(3, '0').slice(0, 3);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${ms}`;
  }

  // MM:SS,mmm or MM:SS
  const msMatch = cleaned.match(/^(\d{1,3}):(\d{1,2})(?:,(\d{1,3}))?$/);
  if (msMatch) {
    const totalMinutes = parseInt(msMatch[1], 10);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const s = Math.min(59, parseInt(msMatch[2], 10));
    const ms = (msMatch[3] || '0').padEnd(3, '0').slice(0, 3);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${ms}`;
  }

  // Numeric seconds fallback
  const numeric = parseFloat(cleaned.replace(',', '.'));
  if (!Number.isNaN(numeric) && numeric >= 0) {
    return secondsToTimestamp(numeric);
  }

  return '00:00:00,000';
}

export function timestampToSeconds(ts: string): number {
  const normalized = normalizeTimestamp(ts);
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) return 0;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);
  return h * 3600 + m * 60 + s + ms / 1000;
}

export function secondsToTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safe * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function sanitizeCues(
  rawCues: Array<{ startTime?: string; endTime?: string; text?: string }>,
  maxDurationSeconds?: number
): SrtCue[] {
  const sanitized: SrtCue[] = [];
  let prevEndSeconds = 0;

  for (const item of rawCues) {
    const text = String(item.text || '').trim();
    if (!text) continue;

    let startSec = timestampToSeconds(item.startTime || '00:00:00,000');
    let endSec = timestampToSeconds(item.endTime || '00:00:00,000');

    if (startSec < prevEndSeconds) {
      startSec = prevEndSeconds;
    }

    if (maxDurationSeconds && maxDurationSeconds > 0) {
      startSec = Math.min(startSec, Math.max(0, maxDurationSeconds - 0.2));
      if (endSec > maxDurationSeconds) {
        endSec = maxDurationSeconds;
      }
    }

    if (endSec <= startSec) {
      endSec = startSec + 1.5;
      if (maxDurationSeconds && maxDurationSeconds > 0) {
        endSec = Math.min(endSec, maxDurationSeconds);
      }
    }

    prevEndSeconds = endSec;
    sanitized.push({
      index: sanitized.length + 1,
      startTime: secondsToTimestamp(startSec),
      endTime: secondsToTimestamp(endSec),
      text,
    });
  }

  return sanitized;
}

export function formatCuesToSrt(cues: SrtCue[]): string {
  return cues
    .filter((cue) => cue.text.trim().length > 0)
    .map((cue, idx) => {
      const start = normalizeTimestamp(cue.startTime);
      const end = normalizeTimestamp(cue.endTime);
      return `${idx + 1}\n${start} --> ${end}\n${cue.text.trim()}`;
    })
    .join('\n\n');
}

export function parseSrtToCues(srtText: string): SrtCue[] {
  const blocks = srtText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split(/\n{2,}/);

  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    if (lines.length < 2) continue;

    const timingLineIdx = lines.findIndex((line) => line.includes('-->'));
    if (timingLineIdx === -1) continue;

    const [rawStart, rawEnd] = lines[timingLineIdx].split('-->').map((s) => s.trim());
    const textLines = lines.slice(timingLineIdx + 1).join('\n').trim();
    if (!textLines) continue;

    cues.push({
      index: cues.length + 1,
      startTime: normalizeTimestamp(rawStart),
      endTime: normalizeTimestamp(rawEnd),
      text: textLines,
    });
  }

  return cues;
}

export function srtToVtt(srtText: string): string {
  const cues = parseSrtToCues(srtText);
  const body = cues
    .map((cue) => {
      const start = cue.startTime.replace(',', '.');
      const end = cue.endTime.replace(',', '.');
      return `${cue.index}\n${start} --> ${end}\n${cue.text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}
