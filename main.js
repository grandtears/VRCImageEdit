import "./style.css";

const fileInput = document.getElementById("file");
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const info = document.getElementById("info");

const buttons = {
  flipX: document.getElementById("flipX"),
  flipY: document.getElementById("flipY"),
  rotL: document.getElementById("rotL"),
  rotR: document.getElementById("rotR"),
  reset: document.getElementById("reset"),
  download: document.getElementById("download"),
  cropMode: document.getElementById("cropMode"),
  applyCrop: document.getElementById("applyCrop"),
  cancelCrop: document.getElementById("cancelCrop"),
};

const ratioButtons = [...document.querySelectorAll("[data-ratio]")];
const cropTools = document.getElementById("cropTools");

const state = {
  img: null,
  sourceImg: null,
  rot: 0,
  flipX: false,
  flipY: false,
  filename: null,
  crop: {
    enabled: false,
    ratio: 0,
    rect: null,
    drag: null,
  },
};

const cropWasm = createCropWasm();

function createCropWasm() {
  const bytes = new Uint8Array(makeCropModuleBytes());
  const module = new WebAssembly.Module(bytes);
  return new WebAssembly.Instance(module).exports;
}

function makeCropModuleBytes() {
  const i32 = 0x7f;
  const bytes = [];
  const u32 = (value) => {
    const out = [];
    let n = value >>> 0;
    do {
      let byte = n & 0x7f;
      n >>>= 7;
      if (n) byte |= 0x80;
      out.push(byte);
    } while (n);
    return out;
  };
  const ascii = (value) => [...value].map((char) => char.charCodeAt(0));
  const section = (id, data) => bytes.push(id, ...u32(data.length), ...data);
  const op = (...items) => instr.push(...items.flat());
  let instr = [];

  bytes.push(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);

  section(1, [
    1,
    0x60,
    7,
    i32,
    i32,
    i32,
    i32,
    i32,
    i32,
    i32,
    0,
  ]);
  section(3, [1, 0]);
  section(5, [1, 0, 1]);
  section(7, [
    2,
    6,
    ...ascii("memory"),
    2,
    0,
    4,
    ...ascii("crop"),
    0,
    0,
  ]);

  // Params: src, dst, srcW, cropX, cropY, cropW, cropH
  // Locals: y, x, srcOffset, dstOffset
  op(0x41, 0x00, 0x21, 0x07);
  op(0x02, 0x40, 0x03, 0x40);
  op(0x20, 0x07, 0x20, 0x06, 0x4e, 0x0d, 0x01);
  op(0x41, 0x00, 0x21, 0x08);
  op(0x02, 0x40, 0x03, 0x40);
  op(0x20, 0x08, 0x20, 0x05, 0x4e, 0x0d, 0x01);

  op(0x20, 0x00);
  op(0x20, 0x04, 0x20, 0x07, 0x6a);
  op(0x20, 0x02, 0x6c);
  op(0x20, 0x03, 0x20, 0x08, 0x6a);
  op(0x6a, 0x41, 0x04, 0x6c, 0x6a, 0x21, 0x09);

  op(0x20, 0x01);
  op(0x20, 0x07, 0x20, 0x05, 0x6c);
  op(0x20, 0x08, 0x6a);
  op(0x41, 0x04, 0x6c, 0x6a, 0x21, 0x0a);

  op(0x20, 0x0a, 0x20, 0x09, 0x28, 0x02, 0x00, 0x36, 0x02, 0x00);
  op(0x20, 0x08, 0x41, 0x01, 0x6a, 0x21, 0x08);
  op(0x0c, 0x00, 0x0b, 0x0b);
  op(0x20, 0x07, 0x41, 0x01, 0x6a, 0x21, 0x07);
  op(0x0c, 0x00, 0x0b, 0x0b);

  const body = [1, 4, i32, ...instr, 0x0b];
  section(10, [1, ...u32(body.length), ...body]);
  return bytes;
}

