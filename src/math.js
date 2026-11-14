export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function simplifyRDP(points, tolerance = 2) {
  if (points.length <= 2) return points.map(point => ({ ...point }));
  const marked = new Uint8Array(points.length);
  marked[0] = 1;
  marked[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = tolerance;
    let farthest = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointLineDistance(points[i], points[first], points[last]);
      if (d > maxDistance) { maxDistance = d; farthest = i; }
    }
    if (farthest !== -1) {
      marked[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => marked[index]).map(point => ({ ...point }));
}

export function smoothNodes(points, tension = 0.22) {
  if (points.length < 2) return points.map(point => ({ ...point, cp1: { ...point }, cp2: { ...point } }));
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const span = distance(previous, next) * tension;
    const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
    return {
      ...point,
      cp1: { x: point.x - Math.cos(angle) * span, y: point.y - Math.sin(angle) * span },
      cp2: { x: point.x + Math.cos(angle) * span, y: point.y + Math.sin(angle) * span }
    };
  });
}

export function tracePath(ctx, stroke) {
  const nodes = stroke.nodes;
  if (!nodes.length) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length; i++) {
    const previous = nodes[i - 1];
    const current = nodes[i];
    ctx.bezierCurveTo(previous.cp2?.x ?? previous.x, previous.cp2?.y ?? previous.y, current.cp1?.x ?? current.x, current.cp1?.y ?? current.y, current.x, current.y);
  }
  if (stroke.closed && nodes.length > 2) {
    const last = nodes[nodes.length - 1];
    const first = nodes[0];
    ctx.bezierCurveTo(last.cp2?.x ?? last.x, last.cp2?.y ?? last.y, first.cp1?.x ?? first.x, first.cp1?.y ?? first.y, first.x, first.y);
    ctx.closePath();
  }
}

export function deepClone(value) { return JSON.parse(JSON.stringify(value)); }

export function pointInStroke(ctx, stroke, point) {
  tracePath(ctx, stroke);
  if (stroke.closed && ctx.isPointInPath(point.x, point.y)) return true;
  return ctx.isPointInStroke(point.x, point.y);
}
