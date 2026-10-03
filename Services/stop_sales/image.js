// Low-level reading of a calendar screenshot (PNG/JPG/GIF pasted in an e-mail):
// table lines, cell colours and OCR words with their positions. Turning that into
// rooms and dates is done by the grid logic in extractor.js.
const os = require("os");
const path = require("path");

const MIN_WIDTH = 300;
const MIN_HEIGHT = 80;

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function loadPixels(buffer) {
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
}

// Black/grey ink: dark and unsaturated (red/green fills are not ink).
function inkMask({ width, height, data }) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const r = data[index * 4];
    const g = data[index * 4 + 1];
    const b = data[index * 4 + 2];
    mask[index] = luminance(r, g, b) < 150 && Math.max(r, g, b) - Math.min(r, g, b) < 60 ? 1 : 0;
  }
  return mask;
}

function clusterPositions(positions) {
  const lines = [];
  for (const position of positions) {
    const last = lines[lines.length - 1];
    if (last && position - last.end <= 1) last.end = position;
    else lines.push({ start: position, end: position });
  }
  return lines.map((line) => ({ ...line, center: (line.start + line.end) / 2 }));
}

function horizontalLines(mask, width, height) {
  const rows = [];
  // A table line is one long unbroken stroke; a row of bold digits has as much ink
  // but in short pieces.
  // Only thin ink counts (not the inside of a filled black cell), so a line that
  // crosses black cells is still found from its visible part, e.g. the label column.
  for (let y = 0; y < height; y += 1) {
    let longest = 0;
    let run = 0;
    for (let x = 0; x < width; x += 1) {
      const above = y >= 2 && mask[(y - 2) * width + x];
      const below = y + 2 < height && mask[(y + 2) * width + x];
      run = mask[y * width + x] && !(above && below) ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest >= Math.max(60, width * 0.1)) rows.push(y);
  }
  // Thick dark bands are filled cells (e.g. black "not applicable" days), not lines.
  return clusterPositions(rows).filter((line) => line.end - line.start <= 3);
}

function verticalLinesIn(mask, width, top, bottom) {
  const from = Math.ceil(top) + 1;
  const to = Math.floor(bottom) - 1;
  if (to - from < 3) return [];
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    let ink = 0;
    for (let y = from; y <= to; y += 1) ink += mask[y * width + x];
    if (ink >= (to - from + 1) * 0.85) columns.push(x);
  }
  return clusterPositions(columns);
}

// Remove table lines so OCR only sees the text (labels, month names, day numbers).
function textOnlyImage(mask, width, height) {
  const clean = new Uint8Array(mask);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width;) {
      if (!mask[y * width + x]) { x += 1; continue; }
      let end = x;
      while (end < width && mask[y * width + end]) end += 1;
      if (end - x > 20) clean.fill(0, y * width + x, y * width + end);
      x = end;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height;) {
      if (!mask[y * width + x]) { y += 1; continue; }
      let end = y;
      while (end < height && mask[end * width + x]) end += 1;
      if (end - y > 12) for (let k = y; k < end; k += 1) clean[k * width + x] = 0;
      y = end;
    }
  }
  return clean;
}

async function ocrWords(clean, width, height) {
  const { createCanvas } = require("@napi-rs/canvas");
  const { createWorker } = require("tesseract.js");
  const scale = Math.min(3, Math.max(1, 2400 / width));
  const small = createCanvas(width, height);
  const smallContext = small.getContext("2d");
  const pixels = smallContext.createImageData(width, height);
  for (let index = 0; index < width * height; index += 1) {
    const value = clean[index] ? 0 : 255;
    pixels.data[index * 4] = value;
    pixels.data[index * 4 + 1] = value;
    pixels.data[index * 4 + 2] = value;
    pixels.data[index * 4 + 3] = 255;
  }
  smallContext.putImageData(pixels, 0, 0);
  const big = createCanvas(Math.round(width * scale), Math.round(height * scale));
  big.getContext("2d").drawImage(small, 0, 0, big.width, big.height);
  const worker = await createWorker("eng", 1, {
    langPath: path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int"),
    cachePath: path.join(os.tmpdir(), "stop-sale-ocr"),
    gzip: true,
    logger: () => {},
    errorHandler: () => {},
  });
  try {
    // Sparse text: table cells are scattered words, not paragraphs.
    await worker.setParameters({ tessedit_pageseg_mode: "11", user_defined_dpi: "300" });
    const { data } = await worker.recognize(big.toBuffer("image/png"), {}, { blocks: true });
    const words = [];
    for (const block of data.blocks || [])
      for (const paragraph of block.paragraphs || [])
        for (const line of paragraph.lines || [])
          for (const word of line.words || []) {
            const text = String(word.text || "").trim();
            if (!text) continue;
            words.push({
              text,
              confidence: word.confidence,
              x0: word.bbox.x0 / scale,
              y0: word.bbox.y0 / scale,
              x1: word.bbox.x1 / scale,
              y1: word.bbox.y1 / scale,
            });
          }
    return words;
  } finally {
    await worker.terminate().catch(() => {});
  }
}

async function analyzeImage(buffer) {
  const pixels = await loadPixels(buffer);
  const { width, height, data } = pixels;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
  const mask = inkMask(pixels);
  const hLines = horizontalLines(mask, width, height);
  if (hLines.length < 3) return null; // not a table (logo, photo, signature)
  const words = await ocrWords(textOnlyImage(mask, width, height), width, height);
  const pixelHex = (x, y) => {
    const px = Math.min(width - 1, Math.max(0, Math.round(x)));
    const py = Math.min(height - 1, Math.max(0, Math.round(y)));
    const offset = (py * width + px) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]].map((value) => value.toString(16).padStart(2, "0")).join("");
  };
  return {
    width,
    height,
    words,
    hLines,
    verticalLines: (top, bottom) => verticalLinesIn(mask, width, top, bottom),
    colorAtPoint: pixelHex,
    // Majority colour of a cell, sampled away from the centre where text sits.
    cellColor(x0, x1, y0, y1) {
      const inset = 2;
      const samples = [
        [x0 + inset, y0 + inset], [x1 - inset, y0 + inset], [x0 + inset, y1 - inset], [x1 - inset, y1 - inset],
        [(x0 + x1) / 2, y0 + inset], [(x0 + x1) / 2, y1 - inset],
      ].map(([x, y]) => pixelHex(x, y));
      const counts = new Map();
      for (const sample of samples) counts.set(sample, (counts.get(sample) || 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    },
  };
}

module.exports = { analyzeImage };
