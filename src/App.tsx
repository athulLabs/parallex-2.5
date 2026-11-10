import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import MaskEditor from './MaskEditor';
import {
  Upload, Layers3, Image as ImageIcon, Move3D, SlidersHorizontal, Eye, EyeOff,
  Lock, Unlock, Trash2, Copy, Plus, Play, Undo2, Redo2, Maximize2, Download, FolderOpen,
  ZoomIn, ZoomOut, RotateCcw, Film, Settings2, Scan, Pause, CircleDot, SkipBack, Camera, KeyRound
, Waves, Wind} from 'lucide-react';

type Transform = { x:number; y:number; z:number; scale:number; rotation:number; opacity:number };
type CameraTransform = { x:number; y:number; zoom:number; z:number; roll:number };
type Keyframe = { id:string; time:number; layers:Record<string,Transform>; camera:CameraTransform };
type EnvironmentPreset = 'divine'|'sunset'|'night'|'storm'|'temple'|'cosmic';
type EnvironmentSettings = { preset: EnvironmentPreset; intensity:number; horizon:number; stars:boolean; };
type Layer = {
  id: string; name: string; url: string; fileName: string;
  x: number; y: number; z: number; scale: number; rotation: number;
  visible: boolean; locked: boolean; opacity: number; width: number; height: number; isVideo?: boolean;
  motionX?: number; motionY?: number; motionRotation?: number; motionSpeed?: number;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const BOARD_W = 4.05;
const BOARD_H = 7.2;

type EditorSnapshot = { layers:Layer[]; selectedId:string|null; projectName:string; duration:number; keyframes:Keyframe[]; cameraTransform:CameraTransform };
const AUTOSAVE_DB='parallax-editor-recovery';
const AUTOSAVE_STORE='projects';
const openAutosaveDb=():Promise<IDBDatabase>=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(AUTOSAVE_DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(AUTOSAVE_STORE))db.createObjectStore(AUTOSAVE_STORE);};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
const persistRecovery=async(snapshot:EditorSnapshot)=>{
  const layers=await Promise.all(snapshot.layers.map(async layer=>{const response=await fetch(layer.url);const blob=await response.blob();return {...layer,blob};}));
  const db=await openAutosaveDb();
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(AUTOSAVE_STORE,'readwrite');tx.objectStore(AUTOSAVE_STORE).put({...snapshot,layers},'latest');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  db.close();
};
const readRecovery=async():Promise<any|null>=>{
  const db=await openAutosaveDb();
  const value=await new Promise<any>((resolve,reject)=>{const tx=db.transaction(AUTOSAVE_STORE,'readonly');const req=tx.objectStore(AUTOSAVE_STORE).get('latest');req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error);});
  db.close();return value;
};
const clearRecovery=async()=>{const db=await openAutosaveDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(AUTOSAVE_STORE,'readwrite');tx.objectStore(AUTOSAVE_STORE).delete('latest');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();};

