import { simplifyRDP, smoothNodes, deepClone, pointInStroke, distance } from './math.js';
import { ARTBOARD, renderCanvas, hitTestNode } from './renderer.js';
import { AudioTrack } from './audio.js';
import { saveProject, exportSVG, exportPNGSequence } from './exporter.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#drawCanvas');
const frameStrip = $('#frameStrip');
const paletteElement = $('#palette');
const toastElement = $('#toast');
const audio = new AudioTrack(updateAudioUI);
const defaultPalette = {
  contorno: { name: 'contorno', value: '#25252b' },
  piel: { name: 'piel', value: '#f2b99b' },
  ropa: { name: 'ropa', value: '#8b79d8' },
  sombra: { name: 'sombra', value: '#554d72' }
};
let project = { version: 1, name: 'Estudio sin título', width: ARTBOARD.width, height: ARTBOARD.height, fps: 12, palette: defaultPalette, frames: [{ strokes: [] }] };
let currentFrame = 0;
let selectedStrokeId = null;
let selectedNodeIndex = -1;
let tool = 'draw';
let onion = false;
let drawing = null;
let drag = null;
let pointer = { x: -100, y: -100, pressure: 0 };
let sculptRadius = 65;
let zoom = 1;
let playing = false;
let playTimer = null;
let history = [];
let future = [];
let toastTimer;

const frame = () => project.frames[currentFrame];
const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const activePaletteId = () => $('#quickColor').dataset.colorId || 'contorno';

function notify(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 1900);
}

function snapshot() {
  history.push(JSON.stringify(project));
  if (history.length > 70) history.shift();
  future = [];
  $('#undoBtn').disabled = false;
}

function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(project));
  project = JSON.parse(history.pop());
  currentFrame = Math.min(currentFrame, project.frames.length - 1);
  selectedStrokeId = null;
  refresh();
  markSaved();
}

function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(project));
  project = JSON.parse(future.pop());
  currentFrame = Math.min(currentFrame, project.frames.length - 1);
  selectedStrokeId = null;
  refresh();
  markSaved();
}

function markSaved() {
  $('#saveStatus').textContent = 'Cambios guardados localmente';
  try { localStorage.setItem('trazo-project', JSON.stringify(project)); } catch { /* storage may be unavailable */ }
}

function selectedStroke() { return frame().strokes.find(stroke => stroke.id === selectedStrokeId) || null; }

