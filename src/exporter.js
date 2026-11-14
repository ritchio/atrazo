import { ARTBOARD, renderCanvas } from './renderer.js';

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveProject(project) {
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeName(project.name)}.json`);
}

export function safeName(name) { return (name || 'animacion').toLowerCase().replace(/[^a-z0-9áéíóúñ_-]+/gi, '-').replace(/^-|-$/g, '') || 'animacion'; }

export function exportSVG(frame, palette, background = 'transparent') {
  const colors = Object.entries(palette).map(([id, color]) => `    --color-${id}: ${color.value};`).join('\n');
  const paths = frame.strokes.map(stroke => {
    const nodes = stroke.nodes;
    if (!nodes.length) return '';
    let d = `M ${nodes[0].x.toFixed(2)} ${nodes[0].y.toFixed(2)}`;
    for (let i = 1; i < nodes.length; i++) { const a = nodes[i - 1], b = nodes[i]; d += ` C ${(a.cp2?.x ?? a.x).toFixed(2)} ${(a.cp2?.y ?? a.y).toFixed(2)}, ${(b.cp1?.x ?? b.x).toFixed(2)} ${(b.cp1?.y ?? b.y).toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}`; }
    if (stroke.closed && nodes.length > 2) { const a = nodes[nodes.length - 1], b = nodes[0]; d += ` C ${(a.cp2?.x ?? a.x).toFixed(2)} ${(a.cp2?.y ?? a.y).toFixed(2)}, ${(b.cp1?.x ?? b.x).toFixed(2)} ${(b.cp1?.y ?? b.y).toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`; }
    const fill = stroke.fillColorId && palette[stroke.fillColorId] ? `var(--color-${stroke.fillColorId})` : 'none';
    const color = palette[stroke.strokeColorId]?.value ? `var(--color-${stroke.strokeColorId})` : '#24242b';
    return `  <path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${stroke.width || 5}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).filter(Boolean).join('\n');
  const bg = background === 'transparent' ? '' : `  <rect width="${ARTBOARD.width}" height="${ARTBOARD.height}" fill="${background}"/>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ARTBOARD.width}" height="${ARTBOARD.height}" viewBox="0 0 ${ARTBOARD.width} ${ARTBOARD.height}">\n  <style>\n:root {\n${colors}\n}\n  </style>\n${bg}${paths}\n</svg>`;
}

export async function exportPNGSequence(project, transparent = true) {
  const canvas = document.createElement('canvas');
  canvas.width = ARTBOARD.width; canvas.height = ARTBOARD.height;
  for (let i = 0; i < project.frames.length; i++) {
    renderCanvas(canvas, project.frames[i], project.palette, { background: transparent ? false : '#f8f8fa' });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    download(blob, `${safeName(project.name)}_${String(i + 1).padStart(4, '0')}.png`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
