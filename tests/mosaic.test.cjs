const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const algorithm = fs.readFileSync('mosaic.js', 'utf8').replace('export function', 'function');
const context = vm.createContext({});
vm.runInContext(algorithm, context);

test('blocks average colors, handle partial edges and preserve alpha', () => {
  const image = { width: 3, height: 1, data: new Uint8ClampedArray([
    100, 0, 0, 255, 0, 100, 0, 255, 0, 0, 200, 128,
  ]) };
  context.pixelate(image, 2);
  assert.deepEqual([...image.data], [50, 50, 0, 255, 50, 50, 0, 255, 0, 0, 200, 128]);
  const transparent = { width: 2, height: 1, data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 255, 0,
  ]) };
  context.pixelate(transparent, 2);
  assert.deepEqual([...transparent.data], [255, 0, 0, 128, 255, 0, 0, 128]);
});

test('small, medium and large produce progressively larger blocks', () => {
  const counts = [8, 16, 32].map(size => {
    const image = { width: 64, height: 1, data: new Uint8ClampedArray(64 * 4) };
    for (let x = 0; x < 64; x++) image.data.set([x, x, x, 255], x * 4);
    context.pixelate(image, size);
    return new Set(Array.from({ length: 64 }, (_, x) => image.data[x * 4])).size;
  });
  assert.deepEqual(counts, [8, 4, 2]);
});

function editor() {
  const elements = new Map();
  const writes = [];
  const captures = new Set();
  const ctx = new Proxy({
    getImageData: (x, y, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (data, x, y) => writes.push({ data, x, y }),
  }, { get: (target, key) => target[key] || (() => {}) });
  const element = () => ({
    hidden: false, disabled: false, dataset: {}, classList: { toggle() {}, remove() {}, add() {} },
    addEventListener() {}, setAttribute() {}, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  });
  const sizes = [8, 16, 32].map(size => Object.assign(element(), { dataset: { mosaic: String(size) } }));
  const document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll: selector => selector === '[data-mosaic]' ? sizes : [],
    createElement: element,
  };
  const c = vm.createContext({ document, WebAssembly, Uint8Array, Uint8ClampedArray });
  vm.runInContext(algorithm + '\n' + fs.readFileSync('main.js', 'utf8').replace(/^import .*;\r?\n/gm, ''), c);
  const run = code => vm.runInContext(code, c);
  run('state.img = state.sourceImg = {width:1000,height:1000}; render();');
  const event = (x, y, type = 'pointermove') => ({ clientX: x, clientY: y, pointerId: 1, type, preventDefault() {} });
  const select = () => {
    c.pointerDown(event(100, 200, 'pointerdown'));
    c.pointerMove(event(300, 400));
    c.pointerUp(event(300, 400, 'pointerup'));
  };
  return { c, run, elements, writes, sizes, select, event, captures };
}

test('selection previews only its region, supports strength and applies to the image', () => {
  const e = editor();
  e.elements.get('mosaicMode').onclick();
  e.select();
  const write = e.writes.at(-1);
  assert.deepEqual([write.x, write.y, write.data.width, write.data.height], [100, 200, 200, 200]);
  e.sizes[2].onclick();
  assert.equal(e.run('state.mosaic.size'), 32);
  e.elements.get('applyMosaic').onclick();
  assert.equal(e.run('state.img === state.sourceImg'), false);
  assert.equal(e.run('state.mosaic.enabled'), false);
  assert.equal(e.run('state.rot'), 0);
  e.elements.get('reset').onclick();
  assert.equal(e.run('state.img === state.sourceImg'), true);
});

test('cancel, mode switches, reverse drags, bounds and pointer cancellation', () => {
  const e = editor();
  e.elements.get('mosaicMode').onclick();
  e.c.pointerDown(e.event(500, 600, 'pointerdown'));
  e.c.pointerUp(e.event(-200, -300, 'pointerup'));
  assert.equal(e.run('JSON.stringify(state.mosaic.rect)'), JSON.stringify({ x: 0, y: 0, w: 500, h: 600 }));
  e.elements.get('cancelMosaic').onclick();
  assert.equal(e.run('state.img === state.sourceImg'), true);
  e.elements.get('mosaicMode').onclick();
  e.c.pointerDown(e.event(100, 100, 'pointerdown'));
  e.c.pointerUp(e.event(100, 100, 'pointerup'));
  assert.equal(e.elements.get('applyMosaic').disabled, true);
  e.select();
  e.c.setCropEnabled(true);
  assert.equal(e.run('state.mosaic.enabled'), false);
  e.elements.get('mosaicMode').onclick();
  assert.equal(e.run('state.crop.enabled'), false);
  e.c.pointerDown(e.event(100, 100, 'pointerdown'));
  e.c.pointerMove(e.event(300, 300));
  e.c.pointerUp(e.event(300, 300, 'pointercancel'));
  assert.equal(e.run('state.mosaic.rect'), null);
  assert.equal(e.captures.size, 0);
});