function setTool(next) {
  tool = next;
  document.querySelectorAll('.tool[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  const labels = { draw: ['Dibujar', 'Arrastra para dibujar un trazo'], nodes: ['Editar nodos', 'Selecciona y arrastra nodos o tiradores'], sculpt: ['Empujar', 'Arrastra cerca de una curva para deformarla'], fill: ['Bote de pintura', 'Haz clic en un trazo cerrado para rellenarlo'] };
  $('#toolName').textContent = labels[tool][0];
  $('#toolHint').textContent = labels[tool][1];
  canvas.style.cursor = tool === 'sculpt' ? 'none' : tool === 'fill' ? 'cell' : 'crosshair';
  redraw();
}

function renderPalette() {
  paletteElement.replaceChildren();
  for (const [id, color] of Object.entries(project.palette)) {
    const row = document.createElement('div');
    row.className = 'palette-row';
    const input = document.createElement('input'); input.type = 'color'; input.value = color.value; input.title = `Color ${id}`;
    input.addEventListener('input', () => { snapshot(); color.value = input.value; redraw(); renderFrames(); markSaved(); });
    const name = document.createElement('input'); name.type = 'text'; name.value = color.name || id; name.setAttribute('aria-label', `Nombre del color ${id}`);
    name.addEventListener('change', () => { const newId = name.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_'); if (!newId || (newId !== id && project.palette[newId])) { name.value = color.name || id; return; } if (newId !== id) { snapshot(); project.palette[newId] = color; delete project.palette[id]; for (const f of project.frames) for (const s of f.strokes) { if (s.strokeColorId === id) s.strokeColorId = newId; if (s.fillColorId === id) s.fillColorId = newId; } } color.name = name.value.trim(); renderPalette(); redraw(); markSaved(); });
    const remove = document.createElement('button'); remove.className = 'remove-color'; remove.textContent = '×'; remove.title = `Eliminar color ${id}`;
    remove.addEventListener('click', () => { if (Object.keys(project.palette).length <= 1) return notify('La paleta debe conservar al menos un color.'); snapshot(); delete project.palette[id]; for (const f of project.frames) for (const s of f.strokes) { if (s.strokeColorId === id) s.strokeColorId = Object.keys(project.palette)[0]; if (s.fillColorId === id) s.fillColorId = null; } renderPalette(); refresh(); });
    row.append(input, name, remove); paletteElement.append(row);
  }
  const quickSelect = $('#quickColor');
  if (!project.palette[quickSelect.dataset.colorId]) quickSelect.dataset.colorId = Object.keys(project.palette)[0];
  quickSelect.value = project.palette[quickSelect.dataset.colorId].value;
  renderColorSelects();
}

function renderColorSelects() {
  const strokeSelect = $('#strokeColorSelect');
  const fillSelect = $('#fillColorSelect');
  const chosenStroke = selectedStroke()?.strokeColorId || activePaletteId();
  const chosenFill = selectedStroke()?.fillColorId || '';
  strokeSelect.replaceChildren(); fillSelect.replaceChildren(new Option('Sin relleno', ''));
  for (const [id, color] of Object.entries(project.palette)) {
    strokeSelect.add(new Option(color.name || id, id));
    fillSelect.add(new Option(color.name || id, id));
  }
  strokeSelect.value = chosenStroke;
  fillSelect.value = chosenFill;
}

function renderFrames() {
  frameStrip.replaceChildren();
  project.frames.forEach((item, index) => {
    const card = document.createElement('button'); card.className = `frame-card${index === currentFrame ? ' active' : ''}`; card.title = `Fotograma ${index + 1}`;
    const preview = document.createElement('div'); preview.className = 'frame-preview';
    const thumb = document.createElement('canvas'); preview.append(thumb);
    const number = document.createElement('span'); number.className = 'frame-number'; number.textContent = String(index + 1).padStart(2, '0');
    card.append(preview, number);
    card.addEventListener('click', () => selectFrame(index, true));
    frameStrip.append(card);
    renderCanvas(thumb, item, project.palette, { background: '#f8f8fa' });
  });
  const add = document.createElement('button'); add.className = 'frame-add'; add.title = 'Añadir fotograma'; add.textContent = '+'; add.addEventListener('click', addFrame); frameStrip.append(add);
  $('#frameCount').textContent = `${project.frames.length} ${project.frames.length === 1 ? 'fotograma' : 'fotogramas'}`;
}

function redraw() {
  const previous = onion && currentFrame > 0 ? project.frames[currentFrame - 1] : null;
  const next = onion && currentFrame < project.frames.length - 1 ? project.frames[currentFrame + 1] : null;
  const selected = selectedStroke();
  renderCanvas(canvas, frame(), project.palette, { previous, next, preview: drawing ? drawing.preview : null, selected: tool === 'nodes' ? selected : null, selectedNode: selectedNodeIndex, brush: tool === 'sculpt' ? { ...pointer, radius: sculptRadius } : null });
}

function refresh() { renderPalette(); renderFrames(); renderColorSelects(); redraw(); updateTimelineLabels(); updateAudioUI(); }

function updateTimelineLabels() {
  $('#playheadLabel').textContent = `Fotograma ${currentFrame + 1}`;
  $('#layerCount').textContent = String(frame().strokes.length);
  const stroke = selectedStroke();
  $('#selectionTitle').textContent = stroke ? 'Trazo seleccionado' : 'Sin selección';
  $('#selectionInfo').textContent = stroke ? `${stroke.nodes.length} nodos · ${stroke.closed ? 'Forma cerrada' : 'Trazo abierto'}` : 'Selecciona un trazo con la herramienta de nodos para editar sus puntos.';
  if (stroke) { $('#selectedWidth').value = stroke.width; $('#widthValue').textContent = `${stroke.width} px`; }
  renderColorSelects();
}

function resize() { redraw(); renderFrames(); updateAudioUI(); }

function addFrame() {
  snapshot(); project.frames.splice(currentFrame + 1, 0, { strokes: [] }); selectFrame(currentFrame + 1, false); markSaved();
}

function duplicateFrame() {
  snapshot();
  const clone = deepClone(frame());
  clone.strokes.forEach(stroke => stroke.id = uid());
  project.frames.splice(currentFrame + 1, 0, clone);
  selectFrame(currentFrame + 1, false);
  setTool('nodes');
  markSaved();
  notify('Fotograma duplicado. Ajusta la siguiente pose.');
}

function selectFrame(index, scrubAudio = false) {
  currentFrame = Math.max(0, Math.min(project.frames.length - 1, index));
  selectedStrokeId = null; selectedNodeIndex = -1;
  renderFrames(); redraw(); updateTimelineLabels();
  $('#frameStrip .frame-card.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (scrubAudio && audio.buffer) audio.seek(frameTime(currentFrame), playing);
  updateAudioUI();
}

function frameTime(index = currentFrame) { return index / Number($('#fps').value); }

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * ARTBOARD.width / rect.width, y: (event.clientY - rect.top) * ARTBOARD.height / rect.height };
}

function hitStroke(point) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ARTBOARD.width / canvas.getBoundingClientRect().width, 0, 0, ARTBOARD.height / canvas.getBoundingClientRect().height, 0, 0);
  for (let i = frame().strokes.length - 1; i >= 0; i--) {
    const stroke = frame().strokes[i]; ctx.lineWidth = Math.max(stroke.width, 12);
    if (pointInStroke(ctx, stroke, point)) return stroke;
  }
  return null;
}

function pointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  pointer = { ...pointFromEvent(event), pressure: event.pressure };
  $('#pointerPressure').textContent = `Presión ${Math.round(event.pressure * 100)}%`;
  if (tool === 'draw') {
    drawing = { points: [{ ...pointer }], preview: { id: 'preview', nodes: smoothNodes([pointer]), closed: false, width: Number($('#strokeWidth').value), strokeColorId: activePaletteId(), fillColorId: null } };
  } else if (tool === 'fill') {
    const hit = hitStroke(pointer);
    if (hit?.closed) { snapshot(); hit.fillColorId = activePaletteId(); selectedStrokeId = hit.id; refresh(); markSaved(); }
    else notify('Selecciona una forma cerrada para rellenarla.');
  } else if (tool === 'nodes') {
    const chosen = selectedStroke();
    const nodeHit = chosen ? hitTestNode(chosen, pointer, 13) : null;
    if (nodeHit) { snapshot(); drag = { kind: nodeHit.type, index: nodeHit.index, origin: pointer }; selectedNodeIndex = nodeHit.index; }
    else {
      const hit = hitStroke(pointer); selectedStrokeId = hit?.id || null; selectedNodeIndex = -1;
      if (hit) { const found = hitTestNode(hit, pointer, 13); if (found) { snapshot(); drag = { kind: found.type, index: found.index, origin: pointer }; selectedNodeIndex = found.index; } }
      updateTimelineLabels(); redraw();
    }
  } else if (tool === 'sculpt') {
    snapshot(); drag = { kind: 'sculpt', last: pointer };
  }
}

function pointerMove(event) {
  pointer = { ...pointFromEvent(event), pressure: event.pressure };
  $('#pointerPressure').textContent = `Presión ${Math.round(event.pressure * 100)}%`;
  if (drawing) {
    const last = drawing.points[drawing.points.length - 1];
    if (distance(last, pointer) >= 1.2) drawing.points.push({ ...pointer });
    const simplified = simplifyRDP(drawing.points, Number($('#tolerance').value) || 2);
    drawing.preview.nodes = smoothNodes(simplified);
  }
  const stroke = selectedStroke();
  if (drag && stroke && drag.kind !== 'sculpt') {
    const dx = pointer.x - drag.origin.x, dy = pointer.y - drag.origin.y;
    const node = stroke.nodes[drag.index];
    if (drag.kind === 'node') { node.x += dx; node.y += dy; for (const key of ['cp1', 'cp2']) if (node[key]) { node[key].x += dx; node[key].y += dy; } }
    else { node[drag.kind].x += dx; node[drag.kind].y += dy; }
    drag.origin = pointer;
  } else if (drag?.kind === 'sculpt') {
    const active = selectedStroke() || hitStroke(pointer);
    if (active) {
      selectedStrokeId = active.id;
      const dx = pointer.x - drag.last.x, dy = pointer.y - drag.last.y;
      for (const node of active.nodes) {
        const d = distance(pointer, node);
        if (d < sculptRadius) {
          const force = (1 - d / sculptRadius) ** 2;
          for (const p of [node, node.cp1, node.cp2]) if (p) { p.x += dx * force; p.y += dy * force; }
        }
      }
      drag.last = pointer;
    }
  }
  redraw();
}

