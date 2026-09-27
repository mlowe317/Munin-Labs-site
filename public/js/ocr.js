// Free OCR page: everything runs in the browser.
// Tesseract.js (WebAssembly) does the recognition; pdf.js rasterises PDF pages
// first. All assets are self-hosted under /vendor so nothing leaves the device.

const VENDOR = '/vendor';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const TARGET_PAGE_WIDTH = 2200; // px; roughly 250 dpi for an A4/Letter page

const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('file-input');
const preview = $('preview');
const previewImg = $('preview-img');
const previewName = $('preview-name');
const progress = $('progress');
const progressBar = $('progress-bar');
const progressText = $('progress-text');
const errorBox = $('ocr-error');
const result = $('result');
const resultMeta = $('result-meta');
const copyBtn = $('copy-btn');
const downloadBtn = $('download-btn');
const clearBtn = $('clear-btn');

let workerPromise = null;
let busy = false;
let previewUrl = null;

// --- helpers -------------------------------------------------------------

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function setProgress(status, fraction) {
  progress.hidden = false;
  progressText.textContent = status;
  progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

function updateButtons() {
  const hasText = result.value.trim().length > 0;
  copyBtn.disabled = !hasText || busy;
  downloadBtn.disabled = !hasText || busy;
  clearBtn.disabled = busy || (!hasText && preview.hidden);
}

// wasm-feature-detect's SIMD probe: a minimal module using a v128 instruction.
function simdSupported() {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch (_) {
    return false;
  }
}

const STATUS_LABELS = {
  'loading tesseract core': 'Loading OCR engine…',
  'initializing tesseract': 'Starting OCR engine…',
  'loading language traineddata': 'Loading English model…',
  'initializing api': 'Preparing…',
  'initialized api': 'Ready',
  'recognizing text': 'Recognising text…',
};

function getWorker() {
  if (!workerPromise) {
    if (!window.Tesseract) throw new Error('The OCR library failed to load. Please refresh and try again.');
    const core = simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
    workerPromise = window.Tesseract.createWorker('eng', window.Tesseract.OEM.LSTM_ONLY, {
      workerPath: `${VENDOR}/tesseract/worker.min.js`,
      workerBlobURL: false,
      corePath: `${VENDOR}/tesseract/${core}`,
      langPath: `${VENDOR}/tesseract/lang`,
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text' && currentPageLabel) {
          setProgress(`Recognising text (${currentPageLabel})…`, m.progress);
        } else if (STATUS_LABELS[m.status]) {
          setProgress(STATUS_LABELS[m.status], m.progress ?? 0);
        }
      },
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

let currentPageLabel = '';

// --- input sources -------------------------------------------------------

function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

async function loadImageBitmap(file) {
  try {
    return await createImageBitmap(file);
  } catch (_) {
    throw new Error(`"${file.name}" is not an image this browser can read.`);
  }
}

function bitmapToCanvas(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${VENDOR}/pdfjs/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdfjs/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function* pdfPages(file) {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    standardFontDataUrl: `${VENDOR}/pdfjs/standard_fonts/`,
    wasmUrl: `${VENDOR}/pdfjs/wasm/`,
    isEvalSupported: false,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    throw new Error(/password/i.test(err?.message || '') ? `"${file.name}" is password protected.` : `"${file.name}" could not be opened as a PDF.`);
  }
  try {
    yield* renderPages(doc, file);
  } finally {
    await task.destroy();
  }
}

async function* renderPages(doc, file) {
  const total = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let i = 1; i <= total; i += 1) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, Math.max(1.5, TARGET_PAGE_WIDTH / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    yield { canvas, index: i, total, truncated: doc.numPages > MAX_PDF_PAGES, name: file.name };
  }
}

// --- main flow -----------------------------------------------------------

function showPreview(file, canvas) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (canvas) {
    previewImg.src = canvas.toDataURL('image/jpeg', 0.7);
  } else {
    previewUrl = URL.createObjectURL(file);
    previewImg.src = previewUrl;
  }
  previewName.textContent = file.name;
  preview.hidden = false;
}

function appendText(text) {
  const clean = text.replace(/[ \t]+\n/g, '\n').trim();
  if (!clean) return;
  result.value = result.value.trim() ? `${result.value.trimEnd()}\n\n${clean}` : clean;
  result.scrollTop = result.scrollHeight;
}

async function processFiles(files) {
  if (busy) return;
  const list = Array.from(files).filter((f) => f && f.size > 0);
  if (!list.length) return;
  showError('');
  const tooBig = list.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    showError(`"${tooBig.name}" is larger than 25 MB. Please use a smaller file.`);
    return;
  }

  busy = true;
  dropzone.classList.add('is-busy');
  updateButtons();
  const started = performance.now();
  let pages = 0;
  let confidences = [];

  try {
    setProgress('Loading OCR engine…', 0);
    const worker = await getWorker();

    for (const [fileIndex, file] of list.entries()) {
      const multi = list.length > 1;
      if (multi) appendText(`===== ${file.name} =====`);

      if (isPdf(file)) {
        let first = true;
        for await (const { canvas, index, total, truncated } of pdfPages(file)) {
          if (first) {
            showPreview(file, canvas);
            first = false;
          }
          currentPageLabel = total > 1 ? `page ${index} of ${total}` : file.name;
          const { data } = await worker.recognize(canvas);
          if (total > 1) appendText(`--- Page ${index} ---`);
          appendText(data.text);
          confidences.push(data.confidence);
          pages += 1;
          if (truncated && index === total) {
            appendText(`[Only the first ${MAX_PDF_PAGES} pages were processed.]`);
          }
        }
      } else {
        const bitmap = await loadImageBitmap(file);
        const canvas = bitmapToCanvas(bitmap);
        showPreview(file, null);
        currentPageLabel = multi ? `file ${fileIndex + 1} of ${list.length}` : file.name;
        const { data } = await worker.recognize(canvas);
        appendText(data.text);
        confidences.push(data.confidence);
        pages += 1;
      }
    }

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const words = result.value.trim() ? result.value.trim().split(/\s+/).length : 0;
    const avgConf = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;
    setProgress('Done', 1);
    resultMeta.textContent = `${pages} page${pages === 1 ? '' : 's'} · ${words} words · ${avgConf}% average confidence · ${seconds}s`;
    if (!result.value.trim()) {
      showError('No text was found. Try a sharper image, or one where the text is larger.');
    }
  } catch (err) {
    console.error(err);
    showError(err?.message || 'OCR failed. Please try another file.');
    setProgress('Failed', 0);
  } finally {
    busy = false;
    currentPageLabel = '';
    dropzone.classList.remove('is-busy');
    updateButtons();
  }
}

// --- wiring --------------------------------------------------------------

dropzone.addEventListener('click', () => !busy && fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!busy) fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  processFiles(fileInput.files);
  fileInput.value = '';
});
for (const evt of ['dragenter', 'dragover']) {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  });
}
for (const evt of ['dragleave', 'drop']) {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
  });
}
dropzone.addEventListener('drop', (e) => processFiles(e.dataTransfer?.files || []));
document.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files || []);
  if (files.length) processFiles(files);
});

copyBtn.addEventListener('click', async () => {
  const text = result.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    result.select();
    document.execCommand('copy');
  }
  const label = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  setTimeout(() => { copyBtn.textContent = label; }, 1500);
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob([result.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(previewName.textContent || 'ocr').replace(/\.[^.]+$/, '')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

clearBtn.addEventListener('click', () => {
  result.value = '';
  resultMeta.textContent = '';
  preview.hidden = true;
  previewImg.removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  progress.hidden = true;
  showError('');
  updateButtons();
});

result.addEventListener('input', updateButtons);
updateButtons();
