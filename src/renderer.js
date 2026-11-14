import { tracePath, distance } from './math.js';

export const ARTBOARD = { width: 1280, height: 720 };

function bezierPoint(a, b, t) {
  const p0 = a, p1 = a.cp2 || a, p2 = b.cp1 || b, p3 = b;
  const u = 1 - t;
  return { x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x, y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y };
}

export function drawStroke(ctx, stroke, palette, options = {}) {
  if (!stroke.nodes?.length) return;
  tracePath(ctx, stroke);
  if (stroke.closed && stroke.fillColorId && palette[stroke.fillColorId]) {
    ctx.fillStyle = options.tint || palette[stroke.fillColorId].value;
    ctx.fill();
  }
  ctx.strokeStyle = options.tint || palette[stroke.strokeColorId]?.value || '#25252b';
  ctx.lineWidth = stroke.width || 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function drawSelection(ctx, stroke, selectedNode = -1) {
  if (!stroke) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#9b7cff';
  ctx.fillStyle = '#18151f';
  for (let i = 0; i < stroke.nodes.length; i++) {
    const node = stroke.nodes[i];
    for (const key of ['cp1', 'cp2']) {
      if (!node[key]) continue;
      ctx.beginPath(); ctx.moveTo(node.x, node.y); ctx.lineTo(node[key].x, node[key].y); ctx.stroke();
      ctx.beginPath(); ctx.arc(node[key].x, node[key].y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = i === selectedNode ? '#c6b2ff' : '#fff';
    ctx.fillRect(node.x - 4, node.y - 4, 8, 8);
    ctx.strokeRect(node.x - 4, node.y - 4, 8, 8);
  }
  ctx.restore();
}

export function renderCanvas(canvas, frame, palette, options = {}) {
  const rect = canvas.getBoundingClientRect();
  const dpr = rect.width && rect.height ? (window.devicePixelRatio || 1) : 1;
  const width = Math.max(1, Math.round((rect.width || canvas.width || ARTBOARD.width) * dpr));
  const height = Math.max(1, Math.round((rect.height || canvas.height || ARTBOARD.height) * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(width / ARTBOARD.width, 0, 0, height / ARTBOARD.height, 0, 0);
  ctx.clearRect(0, 0, ARTBOARD.width, ARTBOARD.height);
  if (options.background !== false) { ctx.fillStyle = options.background || '#f8f8fa'; ctx.fillRect(0, 0, ARTBOARD.width, ARTBOARD.height); }
  if (options.previous) for (const stroke of options.previous.strokes) drawStroke(ctx, stroke, palette, { tint: 'rgba(239,76,97,.25)' });
  if (options.next) for (const stroke of options.next.strokes) drawStroke(ctx, stroke, palette, { tint: 'rgba(67,143,255,.23)' });
  for (const stroke of frame.strokes) drawStroke(ctx, stroke, palette);
  if (options.preview) drawStroke(ctx, options.preview, palette);
  if (options.selected) drawSelection(ctx, options.selected, options.selectedNode ?? -1);
  if (options.brush) {
    ctx.save(); ctx.beginPath(); ctx.arc(options.brush.x, options.brush.y, options.brush.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(173,145,255,.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(181,155,255,.8)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  return ctx;
}

export function hitTestNode(stroke, point, radius) {
  for (let i = 0; i < stroke.nodes.length; i++) {
    const node = stroke.nodes[i];
    for (const key of ['cp1', 'cp2']) if (node[key] && distance(point, node[key]) <= radius) return { type: key, index: i };
    if (distance(point, node) <= radius) return { type: 'node', index: i };
  }
  return null;
}