function pointerUp(event) {
  if (drawing) {
    const tolerance = Number($('#tolerance').value) || 2;
    const simplified = simplifyRDP(drawing.points, tolerance);
    const close = $('#autoClose').checked && simplified.length > 2 && distance(simplified[0], simplified[simplified.length - 1]) > 0;
    const nodes = smoothNodes(simplified);
    if (nodes.length >= 2) {
      snapshot();
      frame().strokes.push({ id: uid(), nodes, closed: close, width: Number($('#strokeWidth').value) * Math.max(.45, drawing.points.reduce((sum, p) => sum + (p.pressure || .5), 0) / drawing.points.length), strokeColorId: activePaletteId(), fillColorId: null });
      selectedStrokeId = frame().strokes.at(-1).id;
      markSaved();
    }
    drawing = null; renderFrames(); updateTimelineLabels();
  }
  if (drag) { drag = null; markSaved(); updateTimelineLabels(); }
  redraw();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

function deleteSelected() {
  if (!selectedStrokeId) return;
  snapshot(); frame().strokes = frame().strokes.filter(stroke => stroke.id !== selectedStrokeId); selectedStrokeId = null; selectedNodeIndex = -1; refresh(); markSaved();
}

function togglePlayback() {
  playing = !playing;
  $('#playBtn').textContent = playing ? 'Ⅱ' : '▶';
  if (playing) {
    audio.seek(frameTime(), Boolean(audio.buffer));
    const interval = 1000 / Number($('#fps').value);
    playTimer = setInterval(() => {
      const next = (currentFrame + 1) % project.frames.length;
      currentFrame = next;
      renderFrames(); redraw(); updateTimelineLabels();
      if (audio.buffer && frameTime() >= audio.duration) audio.seek(0, true);
      updateAudioUI();
    }, interval);
  } else { clearInterval(playTimer); audio.stop(); }
}

function updateAudioUI() {
  $('#audioName').textContent = audio.name || 'Sin pista';
  audio.drawWaveform($('#waveform'), frameTime());
}

function handleWaveformPointer(event) {
  if (!audio.buffer) return;
  const rect = $('#waveform').getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  selectFrame(Math.round(ratio * Math.max(0, project.frames.length - 1)), false);
  audio.seek(ratio * audio.duration, playing);
}

document.querySelectorAll('.tool[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);
canvas.addEventListener('contextmenu', event => event.preventDefault());
$('#undoBtn').addEventListener('click', undo); $('#redoBtn').addEventListener('click', redo);
$('#deleteBtn').addEventListener('click', deleteSelected);
$('#duplicateFrame').addEventListener('click', duplicateFrame); $('#tipDuplicate').addEventListener('click', duplicateFrame);
$('#firstFrame').addEventListener('click', () => selectFrame(0, true)); $('#lastFrame').addEventListener('click', () => selectFrame(project.frames.length - 1, true));
$('#prevFrame').addEventListener('click', () => selectFrame(currentFrame - 1, true)); $('#nextFrame').addEventListener('click', () => selectFrame(currentFrame + 1, true));
$('#playBtn').addEventListener('click', togglePlayback);
$('#fps').addEventListener('change', () => { project.fps = Number($('#fps').value); if (playing) { togglePlayback(); togglePlayback(); } markSaved(); });
$('#onionBtn').addEventListener('click', event => { onion = !onion; event.currentTarget.classList.toggle('active', onion); redraw(); });
$('#quickColor').addEventListener('input', event => {
  const currentId = event.currentTarget.dataset.colorId;
  const match = Object.keys(project.palette).find(id => project.palette[id].value === event.currentTarget.value);
  if (match) event.currentTarget.dataset.colorId = match;
  else if (project.palette[currentId]) { snapshot(); project.palette[currentId].value = event.currentTarget.value; redraw(); renderFrames(); markSaved(); }
});
$('#addColor').addEventListener('click', () => {
  let id = `color${Object.keys(project.palette).length + 1}`, index = 2;
  while (project.palette[id]) id = `color${index++}`;
  snapshot(); project.palette[id] = { name: id, value: '#e69ac5' }; renderPalette(); markSaved();
});
$('#strokeColorSelect').addEventListener('change', event => { const stroke = selectedStroke(); if (stroke) { snapshot(); stroke.strokeColorId = event.target.value; refresh(); markSaved(); } else { $('#quickColor').dataset.colorId = event.target.value; $('#quickColor').value = project.palette[event.target.value].value; } });
$('#fillColorSelect').addEventListener('change', event => { const stroke = selectedStroke(); if (stroke?.closed) { snapshot(); stroke.fillColorId = event.target.value || null; refresh(); markSaved(); } });
$('#selectedWidth').addEventListener('input', event => { const stroke = selectedStroke(); if (stroke) { stroke.width = Number(event.target.value); $('#widthValue').textContent = `${stroke.width} px`; redraw(); } });
$('#selectedWidth').addEventListener('change', () => { snapshot(); markSaved(); });
$('#saveBtn').addEventListener('click', () => saveProject(project));
$('#loadFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.frames) || !imported.palette || imported.frames.some(f => !Array.isArray(f.strokes))) throw new Error('Formato inválido');
    snapshot(); project = imported; project.width ||= ARTBOARD.width; project.height ||= ARTBOARD.height; project.fps ||= 12; project.name ||= file.name.replace(/\.json$/i, '');
    currentFrame = 0; $('#fps').value = String(project.fps); selectedStrokeId = null; refresh(); markSaved(); notify('Proyecto cargado.');
  } catch (error) { notify(`No se pudo abrir el proyecto: ${error.message}`); }
  event.target.value = '';
});
$('#exportSvg').addEventListener('click', () => {
  const svg = exportSVG(frame(), project.palette, 'transparent');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/\s+/g, '-')}-fotograma-${currentFrame + 1}.svg`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#exportPng').addEventListener('click', async () => { $('#exportPng').disabled = true; try { await exportPNGSequence(project, true); notify('Secuencia PNG exportada.'); } catch (error) { notify(`No se pudo exportar: ${error.message}`); } finally { $('#exportPng').disabled = false; } });
$('#audioFile').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { await audio.load(file); notify('Audio cargado.'); } catch (error) { notify(`No se pudo cargar el audio: ${error.message}`); } event.target.value = ''; });
$('#removeAudio').addEventListener('click', () => audio.clear());
$('#waveform').addEventListener('pointerdown', handleWaveformPointer);
$('#zoomIn').addEventListener('click', () => setZoom(zoom + .1)); $('#zoomOut').addEventListener('click', () => setZoom(zoom - .1)); $('#fitCanvas').addEventListener('click', () => setZoom(1));
function setZoom(value) { zoom = Math.max(.5, Math.min(1.5, value)); $('#canvasWrap').style.width = `min(${88 * zoom}%, ${1080 * zoom}px)`; $('#zoomLabel').textContent = `${Math.round(zoom * 100)}%`; }
const shortcuts = $('#shortcutsDialog');
document.addEventListener('keydown', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); return; }
  if (event.key === 'ArrowLeft') { selectFrame(currentFrame - 1, true); return; }
  if (event.key === 'ArrowRight') { selectFrame(currentFrame + 1, true); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { deleteSelected(); return; }
  if (event.key.toLowerCase() === 'b') setTool('draw');
  if (event.key.toLowerCase() === 'e') setTool('nodes');
  if (event.key.toLowerCase() === 's') setTool('sculpt');
  if (event.key.toLowerCase() === 'g') setTool('fill');
  if (event.key.toLowerCase() === 'd') duplicateFrame();
  if (event.key === '?') shortcuts.showModal();
});
$('#closeShortcuts').addEventListener('click', () => shortcuts.close());
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => { if (playing) audio.stop(); });

try {
  const stored = localStorage.getItem('trazo-project');
  if (stored) { const parsed = JSON.parse(stored); if (Array.isArray(parsed.frames) && parsed.palette) project = parsed; }
} catch { /* start with an empty document when storage is unavailable */ }
$('#fps').value = String(project.fps || 12);
renderPalette(); renderFrames(); redraw(); updateTimelineLabels(); updateAudioUI();