function Viewport({ layers, selectedId, onSelect, onMove, onMoveEnd, onCameraZoom, onCameraReset, cameraTransform, playing, playhead, windStrength, windDirection, atmosphere, environment }: {
  layers: Layer[]; selectedId: string | null; onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void; onMoveEnd: () => void; onCameraZoom:(zoom:number)=>void; onCameraReset:()=>void; cameraTransform: CameraTransform; playing: boolean; playhead:number; windStrength: number; windDirection: number; atmosphere: {clouds:boolean;mist:boolean;dust:boolean;intensity:number}; environment: EnvironmentSettings;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshes = useRef(new Map<string, THREE.Mesh>());
  const drag = useRef<{id:string; startX:number; startY:number; originX:number; originY:number; moved:boolean}|null>(null);
  const layersRef = useRef(layers);
  const moveRef = useRef(onMove);
  const playingRef = useRef(playing);
  const playheadRef = useRef(playhead);
  const windRef = useRef({strength:windStrength,direction:windDirection});
  const atmosphereRef = useRef(atmosphere);
  useEffect(() => { atmosphereRef.current=atmosphere; }, [atmosphere]);
  useEffect(() => { windRef.current={strength:windStrength,direction:windDirection}; }, [windStrength,windDirection]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { moveRef.current = onMove; }, [onMove]);

  useEffect(() => {
    if (!host.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e1018');
    const skyCanvas=document.createElement('canvas'); skyCanvas.width=512; skyCanvas.height=1024;
    const skyContext=skyCanvas.getContext('2d')!;
    const skyTexture=new THREE.CanvasTexture(skyCanvas); skyTexture.colorSpace=THREE.SRGBColorSpace;
    const skyMaterial=new THREE.MeshBasicMaterial({map:skyTexture,depthWrite:false,side:THREE.DoubleSide});
    const skyMesh=new THREE.Mesh(new THREE.PlaneGeometry(100,100),skyMaterial); skyMesh.position.set(0,0,-12); scene.add(skyMesh);
    const starPositions=new Float32Array(420*3); for(let i=0;i<420;i++){starPositions[i*3]=(Math.random()-.5)*80;starPositions[i*3+1]=(Math.random()-.5)*90;starPositions[i*3+2]=-11.8;}
    const starGeometry=new THREE.BufferGeometry(); starGeometry.setAttribute('position',new THREE.BufferAttribute(starPositions,3));
    const starMaterial=new THREE.PointsMaterial({color:0xe8e5ff,size:.075,transparent:true,opacity:.75,depthWrite:false});
    const stars=new THREE.Points(starGeometry,starMaterial); stars.name='environment-stars'; scene.add(stars);
    const camera = new THREE.PerspectiveCamera(20.4, 1, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.touchAction = 'none';
    host.current.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const makeAtmosphere = (count:number,color:number,size:number,opacity:number,spreadX:number,spreadY:number,z:number) => {
      const positions=new Float32Array(count*3), speeds=new Float32Array(count), phases=new Float32Array(count);
      for(let i=0;i<count;i++){
        positions[i*3]=(Math.random()-.5)*spreadX;
        positions[i*3+1]=(Math.random()-.5)*spreadY;
        positions[i*3+2]=z+(Math.random()-.5)*.25;
        speeds[i]=.12+Math.random()*.3; phases[i]=Math.random()*Math.PI*2;
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const material=new THREE.PointsMaterial({color,size,transparent:true,opacity,depthWrite:false,sizeAttenuation:true});
      const points=new THREE.Points(geometry,material); points.visible=false; scene.add(points);
      return {points,geometry,material,speeds,phases,count,spreadX,spreadY};
    };
    const cloudFx=makeAtmosphere(26,0x9ca8bc,.22,.12,BOARD_W*1.5,BOARD_H*1.25,-.4);
    const mistFx=makeAtmosphere(115,0xc9d3df,.075,.22,BOARD_W*1.35,BOARD_H*.45,.65);
    const dustFx=makeAtmosphere(100,0xf2d9a0,.025,.72,BOARD_W*1.25,BOARD_H*1.2,1.2);

    // Fixed 9:16 composition frame. Artwork is positioned inside this board.
    const board = new THREE.Group();
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(BOARD_W, BOARD_H)),
      new THREE.LineBasicMaterial({ color: 0x77718f, transparent: true, opacity: 0.75 })
    );
    frame.position.z = -0.05;
    board.add(frame);
    const guides = new THREE.Group();
    const guideMaterial = new THREE.LineDashedMaterial({ color: 0x383448, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.65 });
    const guideGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-BOARD_W/2, 0, -0.04), new THREE.Vector3(BOARD_W/2, 0, -0.04),
      new THREE.Vector3(0, -BOARD_H/2, -0.04), new THREE.Vector3(0, BOARD_H/2, -0.04)
    ]);
    const guideLines = new THREE.LineSegments(guideGeo, guideMaterial);
    guideLines.computeLineDistances(); guides.add(guideLines); board.add(guides); scene.add(board);
    sceneRef.current = scene; rendererRef.current = renderer; cameraRef.current = camera;

    const resize = () => {
      if (!host.current) return;
      const w = Math.max(1, host.current.clientWidth), h = Math.max(1, host.current.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    let frameId = 0;
    const motionClock = new THREE.Clock();
    const render = () => {
      frameId = requestAnimationFrame(render);
      const delta=Math.min(motionClock.getDelta(),.04);
      const time=motionClock.elapsedTime;
      const fx=atmosphereRef.current;
      const wind=windRef.current;
      cloudFx.points.visible=fx.clouds; mistFx.points.visible=fx.mist; dustFx.points.visible=fx.dust;
      const updateAtmosphere=(system:typeof cloudFx,rate:number,drift:number)=>{
        if(!playingRef.current)return;
        const attr=system.geometry.attributes.position as THREE.BufferAttribute;
        for(let i=0;i<system.count;i++){
          const x=attr.getX(i)+Math.cos(wind.direction)*wind.strength*drift*delta;
          let y=attr.getY(i)+system.speeds[i]*rate*delta;
          if(y>system.spreadY/2)y=-system.spreadY/2;
          let nx=x;if(nx>system.spreadX/2)nx=-system.spreadX/2;if(nx< -system.spreadX/2)nx=system.spreadX/2;
          attr.setXY(i,nx,y);
        }
        attr.needsUpdate=true;
      };
      updateAtmosphere(cloudFx,.10,.18); updateAtmosphere(mistFx,.035,.10); updateAtmosphere(dustFx,.12,.24);
      cloudFx.material.opacity=.12*fx.intensity; mistFx.material.opacity=.22*fx.intensity; dustFx.material.opacity=.72*fx.intensity;
      if (playingRef.current) {
        layersRef.current.forEach(layer => {
          const mesh = meshes.current.get(layer.id);
          if (!mesh) return;
          const speed = Math.max(0.05, layer.motionSpeed ?? 1);
          const phase = (parseInt(layer.id.slice(0, 5), 36) || 0) * 0.0007;
          const wave = time * speed + phase;
          const wind=windRef.current;
          const windPhase=wave*0.28+phase;
          mesh.position.x = layer.x + Math.sin(wave) * (layer.motionX ?? 0) + Math.sin(windPhase)*wind.strength*0.18*Math.cos(wind.direction);
          mesh.position.y = layer.y + Math.sin(wave * 0.72 + 0.8) * (layer.motionY ?? 0) + Math.sin(windPhase*0.8)*wind.strength*0.10*Math.sin(wind.direction);
          mesh.rotation.z = THREE.MathUtils.degToRad(layer.rotation + Math.sin(wave * 0.55) * (layer.motionRotation ?? 0));
        });
      }
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frameId); observer.disconnect();
      [cloudFx,mistFx,dustFx].forEach(fx=>{scene.remove(fx.points);fx.geometry.dispose();fx.material.dispose();});
      meshes.current.forEach(mesh => {
        scene.remove(mesh); mesh.geometry.dispose();
        const material = mesh.material as THREE.MeshBasicMaterial;
        const video=mesh.userData.videoElement as HTMLVideoElement|undefined;if(video){video.pause();video.removeAttribute('src');video.load();}
        material.map?.dispose(); material.dispose();
      });
      meshes.current.clear(); frame.geometry.dispose(); (frame.material as THREE.Material).dispose();
      guideGeo.dispose(); guideMaterial.dispose(); skyMesh.geometry.dispose(); skyMaterial.dispose(); skyTexture.dispose(); starGeometry.dispose(); starMaterial.dispose(); renderer.dispose();
      if (host.current?.contains(renderer.domElement)) host.current.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const canvas=document.querySelector('.viewport canvas') as HTMLCanvasElement|null;
    // The scene's own sky texture is kept on the Three.js scene, not the UI canvas.
    const scene=sceneRef.current; if(!scene) return;
    const sky=scene.children.find(o=>o.type==='Mesh' && o.position.z===-12) as THREE.Mesh|undefined;
    const material=sky?.material as THREE.MeshBasicMaterial|undefined;
    const texture=material?.map as THREE.CanvasTexture|undefined;
    const source=texture?.image as HTMLCanvasElement|undefined;
    const ctx=source?.getContext('2d'); if(!ctx||!texture||!material) return;
    const palettes:Record<EnvironmentPreset,[string,string,string,string]> = {
      divine:['#080d22','#182b52','#bd8065','#f1c68d'],
      sunset:['#25102e','#8c3151','#e77b53','#ffd18a'],
      night:['#030611','#0b1730','#17294c','#52618b'],
      storm:['#080d17','#202d3c','#48515b','#9a8e82'],
      temple:['#100d13','#342326','#80513c','#d5a45e'],
      cosmic:['#07051b','#24154c','#593b83','#d29bc1']
    };
    const colors=palettes[environment.preset];
    const gradient=ctx.createLinearGradient(0,0,0,1024);
    gradient.addColorStop(0,colors[0]); gradient.addColorStop(.48,colors[1]); gradient.addColorStop(.78,colors[2]); gradient.addColorStop(1,colors[3]);
    ctx.clearRect(0,0,512,1024); ctx.fillStyle=gradient; ctx.fillRect(0,0,512,1024);
    const glow=ctx.createRadialGradient(256,760,8,256,760,430);
    glow.addColorStop(0,colors[3]); glow.addColorStop(1,'transparent');
    ctx.globalAlpha=environment.horizon*.65; ctx.fillStyle=glow; ctx.fillRect(0,0,512,1024); ctx.globalAlpha=1;
    if(environment.preset==='cosmic'){
      for(let i=0;i<18;i++){const x=(i*137)%512,y=130+(i*193)%650;const g=ctx.createRadialGradient(x,y,2,x,y,90);g.addColorStop(0,'rgba(164,112,255,.24)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x-90,y-90,180,180);}
    }
    texture.needsUpdate=true; material.opacity=environment.intensity; material.transparent=environment.intensity<1;
    const starPoints=scene.getObjectByName('environment-stars') as THREE.Points|undefined;
    if(starPoints) starPoints.visible=environment.stars && ['night','storm','cosmic','divine'].includes(environment.preset);
    if(starPoints) (starPoints.material as THREE.PointsMaterial).opacity=environment.preset==='storm'?.22:.75;
  }, [environment]);
  useEffect(() => { const camera=cameraRef.current; if(!camera) return; camera.position.set(cameraTransform.x,cameraTransform.y,cameraTransform.z ?? 20); camera.lookAt(0,0,0); camera.rotation.z=(cameraTransform.roll??0)*Math.PI/180; camera.zoom=cameraTransform.zoom; camera.updateProjectionMatrix(); }, [cameraTransform]);

  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    const active = new Set(layers.map(layer => layer.id));
    meshes.current.forEach((mesh, id) => {
      if (!active.has(id)) {
        scene.remove(mesh); mesh.geometry.dispose();
        const material = mesh.material as THREE.MeshBasicMaterial;
        const video=mesh.userData.videoElement as HTMLVideoElement|undefined;
        if(video){video.pause();video.removeAttribute('src');video.load();}
        material.map?.dispose(); material.dispose(); meshes.current.delete(id);
      }
    });
    layers.forEach((layer, index) => {
      let mesh = meshes.current.get(layer.id);
      if (!mesh) {
        const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), material);
        mesh.userData.layerId = layer.id;
        scene.add(mesh);
        meshes.current.set(layer.id, mesh);
      }
      if (mesh.userData.sourceUrl !== layer.url) {
        mesh.userData.sourceUrl = layer.url;
        const material = mesh.material as THREE.MeshBasicMaterial;
        const oldVideo=mesh.userData.videoElement as HTMLVideoElement|undefined;
        if(oldVideo){oldVideo.pause();oldVideo.removeAttribute('src');oldVideo.load();delete mesh.userData.videoElement;}
        material.map?.dispose();
        if(layer.isVideo){
          const video=document.createElement('video');video.src=layer.url;video.muted=true;video.loop=true;video.playsInline=true;video.preload='auto';video.crossOrigin='anonymous';
          mesh.userData.videoElement=video;
          const texture=new THREE.VideoTexture(video);texture.colorSpace=THREE.SRGBColorSpace;material.map=texture;material.needsUpdate=true;
          const fitVideo=()=>{if(!meshes.current.has(layer.id)||mesh!.userData.sourceUrl!==layer.url)return;const aspect=(video.videoWidth||16)/(video.videoHeight||9);const boardAspect=BOARD_W/BOARD_H;const fitW=aspect>boardAspect?BOARD_W:BOARD_H*aspect;const fitH=aspect>boardAspect?BOARD_W/aspect:BOARD_H;mesh!.geometry.dispose();mesh!.geometry=new THREE.PlaneGeometry(fitW,fitH);};
          video.addEventListener('loadedmetadata',fitVideo,{once:true});
          if(video.readyState>=1)fitVideo();
          if(playingRef.current){const start=()=>{video.currentTime=Math.min(playheadRef.current,Number.isFinite(video.duration)?video.duration:playheadRef.current);void video.play().catch(()=>{});};if(video.readyState>=2)start();else video.addEventListener('canplay',start,{once:true});}
        }else new THREE.TextureLoader().load(layer.url, texture => {
          if (!meshes.current.has(layer.id) || mesh!.userData.sourceUrl !== layer.url) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          material.map = texture;
          material.needsUpdate = true;
          const image = texture.image as HTMLImageElement;
          const imageAspect = image.width / Math.max(1, image.height);
          const boardAspect = BOARD_W / BOARD_H;
          const fitW = imageAspect > boardAspect ? BOARD_W : BOARD_H * imageAspect;
          const fitH = imageAspect > boardAspect ? BOARD_W / imageAspect : BOARD_H;
          mesh!.geometry.dispose();
          mesh!.geometry = new THREE.PlaneGeometry(fitW, fitH);
        });
      }
      mesh.position.set(layer.x, layer.y, layer.z);
      mesh.scale.setScalar(layer.scale);
      mesh.rotation.z = THREE.MathUtils.degToRad(layer.rotation);
      mesh.visible = layer.visible;
      mesh.renderOrder = index;
      (mesh.material as THREE.MeshBasicMaterial).opacity = layer.opacity / 100;
    });
  }, [layers]);

  useEffect(()=>{meshes.current.forEach(mesh=>{const video=mesh.userData.videoElement as HTMLVideoElement|undefined;if(!video)return;if(playing){void video.play().catch(()=>{});}else{video.pause();if(Number.isFinite(video.duration)&&video.duration>0){const target=Math.min(playhead,video.duration);if(Math.abs(video.currentTime-target)>.08){try{video.currentTime=target;}catch{}}}}});},[playing,playhead]);

  const pointerToWorld = (e: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const camera = cameraRef.current!;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const point = new THREE.Vector3(nx, ny, 0).unproject(camera);
    return { x: point.x, y: point.y };
  };
  const down = (e: React.PointerEvent) => {
    if (!cameraRef.current || !host.current) return;
    const point = pointerToWorld(e);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(
      ((e.clientX-host.current.getBoundingClientRect().left)/host.current.clientWidth)*2-1,
      -((e.clientY-host.current.getBoundingClientRect().top)/host.current.clientHeight)*2+1
    ), cameraRef.current);
    const hits = ray.intersectObjects([...meshes.current.values()].filter(m => m.visible), false);
    if (!hits.length) return;
    const id = hits[0].object.userData.layerId as string;
    const layer = layersRef.current.find(item => item.id === id);
    if (!layer) return;
    onSelect(id);
    if (layer.locked) return;
    drag.current = { id, startX: point.x, startY: point.y, originX: layer.x, originY: layer.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !host.current) return;
    const point = pointerToWorld(e);
    const x = d.originX + point.x - d.startX;
    const y = d.originY + point.y - d.startY;
    d.moved = true;
    const mesh = meshes.current.get(d.id);
    if (mesh) { mesh.position.x = x; mesh.position.y = y; }
    moveRef.current(d.id, x, y);
  };
  return <div className="viewport" ref={host} onPointerDown={down} onPointerMove={move} onPointerUp={() => { if(drag.current?.moved) onMoveEnd(); drag.current = null; }} onPointerCancel={() => { if(drag.current?.moved) onMoveEnd(); drag.current = null; }}>
    {layers.length === 0 && <div className="empty-scene"><div className="empty-icon"><ImageIcon size={26}/></div><strong>Your canvas is empty</strong><span>Import artwork to begin building your 2.5D scene.</span></div>}
    <div className="viewport-badge"><span className="live-dot"/> 9:16 COMPOSITION</div>
    <div className="viewport-actions">
      <button title="Zoom in" onClick={() => onCameraZoom(Math.min(2.5,cameraTransform.zoom+0.15))}><ZoomIn size={16}/></button>
      <button title="Zoom out" onClick={() => onCameraZoom(Math.max(.5,cameraTransform.zoom-0.15))}><ZoomOut size={16}/></button>
      <button title="Reset view" onClick={onCameraReset}><RotateCcw size={16}/></button>
    </div>
  </div>;
}

