import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import MaskEditor from './MaskEditor';
import Library from './Library';
import {
  Upload, Layers3, Image as ImageIcon, Move3D, SlidersHorizontal, Eye, EyeOff,
  Lock, Unlock, Trash2, Copy, Plus, Play, Undo2, Redo2, Maximize2, Download, FolderOpen,
  ZoomIn, ZoomOut, RotateCcw, Film, Settings2, Scan, Pause, CircleDot, SkipBack, Camera, KeyRound
, Waves, Wind} from 'lucide-react';

type Transform = { x:number; y:number; z:number; scale:number; rotation:number; opacity:number };
type CameraTransform = { x:number; y:number; zoom:number; z:number; roll:number; yaw?:number; pitch?:number };
type Keyframe = { id:string; time:number; layers:Record<string,Transform>; camera:CameraTransform };
type EnvironmentPreset = 'divine'|'sunset'|'night'|'storm'|'temple'|'cosmic';
type EnvironmentSettings = { preset: EnvironmentPreset; intensity:number; horizon:number; stars:boolean; fabric:boolean; fabricScale:number; fabricOpacity:number; fabricGlow:number; };
type Layer = {
  id: string; name: string; url: string; fileName: string;
  x: number; y: number; z: number; scale: number; rotation: number;
  visible: boolean; locked: boolean; opacity: number; width: number; height: number; isVideo?: boolean;
  motionX?: number; motionY?: number; motionRotation?: number; motionSpeed?: number; slot?: number;
  textContent?: string; textFont?: string; textSize?: number; textColor?: string; textBold?: boolean; textItalic?: boolean; textAlign?: 'left'|'center'|'right'; textStroke?: string; textStrokeWidth?: number;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const renderTextArtwork = (text:string,font:string,size:number,color:string,bold:boolean,italic:boolean,align:'left'|'center'|'right',stroke:string,strokeWidth:number) => {
  const canvas=document.createElement('canvas'); canvas.width=1600; canvas.height=600;
  const ctx=canvas.getContext('2d')!;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.textAlign=align; ctx.textBaseline='middle';
  ctx.font=`${italic?'italic ':''}${bold?'700 ':'400 '}${size*2}px "${font}"`;
  ctx.lineJoin='round'; ctx.lineWidth=strokeWidth*2;
  const x=align==='left'?70:align==='right'?1530:800;
  const lines=text.split('\\n').slice(0,4), lineHeight=size*2.25;
  const startY=300-((lines.length-1)*lineHeight)/2;
  lines.forEach((line,index)=>{if(stroke&&strokeWidth>0){ctx.strokeStyle=stroke;ctx.strokeText(line,x,startY+index*lineHeight,1460);}ctx.fillStyle=color;ctx.fillText(line,x,startY+index*lineHeight,1460);});
  return canvas.toDataURL('image/png');
};
const BOARD_H = 7.2;
const ASPECT_RATIOS:Record<string,number> = {'9:16':9/16,'16:9':16/9,'1:1':1,'4:5':4/5,'3:4':3/4};

type EditorSnapshot = { layers:Layer[]; selectedId:string|null; projectName:string; duration:number; keyframes:Keyframe[]; cameraTransform:CameraTransform; aspectRatio:string };
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

function Viewport({ layers, selectedId, onSelect, onMove, onMoveEnd, onCameraZoom, onCameraPan, onCameraReset, cameraTransform, aspectRatio, playing, playhead, windStrength, windDirection, atmosphere, environment }: {
  layers: Layer[]; selectedId: string | null; onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void; onMoveEnd: () => void; onCameraZoom:(zoom:number)=>void; onCameraPan:(patch:Partial<CameraTransform>)=>void; onCameraReset:()=>void; cameraTransform: CameraTransform; aspectRatio:string; playing: boolean; playhead:number; windStrength: number; windDirection: number; atmosphere: {clouds:boolean;mist:boolean;dust:boolean;intensity:number}; environment: EnvironmentSettings;
}) {
  const host = useRef<HTMLDivElement>(null);
  const boardW=BOARD_H*(ASPECT_RATIOS[aspectRatio]??(9/16));
  const fitDistance=useRef(24);
  const cameraSettingsRef=useRef(cameraTransform); cameraSettingsRef.current=cameraTransform;
  const applyCameraFraming = (camera:THREE.PerspectiveCamera, framing:CameraTransform) => {
    const roll=THREE.MathUtils.degToRad(framing.roll??0);
    const cos=Math.abs(Math.cos(roll)), sin=Math.abs(Math.sin(roll));
    // Fit the rotated composition bounds, not the unrotated board.
    const rotatedWidth=boardW*cos+BOARD_H*sin;
    const rotatedHeight=BOARD_H*cos+boardW*sin;
    const verticalFov=THREE.MathUtils.degToRad(camera.fov);
    // Fit the complete composition inside the *current viewport* in both axes.
    // The extra safety margin prevents edge clipping after mobile resize/orientation changes.
    const safeAspect=Math.max(.01,camera.aspect);
    const fit=Math.max(rotatedHeight,rotatedWidth/safeAspect)*0.94/(2*Math.tan(verticalFov/2));
    fitDistance.current=fit;
    const distance=fit*((framing.z??20)/20)/Math.max(.1,framing.zoom);
    // Orbit around the composition target. Yaw rotates horizontally; pitch tilts vertically.
    const yaw=THREE.MathUtils.degToRad(framing.yaw??0);
    const pitch=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(framing.pitch??0,-80,80));
    const target=new THREE.Vector3(framing.x,framing.y,0);
    const spherical=new THREE.Spherical(Math.max(.5,distance),Math.PI/2-pitch,yaw);
    camera.position.setFromSpherical(spherical).add(target);
    camera.up.set(0,1,0);
    camera.lookAt(target);
    camera.rotateZ(roll);
    camera.updateProjectionMatrix();
  };
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshes = useRef(new Map<string, THREE.Mesh>());
  const drag = useRef<{kind:'layer';id:string;startX:number;startY:number;originX:number;originY:number;planeZ:number;moved:boolean}|{kind:'pan';startClientX:number;startClientY:number;originX:number;originY:number;moved:boolean}|null>(null);
  const activePointers = useRef(new Map<number,{x:number;y:number}>());
  const pinchStart = useRef<{distance:number;zoom:number}|null>(null);
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
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    // ULTRA: render at native device density (up to 3x) with MSAA enabled.
    renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 2), 3));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x0e1018, 1);
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
    const cloudFx=makeAtmosphere(26,0x9ca8bc,.22,.12,boardW*1.5,BOARD_H*1.25,-.4);
    const mistFx=makeAtmosphere(115,0xc9d3df,.075,.22,boardW*1.35,BOARD_H*.45,.65);
    const dustFx=makeAtmosphere(100,0xf2d9a0,.025,.72,boardW*1.25,BOARD_H*1.2,1.2);

    // Camera-mounted composition overlay: it stays locked to the camera during pan, zoom, roll and resize.
    const board = new THREE.Group();
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(boardW, BOARD_H)),
      new THREE.LineBasicMaterial({ color: 0x9b8bd0, transparent: true, opacity: 0.9, depthTest: false })
    );
    frame.position.z = -0.05; frame.renderOrder = 1000;
    board.add(frame);
    const guides = new THREE.Group();
    const guideMaterial = new THREE.LineDashedMaterial({ color: 0x62577f, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.55, depthTest: false });
    const guideGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-boardW/2, 0, -0.04), new THREE.Vector3(boardW/2, 0, -0.04),
      new THREE.Vector3(0, -BOARD_H/2, -0.04), new THREE.Vector3(0, BOARD_H/2, -0.04)
    ]);
    const guideLines = new THREE.LineSegments(guideGeo, guideMaterial);
    guideLines.computeLineDistances(); guideLines.renderOrder = 1000; guides.add(guideLines); board.add(guides);
    board.position.set(0,0,-2); camera.add(board);
    const resizeCompositionFrame = () => { const ratio=boardW/BOARD_H; const fit=Math.min(.97,.97*camera.aspect/ratio); board.scale.setScalar(fit); };
    resizeCompositionFrame();

    // True 3D surface grid: build connected X/Y grid lines over a rolling terrain mesh.
    // Alternating diagonals create triangular topology without the one-directional stripe look.
    const fabricGroup = new THREE.Group();
    fabricGroup.name='environment-geometric-fabric';
    const fabricWidth=boardW*3.8, fabricHeight=BOARD_H*3.1, fabricCols=58, fabricRows=48;
    const fabricVertex=(ix:number,iy:number)=>{
      const x=(ix/fabricCols-.5)*fabricWidth, y=(iy/fabricRows-.5)*fabricHeight;
      const broad=Math.sin(x*.34+y*.13)*.95+Math.cos(y*.39-x*.17)*.72;
      const rolling=Math.sin(x*.19)*Math.cos(y*.27)*.58+Math.cos((x+y)*.22)*.32;
      return new THREE.Vector3(x,y,broad+rolling);
    };
    const fabricLinePositions:number[]=[];
    const addFabricLine=(a:THREE.Vector3,b:THREE.Vector3)=>{fabricLinePositions.push(a.x,a.y,a.z,b.x,b.y,b.z);};
    const vertices=Array.from({length:fabricRows+1},(_,iy)=>Array.from({length:fabricCols+1},(_,ix)=>fabricVertex(ix,iy)));
    for(let iy=0;iy<=fabricRows;iy++) for(let ix=0;ix<=fabricCols;ix++){
      if(ix<fabricCols)addFabricLine(vertices[iy][ix],vertices[iy][ix+1]);
      if(iy<fabricRows)addFabricLine(vertices[iy][ix],vertices[iy+1][ix]);
      if(ix<fabricCols&&iy<fabricRows){
        if((ix+iy)%2===0)addFabricLine(vertices[iy][ix],vertices[iy+1][ix+1]);
        else addFabricLine(vertices[iy][ix+1],vertices[iy+1][ix]);
      }
    }
    const fabricGeometry=new THREE.BufferGeometry();
    fabricGeometry.setAttribute('position',new THREE.Float32BufferAttribute(fabricLinePositions,3));
    const fabricMaterial=new THREE.LineBasicMaterial({color:0x9b83ed,transparent:true,opacity:.42,depthWrite:false});
    const fabric=new THREE.LineSegments(fabricGeometry,fabricMaterial);
    fabricGroup.add(fabric);
    // A faint shaded surface gives the wire grid readable volume rather than a flat overlay.
    const surfacePositions:number[]=[];
    const surfaceIndices:number[]=[];
    for(let iy=0;iy<=fabricRows;iy++)for(let ix=0;ix<=fabricCols;ix++){const v=vertices[iy][ix];surfacePositions.push(v.x,v.y,v.z);}
    for(let iy=0;iy<fabricRows;iy++)for(let ix=0;ix<fabricCols;ix++){
      const a=iy*(fabricCols+1)+ix,b=a+1,d=(iy+1)*(fabricCols+1)+ix,e=d+1;
      surfaceIndices.push(a,d,b,b,d,e);
    }
    const surfaceGeometry=new THREE.BufferGeometry();
    surfaceGeometry.setAttribute('position',new THREE.Float32BufferAttribute(surfacePositions,3));
    surfaceGeometry.setIndex(surfaceIndices);surfaceGeometry.computeVertexNormals();
    const surfaceMaterial=new THREE.MeshBasicMaterial({color:0x24203d,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide});
    const surface=new THREE.Mesh(surfaceGeometry,surfaceMaterial);fabricGroup.add(surface);
    fabricGroup.position.set(0,-1.1,-3.35);fabricGroup.renderOrder=-2;scene.add(fabricGroup);
    sceneRef.current = scene; rendererRef.current = renderer; cameraRef.current = camera;

    const resize = () => {
      if (!host.current) return;
      const w = Math.max(1, host.current.clientWidth), h = Math.max(1, host.current.clientHeight);
      camera.aspect = w / h;
      applyCameraFraming(camera,cameraSettingsRef.current);
      resizeCompositionFrame();
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
      scene.remove(fabricGroup); fabricGeometry.dispose(); fabricMaterial.dispose(); surfaceGeometry.dispose(); surfaceMaterial.dispose(); camera.remove(board);
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
  }, [aspectRatio]);

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
    const fabric=scene.getObjectByName('environment-geometric-fabric') as THREE.Group|undefined;
    if(fabric){fabric.visible=environment.fabric;fabric.scale.setScalar(environment.fabricScale);const lines=fabric.children[0] as THREE.LineSegments;const lm=lines.material as THREE.LineBasicMaterial;lm.opacity=environment.fabricOpacity;lm.color.setRGB(.28+environment.fabricGlow*.42,.22+environment.fabricGlow*.34,.48+environment.fabricGlow*.42);const sm=(fabric.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;sm.opacity=environment.fabricOpacity*.48;}
  }, [environment]);
  useEffect(() => { const camera=cameraRef.current; if(!camera) return; applyCameraFraming(camera,cameraTransform); }, [cameraTransform,aspectRatio]);

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
    layers.forEach(layer => {
      let mesh = meshes.current.get(layer.id);
      if (!mesh) {
        const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(boardW, BOARD_H), material);
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
          const texture=new THREE.VideoTexture(video);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;material.map=texture;material.needsUpdate=true;
          const fitVideo=()=>{if(!meshes.current.has(layer.id)||mesh!.userData.sourceUrl!==layer.url)return;const aspect=(video.videoWidth||16)/(video.videoHeight||9);const boardAspect=boardW/BOARD_H;const fitW=aspect>boardAspect?boardW:BOARD_H*aspect;const fitH=aspect>boardAspect?boardW/aspect:BOARD_H;mesh!.geometry.dispose();mesh!.geometry=new THREE.PlaneGeometry(fitW,fitH);};
          video.addEventListener('loadedmetadata',fitVideo,{once:true});
          if(video.readyState>=1)fitVideo();
          if(playingRef.current){const start=()=>{video.currentTime=Math.min(playheadRef.current,Number.isFinite(video.duration)?video.duration:playheadRef.current);void video.play().catch(()=>{});};if(video.readyState>=2)start();else video.addEventListener('canplay',start,{once:true});}
        }else new THREE.TextureLoader().load(layer.url, texture => {
          if (!meshes.current.has(layer.id) || mesh!.userData.sourceUrl !== layer.url) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.anisotropy = rendererRef.current?.capabilities.getMaxAnisotropy() ?? 1;
          material.map = texture;
          material.needsUpdate = true;
          const image = texture.image as HTMLImageElement;
          const imageAspect = image.width / Math.max(1, image.height);
          const boardAspect = boardW / BOARD_H;
          const fitW = imageAspect > boardAspect ? boardW : BOARD_H * imageAspect;
          const fitH = imageAspect > boardAspect ? boardW / imageAspect : BOARD_H;
          mesh!.geometry.dispose();
          mesh!.geometry = new THREE.PlaneGeometry(fitW, fitH);
        });
      }
      const currentMaterial=mesh.material as THREE.MeshBasicMaterial;
      const media=currentMaterial.map?.image as HTMLImageElement|undefined;
      const video=mesh.userData.videoElement as HTMLVideoElement|undefined;
      const mediaWidth=video?.videoWidth||media?.width||0, mediaHeight=video?.videoHeight||media?.height||0;
      if(mediaWidth>0&&mediaHeight>0){const mediaAspect=mediaWidth/mediaHeight,boardAspect=boardW/BOARD_H;const fitW=mediaAspect>boardAspect?boardW:BOARD_H*mediaAspect;const fitH=mediaAspect>boardAspect?boardW/mediaAspect:BOARD_H;const geometry=mesh.geometry as THREE.PlaneGeometry;const params=(geometry.parameters||{}) as {width?:number;height?:number};if(Math.abs((params.width||0)-fitW)>.001||Math.abs((params.height||0)-fitH)>.001){mesh.geometry.dispose();mesh.geometry=new THREE.PlaneGeometry(fitW,fitH);}}
      mesh.position.set(layer.x, layer.y, layer.z);
      mesh.scale.setScalar(layer.scale);
      mesh.rotation.z = THREE.MathUtils.degToRad(layer.rotation);
      mesh.visible = layer.visible;
      // Respect the actual Z depth; array-index render order made background layers draw over foreground objects.
      mesh.renderOrder = Math.round((layer.z + 8) * 100);
      (mesh.material as THREE.MeshBasicMaterial).opacity = layer.opacity / 100;
    });
  }, [layers,aspectRatio]);

  useEffect(()=>{meshes.current.forEach(mesh=>{const video=mesh.userData.videoElement as HTMLVideoElement|undefined;if(!video)return;if(playing){void video.play().catch(()=>{});}else{video.pause();if(Number.isFinite(video.duration)&&video.duration>0){const target=Math.min(playhead,video.duration);if(Math.abs(video.currentTime-target)>.08){try{video.currentTime=target;}catch{}}}}});},[playing,playhead]);

  const pointerToWorld = (e: React.PointerEvent, planeZ = 0) => {
    const rect = host.current!.getBoundingClientRect();
    const camera = cameraRef.current!;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster=new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx,ny),camera);
    const point=raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-planeZ),new THREE.Vector3());
    return point ? {x:point.x,y:point.y} : {x:0,y:0};
  };
  const down = (e: React.PointerEvent) => {
    if (!cameraRef.current || !host.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(activePointers.current.size >= 2){
      drag.current=null;
      const pts=[...activePointers.current.values()];
      pinchStart.current={distance:Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)),zoom:cameraSettingsRef.current.zoom};
      return;
    }
    const rect=host.current.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1),cameraRef.current);
    const hits = ray.intersectObjects([...meshes.current.values()].filter(m => m.visible), false);
    const layer=hits.length ? layersRef.current.find(item=>item.id===hits[0].object.userData.layerId) : undefined;
    if(layer){
      onSelect(layer.id);
      if(!layer.locked){
        const point=pointerToWorld(e,layer.z);
        drag.current={kind:'layer',id:layer.id,startX:point.x,startY:point.y,originX:layer.x,originY:layer.y,planeZ:layer.z,moved:false};
        return;
      }
    }
    // Empty canvas (or a locked layer) pans the camera instead of doing nothing.
    drag.current={kind:'pan',startClientX:e.clientX,startClientY:e.clientY,originX:cameraSettingsRef.current.x,originY:cameraSettingsRef.current.y,moved:false};
  };
  const move = (e: React.PointerEvent) => {
    const active=activePointers.current;
    if(active.has(e.pointerId))active.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(active.size>=2){
      const pts=[...active.values()];
      const distance=Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y));
      const start=pinchStart.current;
      if(start)onCameraZoom(THREE.MathUtils.clamp(start.zoom*(distance/start.distance),.5,2.5));
      return;
    }
    const d=drag.current; if(!d||!host.current)return;
    if(d.kind==='layer'){
      const point=pointerToWorld(e,d.planeZ);
      const x=d.originX+point.x-d.startX, y=d.originY+point.y-d.startY;
      d.moved=true;
      const mesh=meshes.current.get(d.id);
      if(mesh){mesh.position.x=x;mesh.position.y=y;}
      moveRef.current(d.id,x,y);
    }else{
      const camera=cameraRef.current;
      if(!camera)return;
      const rect=host.current.getBoundingClientRect();
      const worldPerPixel=(2*Math.max(.5,camera.position.length())*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))/Math.max(1,rect.height);
      const dx=e.clientX-d.startClientX, dy=e.clientY-d.startClientY;
      d.moved=true;
      onCameraPan({x:d.originX-dx*worldPerPixel,y:d.originY+dy*worldPerPixel});
    }
  };
  const finishPointer=(e:React.PointerEvent)=>{
    activePointers.current.delete(e.pointerId);
    if(activePointers.current.size<2)pinchStart.current=null;
    if(activePointers.current.size===1){
      // Keep the remaining finger in pan mode after a pinch; do not clear it below.
      const remaining=[...activePointers.current.values()][0];
      drag.current={kind:'pan',startClientX:remaining.x,startClientY:remaining.y,originX:cameraSettingsRef.current.x,originY:cameraSettingsRef.current.y,moved:false};
      return;
    }
    if(drag.current?.kind==='layer'&&drag.current.moved)onMoveEnd();
    drag.current=null;
  };
  return <div className="viewport" ref={host} onPointerDown={down} onPointerMove={move} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
    {layers.length === 0 && <div className="empty-scene"><div className="empty-icon"><ImageIcon size={26}/></div><strong>Your canvas is empty</strong><span>Import artwork to begin building your 2.5D scene.</span></div>}
    <div className="viewport-badge"><span className="live-dot"/> {aspectRatio} COMPOSITION</div>
    <button type="button" className="viewport-reset-camera" title="Reset camera" aria-label="Reset camera" onClick={onCameraReset}><RotateCcw size={15} aria-hidden="true"/></button>
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
  const [motionClipboard,setMotionClipboard] = useState<{sourceId:string;sourceName:string;points:{time:number;transform:Transform}[]}|null>(null);
  const [motionStatus,setMotionStatus] = useState('');
  const [tab, setTab] = useState<'layers'|'properties'|'environment'|'animation'>('layers');
  const [projectName, setProjectName] = useState('Untitled Scene');
  const [maskLayerId, setMaskLayerId] = useState<string | null>(null);
  const [duration, setDuration] = useState(10);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [windStrength, setWindStrength] = useState(0);
  const [windDirection, setWindDirection] = useState(0);
  const [atmosphere, setAtmosphere] = useState({clouds:false,mist:false,dust:false,intensity:1});
  const [environment,setEnvironment] = useState<EnvironmentSettings>({preset:'divine',intensity:1,horizon:0.35,stars:true,fabric:true,fabricScale:1,fabricOpacity:0.28,fabricGlow:0.55});
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [cameraTransform, setCameraTransform] = useState<CameraTransform>({x:0,y:0,zoom:1,z:18,roll:0});
  const cameraTransformRef = useRef<CameraTransform>(cameraTransform);
  cameraTransformRef.current = cameraTransform;
  const [aspectRatio,setAspectRatio]=useState('9:16');
  const [selectedKeyframeId,setSelectedKeyframeId]=useState<string|null>(null);
  const [liveEditTime, setLiveEditTime] = useState<number | null>(null);
  const [hydrated,setHydrated]=useState(false);
  const [autosaveEnabled,setAutosaveEnabled]=useState(true);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [historyVersion,setHistoryVersion]=useState(0);
  const undoStack=useRef<EditorSnapshot[]>([]);
  const redoStack=useRef<EditorSnapshot[]>([]);
  const historyTimer=useRef<number|null>(null);
  const autosaveTimer=useRef<number|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotFileRef = useRef<HTMLInputElement>(null);
  const [pendingSlot,setPendingSlot] = useState<number|null>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);

  const snapshotEditor=():EditorSnapshot=>({layers:layers.map(layer=>({...layer})),selectedId,projectName,duration,keyframes:keyframes.map(frame=>({...frame,layers:{...frame.layers},camera:{...frame.camera}})),cameraTransform:{...cameraTransform},aspectRatio});
  const recordHistory=()=>{
    if(historyTimer.current!==null)return;
    const previous=snapshotEditor();
    historyTimer.current=window.setTimeout(()=>{undoStack.current=[...undoStack.current,previous].slice(-40);redoStack.current=[];historyTimer.current=null;setHistoryVersion(v=>v+1);},650);
  };
  const applySnapshot=(snapshot:EditorSnapshot)=>{
    setLayers(snapshot.layers.map(layer=>({...layer})));setSelectedId(snapshot.selectedId);setProjectName(snapshot.projectName);setDuration(snapshot.duration);setKeyframes(snapshot.keyframes.map(frame=>({...frame,layers:{...frame.layers},camera:{...frame.camera}})));setCameraTransform({...snapshot.cameraTransform});setAspectRatio(snapshot.aspectRatio||'9:16');setPlaying(false);setPlayhead(0);setLiveEditTime(null);
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
      if(active){setLayers(restored);setSelectedId(payload.selectedId??restored[0]?.id??null);setProjectName(payload.projectName||'Untitled Scene');setDuration(Number.isFinite(payload.duration)?payload.duration:10);setKeyframes(Array.isArray(payload.keyframes)?payload.keyframes:[]);setCameraTransform(payload.cameraTransform||{x:0,y:0,zoom:1,z:20,roll:0});setAspectRatio(payload.aspectRatio&&ASPECT_RATIOS[payload.aspectRatio]?payload.aspectRatio:'9:16');}
    }).catch(()=>{}).finally(()=>{if(active)setHydrated(true);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!hydrated||!autosaveEnabled)return;
    if(autosaveTimer.current!==null)window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current=window.setTimeout(()=>{void persistRecovery(snapshotEditor()).catch(()=>{});},900);
    return()=>{if(autosaveTimer.current!==null)window.clearTimeout(autosaveTimer.current);};
  },[hydrated,autosaveEnabled,layers,selectedId,projectName,duration,keyframes,cameraTransform,aspectRatio]);
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
  const selected = animatedLayers.find(layer => layer.id === selectedId) ?? layers.find(layer => layer.id === selectedId) ?? null;
  const animatedCamera = (() => {
    if(!keyframes.length || (liveEditTime !== null && Math.abs(playhead-liveEditTime)<0.02)) return cameraTransform;
    const frames=[...keyframes].sort((a,b)=>a.time-b.time);
    const before=[...frames].reverse().find(frame=>frame.time<=playhead) ?? frames[0];
    const after=frames.find(frame=>frame.time>=playhead) ?? frames[frames.length-1];
    const span=after.time-before.time, raw=span<=0?0:Math.max(0,Math.min(1,(playhead-before.time)/span));
    const t=raw*raw*(3-2*raw);
    return {x:before.camera.x+(after.camera.x-before.camera.x)*t,y:before.camera.y+(after.camera.y-before.camera.y)*t,zoom:before.camera.zoom+(after.camera.zoom-before.camera.zoom)*t,z:(before.camera.z??20)+((after.camera.z??20)-(before.camera.z??20))*t,roll:(before.camera.roll??0)+((after.camera.roll??0)-(before.camera.roll??0))*t,yaw:(before.camera.yaw??0)+((after.camera.yaw??0)-(before.camera.yaw??0))*t,pitch:(before.camera.pitch??0)+((after.camera.pitch??0)-(before.camera.pitch??0))*t};
  })();
  const makeFrame = (time:number, layerSnapshot:Layer[]=animatedLayers, cameraSnapshot:CameraTransform=animatedCamera):Keyframe => ({
    id:uid(),time:Number(time.toFixed(2)),
    layers:Object.fromEntries(layerSnapshot.map(layer=>[layer.id,{x:layer.x,y:layer.y,z:layer.z,scale:layer.scale,rotation:layer.rotation,opacity:layer.opacity}])),
    camera:{...cameraSnapshot}
  });
  const writeKeyframe = (frame:Keyframe) => setKeyframes(prev=>[...prev.filter(item=>Math.abs(item.time-frame.time)>0.015),frame].sort((a,b)=>a.time-b.time));
  const addKeyframe = () => { recordHistory(); const frame=makeFrame(playhead,animatedLayers,animatedCamera); setKeyframes(prev=>[...prev.filter(item=>Math.abs(item.time-frame.time)>0.015),frame].sort((x,y)=>x.time-y.time)); setSelectedKeyframeId(frame.id); setLiveEditTime(null); setPlaying(false); };
  const selectedKeyframe = keyframes.find(frame=>frame.id===selectedKeyframeId) ?? null;
  const deleteSelectedKeyframe = () => { const target=selectedKeyframe ?? [...keyframes].sort((a,b)=>Math.abs(a.time-playhead)-Math.abs(b.time-playhead))[0] ?? null; if(!target)return; recordHistory(); setKeyframes(prev=>prev.filter(frame=>frame.id!==target.id)); setSelectedKeyframeId(null); };
  const playbackStart = useRef(0);
  useEffect(()=>{ if(tab==='properties') document.querySelector('.properties-panel')?.scrollTo({top:0,behavior:'smooth'}); },[tab,selectedId]);
  useEffect(()=>{ if(!playing)return; playbackStart.current=playhead; let raf=0,last=0,elapsed=0; const tick=(now:number)=>{if(!last)last=now;elapsed+=Math.min(.1,(now-last)/1000);last=now;const next=Math.min(duration,playbackStart.current+elapsed);setPlayhead(next);if(next>=duration){setPlaying(false);return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[playing,duration]);

  // Place new artwork at the centre of the currently visible composition, on its own Z plane.
  // The camera looks toward (animatedCamera.x, animatedCamera.y, 0); account for orbit so
  // the centre-screen ray still intersects the new layer at its actual depth.
  const getLayerSpawnPosition = (z:number) => {
    const yaw=THREE.MathUtils.degToRad(animatedCamera.yaw??0);
    const pitch=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(animatedCamera.pitch??0,-80,80));
    const cosYaw=Math.max(0.15,Math.cos(yaw));
    return {
      x:animatedCamera.x - z*Math.tan(yaw),
      y:animatedCamera.y + z*Math.tan(pitch)/cosYaw
    };
  };

  const addTextLayer = () => {
    recordHistory();
    const text='Your Text';
    const font='Arial', size=96, color='#ffffff';
    const layer:Layer={id:uid(),name:'Text',fileName:'text-layer.png',url:renderTextArtwork(text,font,size,color,true,false,'center','#000000',0),...getLayerSpawnPosition(layers.length*.02),z:layers.length*.02,scale:1,rotation:0,visible:true,locked:false,opacity:100,width:0,height:0,motionX:0,motionY:0,motionRotation:0,motionSpeed:1,textContent:text,textFont:font,textSize:size,textColor:color,textBold:true,textItalic:false,textAlign:'center',textStroke:'#000000',textStrokeWidth:0};
    setLayers(prev=>[...prev,layer]);setSelectedId(layer.id);setTab('properties');
  };
  const updateTextLayer = (patch:Partial<Layer>) => {
    if(!selected?.textContent && selected?.textContent!=='')return;
    const next={...selected,...patch};
    const url=renderTextArtwork(next.textContent??'Text',next.textFont??'Arial',next.textSize??96,next.textColor??'#ffffff',next.textBold??false,next.textItalic??false,next.textAlign??'center',next.textStroke??'#000000',next.textStrokeWidth??0);
    updateLayer(selected.id,{...patch,url});
  };
  const importFiles = (files: FileList | null) => {
    if(files?.length)recordHistory();
    if (!files) return;
    const additions: Layer[] = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/')).map(file => ({
      id: uid(), name: (() => { const base=file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g,' ').trim(); return /^file[_\s-]*[a-f0-9]{12,}$/i.test(base) ? 'Image ' + (layers.length + 1) : (base || 'Image ' + (layers.length + 1)); })(), fileName: file.name,
      url: URL.createObjectURL(file), isVideo:file.type.startsWith('video/'), ...getLayerSpawnPosition(layers.length * 0.02), z: layers.length * 0.02,
      scale: 1, rotation: 0, visible: true, locked: false, opacity: 100, width: 0, height: 0,
      motionX: 0, motionY: 0, motionRotation: 0, motionSpeed: 1
    }));
    setLayers(prev => [...prev, ...additions]);
    if (additions[0]) { setSelectedId(additions[0].id); setTab('properties'); }
  };
  const uploadToSlot = (slot:number, file:File) => {
    if(!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;
    recordHistory();
    const slotDepth=[-6,-3.5,-1.5,0,2,4][slot-1];
    const old=layers.find(layer=>layer.slot===slot);
    const base=file.name.replace(/\\.[^.]+$/, '').replace(/[_-]+/g,' ').trim();
    const layer:Layer={
      id:uid(),slot,name:base||('Layer '+slot),fileName:file.name,url:URL.createObjectURL(file),
      isVideo:file.type.startsWith('video/'),...getLayerSpawnPosition(slotDepth),z:slotDepth,scale:1,rotation:0,
      visible:true,locked:false,opacity:100,width:0,height:0,
      motionX:0,motionY:0,motionRotation:0,motionSpeed:1
    };
    setLayers(prev=>[...prev.filter(item=>item.slot!==slot),layer]);
    setSelectedId(layer.id);
    setTab('properties');
  };
  const updateLayer = (id: string, patch: Partial<Layer>) => {
    recordHistory();
    setLiveEditTime(playhead);
    const evaluated = animatedLayers.find(layer => layer.id === id);
    setLayers(prev => prev.map(layer => layer.id === id ? {...layer,...(evaluated ?? {}),...patch} : layer));
  };
  const updateSelected = (patch: Partial<Layer>) => { if (selectedId) updateLayer(selectedId,patch); };
  const evaluateLayerTransformAt = (layerId:string,time:number):Transform|null => {
    const points=[...keyframes].filter(frame=>frame.layers[layerId]).sort((a,b)=>a.time-b.time);
    if(!points.length)return null;
    const before=[...points].reverse().find(frame=>frame.time<=time)??points[0];
    const after=points.find(frame=>frame.time>=time)??points[points.length-1];
    const a=before.layers[layerId],b=after.layers[layerId],span=after.time-before.time;
    const raw=span<=0?0:Math.max(0,Math.min(1,(time-before.time)/span)),t=raw*raw*(3-2*raw);
    const rotationDelta=THREE.MathUtils.euclideanModulo(b.rotation-a.rotation+180,360)-180;
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,scale:a.scale+(b.scale-a.scale)*t,rotation:a.rotation+rotationDelta*t,opacity:a.opacity+(b.opacity-a.opacity)*t};
  };
  const copySelectedMotion = () => {
    if(!selected)return;
    const points=[...keyframes].filter(frame=>frame.layers[selected.id]).sort((a,b)=>a.time-b.time).map(frame=>({time:frame.time,transform:{...frame.layers[selected.id]}}));
    if(points.length<2){setMotionStatus('Add at least two keyframes for this layer first.');return;}
    setMotionClipboard({sourceId:selected.id,sourceName:selected.name,points});
    setMotionStatus(`Copied ${points.length} timeline keyframes.`);
  };
  const pasteMotionToLayers = (targetIds:string[]) => {
    if(!motionClipboard||!targetIds.length)return;
    const points=motionClipboard.points,base=points[0].transform;
    const targets=targetIds.filter(id=>id!==motionClipboard.sourceId&&layers.some(layer=>layer.id===id));
    if(!targets.length){setMotionStatus('Select a different destination layer.');return;}
    recordHistory();
    const next=[...keyframes];
    for(const id of targets){
      const layer=layers.find(item=>item.id===id)!;
      const dest=evaluateLayerTransformAt(id,points[0].time)??{x:layer.x,y:layer.y,z:layer.z,scale:layer.scale,rotation:layer.rotation,opacity:layer.opacity};
      for(const point of points){
        const src=point.transform,rot=THREE.MathUtils.euclideanModulo(src.rotation-base.rotation+180,360)-180;
        const value:Transform={x:dest.x+src.x-base.x,y:dest.y+src.y-base.y,z:dest.z+src.z-base.z,scale:Math.max(.01,dest.scale*(src.scale/Math.max(.01,base.scale))),rotation:dest.rotation+rot,opacity:THREE.MathUtils.clamp(dest.opacity+src.opacity-base.opacity,0,100)};
        const index=next.findIndex(frame=>Math.abs(frame.time-point.time)<=.015);
        if(index>=0)next[index]={...next[index],layers:{...next[index].layers,[id]:value}};
        else {
          const scene=layers.map(item=>({...item,...(evaluateLayerTransformAt(item.id,point.time)??{})}));
          const frame=makeFrame(point.time,scene,animatedCamera);
          next.push({...frame,layers:{...frame.layers,[id]:value}});
        }
      }
    }
    setKeyframes(next.sort((a,b)=>a.time-b.time));
    setMotionStatus(`Pasted ${points.length} keyframes to ${targets.length} layer(s). Starting positions preserved.`);
  };
  const setSelectedDepth = (z:number) => { if(!selectedId)return; recordHistory(); const next=layers.map(layer=>layer.id===selectedId?{...layer,z}:layer); setLayers(next); const existing=keyframes.find(frame=>Math.abs(frame.time-playhead)<=0.015); if(existing){const frame=makeFrame(existing.time,next,cameraTransform);frame.id=existing.id;writeKeyframe(frame);} };
  const beginCameraEdit = () => {
    recordHistory();
    // Start from the evaluated camera at the playhead, then keep every drag update in a ref.
    const start={...animatedCamera};
    cameraTransformRef.current=start;
    setCameraTransform(start);
    setLiveEditTime(playhead);
  };
  const updateCamera = (patch:Partial<CameraTransform>) => {
    const next={...cameraTransformRef.current,...patch};
    cameraTransformRef.current=next;
    setLiveEditTime(playhead);
    setCameraTransform(next);
  };
  // Editing a property must never create a keyframe implicitly.
  // Only update a keyframe when the playhead is already on an existing marker.
  const commitCurrentKeyframe = () => {
    const existing=keyframes.find(frame=>Math.abs(frame.time-playhead)<=0.015);
    if(existing && selectedId){
      // Commit only the edited layer's transform. A keyframe is a shared
      // timeline container, but editing one layer must never rewrite the
      // animation tracks of every other layer.
      const edited=layers.find(layer=>layer.id===selectedId);
      if(edited){
        const transform:Transform={x:edited.x,y:edited.y,z:edited.z,scale:edited.scale,rotation:edited.rotation,opacity:edited.opacity};
        setKeyframes(prev=>prev.map(frame=>frame.id===existing.id
          ? {...frame,layers:{...frame.layers,[selectedId]:transform}}
          : frame));
      }
    }
    // Keep a manual edit active at this playhead when it is not on a keyframe.
    setLiveEditTime(existing ? null : playhead);
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
    setKeyframes(prev => prev.map(frame => { const nextLayers={...frame.layers}; delete nextLayers[id]; return {...frame,layers:nextLayers}; }));
    if(selectedId===id) setSelectedId(null);
  };
  const duplicateLayer = (layer: Layer) => {
    recordHistory();
    const copy={...layer,id:uid(),name:layer.name+' copy',z:layer.z+0.08};
    setLayers(prev=>[...prev,copy]); setSelectedId(copy.id);
  };
  const captureLibraryScene = async () => {
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
    return { format:'PARALLAX_2_5', version:3, projectName, duration, keyframes, cameraTransform, aspectRatio, layers:imageLayers };
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
      const payload = { format: 'PARALLAX_2_5', version: 3, projectName, duration, keyframes, cameraTransform, aspectRatio, layers: imageLayers };
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
  const exportVideo = async () => {
    const sourceCanvas = document.querySelector('.viewport canvas') as HTMLCanvasElement | null;
    if (!sourceCanvas) { alert('The preview is not ready yet.'); return; }
    if (keyframes.length < 2) { alert('Add at least two keyframes at different times before exporting a video.'); return; }
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      alert('MP4 export needs a recent version of Chrome or Samsung Internet with WebCodecs support. Open PARALLAX in an updated Chrome browser.');
      return;
    }
    const fps = 30;
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const outputScale = Math.min(1, 1080 / Math.max(sourceCanvas.width, sourceCanvas.height));
    const width = Math.max(2, Math.floor(sourceCanvas.width * outputScale / 2) * 2);
    const height = Math.max(2, Math.floor(sourceCanvas.height * outputScale / 2) * 2);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) { alert('Could not prepare the video frame buffer.'); return; }
    let encoder: VideoEncoder | null = null;
    try {
      setPlaying(false);
      setPlayhead(0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const codec = 'avc1.42001f';
      const support = await VideoEncoder.isConfigSupported({
        codec, width, height, bitrate: 8_000_000, framerate: fps,
        latencyMode: 'quality'
      });
      if (!support.supported || !support.config) {
        alert('This device does not provide an H.264 video encoder. Try an updated Chrome browser or a device with H.264 hardware encoding.');
        return;
      }
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: 'avc', width, height, frameRate: fps },
        fastStart: 'in-memory'
      });
      let encodeError: Error | null = null;
      encoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: error => { encodeError = error; }
      });
      encoder.configure(support.config);
      setPlaying(true);
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (encodeError) throw encodeError;
        const time = frameIndex / fps;
        setPlayhead(time);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        outputContext.drawImage(sourceCanvas, 0, 0, width, height);
        const frame = new VideoFrame(outputCanvas, {
          timestamp: Math.round(frameIndex * 1_000_000 / fps),
          duration: Math.round(1_000_000 / fps)
        });
        encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 6) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (encodeError) throw encodeError;
        }
      }
      await encoder.flush();
      if (encodeError) throw encodeError;
      encoder.close();
      encoder = null;
      muxer.finalize();
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      if (!blob.size) throw new Error('The MP4 file was empty.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (projectName.trim() || 'parallax-scene').replace(/[^a-z0-9-_]+/gi, '-') + '.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      alert('MP4 export complete. The H.264 video is ready for Samsung Gallery.');
    } catch (error) {
      console.error('PARALLAX MP4 export failed:', error);
      alert(error instanceof Error ? 'MP4 export failed: ' + error.message : 'MP4 export failed. Please try again.');
    } finally {
      if (encoder && encoder.state !== 'closed') encoder.close();
      setPlaying(false);
      setPlayhead(0);
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
      setAspectRatio(payload.aspectRatio&&ASPECT_RATIOS[payload.aspectRatio]?payload.aspectRatio:'9:16');
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
      <div className="top-actions"><button className="icon-btn" title="Open PARALLAX project" onClick={()=>projectFileRef.current?.click()}><FolderOpen size={17}/></button><button className="icon-btn" title="Open content library" aria-label="Open content library" onClick={()=>setLibraryOpen(true)}><Layers3 size={17}/></button><button className="icon-btn" title="Save project JSON" onClick={saveProject}><Download size={17}/></button><button className="icon-btn mobile-hidden" title="Undo" aria-label="Undo" disabled={undoStack.current.length===0} onClick={undo}><Undo2 size={17}/></button><button className="icon-btn mobile-hidden" title="Redo" aria-label="Redo" disabled={redoStack.current.length===0} onClick={redo}><Redo2 size={17}/></button><button className="export-btn" onClick={exportVideo} title="Render the keyframed scene as a video"><Film size={15}/> Export Video</button></div>
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
        <div className="scene-toolbar"><div><span className="eyebrow">SCENE EDITOR</span><strong>Composition</strong></div><div className="toolbar-right"><button type="button" className="wide-secondary text-add-button" onClick={addTextLayer}>＋ Add Text</button><label className="format-control"><span>FORMAT</span><select className="format-select" value={aspectRatio} onChange={e=>{recordHistory();setAspectRatio(e.target.value);setCameraTransform(v=>({...v,x:0,y:0,z:20,zoom:1,roll:0}));}} aria-label="Composition aspect ratio">{Object.keys(ASPECT_RATIOS).map(r=><option key={r} value={r}>{r} {r==='9:16'?'Portrait':r==='16:9'?'Landscape':r==='1:1'?'Square':r==='4:5'?'Portrait':'Portrait'}</option>)}</select></label><button className="small-icon" title="Full preview" aria-label="Open full preview" onClick={()=>{const el=document.querySelector(".viewport") as HTMLElement|null;if(!el)return;const request=el.requestFullscreen||((el as any).webkitRequestFullscreen);if(request)request.call(el);else alert("Full-screen preview is not supported by this browser.");}}><Maximize2 size={15}/></button></div></div>
        <Viewport aspectRatio={aspectRatio} layers={animatedLayers} selectedId={selectedId} onSelect={id=>{setSelectedId(id);setTab('properties');}} onMove={(id,x,y)=>updateLayer(id,{x,y})} onMoveEnd={commitCurrentKeyframe} onCameraZoom={zoom=>updateCamera({zoom})} onCameraPan={patch=>updateCamera(patch)} onCameraReset={()=>{const reset={x:0,y:0,zoom:1,z:20,roll:0,yaw:0,pitch:0};cameraTransformRef.current=reset;setCameraTransform(reset);setLiveEditTime(null);}} cameraTransform={animatedCamera} playing={playing} playhead={playhead} windStrength={windStrength} windDirection={windDirection} atmosphere={atmosphere} environment={environment}/>
        <div className="six-layer-dock" aria-label="Six individual scene layer upload slots">
          <div className="six-layer-heading"><b>SCENE DEPTH</b><span>Upload one asset into each layer</span></div>
          <div className="six-layer-buttons">
            {(['Background','Far','Mid','Main','Near','Front'] as const).map((label,index)=>{
              const slot=index+1, item=layers.find(layer=>layer.slot===slot);
              return <button type="button" key={slot} className={'six-layer-slot '+(item?'filled ':'')+(item?.id===selectedId?'active':'')} onClick={()=>{setPendingSlot(slot);slotFileRef.current?.click();}} title={item?label+' · '+item.name+' · tap to replace':'Upload '+label+' layer'}>
                <span className="slot-number">{slot}</span><span className="slot-copy"><b>{label}</b><small>{item?item.name:'＋ Upload'}</small></span><span className="slot-depth">Z {[-6,-3.5,-1.5,0,2,4][index].toFixed(1)}</span>
              </button>;
            })}
          </div>
        </div>
<div className="timeline-panel" aria-label="Animation timeline">
  <div className="timeline-top">
   <div className="timeline-controls">
    <button className="play-btn" onClick={()=>{if(playhead>=duration)setPlayhead(0);setPlaying(v=>!v);}} title={playing?"Pause":"Play"}>{playing?<Pause size={15}/>:<Play size={15} fill="currentColor"/>}</button>
    <button className="timeline-icon" onClick={()=>{setPlaying(false);setPlayhead(0);}} title="Go to start"><SkipBack size={15}/></button>
    <span className="time-readout">{playhead.toFixed(2)}s <i>/</i> {duration.toFixed(1)}s</span>
   </div>
   <div className="timeline-actions">
    <button className="keyframe-btn" onClick={addKeyframe} title="Save the current scene state at this time"><KeyRound size={14}/> + KEYFRAME</button>
    <button className="keyframe-delete-btn" disabled={!keyframes.length} onClick={deleteSelectedKeyframe} title="Delete selected keyframe"><Trash2 size={13}/> DELETE</button>
    <label className="timeline-duration">DURATION <select value={duration} onChange={e=>{recordHistory();setDuration(+e.target.value);setPlayhead(p=>Math.min(p,+e.target.value));setPlaying(false);}}>{[5,10,15,20,30,45,60,90,120].map(v=><option key={v} value={v}>{v}s</option>)}</select></label>
   </div>
  </div>
  <div className="timeline-ruler"><span>0s</span><span>{(duration*.25).toFixed(1)}s</span><span>{(duration*.5).toFixed(1)}s</span><span>{(duration*.75).toFixed(1)}s</span><span>{duration}s</span></div>
  <div className="timeline-scrub">
   <input aria-label="Timeline playhead" type="range" min="0" max={duration} step="0.01" value={playhead} onChange={e=>{setPlaying(false);setPlayhead(+e.target.value);}}/>
   <div className="keyframe-markers">{keyframes.map(frame=><button key={frame.id} className={selectedKeyframeId===frame.id?"selected":""} aria-label={"Select keyframe at "+frame.time.toFixed(2)+" seconds"} title={"Keyframe at "+frame.time.toFixed(2)+"s"} style={{left:(frame.time/duration*100)+"%"}} onClick={()=>{setPlaying(false);setSelectedKeyframeId(frame.id);setPlayhead(frame.time);}}/>)}</div>
  </div>
  <div className="keyframe-lane" aria-label="Saved keyframes">
   <b>KEYFRAMES</b>
   {keyframes.length===0 ? <span className="keyframe-empty">No keyframes yet — move the playhead and tap + KEYFRAME.</span> : [...keyframes].sort((x,y)=>x.time-y.time).map((frame,index)=><button type="button" key={frame.id} className={selectedKeyframeId===frame.id?"active":""} onClick={()=>{setPlaying(false);setSelectedKeyframeId(frame.id);setPlayhead(frame.time);}}>{index+1} · {frame.time.toFixed(2)}s</button>)}
  </div>
  <div className="layer-track-heading"><b>SCENE TRACKS</b><span>Each row follows its own layer animation</span></div>
  <div className="layer-track-list" aria-label="Per-layer animation tracks">
   {[...layers].slice().reverse().map(layer=>{
    const points=keyframes.filter(frame=>frame.layers[layer.id]).sort((x,y)=>x.time-y.time);
    return <div className={'layer-track-row '+(selectedId===layer.id?'active':'')} key={layer.id}>
     <button type="button" className="layer-track-name" onClick={()=>{setSelectedId(layer.id);setTab('properties');}}>
      <span className={'track-kind '+(layer.isVideo?'video':'image')}>{layer.isVideo?<Film size={12}/>:<ImageIcon size={12}/>}</span>
      <span><b>{layer.name}</b><small>{layer.isVideo?'VIDEO LAYER':'IMAGE LAYER'} · {points.length} KF</small></span>
     </button>
     <div className="layer-track-rail">
      {points.map(frame=><button type="button" key={frame.id} className={'layer-track-key '+(selectedKeyframeId===frame.id?'selected':'')} style={{left:(frame.time/duration*100)+'%'}} title={frame.time.toFixed(2)+'s'} aria-label={layer.name+' keyframe at '+frame.time.toFixed(2)+' seconds'} onClick={()=>{setPlaying(false);setSelectedId(layer.id);setSelectedKeyframeId(frame.id);setPlayhead(frame.time);}} />)}
      <span className="layer-track-playhead" style={{left:(playhead/duration*100)+'%'}}/>
     </div>
    </div>;
   })}
   {layers.length===0&&<div className="layer-track-empty">Import a scene layer to create its animation track.</div>}
  </div>
  <div className="timeline-bottom"><span><CircleDot size={11}/> {keyframes.length} saved</span><span>30 FPS · Smooth motion</span></div>
 </div>
       </section>
      <aside className="inspector">
        <div className="inspector-tabs"><button className={tab==='layers'?'chosen':''} onClick={()=>setTab('layers')}><Layers3 size={15}/> Layers</button><button className={tab==='properties'?'chosen':''} onClick={()=>setTab('properties')}><SlidersHorizontal size={15}/> Properties</button><button className={tab==='animation'?'chosen':''} onClick={()=>setTab('animation')}><Film size={15}/> Animate</button><button className={tab==='environment'?'chosen':''} onClick={()=>setTab('environment')}><Waves size={15}/> World</button></div>
        {tab==='animation' ? <div className="properties-panel layer-animation-editor">
          <div className="panel-heading"><div><span className="eyebrow">LAYER WORKSPACE</span><strong>Layer Animation</strong></div><span className="animation-duration">{duration.toFixed(1)}s</span></div>
          <div className="animation-selected">
            <span className={'track-kind '+(selected?.isVideo?'video':'image')}>{selected?.isVideo?<Film size={14}/>:<ImageIcon size={14}/>}</span>
            <div><b>{selected?.name??'No layer selected'}</b><small>{selected ? 'Editing independent layer motion' : 'Choose a layer to animate'}</small></div>
            <button type="button" disabled={!selected} onClick={addKeyframe}><Plus size={14}/> Keyframe</button>
          </div>
          <div className="animation-transport">
            <button type="button" className="play-btn" onClick={()=>{if(playhead>=duration)setPlayhead(0);setPlaying(v=>!v);}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
            <span>{playhead.toFixed(2)}s</span>
            <input aria-label="Layer animation playhead" type="range" min="0" max={duration} step=".01" value={playhead} onChange={e=>{setPlaying(false);setPlayhead(+e.target.value);setLiveEditTime(null);}}/>
            <span>{duration}s</span>
          </div>
          <div className="animation-track-title"><b>ANIMATION TRACKS</b><small>Tap a layer · drag timeline to scrub</small></div>
          <div className="animation-track-list">
            {[...layers].reverse().map(layer=>{
              const points=keyframes.filter(frame=>frame.layers[layer.id]).sort((x,y)=>x.time-y.time);
              return <div className={'animation-track-row '+(selectedId===layer.id?'active':'')} key={layer.id}>
                <button type="button" className="animation-track-label" onClick={()=>setSelectedId(layer.id)}><span className={'track-kind '+(layer.isVideo?'video':'image')}>{layer.isVideo?<Film size={12}/>:<ImageIcon size={12}/>}</span><b>{layer.name}</b></button>
                <div className="animation-track-rail" onPointerDown={e=>{const rect=e.currentTarget.getBoundingClientRect();const seek=()=>{const x=Math.max(0,Math.min(rect.width,e.clientX-rect.left));setPlayhead(x/rect.width*duration);setPlaying(false);setLiveEditTime(null);};(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);seek();}} onPointerMove={e=>{if(e.buttons!==1)return;const rect=e.currentTarget.getBoundingClientRect();setPlayhead(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*duration);setPlaying(false);setLiveEditTime(null);}}>
                  {points.map(frame=><button type="button" key={frame.id} className={'animation-key '+(selectedKeyframeId===frame.id?'selected':'')} style={{left:(frame.time/duration*100)+'%'}} title={frame.time.toFixed(2)+'s'} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setSelectedId(layer.id);setSelectedKeyframeId(frame.id);setPlayhead(frame.time);setPlaying(false);}}/>)}<span className="animation-playhead" style={{left:(playhead/duration*100)+'%'}}/>
                </div>
              </div>;
            })}
            {!layers.length&&<div className="layer-track-empty">Import artwork to create animation tracks.</div>}
          </div>
          {selected ? <div className="animation-property-group">
            <div className="animation-track-title"><b>{selected.name.toUpperCase()} · TRANSFORM</b><small>Set the value, then add a keyframe</small></div>
            {([['Position X','x',-3,3,.01],['Position Y','y',-5,5,.01],['Depth Z','z',-8,8,.05],['Scale','scale',.1,3,.01],['Rotation','rotation',-180,180,1],['Opacity','opacity',0,100,1]] as [string,keyof Transform,number,number,number][]).map(([label,key,min,max,step])=><label key={key}>{label}<b>{key==='opacity'?Math.round(selected[key])+'%':key==='scale'?selected[key].toFixed(2)+'×':selected[key].toFixed(2)}</b><input type="range" min={min} max={max} step={step} value={selected[key]} onChange={e=>updateSelected({[key]:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>)}
            <div className="animation-actions"><button type="button" onClick={addKeyframe}><KeyRound size={13}/> Add / Update Keyframe</button><button type="button" disabled={!keyframes.some(frame=>frame.layers[selected.id])} onClick={()=>{const target=[...keyframes].filter(frame=>frame.layers[selected.id]).sort((x,y)=>Math.abs(x.time-playhead)-Math.abs(y.time-playhead))[0];if(target){setSelectedKeyframeId(target.id);setPlayhead(target.time);setPlaying(false);}}}>Nearest Keyframe</button></div>
          </div>:null}
          <div className="animation-footer"><span>{keyframes.filter(frame=>selected?!!frame.layers[selected.id]:false).length} layer keyframes</span><span>Scene timeline remains independent</span></div>
        </div> : {tab==='environment' ? <div className="properties-panel environment-panel">
          <div className="panel-heading"><div><span className="eyebrow">PROCEDURAL WORLD</span><strong>Environment</strong></div></div>
          <div className="environment-presets">{([['divine','Divine'],['sunset','Sunset'],['night','Night'],['storm','Storm'],['temple','Temple'],['cosmic','Cosmic']] as [EnvironmentPreset,string][]).map(([id,label])=><button key={id} className={environment.preset===id?'selected':''} onClick={()=>setEnvironment(v=>({...v,preset:id}))}>{label}</button>)}</div>
          <label>Sky intensity <b>{environment.intensity.toFixed(1)}×</b><input type="range" min="0.2" max="2" step=".05" value={environment.intensity} onChange={e=>setEnvironment(v=>({...v,intensity:+e.target.value}))}/></label>
          <label>Horizon glow <b>{Math.round(environment.horizon*100)}%</b><input type="range" min="0" max="1" step=".01" value={environment.horizon} onChange={e=>setEnvironment(v=>({...v,horizon:+e.target.value}))}/></label>
          <label className="environment-check"><input type="checkbox" checked={environment.stars} onChange={e=>setEnvironment(v=>({...v,stars:e.target.checked}))}/> Show stars</label>
          <div className="world-divider"><span>GEOMETRIC FABRIC</span><label className="environment-check"><input type="checkbox" checked={environment.fabric} onChange={e=>setEnvironment(v=>({...v,fabric:e.target.checked}))}/> Enable 3D fabric field</label></div>
          <label>Fabric scale <b>{environment.fabricScale.toFixed(2)}×</b><input type="range" min="0.45" max="2.2" step=".05" value={environment.fabricScale} onChange={e=>setEnvironment(v=>({...v,fabricScale:+e.target.value}))}/></label>
          <label>Fabric opacity <b>{Math.round(environment.fabricOpacity*100)}%</b><input type="range" min="0" max="0.8" step=".01" value={environment.fabricOpacity} onChange={e=>setEnvironment(v=>({...v,fabricOpacity:+e.target.value}))}/></label>
          <label>Fabric glow <b>{Math.round(environment.fabricGlow*100)}%</b><input type="range" min="0" max="1" step=".01" value={environment.fabricGlow} onChange={e=>setEnvironment(v=>({...v,fabricGlow:+e.target.value}))}/></label>
          <p className="environment-note">A connected 3D terrain grid with rolling peaks, valleys, cross-lines and alternating triangular topology — not a flat repeating pattern. Adjust visibility, scale, opacity and glow.</p>
        </div> : tab==='layers' ? <div className="layer-panel">
          <div className="panel-heading"><div><span className="eyebrow">SCENE CONTENT</span><strong>Layers <em>{layers.length}</em></strong></div><button className="add-btn" onClick={()=>fileRef.current?.click()}><Plus size={15}/> Add</button></div>
          {layers.length===0 ? <div className="layer-empty"><Layers3 size={22}/><b>No layers yet</b><span>Import transparent PNGs, artwork or video clips.</span><button onClick={()=>fileRef.current?.click()}><Upload size={14}/> Import artwork</button></div> :
            <div className="layer-list">{[...layers].reverse().map(layer=><div className={'layer-row '+(selectedId===layer.id?'selected':'')} key={layer.id} onClick={()=>{setSelectedId(layer.id);setTab('properties');}}>
              <div className="layer-thumb">{layer.isVideo?<Film size={18}/>:<img src={layer.url} alt=""/>}</div><div className="layer-info"><b>{layer.name}</b><small>{layer.isVideo?'VIDEO · ':'IMAGE · '}Z {layer.z.toFixed(2)} · {layer.locked?'Locked':'Editable'}</small></div>
              <button title="Toggle visibility" onClick={e=>{e.stopPropagation();updateLayer(layer.id,{visible:!layer.visible});}}>{layer.visible?<Eye size={15}/>:<EyeOff size={15}/>}</button>
              <button title="Lock layer" onClick={e=>{e.stopPropagation();updateLayer(layer.id,{locked:!layer.locked});}}>{layer.locked?<Lock size={14}/>:<Unlock size={14}/>}</button><button className="layer-delete-btn" title={'Delete '+layer.name} aria-label={'Delete '+layer.name} onClick={e=>{e.stopPropagation();removeLayer(layer.id);}}><Trash2 size={14}/></button>
            </div>)}</div>}
        </div> : <div className="properties-panel">{selected ? <>
          <div className="panel-heading"><div><span className="eyebrow">SELECTED LAYER</span><strong>{selected.name}</strong></div><button className="danger-icon" title="Delete layer" onClick={()=>removeLayer(selected.id)}><Trash2 size={16}/></button></div>
          <label className="layer-name-field">Layer name<input type="text" value={selected.name} maxLength={64} onChange={e=>updateSelected({name:e.target.value})} placeholder="Name this layer"/></label>
          {selected.textContent!==undefined && <section className="text-editor-card">
            <div className="world-divider"><span>TEXT EDITOR</span></div>
            <label>Text<textarea rows={3} value={selected.textContent} onChange={e=>updateTextLayer({textContent:e.target.value})} placeholder="Type your text"/></label>
            <label>Font<select value={selected.textFont??'Arial'} onChange={e=>updateTextLayer({textFont:e.target.value})}><option>Arial</option><option>Georgia</option><option>Times New Roman</option><option>Verdana</option><option>Trebuchet MS</option><option>Courier New</option></select></label>
            <label>Size <b>{selected.textSize??96}px</b><input type="range" min="24" max="180" step="2" value={selected.textSize??96} onChange={e=>updateTextLayer({textSize:+e.target.value})}/></label>
            <label>Text colour <input type="color" value={selected.textColor??'#ffffff'} onChange={e=>updateTextLayer({textColor:e.target.value})}/></label>
            <div className="text-style-row"><button type="button" className={selected.textBold?'selected':''} onClick={()=>updateTextLayer({textBold:!selected.textBold})}><b>B</b></button><button type="button" className={selected.textItalic?'selected':''} onClick={()=>updateTextLayer({textItalic:!selected.textItalic})}><i>I</i></button><select value={selected.textAlign??'center'} onChange={e=>updateTextLayer({textAlign:e.target.value as 'left'|'center'|'right'})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>
            <label>Outline colour <input type="color" value={selected.textStroke??'#000000'} onChange={e=>updateTextLayer({textStroke:e.target.value})}/></label>
            <label>Outline width <b>{selected.textStrokeWidth??0}</b><input type="range" min="0" max="12" step="1" value={selected.textStrokeWidth??0} onChange={e=>updateTextLayer({textStrokeWidth:+e.target.value})}/></label>
          </section>}
          <label>Position X <b>{selected.x.toFixed(2)}</b><input type="range" min="-3" max="3" step=".01" value={selected.x} onChange={e=>updateSelected({x:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <label>Position Y <b>{selected.y.toFixed(2)}</b><input type="range" min="-5" max="5" step=".01" value={selected.y} onChange={e=>updateSelected({y:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <label>Depth (Z) <b>{selected.z.toFixed(2)}</b><input type="range" min="-8" max="8" step=".05" value={selected.z} onChange={e=>updateSelected({z:+e.target.value})} onPointerUp={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
          <div className="depth-presets" aria-label="Layer depth presets">
            <button type="button" onClick={()=>setSelectedDepth(-8)}>Background</button>
            <button type="button" onClick={()=>setSelectedDepth(0)}>Midground</button>
            <button type="button" onClick={()=>setSelectedDepth(8)}>Foreground</button>
          </div><p className="depth-help">Negative Z = farther behind · Positive Z = closer to camera.</p>
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
            <div className="motion-copy-box">
              <b>Motion transfer</b>
              <small>Copy the selected layer's timeline animation, select another layer, then paste. Its image and starting position are preserved.</small>
              <button type="button" className="wide-secondary" onClick={copySelectedMotion}>Copy motion · {keyframes.filter(frame=>frame.layers[selected.id]).length} keyframes</button>
              <button type="button" className="wide-secondary" disabled={!motionClipboard||motionClipboard.sourceId===selected.id} onClick={()=>pasteMotionToLayers([selected.id])}>Paste motion to this layer</button>
              <button type="button" className="wide-secondary" disabled={!motionClipboard||layers.every(layer=>layer.id===motionClipboard?.sourceId)} onClick={()=>pasteMotionToLayers(layers.filter(layer=>layer.id!==motionClipboard?.sourceId).map(layer=>layer.id))}>Paste to all other layers</button>
              {motionClipboard&&<small className="motion-clipboard-state">Clipboard: {motionClipboard.sourceName} · {motionClipboard.points.length} keyframes</small>}
              {motionStatus&&<small className="motion-clipboard-state" role="status">{motionStatus}</small>}
            </div>
          </div>
          <div className="camera-control-card"><div><Camera size={14}/> Camera framing</div>
            <label>Horizontal <b>{animatedCamera.x.toFixed(2)}</b><input type="range" min="-6" max="6" step=".02" value={animatedCamera.x} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({x:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
            <label>Vertical <b>{animatedCamera.y.toFixed(2)}</b><input type="range" min="-6" max="6" step=".02" value={animatedCamera.y} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({y:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
            <label>Camera zoom <b>{animatedCamera.zoom.toFixed(2)}×</b><input type="range" min=".25" max="5" step=".01" value={animatedCamera.zoom} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({zoom:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <label>Camera distance <b>{(animatedCamera.z??20).toFixed(1)}</b><input type="range" min="4" max="60" step=".1" value={animatedCamera.z??20} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({z:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <label>Camera pan X <b>{animatedCamera.x.toFixed(2)}</b><input type="range" min="-12" max="12" step=".02" value={animatedCamera.x} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({x:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <label>Camera pan Y <b>{animatedCamera.y.toFixed(2)}</b><input type="range" min="-12" max="12" step=".02" value={animatedCamera.y} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({y:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <label>Camera orbit · horizontal <b>{(animatedCamera.yaw??0).toFixed(0)}°</b><input type="range" min="-45" max="45" step=".5" value={animatedCamera.yaw??0} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({yaw:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <label>Camera orbit · vertical <b>{(animatedCamera.pitch??0).toFixed(0)}°</b><input type="range" min="-35" max="35" step=".5" value={animatedCamera.pitch??0} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({pitch:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <label>Camera roll <b>{(animatedCamera.roll??0).toFixed(0)}°</b><input type="range" min="-180" max="180" step="1" value={animatedCamera.roll??0} onPointerDown={beginCameraEdit} onChange={e=>updateCamera({roll:+e.target.value})} onPointerUp={commitCurrentKeyframe} onPointerCancel={commitCurrentKeyframe} onKeyUp={commitCurrentKeyframe}/></label>
             <button type="button" className="wide-secondary" onClick={()=>{recordHistory();setCameraTransform({x:0,y:0,zoom:1,z:20,roll:0,yaw:0,pitch:0});setLiveEditTime(null);commitCurrentKeyframe();}}>Reset camera framing</button></div>
          <button className="wide-secondary mask-open-btn" onClick={()=>setMaskLayerId(selected.id)}><Scan size={14}/> Open manual mask editor</button><button className="wide-secondary" onClick={()=>duplicateLayer(selected)}><Copy size={14}/> Duplicate layer</button>
        </> : <div className="layer-empty"><SlidersHorizontal size={22}/><b>No layer selected</b><span>Select a layer to edit its transforms.</span></div>}</div>}
        <div className="inspector-footer"><span className="live-dot"/> Drag layers in the canvas to reposition</div>
      </aside>
    </div>
    {settingsOpen && <div className="mask-overlay" role="dialog" aria-modal="true" aria-label="PARALLAX settings"><div className="mask-dialog settings-dialog"><div className="mask-header"><div><span className="eyebrow">WORKSPACE</span><strong>Settings</strong></div><button className="mask-close" onClick={()=>setSettingsOpen(false)} aria-label="Close settings">×</button></div><label className="environment-check"><input type="checkbox" checked={autosaveEnabled} onChange={e=>setAutosaveEnabled(e.target.checked)}/> Automatically save recovery copy on this device</label><p className="environment-note">Your scene and imported artwork are saved privately in this browser using IndexedDB. Autosave helps restore your work if the tab reloads.</p><button className="wide-secondary" onClick={()=>{void clearRecovery().then(()=>alert("Local recovery copy cleared." )).catch(()=>alert("Could not clear local recovery copy."));}}>Clear local recovery copy</button><div className="mask-footer"><span>PARALLAX 2.5 · Local workspace</span><button className="mask-apply" onClick={()=>setSettingsOpen(false)}>Done</button></div></div></div>}
    {maskLayerId && layers.find(layer=>layer.id===maskLayerId) && <MaskEditor src={layers.find(layer=>layer.id===maskLayerId)!.url} name={layers.find(layer=>layer.id===maskLayerId)!.name} onApply={blob=>applyMask(maskLayerId,blob)} onClose={()=>setMaskLayerId(null)}/>}
    <Library open={libraryOpen} onClose={()=>setLibraryOpen(false)} captureScene={captureLibraryScene} onOpenScene={(payload)=>{const file=new File([JSON.stringify(payload)],(payload.projectName||'saved-scene')+'.parallax.json',{type:'application/json'});void loadProject(file);setLibraryOpen(false);}}/>
    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden onChange={e=>{importFiles(e.target.files);e.target.value='';}}/><input ref={slotFileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden onChange={e=>{const file=e.target.files?.[0];if(file&&pendingSlot!==null)uploadToSlot(pendingSlot,file);setPendingSlot(null);e.target.value='';}}/><input ref={projectFileRef} type="file" accept=".json,.parallax.json,application/json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void loadProject(file);e.target.value='';}}/>
  </main>;
}