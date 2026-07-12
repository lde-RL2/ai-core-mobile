import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy }

export async function loadPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(await blob.arrayBuffer())
  return getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise
}