export default function App() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'layers'|'properties'|'environment'>('layers');
  const [projectName, setProjectName] = useState('Untitled Scene');
  const [maskLayerId, setMaskLayerId] = useState<string | null>(null);
  const [duration, setDuration] = useState(10);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [windStrength, setWindStrength] = useState(0);
  const [windDirection, setWindDirection] = useState(0);
  const [atmosphere, setAtmosphere] = useState({clouds:false,mist:false,dust:false,intensity:1});
  const [environment,setEnvironment] = useState<EnvironmentSettings>({preset:'divine',intensity:1,horizon:0.35,stars:true});
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [cameraTransform, setCameraTransform] = useState<CameraTransform>({x:0,y:0,zoom:1.4,z:18,roll:0});
  const [selectedKeyframeId,setSelectedKeyframeId]=useState<string|null>(null);
  const [liveEditTime, setLiveEditTime] = useState<number | null>(null);
  const [hydrated,setHydrated]=useState(false);
  const [autosaveEnabled,setAutosaveEnabled]=useState(true);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [historyVersion,setHistoryVersion]=useState(0);
  const undoStack=useRef<EditorSnapshot[]>([]);
  const redoStack=useRef<EditorSnapshot[]>([]);
  const historyTimer=useRef<number|null>(null);
  const autosaveTimer=useRef<number|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const selected = layers.find(layer => layer.id === selectedId) ?? null;

  const snapshotEditor=():EditorSnapshot=>({layers:layers.map(layer=>({...layer})),selectedId,projectName,duration,keyframes:keyframes.map(frame=>({...frame,layers:{...frame.layers},camera:{...frame.camera}})),cameraTransform:{...cameraTransform}});
  const recordHistory=()=>{
    if(historyTimer.current!==null)return;
    const previous=snapshotEditor();
    historyTimer.current=window.setTimeout(()=>{undoStack.current=[...undoStack.current,previous].slice(-40);redoStack.current=[];historyTimer.current=null;setHistoryVersion(v=>v+1);},650);
  };
  const applySnapshot=(snapshot:EditorSnapshot)=>{
    setLayers(snapshot.layers.map(layer=>({...layer})));setSelectedId(snapshot.selectedId);setProjectName(snapshot.projectName);setDuration(snapshot.duration);setKeyframes(snapshot.keyframes.map(frame=>({...frame,layers:{...frame.layers},camera:{...frame.camera}})));setCameraTransform({...snapshot.cameraTransform});setPlaying(false);setPlayhead(0);setLiveEditTime(null);
  };
  const undo=()=>{
    if(historyTimer.current!==null){window.clearTimeout(historyTimer.current);historyTimer.current=null;}
    const previous=undoStack.current.pop();if(!previous)return;
    redoStack.current.push(snapshotEditor());applySnapshot(previous);setHistoryVersion(v=>v+1);
  };
  const redo=()=>{
    if(historyTimer.current!==null){window.clearTimeout(historyTimer.current);historyTimer.current=null;}
    const next=redoStack.current.pop();if(!next)return;
    undoStack.current.push(snapshotEditor());applySnapshot(next);setHistoryVersion(v=>v+1);
  };
  useEffect(()=>{
    let active=true;
    readRecovery().then(payload=>{
      if(!active||!payload||!Array.isArray(payload.layers))return;
      const restored:Layer[]=payload.layers.map((item:any)=>{const {blob,...meta}=item;if(!(blob instanceof Blob))throw new Error('Recovery image data is unavailable');return {...meta,url:URL.createObjectURL(blob)};});
      if(active){setLayers(restored);setSelectedId(payload.selectedId??restored[0]?.id??null);setProjectName(payload.projectName||'Untitled Scene');setDuration(Number.isFinite(payload.duration)?payload.duration:10);setKeyframes(Array.isArray(payload.keyframes)?payload.keyframes:[]);setCameraTransform(payload.cameraTransform||{x:0,y:0,zoom:1.4,z:18,roll:0});}
    }).catch(()=>{}).finally(()=>{if(active)setHydrated(true);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!hydrated||!autosaveEnabled)return;
    if(autosaveTimer.current!==null)window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current=window.setTimeout(()=>{void persistRecovery(snapshotEditor()).catch(()=>{});},900);
    return()=>{if(autosaveTimer.current!==null)window.clearTimeout(autosaveTimer.current);};
  },[hydrated,autosaveEnabled,layers,selectedId,projectName,duration,keyframes,cameraTransform]);
  const animatedLayers = layers.map(layer => {
    if (!keyframes.length || (liveEditTime !== null && Math.abs(playhead-liveEditTime)<0.02)) return layer;
    const frames=[...keyframes].sort((a,b)=>a.time-b.time);
    const before=[...frames].reverse().find(frame=>frame.time<=playhead) ?? frames[0];
    const after=frames.find(frame=>frame.time>=playhead) ?? frames[frames.length-1];
    const a=before.layers[layer.id], b=after.layers[layer.id];
    if(!a && !b) return layer; if(!a) return {...layer,...b}; if(!b) return {...layer,...a};
    const span=after.time-before.time, raw=span<=0?0:Math.max(0,Math.min(1,(playhead-before.time)/span));
    const t=raw*raw*(3-2*raw); // smoothstep easing avoids abrupt starts/stops
    const mix=(key:keyof Transform)=>a[key]+(b[key]-a[key])*t;
    const rotationDelta=THREE.MathUtils.euclideanModulo(b.rotation-a.rotation+180,360)-180;
    return {...layer,x:mix('x'),y:mix('y'),z:mix('z'),scale:mix('scale'),rotation:a.rotation+rotationDelta*t,opacity:mix('opacity')};
  });
  const animatedCamera = (() => {
    if(!keyframes.length || (liveEditTime !== null && Math.abs(playhead-liveEditTime)<0.02)) return cameraTransform;
    const frames=[...keyframes].sort((a,b)=>a.time-b.time);
    const before=[...frames].reverse().find(frame=>frame.time<=playhead) ?? frames[0];
    const after=frames.find(frame=>frame.time>=playhead) ?? frames[frames.length-1];
    const span=after.time-before.time, raw=span<=0?0:Math.max(0,Math.min(1,(playhead-before.time)/span));
    const t=raw*raw*(3-2*raw);
    return {x:before.camera.x+(after.camera.x-before.camera.x)*t,y:before.camera.y+(after.camera.y-before.camera.y)*t,zoom:before.camera.zoom+(after.camera.zoom-before.camera.zoom)*t,z:(before.camera.z??20)+((after.camera.z??20)-(before.camera.z??20))*t,roll:(before.camera.roll??0)+((after.camera.roll??0)-(before.camera.roll??0))*t};
  })();
  const makeFrame = (time:number, layerSnapshot:Layer[]=animatedLayers, cameraSnapshot:CameraTransform=animatedCamera):Keyframe => ({
    id:uid(),time:Number(time.toFixed(2)),
    layers:Object.fromEntries(layerSnapshot.map(layer=>[layer.id,{x:layer.x,y:layer.y,z:layer.z,scale:layer.scale,rotation:layer.rotation,opacity:layer.opacity}])),
    camera:{...cameraSnapshot}
  });
  const writeKeyframe = (frame:Keyframe) => setKeyframes(prev=>[...prev.filter(item=>Math.abs(item.time-frame.time)>0.015),frame].sort((a,b)=>a.time-b.time));
  const addKeyframe = () => { recordHistory(); const frame=makeFrame(playhead); writeKeyframe(frame); setSelectedKeyframeId(frame.id); };
  const selectedKeyframe = keyframes.find(frame=>frame.id===selectedKeyframeId) ?? null;
  const deleteSelectedKeyframe = () => { if(!selectedKeyframe)return; recordHistory(); setKeyframes(prev=>prev.filter(frame=>frame.id!==selectedKeyframe.id)); setSelectedKeyframeId(null); };
  const playbackStart = useRef(0);
  useEffect(()=>{ if(tab==='properties') document.querySelector('.properties-panel')?.scrollTo({top:0,behavior:'smooth'}); },[tab,selectedId]);
  useEffect(()=>{ if(!playing)return; playbackStart.current=playhead; let raf=0,last=0,elapsed=0; const tick=(now:number)=>{if(!last)last=now;elapsed+=Math.min(.1,(now-last)/1000);last=now;const next=Math.min(duration,playbackStart.current+elapsed);setPlayhead(next);if(next>=duration){setPlaying(false);return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[playing,duration]);

  const importFiles = (files: FileList | null) => {
    if(files?.length)recordHistory();
    if (!files) return;
    const additions: Layer[] = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/')).map(file => ({
      id: uid(), name: (() => { const base=file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g,' ').trim(); return /^file[_\s-]*[a-f0-9]{12,}$/i.test(base) ? 'Image ' + (layers.length + 1) : (base || 'Image ' + (layers.length + 1)); })(), fileName: file.name,
      url: URL.createObjectURL(file), isVideo:file.type.startsWith('video/'), x: 0, y: 0, z: layers.length * 0.02,
      scale: 1, rotation: 0, visible: true, locked: false, opacity: 100, width: 0, height: 0,
      motionX: 0, motionY: 0, motionRotation: 0, motionSpeed: 1
    }));
    setLayers(prev => [...prev, ...additions]);
    if (additions[0]) { setSelectedId(additions[0].id); setTab('properties'); }
  };
  const updateLayer = (id: string, patch: Partial<Layer>) => {
    recordHistory();
    setLiveEditTime(playhead);
    setLayers(prev => prev.map(layer => layer.id === id ? {...layer,...patch} : layer));
  };
  const updateSelected = (patch: Partial<Layer>) => { if (selectedId) updateLayer(selectedId,patch); };
  const setSelectedDepth = (z:number) => { if(!selectedId)return; recordHistory(); const next=layers.map(layer=>layer.id===selectedId?{...layer,z}:layer); setLayers(next); if(keyframes.length) writeKeyframe(makeFrame(playhead,next,cameraTransform)); };
  const updateCamera = (patch:Partial<CameraTransform>) => {
    recordHistory();
    setLiveEditTime(playhead);
    setCameraTransform(prev=>({...prev,...patch}));
  };
  const commitCurrentKeyframe = () => {
    if (keyframes.length || liveEditTime !== null) writeKeyframe(makeFrame(playhead,layers,cameraTransform));
    setLiveEditTime(null);
  };
  const applyMask = (id: string, blob: Blob) => {
    recordHistory();
    const oldLayer = layers.find(layer => layer.id === id);
    if (!oldLayer) return;
    const url = URL.createObjectURL(blob);
    setLayers(prev => prev.map(layer => layer.id === id
      ? { ...layer, url, fileName: layer.name + '-masked.png' }
      : layer));
    setMaskLayerId(null);
  };
  const removeLayer = (id: string) => {
    recordHistory();
    setLayers(prev => prev.filter(layer=>layer.id!==id));
    if(selectedId===id) setSelectedId(null);
  };
  const duplicateLayer = (layer: Layer) => {
    recordHistory();
    const copy={...layer,id:uid(),name:layer.name+' copy',z:layer.z+0.08};
    setLayers(prev=>[...prev,copy]); setSelectedId(copy.id);
  };
  const saveProject = async () => {
    try {
      const imageLayers = await Promise.all(layers.map(async layer => {
        const response = await fetch(layer.url);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve,reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const { url, ...metadata } = layer;
        return { ...metadata, dataUrl };
      }));
      const payload = { format: 'PARALLAX_2_5', version: 2, projectName, duration, keyframes, cameraTransform, layers: imageLayers };
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = (projectName.trim() || 'parallax-project').replace(/[^a-z0-9-_]+/gi,'-') + '.parallax.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      alert('Could not save this project. Try removing very large images and saving again.');
    }
  };
  const loadProject = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text());
      if (payload.format !== 'PARALLAX_2_5' || !Array.isArray(payload.layers)) throw new Error('This is not a PARALLAX project file.');
      recordHistory();
      const idMap=new Map<string,string>();
      const restored: Layer[] = payload.layers.map((item: any) => {
        if (typeof item.dataUrl !== 'string' || typeof item.name !== 'string') throw new Error('Project contains an invalid media layer.');
        const [header, encoded] = item.dataUrl.split(',');
        const mime = header.match(/data:(.*?);base64/)?.[1] || 'image/png';
        const binary = atob(encoded);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], {type:mime}));
        const {dataUrl, ...metadata} = item;
        const newId=String(metadata.id||uid());idMap.set(String(item.id),newId);
        return {...metadata, url, id:newId, visible:item.visible !== false, locked:!!item.locked};
      });
      layers.forEach(layer => URL.revokeObjectURL(layer.url));
      setLayers(restored);
      setKeyframes(Array.isArray(payload.keyframes) ? payload.keyframes.map((frame:any)=>({...frame,layers:Object.fromEntries(Object.entries(frame.layers||{}).map(([oldId,value])=>[idMap.get(String(oldId))||String(oldId),value]))})) : []);
      setDuration(Number.isFinite(payload.duration) ? Math.max(1,Math.min(120,payload.duration)) : 10);
      setCameraTransform(payload.cameraTransform && Number.isFinite(payload.cameraTransform.zoom) ? {...payload.cameraTransform,z:Number.isFinite(payload.cameraTransform.z)?payload.cameraTransform.z:20} : {x:0,y:0,zoom:1,z:20});
      setPlayhead(0); setPlaying(false);
      setSelectedId(restored[0]?.id ?? null);
      setProjectName(typeof payload.projectName === 'string' ? payload.projectName : 'Imported Scene');
      setTab('layers');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not open this project file.');
    }
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">P</div><div><b>PARALLAX</b><small>2.5 CINEMATIC STUDIO</small></div></div>
      <div className="project-title"><input value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="Project name"/><span className="saved-dot"/><small>SESSION</small></div>
      <div className="top-actions"><button className="icon-btn" title="Open PARALLAX project" onClick={()=>projectFileRef.current?.click()}><FolderOpen size={17}/></button><button className="icon-btn" title="Save project JSON" onClick={saveProject}><Download size={17}/></button><button className="icon-btn mobile-hidden" title="Undo" aria-label="Undo" disabled={undoStack.current.length===0} onClick={undo}><Undo2 size={17}/></button><button className="icon-btn mobile-hidden" title="Redo" aria-label="Redo" disabled={redoStack.current.length===0} onClick={redo}><Redo2 size={17}/></button><button className="export-btn" onClick={()=>{const canvas=document.querySelector(".viewport canvas") as HTMLCanvasElement|null;if(!canvas){alert("Canvas is not ready yet.");return;}try{const link=document.createElement("a");link.download=(projectName.trim()||"parallax-scene").replace(/[^a-z0-9-_]+/gi,"-")+".png";link.href=canvas.toDataURL("image/png");link.click();}catch{alert("Could not export the canvas. Please try again.");}}}><Download size={15}/> Download PNG</button></div>
    </header>
    <div className="workspace">
      <aside className="left-rail">
        <button className="rail-item active" onClick={()=>setTab('layers')} title="Return to scene layers"><Move3D/><span>Scene</span></button>
        <button className="rail-item" onClick={()=>setTab('layers')}><Layers3/><span>Layers</span></button>
        <button className="rail-item" onClick={()=>fileRef.current?.click()}><ImageIcon/><span>Media</span></button>
        <button className="rail-item" onClick={()=>setTab('properties')}><SlidersHorizontal/><span>Adjust</span></button>
        <button className={'rail-item '+(tab==='environment'?'active':'')} onClick={()=>setTab('environment')}><Waves/><span>World</span></button>
        <div className="rail-bottom"><button className="rail-item" onClick={()=>setSettingsOpen(true)}><Settings2/><span>Settings</span></button></div>
      </aside>
      <section className="editor-main">
        <div className="scene-toolbar"><div><span className="eyebrow">SCENE EDITOR</span><strong>Composition</strong></div><div className="toolbar-right"><span className="format-chip">9:16 PORTRAIT · 1080 × 1920</span><button className="small-icon" title="Full preview" aria-label="Open full preview" onClick={()=>{const el=document.querySelector(".viewport") as HTMLElement|null;if(!el)return;const request=el.requestFullscreen||((el as any).webkitRequestFullscreen);if(request)request.call(el);else alert("Full-screen preview is not supported by this browser.");}}><Maximize2 size={15}/></button></div></div>
        <Viewport layers={animatedLayers} selectedId={selectedId} onSelect={id=>{setSelectedId(id);setTab('properties');}} onMove={(id,x,y)=>updateLayer(id,{x,y})} onMoveEnd={commitCurrentKeyframe} onCameraZoom={zoom=>updateCamera({zoom})} onCameraReset={()=>{setCameraTransform({x:0,y:0,zoom:1.4,z:18,roll:0});setLiveEditTime(null);}} cameraTransform={animatedCamera} playing={playing} playhead={playhead} windStrength={windStrength} windDirection={windDirection} atmosphere={atmosphere} environment={environment}/>
