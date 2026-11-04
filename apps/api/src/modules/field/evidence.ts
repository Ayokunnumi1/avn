import sharp from 'sharp';
import { EVIDENCE_PROMPT_VERSION, EVIDENCE_SYSTEM, EvidenceAssessmentSchema, evidencePrompt } from '@avn/ai';
import type { EvidenceCategory } from '@avn/contracts';
import { deps } from '../../container';
import { registerJob } from '../../lib/jobs';
import { runAi } from '../ai/service';

export interface ImageFacts {
  width: number;
  height: number;
  dHash: string;
  brightness: number;
  sharpness: number;
}

/** Deterministic image facts: dimensions, 64-bit difference hash, mean brightness, sharpness. */
export async function imageFacts(data: Buffer): Promise<ImageFacts> {
  const img = sharp(data, { failOn: 'error' }).rotate();
  const meta = await img.metadata();
  const raw = await sharp(data).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x]! > raw[y * 9 + x + 1]! ? '1' : '0';
  const dHash = BigInt('0b' + bits).toString(16).padStart(16, '0');
  const stats = await sharp(data).rotate().greyscale().stats();
  return { width: meta.width ?? 0, height: meta.height ?? 0, dHash, brightness: Math.round(stats.channels[0]?.mean ?? 0), sharpness: Number(stats.sharpness.toFixed(2)) };
}

/** Rule-based quality feedback available even when AI is disabled. */
export function deterministicFeedback(f: ImageFacts): { clarity: 'GOOD' | 'ACCEPTABLE' | 'POOR'; messages: string[] } {
  const messages: string[] = [];
  const minSide = Math.min(f.width, f.height);
  if (minSide < 480) messages.push('Image resolution is low — move closer or use the full camera resolution.');
  if (f.brightness < 40) messages.push('Image is too dark — capture again with more light.');
  if (f.brightness > 225) messages.push('Image is over-exposed — avoid pointing directly at the sun.');
  if (f.sharpness < 0.6) messages.push('Image looks blurred — hold the phone steady and retake.');
  const clarity = messages.length === 0 ? (minSide >= 900 ? 'GOOD' : 'ACCEPTABLE') : messages.length === 1 && minSide >= 480 ? 'ACCEPTABLE' : 'POOR';
  return { clarity, messages };
}

/** Optional AI evidence assistant (spec B12). Suggestions never alter field observations. */
export async function analyzeEvidenceWithAi(evidenceId: string): Promise<void> {
  const { prisma, storage } = deps();
  const ev = await prisma.verificationEvidence.findUnique({ where: { id: evidenceId }, include: { request: { include: { address: true } } } });
  if (!ev || ev.category === 'VIDEO_WALKTHROUGH') return;
  const file = await prisma.storedFile.findUnique({ where: { id: ev.fileId } });
  if (!file) return;
  const data = await storage.get(file.storageKey);
  const jpeg = await sharp(data).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  await runAi(
    { feature: 'EVIDENCE_QUALITY', subjectType: 'VerificationEvidence', subjectId: ev.id, requestId: ev.requestId, organisationId: ev.request.organisationId, promptVersion: EVIDENCE_PROMPT_VERSION },
    (model) =>
      deps().ai.analyzeImage({
        model,
        system: EVIDENCE_SYSTEM,
        prompt: evidencePrompt(ev.category as EvidenceCategory, ev.request.address?.houseNumber),
        schema: EvidenceAssessmentSchema,
        images: [{ mediaType: 'image/jpeg', base64: jpeg.toString('base64') }],
        maxTokens: 700,
      }),
  );
}

registerJob<{ evidenceId: string }>('ai.evidence', async ({ evidenceId }) => analyzeEvidenceWithAi(evidenceId));
