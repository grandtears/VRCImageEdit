// Average each block in a selected ImageData region, including partial edge blocks.
export function pixelate(image, blockSize) {
  const { data, width, height } = image;
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      const right = Math.min(width, x + blockSize);
      const bottom = Math.min(height, y + blockSize);
      const sums = [0, 0, 0, 0];
      for (let py = y; py < bottom; py += 1) {
        for (let px = x; px < right; px += 1) {
          const i = (py * width + px) * 4;
          const alpha = data[i + 3];
          for (let c = 0; c < 3; c += 1) sums[c] += data[i + c] * alpha;
          sums[3] += alpha;
        }
      }
      const color = sums.map((sum, c) => Math.round(c === 3
        ? sum / ((right - x) * (bottom - y))
        : sums[3] ? sum / sums[3] : 0));
      for (let py = y; py < bottom; py += 1) {
        for (let px = x; px < right; px += 1) {
          data.set(color, (py * width + px) * 4);
        }
      }
    }
  }
  return image;
}