<div className="timeline-panel">
 <div className="timeline-top"><div className="timeline-controls">
  <button className="play-btn" onClick={()=>{if(playhead>=duration)setPlayhead(0);setPlaying(v=>!v);}} title={playing?"Pause":"Play"}>{playing?<Pause size={15}/>:<Play size={15} fill="currentColor"/>}</button>
  <button className="timeline-icon" onClick={()=>{setPlaying(false);setPlayhead(0);}} title="Go to start"><SkipBack size={15}/></button><span className="time-readout">{playhead.toFixed(2)}s / {duration.toFixed(1)}s</span>
 </div><div className="timeline-actions"><label className="atmosphere-toggle"><input type="checkbox" checked={atmosphere.clouds} onChange={e=>setAtmosphere(v=>({...v,clouds:e.target.checked}))}/> Clouds</label><label className="atmosphere-toggle"><input type="checkbox" checked={atmosphere.mist} onChange={e=>setAtmosphere(v=>({...v,mist:e.target.checked}))}/> Mist</label><label className="atmosphere-toggle"><input type="checkbox" checked={atmosphere.dust} onChange={e=>setAtmosphere(v=>({...v,dust:e.target.checked}))}/> Dust</label><label className="atmosphere-intensity">Atmosphere <input type="range" min="0" max="2" step=".05" value={atmosphere.intensity} onChange={e=>setAtmosphere(v=>({...v,intensity:+e.target.value}))}/></label><button className="keyframe-btn" onClick={addKeyframe} title="Add a keyframe for the current camera and layer positions"><KeyRound size={14}/> Add keyframe</button>{selectedKeyframe && <button className="keyframe-delete-btn" onClick={deleteSelectedKeyframe} title={"Delete selected keyframe at "+selectedKeyframe.time.toFixed(2)+"s"}><Trash2 size={13}/> Delete keyframe</button>}<label>Duration <select value={duration} onChange={e=>{recordHistory();setDuration(+e.target.value);setPlayhead(p=>Math.min(p,+e.target.value));setPlaying(false);}}>{[5,10,15,20,30,45,60,90,120].map(v=><option key={v} value={v}>{v}s</option>)}</select></label></div></div>
 <div className="timeline-ruler"><span>00:00</span><span>{(duration/4).toFixed(1)}s</span><span>{(duration/2).toFixed(1)}s</span><span>{(duration*.75).toFixed(1)}s</span><span>{duration.toFixed(1)}s</span></div>
 <div className="timeline-scrub"><input aria-label="Timeline playhead" type="range" min="0" max={duration} step=".01" value={playhead} onChange={e=>{setPlaying(false);setPlayhead(+e.target.value);}}/><div className="keyframe-markers">{keyframes.map(frame=><button key={frame.id} title={"Keyframe at "+frame.time.toFixed(2)+"s"} style={{left:(frame.time/duration*100)+"%"}} onClick={()=>{setPlaying(false);setSelectedKeyframeId(frame.id);setPlayhead(frame.time);}}/>)}</div></div>
 <div className="timeline-bottom"><span><CircleDot size={11}/> {keyframes.length} keyframes</span><span>30 FPS · Smooth interpolation</span></div>
