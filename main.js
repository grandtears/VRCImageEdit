import "./style.css";

const fileInput = document.getElementById("file");
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const info = document.getElementById("info");

const state = {
  img: null,
  rot: 0,       // 0,90,180,270
  flipX: false, // 左右
  flipY: false, // 上下
};

function setCanvasSizeForState() {
  if (!state.img) return;
  const r = ((state.rot % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  canvas.width = swap ? state.img.height : state.img.width;
  canvas.height = swap ? state.img.width : state.img.height;
}

function render() {
  if (!state.img) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    info.textContent = "未選択";
    return;
  }

  setCanvasSizeForState();

  const cw = canvas.width;
  const ch = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, cw, ch);

  // 中心基準で回転・反転
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((state.rot * Math.PI) / 180);
  ctx.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);

  // 画像を中心に描画
  ctx.drawImage(state.img, -state.img.width / 2, -state.img.height / 2);

  ctx.restore();

  info.textContent =
    `元: ${state.img.width}×${state.img.height} / 出力: ${canvas.width}×${canvas.height} / 回転:${state.rot}° / 左右:${state.flipX ? "ON" : "OFF"} / 上下:${state.flipY ? "ON" : "OFF"}`;
}

// 画像ロード
fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    URL.revokeObjectURL(url);
    state.img = img;
    state.rot = 0;
    state.flipX = false;
    state.flipY = false;
    render();
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("画像の読み込みに失敗しました。");
  };

  img.src = url;
});

// 操作
document.getElementById("flipX").onclick = () => {
  if (!state.img) return;
  state.flipX = !state.flipX;
  render();
};

document.getElementById("flipY").onclick = () => {
  if (!state.img) return;
  state.flipY = !state.flipY;
  render();
};

document.getElementById("rotL").onclick = () => {
  if (!state.img) return;
  state.rot = (state.rot - 90 + 360) % 360;
  render();
};

document.getElementById("rotR").onclick = () => {
  if (!state.img) return;
  state.rot = (state.rot + 90) % 360;
  render();
};

document.getElementById("reset").onclick = () => {
  if (!state.img) return;
  state.rot = 0;
  state.flipX = false;
  state.flipY = false;
  render();
};

// ダウンロード
document.getElementById("download").onclick = () => {
  if (!state.img) return;
  const a = document.createElement("a");
  a.download = "edited.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
};

// 初期状態
canvas.width = 900;
canvas.height = 600;
render();
