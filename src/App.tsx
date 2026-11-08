import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Upload, Layers3, Image as ImageIcon, Move3D, Camera, SlidersHorizontal,
  Eye, EyeOff, Lock, Unlock, Trash2, Copy, Plus, ChevronDown, Play,
  Undo2, Redo2, Maximize2, ZoomIn, ZoomOut, RotateCcw, Film, Settings2
} from 'lucide-react';

type Layer = {
  id: string; name: string; url: string; fileName: string;
  x: number; y: number; z: number; scale: number; rotation: number;
  visible: boolean; locked: boolean; opacity: number;
};

const uid = () => Math.random().toString(36).slice(2, 10);

function Viewport({ layers, selectedId, onSelect }: {
  layers: Layer[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshes = useRef(new Map<string, THREE.Mesh>());
  const drag = useRef<{ id: string; x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#10121b');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.current.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    sceneRef.current = scene; rendererRef.current = renderer; cameraRef.current = camera;
    const resize = () => {
      if (!host.current) return;
      const w = host.current.clientWidth, h = host.current.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    let frame = 0;
    const render = () => { frame = requestAnimationFrame(render); renderer.render(scene, camera); };
    render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      meshes.current.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      meshes.current.clear(); renderer.dispose();
      if (host.current?.contains(renderer.domElement)) host.current.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    const live = new Set(layers.map(l => l.id));
    meshes.current.forEach((mesh, id) => {
      if (!live.has(id)) { scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); meshes.current.delete(id); }
    });
    layers.forEach((layer, index) => {
      let mesh = meshes.current.get(layer.id);
      if (!mesh) {
        const texture = new THREE.TextureLoader().load(layer.url);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
        mesh.userData.layerId = layer.id; scene.add(mesh); meshes.current.set(layer.id, mesh);
      }
      mesh.position.set(layer.x / 100, -layer.y / 100, layer.z);
      mesh.scale.setScalar(layer.scale);
      mesh.rotation.z = THREE.MathUtils.degToRad(layer.rotation);
      mesh.visible = layer.visible;
      mesh.renderOrder = index;
      (mesh.material as THREE.MeshBasicMaterial).opacity = layer.opacity / 100;
      mesh.scale.set(4 * layer.scale, 4 * layer.scale, 1);
      if (layer.id === selectedId) mesh.position.z += 0.001;
    });
  }, [layers, selectedId]);

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = host.current?.getBoundingClientRect(); if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), cameraRef.current!);
    const hits = ray.intersectObjects([...meshes.current.values()]);
    if (hits.length) { const id = hits[0].object.userData.layerId as string; onSelect(id); drag.current = { id, x: e.clientX, y: e.clientY, px: hits[0].object.position.x, py: hits[0].object.position.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current; const rect = host.current?.getBoundingClientRect(); if (!rect) return;
    const item = meshes.current.get(d.id); if (!item) return;
    item.position.x = d.px + ((e.clientX - d.x) / rect.width) * 8;
    item.position.y = d.py - ((e.clientY - d.y) / rect.height) * 8;
  };
  return <div className="viewport" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}>
    {layers.length === 0 && <div className="empty-scene"><div className="empty-icon"><ImageIcon size={26}/></div><strong>Your canvas is empty</strong><span>Import artwork to begin building your 2.5D scene.</span></div>}
    <div className="viewport-badge"><span className="live-dot"/> 3D VIEWPORT</div>
    <div className="viewport-actions"><button title="Zoom in" onClick={() => { if (cameraRef.current) cameraRef.current.position.z = Math.max(3, cameraRef.current.position.z - 1); }}><ZoomIn size={16}/></button><button title="Zoom out" onClick={() => { if (cameraRef.current) cameraRef.current.position.z = Math.min(20, cameraRef.current.position.z + 1); }}><ZoomOut size={16}/></button><button title="Reset camera" onClick={() => { if (cameraRef.current) cameraRef.current.position.set(0,0,10); }}><RotateCcw size={16}/></button></div>
  </div>;
}