function setCanvasSizeForState() {
  if (!state.img) return;
  const r = ((state.rot % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  canvas.width = swap ? state.img.height : state.img.width;
  canvas.height = swap ? state.img.width : state.img.height;
}

function render(showOverlay = true) {
  if (!state.img) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    info.textContent = "画像未選択";
    return;
  }

  setCanvasSizeForState();
  const cw = canvas.width;
  const ch = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((state.rot * Math.PI) / 180);
  ctx.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
  ctx.drawImage(state.img, -state.img.width / 2, -state.img.height / 2);
  ctx.restore();

  if (state.crop.enabled && !state.crop.rect) {
    state.crop.rect = makeInitialCropRect(cw, ch, state.crop.ratio);
  }
  if (showOverlay && state.crop.enabled && state.crop.rect) {
    drawCropOverlay(state.crop.rect);
  }

  const cropText = state.crop.enabled && state.crop.rect
    ? ` / トリミング:${Math.round(state.crop.rect.w)}x${Math.round(state.crop.rect.h)}`
    : "";
  info.textContent =
    `元画像: ${state.img.width}x${state.img.height} / 出力: ${canvas.width}x${canvas.height} / 回転:${state.rot}度 / 左右反転:${state.flipX ? "ON" : "OFF"} / 上下反転:${state.flipY ? "ON" : "OFF"}${cropText}`;
}

function makeInitialCropRect(width, height, ratio) {
  const margin = Math.max(24, Math.min(width, height) * 0.08);
  let w = Math.max(1, width - margin * 2);
  let h = Math.max(1, height - margin * 2);
  if (ratio > 0) {
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
  }
  return {
    x: (width - w) / 2,
    y: (height - h) / 2,
    w,
    h,
  };
}

function drawCropOverlay(rect) {
  const x = Math.round(rect.x) + 0.5;
  const y = Math.round(rect.y) + 0.5;
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 0, canvas.width, y);
  ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, canvas.width - x - w, h);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = Math.max(2, canvas.width / 700);
  ctx.strokeRect(x, y, w, h);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i += 1) {
    const gx = x + (w * i) / 3;
    const gy = y + (h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffffff";
  handlePoints(rect).forEach((point) => {
    const size = Math.max(10, Math.min(canvas.width, canvas.height) * 0.018);
    ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  });
  ctx.restore();
}

function handlePoints(rect) {
  return [
    { name: "nw", x: rect.x, y: rect.y },
    { name: "ne", x: rect.x + rect.w, y: rect.y },
    { name: "sw", x: rect.x, y: rect.y + rect.h },
    { name: "se", x: rect.x + rect.w, y: rect.y + rect.h },
  ];
}

function setCropEnabled(enabled) {
  if (!state.img) return;
  state.crop.enabled = enabled;
  state.crop.drag = null;
  cropTools.hidden = !enabled;
  buttons.cropMode.classList.toggle("active", enabled);
  if (enabled) state.crop.rect = makeInitialCropRect(canvas.width, canvas.height, state.crop.ratio);
  render();
}

function setRatio(value) {
  state.crop.ratio = value === "free" ? 0 : Number(value);
  ratioButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.ratio === value);
  });
  if (state.crop.enabled) {
    state.crop.rect = makeInitialCropRect(canvas.width, canvas.height, state.crop.ratio);
    render();
  }
}

function resetCropState() {
  state.crop.enabled = false;
  state.crop.ratio = 0;
  state.crop.rect = null;
  state.crop.drag = null;
  cropTools.hidden = true;
  buttons.cropMode.classList.remove("active");
  ratioButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.ratio === "free");
  });
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function hitTest(point) {
  const rect = state.crop.rect;
  if (!rect) return null;
  const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  const threshold = Math.max(14 * scale, Math.min(canvas.width, canvas.height) * 0.025);
  const handle = handlePoints(rect).find(
    (item) => Math.abs(point.x - item.x) <= threshold && Math.abs(point.y - item.y) <= threshold,
  );
  if (handle) return handle.name;
  if (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  ) {
    return "move";
  }
  return "move-new";
}

function pointerDown(event) {
  if (!state.crop.enabled || !state.crop.rect) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const action = hitTest(point);
  if (action === "move-new") {
    const size = Math.min(canvas.width, canvas.height) * 0.55;
    state.crop.rect = clampRect({
      x: point.x - size / 2,
      y: point.y - size / 2,
      w: state.crop.ratio > 0 ? size : Math.min(size, canvas.width),
      h: state.crop.ratio > 0 ? size / state.crop.ratio : Math.min(size, canvas.height),
    });
  }
  state.crop.drag = {
    action: action === "move-new" ? "move" : action,
    start: point,
    rect: { ...state.crop.rect },
  };
  canvas.setPointerCapture(event.pointerId);
}

function pointerMove(event) {
  const drag = state.crop.drag;
  if (!drag) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  const next = drag.action === "move"
    ? moveRect(drag.rect, dx, dy)
    : resizeRect(drag.rect, drag.action, point);
  state.crop.rect = clampRect(next);
  render();
}

