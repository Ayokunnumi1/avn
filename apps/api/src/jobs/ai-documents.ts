import sharp from 'sharp';
import { deps } from '../container';
import { registerJob } from '../lib/jobs';
import { runAi } from '../modules/ai/service';
import { addressLines } from '../modules/requests/service';

/**
 * OCR on applicant documents (spec §4.2 "compare submitted text with visible address evidence").
 * The comparison is stored as an AI suggestion for reviewers; documents never establish an address.
 */
export async function analyseDocument(documentId: string) {
  const { prisma, storage, ai } = deps();
  const doc = await prisma.applicantDocument.findUnique({ where: { id: documentId }, include: { request: { include: { address: true } } } });
  if (!doc) return;
  const file = await prisma.storedFile.findUnique({ where: { id: doc.fileId } });
  if (!file || !file.mimeType.startsWith('image/')) return; // PDFs are kept for human review only
  const jpeg = await sharp(await storage.get(file.storageKey)).rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const res = await runAi({ feature: 'OCR', subjectType: 'ApplicantDocument', subjectId: doc.id, requestId: doc.requestId, organisationId: doc.request.organisationId, promptVersion: 'ocr@1.0.0' }, (model) =>
    ai.ocr({ model, images: [{ mediaType: 'image/jpeg', base64: jpeg.toString('base64') }], hint: `Document type: ${doc.documentType}` }),
  );
  if (!res.data || !res.analysisId || !doc.request.address) return;
  const text = res.data.lines.join(' ').toLowerCase();
  const tokens = addressLines(doc.request.address).join(' ').toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2);
  const matched = tokens.filter((t) => text.includes(t));
  await prisma.aiAnalysis.update({
    where: { id: res.analysisId },
    data: {
      explanation: `${matched.length}/${tokens.length} submitted address tokens appear in the document text. Supplementary only — a document does not independently establish the physical address.`,
      confidence: tokens.length ? matched.length / tokens.length : 0,
    },
  });
}

registerJob<{ documentId: string }>('ai.document', async ({ documentId }) => analyseDocument(documentId));