export default function App() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'layers'|'properties'>('layers');
  const [projectName, setProjectName] = useState('Untitled Scene');
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = layers.find(l => l.id === selectedId) ?? null;

  const importFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const additions: Layer[] = Array.from(files).filter(f => f.type.startsWith('image/')).map(file => ({
      id: uid(), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name,
      url: URL.createObjectURL(file), x: 0, y: 0, z: layers.length * 0.15,
      scale: 1, rotation: 0, visible: true, locked: false, opacity: 100,
    }));
    setLayers(prev => [...prev, ...additions]); if (additions[0]) setSelectedId(additions[0].id);
  }, [layers.length]);

  const updateSelected = (patch: Partial<Layer>) => setLayers(prev => prev.map(l => l.id === selectedId ? { ...l, ...patch } : l));
  const removeLayer = (id: string) => { setLayers(prev => { const found = prev.find(l => l.id === id); if (found) URL.revokeObjectURL(found.url); return prev.filter(l => l.id !== id); }); if (selectedId === id) setSelectedId(null); };
  const duplicateLayer = (layer: Layer) => { const copy = { ...layer, id: uid(), name: layer.name + ' copy', z: layer.z + 0.1 }; setLayers(prev => [...prev, copy]); setSelectedId(copy.id); };

  useEffect(() => {
    const save = () => localStorage.setItem('parallax-project', JSON.stringify({ projectName, layers: layers.map(({url, ...l}) => l) }));
    save();
  }, [projectName, layers]);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">P</div><div><b>PARALLAX</b><small>2.5 CINEMATIC STUDIO</small></div></div>
      <div className="project-title"><input value={projectName} onChange={e => setProjectName(e.target.value)} aria-label="Project name"/><span className="saved-dot"/> <small>LOCAL PROJECT</small></div>
      <div className="top-actions"><button className="icon-btn" title="Undo"><Undo2 size={17}/></button><button className="icon-btn" title="Redo"><Redo2 size={17}/></button><button className="export-btn" onClick={() => alert('Video rendering will be added in the rendering phase.') }><Film size={15}/> Export</button></div>
    </header>
    <div className="workspace">
      <aside className="left-rail">
        <button className="rail-item active"><Move3D/><span>Scene</span></button>
        <button className="rail-item" onClick={() => setTab('layers')}><Layers3/><span>Layers</span></button>
        <button className="rail-item" onClick={() => fileRef.current?.click()}><ImageIcon/><span>Media</span></button>
        <button className="rail-item" onClick={() => setTab('properties')}><SlidersHorizontal/><span>Adjust</span></button>
        <div className="rail-bottom"><button className="rail-item"><Settings2/><span>Settings</span></button></div>
      </aside>
      <section className="editor-main">
        <div className="scene-toolbar"><div><span className="eyebrow">SCENE EDITOR</span><strong>Composition</strong></div><div className="toolbar-right"><span className="format-chip">9:16 PORTRAIT</span><button className="small-icon"><Maximize2 size={15}/></button></div></div>
        <Viewport layers={layers} selectedId={selectedId} onSelect={setSelectedId}/>
        <div className="transport"><button className="play-btn"><Play size={15} fill="currentColor"/></button><span>00:00:00:00</span><div className="transport-line"><i/></div><span>00:00:10:00</span><span className="fps">30 FPS</span></div>
      </section>
      <aside className="inspector">
        <div className="inspector-tabs"><button className={tab==='layers'?'chosen':''} onClick={() => setTab('layers')}><Layers3 size={15}/> Layers</button><button className={tab==='properties'?'chosen':''} onClick={() => setTab('properties')}><SlidersHorizontal size={15}/> Properties</button></div>
        {tab === 'layers' ? <div className="layer-panel">
          <div className="panel-heading"><div><span className="eyebrow">SCENE CONTENT</span><strong>Layers <em>{layers.length}</em></strong></div><button className="add-btn" onClick={() => fileRef.current?.click()}><Plus size={15}/> Add</button></div>
          {layers.length === 0 ? <div className="layer-empty"><Layers3 size={22}/><b>No layers yet</b><span>Import transparent PNGs or a complete artwork.</span><button onClick={() => fileRef.current?.click()}><Upload size={14}/> Import artwork</button></div> : <div className="layer-list">{[...layers].reverse().map(layer => <div className={'layer-row '+(selectedId===layer.id?'selected':'')} key={layer.id} onClick={() => setSelectedId(layer.id)}><div className="layer-thumb"><img src={layer.url}/></div><div className="layer-info"><b>{layer.name}</b><small>{layer.z.toFixed(2)} depth</small></div><button title="Toggle visibility" onClick={e => {e.stopPropagation();setLayers(p=>p.map(l=>l.id===layer.id?{...l,visible:!l.visible}:l));}}>{layer.visible?<Eye size={15}/>:<EyeOff size={15}/>}</button><button title="Lock layer" onClick={e => {e.stopPropagation();setLayers(p=>p.map(l=>l.id===layer.id?{...l,locked:!l.locked}:l));}}>{layer.locked?<Lock size={14}/>:<Unlock size={14}/>}</button></div>)}</div>}
        </div> : <div className="properties-panel">{selected ? <>
          <div className="panel-heading"><div><span className="eyebrow">SELECTED LAYER</span><strong>{selected.name}</strong></div><button className="danger-icon" onClick={() => removeLayer(selected.id)}><Trash2 size={16}/></button></div>
          <label>Position X <b>{selected.x.toFixed(0)}</b><input type="range" min="-300" max="300" value={selected.x} onChange={e=>updateSelected({x:+e.target.value})}/></label>
          <label>Position Y <b>{selected.y.toFixed(0)}</b><input type="range" min="-300" max="300" value={selected.y} onChange={e=>updateSelected({y:+e.target.value})}/></label>
          <label>Depth (Z) <b>{selected.z.toFixed(2)}</b><input type="range" min="-3" max="3" step=".05" value={selected.z} onChange={e=>updateSelected({z:+e.target.value})}/></label>
          <label>Scale <b>{selected.scale.toFixed(2)}×</b><input type="range" min=".2" max="3" step=".05" value={selected.scale} onChange={e=>updateSelected({scale:+e.target.value})}/></label>
          <label>Rotation <b>{selected.rotation}°</b><input type="range" min="-180" max="180" value={selected.rotation} onChange={e=>updateSelected({rotation:+e.target.value})}/></label>
          <label>Opacity <b>{selected.opacity}%</b><input type="range" min="0" max="100" value={selected.opacity} onChange={e=>updateSelected({opacity:+e.target.value})}/></label>
          <button className="wide-secondary" onClick={() => duplicateLayer(selected)}><Copy size={14}/> Duplicate layer</button>
        </> : <div className="layer-empty"><SlidersHorizontal size={22}/><b>No layer selected</b><span>Select a layer to edit its transforms.</span></div>}</div>}
        <div className="inspector-footer"><span className="live-dot"/> All changes stay in this browser</div>
      </aside>
    </div>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => {importFiles(e.target.files);e.target.value='';}}/>
  </main>;
}