function pointerUp(event) {
  if (!state.crop.drag) return;
  state.crop.drag = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

function moveRect(rect, dx, dy) {
  return {
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy,
  };
}

function resizeRect(rect, action, point) {
  const minSize = Math.max(24, Math.min(canvas.width, canvas.height) * 0.04);
  if (state.crop.ratio > 0) {
    const anchorX = action.includes("w") ? rect.x + rect.w : rect.x;
    const anchorY = action.includes("n") ? rect.y + rect.h : rect.y;
    const signX = point.x >= anchorX ? 1 : -1;
    const signY = point.y >= anchorY ? 1 : -1;
    let w = Math.max(minSize, Math.abs(point.x - anchorX));
    let h = w / state.crop.ratio;
    if (h > Math.abs(point.y - anchorY)) {
      h = Math.max(minSize, Math.abs(point.y - anchorY));
      w = h * state.crop.ratio;
    }
    return {
      x: signX > 0 ? anchorX : anchorX - w,
      y: signY > 0 ? anchorY : anchorY - h,
      w,
      h,
    };
  }

  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;
  if (action.includes("w")) left = Math.min(point.x, right - minSize);
  if (action.includes("e")) right = Math.max(point.x, left + minSize);
  if (action.includes("n")) top = Math.min(point.y, bottom - minSize);
  if (action.includes("s")) bottom = Math.max(point.y, top + minSize);
  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

function clampRect(rect) {
  let { x, y, w, h } = rect;
  const minSize = Math.max(1, Math.min(canvas.width, canvas.height) * 0.03);
  w = Math.min(Math.max(w, minSize), canvas.width);
  h = Math.min(Math.max(h, minSize), canvas.height);
  x = Math.min(Math.max(x, 0), canvas.width - w);
  y = Math.min(Math.max(y, 0), canvas.height - h);
  return { x, y, w, h };
}

function runWasmCrop(source, rect) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.max(1, Math.min(source.width - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(source.height - y, Math.round(rect.h)));
  const sourceBytes = source.data.length;
  const targetBytes = w * h * 4;
  const requiredBytes = sourceBytes + targetBytes;
  const currentPages = cropWasm.memory.buffer.byteLength / 65536;
  const requiredPages = Math.ceil(requiredBytes / 65536);
  if (requiredPages > currentPages) {
    cropWasm.memory.grow(requiredPages - currentPages);
  }

  const sourcePtr = 0;
  const targetPtr = sourceBytes;
  new Uint8ClampedArray(cropWasm.memory.buffer, sourcePtr, sourceBytes).set(source.data);
  cropWasm.crop(sourcePtr, targetPtr, source.width, x, y, w, h);
  const pixels = new Uint8ClampedArray(cropWasm.memory.buffer, targetPtr, targetBytes);
  return new ImageData(new Uint8ClampedArray(pixels), w, h);
}

function imageDataToImage(imageData) {
  const out = document.createElement("canvas");
  out.width = imageData.width;
  out.height = imageData.height;
  out.getContext("2d").putImageData(imageData, 0, 0);
  const img = new Image();
  img.src = out.toDataURL("image/png");
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  state.filename = file.name.replace(/\.[^/.]+$/, "");

  img.onload = () => {
    URL.revokeObjectURL(url);
    state.img = img;
    state.sourceImg = img;
    state.rot = 0;
    state.flipX = false;
    state.flipY = false;
    resetCropState();
    render();
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("画像の読み込みに失敗しました。");
  };

  img.src = url;
});

buttons.flipX.onclick = () => {
  if (!state.img) return;
  state.flipX = !state.flipX;
  render();
};

buttons.flipY.onclick = () => {
  if (!state.img) return;
  state.flipY = !state.flipY;
  render();
};

buttons.rotL.onclick = () => {
  if (!state.img) return;
  state.rot = (state.rot - 90 + 360) % 360;
  state.crop.rect = null;
  render();
};

buttons.rotR.onclick = () => {
  if (!state.img) return;
  state.rot = (state.rot + 90) % 360;
  state.crop.rect = null;
  render();
};

buttons.reset.onclick = () => {
  if (!state.img) return;
  state.img = state.sourceImg || state.img;
  state.rot = 0;
  state.flipX = false;
  state.flipY = false;
  resetCropState();
  render();
};

buttons.cropMode.onclick = () => setCropEnabled(!state.crop.enabled);
buttons.cancelCrop.onclick = () => setCropEnabled(false);

buttons.applyCrop.onclick = async () => {
  if (!state.img || !state.crop.rect) return;
  render(false);
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cropped = runWasmCrop(source, state.crop.rect);
  state.img = await imageDataToImage(cropped);
  state.rot = 0;
  state.flipX = false;
  state.flipY = false;
  state.crop.enabled = false;
  state.crop.rect = null;
  cropTools.hidden = true;
  buttons.cropMode.classList.remove("active");
  render();
};

buttons.download.onclick = () => {
  if (!state.img) return;
  render(false);

  const now = new Date();
  const timestamp =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${state.filename || "image"}_${timestamp}.png`;
  a.click();
  render();
};

ratioButtons.forEach((button) => {
  button.onclick = () => setRatio(button.dataset.ratio);
});

canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);

canvas.width = 900;
canvas.height = 600;
setRatio("free");
render();