</div>
      </section>
      <aside className="inspector">
        <div className="inspector-tabs"><button className={tab==='layers'?'chosen':''} onClick={()=>setTab('layers')}><Layers3 size={15}/> Layers</button><button className={tab==='properties'?'chosen':''} onClick={()=>setTab('properties')}><SlidersHorizontal size={15}/> Properties</button><button className={tab==='environment'?'chosen':''} onClick={()=>setTab('environment')}><Waves size={15}/> World</button></div>
        {tab==='environment' ? <div className="properties-panel environment-panel">
          <div className="panel-heading"><div><span className="eyebrow">PROCEDURAL WORLD</span><strong>Environment</strong></div></div>
          <div className="environment-presets">{([['divine','Divine'],['sunset','Sunset'],['night','Night'],['storm','Storm'],['temple','Temple'],['cosmic','Cosmic']] as [EnvironmentPreset,string][]).map(([id,label])=><button key={id} className={environment.preset===id?'selected':''} onClick={()=>setEnvironment(v=>({...v,preset:id}))}>{label}</button>)}</div>
          <label>Sky intensity <b>{environment.intensity.toFixed(1)}×</b><input type="range" min="0.2" max="2" step=".05" value={environment.intensity} onChange={e=>setEnvironment(v=>({...v,intensity:+e.target.value}))}/></label>
          <label>Horizon glow <b>{Math.round(environment.horizon*100)}%</b><input type="range" min="0" max="1" step=".01" value={environment.horizon} onChange={e=>setEnvironment(v=>({...v,horizon:+e.target.value}))}/></label>
          <label className="environment-check"><input type="checkbox" checked={environment.stars} onChange={e=>setEnvironment(v=>({...v,stars:e.target.checked}))}/> Show stars</label>
          <p className="environment-note">Generated locally in Three.js. No HDRI upload, external image, API or paid credits required.</p>
        </div> : tab==='layers' ? <div className="layer-panel">
          <div className="panel-heading"><div><span className="eyebrow">SCENE CONTENT</span><strong>Layers <em>{layers.length}</em></strong></div><button className="add-btn" onClick={()=>fileRef.current?.click()}><Plus size={15}/> Add</button></div>
          {layers.length===0 ? <div className="layer-empty"><Layers3 size={22}/><b>No layers yet</b><span>Import transparent PNGs, artwork or video clips.</span><button onClick={()=>fileRef.current?.click()}><Upload size={14}/> Import artwork</button></div> :
            <div className="layer-list">{[...layers].reverse().map(layer=><div className={'layer-row '+(selectedId===layer.id?'selected':'')} key={layer.id} onClick={()=>{setSelectedId(layer.id);setTab('properties');}}>
              <div className="layer-thumb">{layer.isVideo?<Film size={18}/>:<img src={layer.url} alt=""/>}</div><div className="layer-info"><b>{layer.name}</b><small>{layer.isVideo?'VIDEO · ':'IMAGE · '}Z {layer.z.toFixed(2)} · {layer.locked?'Locked':'Editable'}</small></div>
              <button title="Toggle visibility" onClick={e=>{e.stopPropagation();updateLayer(layer.id,{visible:!layer.visible});}}>{layer.visible?<Eye size={15}/>:<EyeOff size={15}/>}</button>
              <button title="Lock layer" onClick={e=>{e.stopPropagation();updateLayer(layer.id,{locked:!layer.locked});}}>{layer.locked?<Lock size={14}/>:<Unlock size={14}/>}</button>
            </div>)}</div>}
        </div> : <div className="properties-panel">{selected ? <>
          <div className="panel-heading"><div><span className="eyebrow">SELECTED LAYER</span><strong>{selected.name}</strong></div><button className="danger-icon" title="Delete layer" onClick={()=>removeLayer(selected.id)}><Trash2 size={16}/></button></div>
          <label className="layer-name-field">Layer name<input type="text" value={selected.name} maxLength={64} onChange={e=>updateSelected({name:e.target.value})} placeholder="Name this layer"/></label>
          <label>Position X <b>{selected.x.toFixed(2)}</b><input type="range" min="-3" max="3" step=".01" value={selected.x} onChange={e=>updateSelected({x:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <label>Position Y <b>{selected.y.toFixed(2)}</b><input type="range" min="-5" max="5" step=".01" value={selected.y} onChange={e=>updateSelected({y:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <label>Depth (Z) <b>{selected.z.toFixed(2)}</b><input type="range" min="-8" max="8" step=".05" value={selected.z} onChange={e=>updateSelected({z:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <div className="depth-presets" aria-label="Layer depth presets">
            <button type="button" onClick={()=>setSelectedDepth(-8)}>Background</button>
            <button type="button" onClick={()=>setSelectedDepth(0)}>Midground</button>
            <button type="button" onClick={()=>setSelectedDepth(8)}>Foreground</button>
          </div>
          <label>Scale <b>{selected.scale.toFixed(2)}×</b><input type="range" min=".1" max="3" step=".01" value={selected.scale} onChange={e=>updateSelected({scale:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <label>Rotation <b>{selected.rotation}°</b><input type="range" min="-180" max="180" value={selected.rotation} onChange={e=>updateSelected({rotation:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <label>Opacity <b>{selected.opacity}%</b><input type="range" min="0" max="100" value={selected.opacity} onChange={e=>updateSelected({opacity:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <div className="camera-control-card layer-motion-card"><div><Wind size={14}/> Scene wind <small>Global motion while playing</small></div>
            <label>Wind strength <b>{windStrength.toFixed(2)}</b><input type="range" min="0" max="1" step=".01" value={windStrength} onChange={e=>setWindStrength(+e.target.value)}/></label>
            <label>Wind direction <b>{Math.round(windDirection*180/Math.PI)}°</b><input type="range" min="-3.14" max="3.14" step=".01" value={windDirection} onChange={e=>setWindDirection(+e.target.value)}/></label>
          </div>
          <div className="camera-control-card layer-motion-card"><div><Waves size={14}/> Ambient layer motion <small>Preview while playing</small></div>
            <label>Horizontal drift <b>{(selected.motionX??0).toFixed(2)}</b><input type="range" min="0" max=".8" step=".01" value={selected.motionX??0} onChange={e=>updateSelected({motionX:+e.target.value})}/></label>
            <label>Vertical drift <b>{(selected.motionY??0).toFixed(2)}</b><input type="range" min="0" max=".8" step=".01" value={selected.motionY??0} onChange={e=>updateSelected({motionY:+e.target.value})}/></label>
            <label>Gentle rotation <b>{(selected.motionRotation??0).toFixed(1)}°</b><input type="range" min="0" max="12" step=".1" value={selected.motionRotation??0} onChange={e=>updateSelected({motionRotation:+e.target.value})}/></label>
            <label>Motion speed <b>{(selected.motionSpeed??1).toFixed(1)}×</b><input type="range" min=".2" max="3" step=".1" value={selected.motionSpeed??1} onChange={e=>updateSelected({motionSpeed:+e.target.value})}/></label>
            <button type="button" className="wide-secondary" onClick={()=>updateSelected({motionX:0,motionY:0,motionRotation:0,motionSpeed:1})}>Reset layer motion</button>
          </div>
          <div className="camera-control-card"><div><Camera size={14}/> Camera framing</div>
            <label>Horizontal <b>{cameraTransform.x.toFixed(2)}</b><input type="range" min="-8" max="8" step=".01" value={cameraTransform.x} onChange={e=>updateCamera({x:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
            <label>Vertical <b>{cameraTransform.y.toFixed(2)}</b><input type="range" min="-12" max="12" step=".01" value={cameraTransform.y} onChange={e=>updateCamera({y:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
            <label>Camera zoom <b>{cameraTransform.zoom.toFixed(2)}×</b><input type="range" min=".35" max="5" step=".01" value={cameraTransform.zoom} onChange={e=>updateCamera({zoom:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>\n            <label>Camera distance <b>{(cameraTransform.z??20).toFixed(1)}</b><input type="range" min="6" max="50" step=".1" value={cameraTransform.z??18} onChange={e=>updateCamera({z:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label><label>Camera roll <b>{(cameraTransform.roll??0).toFixed(0)}°</b><input type="range" min="-45" max="45" step="1" value={cameraTransform.roll??0} onChange={e=>updateCamera({roll:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label></div>
          <button className="wide-secondary mask-open-btn" onClick={()=>setMaskLayerId(selected.id)}><Scan size={14}/> Open manual mask editor</button><button className="wide-secondary" onClick={()=>duplicateLayer(selected)}><Copy size={14}/> Duplicate layer</button>
        </> : <div className="layer-empty"><SlidersHorizontal size={22}/><b>No layer selected</b><span>Select a layer to edit its transforms.</span></div>}</div>}
        <div className="inspector-footer"><span className="live-dot"/> Drag layers in the canvas to reposition</div>
      </aside>
    </div>
    {settingsOpen && <div className="mask-overlay" role="dialog" aria-modal="true" aria-label="PARALLAX settings"><div className="mask-dialog settings-dialog"><div className="mask-header"><div><span className="eyebrow">WORKSPACE</span><strong>Settings</strong></div><button className="mask-close" onClick={()=>setSettingsOpen(false)} aria-label="Close settings">×</button></div><label className="environment-check"><input type="checkbox" checked={autosaveEnabled} onChange={e=>setAutosaveEnabled(e.target.checked)}/> Automatically save recovery copy on this device</label><p className="environment-note">Your scene and imported artwork are saved privately in this browser using IndexedDB. Autosave helps restore your work if the tab reloads.</p><button className="wide-secondary" onClick={()=>{void clearRecovery().then(()=>alert("Local recovery copy cleared." )).catch(()=>alert("Could not clear local recovery copy."));}}>Clear local recovery copy</button><div className="mask-footer"><span>PARALLAX 2.5 · Local workspace</span><button className="mask-apply" onClick={()=>setSettingsOpen(false)}>Done</button></div></div></div>}
    {maskLayerId && layers.find(layer=>layer.id===maskLayerId) && <MaskEditor src={layers.find(layer=>layer.id===maskLayerId)!.url} name={layers.find(layer=>layer.id===maskLayerId)!.name} onApply={blob=>applyMask(maskLayerId,blob)} onClose={()=>setMaskLayerId(null)}/>}
    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden onChange={e=>{importFiles(e.target.files);e.target.value='';}}/><input ref={projectFileRef} type="file" accept=".json,.parallax.json,application/json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void loadProject(file);e.target.value='';}}/>
  </main>;
}
