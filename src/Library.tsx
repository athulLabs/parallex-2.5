import { useEffect, useMemo, useState } from 'react';
import { Archive, Film, FolderPlus, FolderOpen, Plus, Trash2, X, ChevronUp, ChevronDown, Play, Save } from 'lucide-react';

type SceneRecord = { id:string; name:string; createdAt:number; updatedAt:number; payload:any };
type ProjectRecord = { id:string; name:string; createdAt:number; updatedAt:number; sceneIds:string[]; durations:Record<string,number> };
type Props = { open:boolean; onClose:()=>void; captureScene:()=>Promise<any>; onOpenScene:(payload:any)=>void };

const DB_NAME='parallax-content-library';
const DB_VERSION=1;
const SCENES='keyframe-videos';
const PROJECTS='video-projects';
const makeId=()=>Math.random().toString(36).slice(2,10);

function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(SCENES))db.createObjectStore(SCENES,{keyPath:'id'});if(!db.objectStoreNames.contains(PROJECTS))db.createObjectStore(PROJECTS,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function all<T>(store:string):Promise<T[]>{
  const db=await openDb();const result=await new Promise<T[]>((resolve,reject)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();return result;
}
async function put(store:string,value:any):Promise<void>{
  const db=await openDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
}
async function remove(store:string,id:string):Promise<void>{
  const db=await openDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
}

export default function Library({open,onClose,captureScene,onOpenScene}:Props){
  const [tab,setTab]=useState<'scenes'|'projects'>('scenes');
  const [scenes,setScenes]=useState<SceneRecord[]>([]);
  const [projects,setProjects]=useState<ProjectRecord[]>([]);
  const [activeProject,setActiveProject]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [projectName,setProjectName]=useState('Untitled Video Project');
  const [sceneName,setSceneName]=useState('');
  const project=projects.find(item=>item.id===activeProject)??null;
  const orderedScenes=useMemo(()=>project?.sceneIds.map(id=>scenes.find(scene=>scene.id===id)).filter(Boolean) as SceneRecord[]??[],[project,scenes]);

  const refresh=async()=>{try{const [s,p]=await Promise.all([all<SceneRecord>(SCENES),all<ProjectRecord>(PROJECTS)]);setScenes(s.sort((a,b)=>b.updatedAt-a.updatedAt));setProjects(p.sort((a,b)=>b.updatedAt-a.updatedAt));}catch{setMessage('Could not read the local library. Check browser storage permissions.');}};
  useEffect(()=>{if(open)void refresh();},[open]);
  if(!open)return null;

  const saveCurrent=async()=>{
    setBusy(true);setMessage('');
    try{
      const payload=await captureScene();
      const name=String(payload.projectName||'Untitled Scene').trim()||'Untitled Scene';
      const record:SceneRecord={id:makeId(),name,createdAt:Date.now(),updatedAt:Date.now(),payload};
      await put(SCENES,record);await refresh();setSceneName('');setMessage('Saved editable keyframe video to this device.');
    }catch{setMessage('Save failed. Try again or reduce the size of imported media.');}
    finally{setBusy(false);}
  };
  const createProject=async()=>{
    const record:ProjectRecord={id:makeId(),name:projectName.trim()||'Untitled Video Project',createdAt:Date.now(),updatedAt:Date.now(),sceneIds:[],durations:{}};
    await put(PROJECTS,record);await refresh();setActiveProject(record.id);setTab('projects');setMessage('Project created. Add saved keyframe videos below.');
  };
  const updateProject=async(next:ProjectRecord)=>{await put(PROJECTS,{...next,updatedAt:Date.now()});await refresh();};
  const addScene=(scene:SceneRecord)=>{
    if(!project)return;
    if(project.sceneIds.includes(scene.id)){setMessage('That scene is already in this project.');return;}
    void updateProject({...project,sceneIds:[...project.sceneIds,scene.id],durations:{...project.durations,[scene.id]:Number(scene.payload.duration)||10}});
    setMessage('Scene added to project.');
  };
  const moveScene=(index:number,direction:number)=>{
    if(!project)return;const next=[...project.sceneIds];const target=index+direction;if(target<0||target>=next.length)return;
    [next[index],next[target]]=[next[target],next[index]];void updateProject({...project,sceneIds:next});
  };
  const deleteScene=async(id:string)=>{
    if(!window.confirm('Delete this saved keyframe video? Projects that use it will also remove this clip.'))return;
    await remove(SCENES,id);
    for(const p of projects)if(p.sceneIds.includes(id))await put(PROJECTS,{...p,sceneIds:p.sceneIds.filter(value=>value!==id),updatedAt:Date.now()});
    await refresh();
  };
  const deleteProject=async(id:string)=>{if(!window.confirm('Delete this video project? Saved keyframe videos will remain.'))return;await remove(PROJECTS,id);if(activeProject===id)setActiveProject(null);await refresh();};
  const renameProject=async(name:string)=>{if(project)await updateProject({...project,name});};
  const removeClip=(id:string)=>{if(project)void updateProject({...project,sceneIds:project.sceneIds.filter(value=>value!==id)});};
  const openScene=(scene:SceneRecord)=>onOpenScene(scene.payload);

  return <div className="library-backdrop" role="dialog" aria-modal="true" aria-label="PARALLAX content library">
    <section className="library-window">
      <header className="library-header"><div className="library-brand"><Archive size={19}/><div><b>CONTENT LIBRARY</b><small>Saved locally on this device</small></div></div><button className="library-close" onClick={onClose} aria-label="Close library"><X size={19}/></button></header>
      <nav className="library-tabs"><button className={tab==='scenes'?'active':''} onClick={()=>{setTab('scenes');setActiveProject(null);}}><Film size={15}/> Keyframe Videos <span>{scenes.length}</span></button><button className={tab==='projects'?'active':''} onClick={()=>setTab('projects')}><FolderOpen size={15}/> Video Projects <span>{projects.length}</span></button></nav>
      {tab==='scenes'?<div className="library-content">
        <div className="library-intro"><div><strong>Keyframe Video Library</strong><p>Save each animated scene with its editable layers, keyframes and camera movement.</p></div><button className="library-primary" disabled={busy} onClick={()=>void saveCurrent()}><Save size={15}/>{busy?'Saving…':'Save current scene'}</button></div>
        {scenes.length===0?<div className="library-empty"><Film size={30}/><b>No saved keyframe videos yet</b><span>Build an animation in the editor, then save it here.</span></div>:<div className="library-grid">{scenes.map(scene=><article className="library-card" key={scene.id}><div className="library-card-icon"><Film size={22}/></div><div className="library-card-body"><b>{scene.name}</b><small>{scene.payload.keyframes?.length??0} keyframes · {scene.payload.duration??10}s · {scene.payload.layers?.length??0} layers</small><small>Updated {new Date(scene.updatedAt).toLocaleDateString()}</small></div><div className="library-card-actions"><button onClick={()=>openScene(scene)}><Play size={13}/> Open & edit</button><button className="library-delete" onClick={()=>void deleteScene(scene.id)} aria-label={'Delete '+scene.name}><Trash2 size={14}/></button></div></article>)}</div>}
        <div className="library-create-project"><div><b>Ready to combine scenes?</b><span>Create a video project and add saved keyframe videos in your preferred order.</span></div><button onClick={()=>{setTab('projects');setActiveProject(null);}}><FolderPlus size={15}/> Go to projects</button></div>
      </div>:<div className="library-content projects-content">
        <div className="library-intro"><div><strong>Video Projects</strong><p>Combine saved scenes into an editable multi-clip project. Original scenes remain separate.</p></div></div>
        {!project?<><div className="project-create-row"><input value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="New video project name" placeholder="New project name"/><button className="library-primary" onClick={()=>void createProject()}><Plus size={15}/> Create project</button></div>
          {projects.length>0&&<div className="project-list">{projects.map(p=><article className="project-row" key={p.id}><FolderOpen size={19}/><div><b>{p.name}</b><small>{p.sceneIds.length} clips · Edited {new Date(p.updatedAt).toLocaleDateString()}</small></div><button onClick={()=>setActiveProject(p.id)}>Edit project</button><button className="library-delete" onClick={()=>void deleteProject(p.id)} aria-label={'Delete '+p.name}><Trash2 size={14}/></button></article>)}</div>}
        </>:<><div className="project-editor-heading"><button onClick={()=>setActiveProject(null)}>← All projects</button><input value={project.name} onChange={e=>void renameProject(e.target.value)} aria-label="Project title"/></div>
          <div className="project-timeline-heading"><b>CLIP TIMELINE</b><span>{orderedScenes.length} clips · {orderedScenes.reduce((sum,s)=>sum+(project.durations[s.id]??10),0).toFixed(1)}s total</span></div>
          <div className="project-clips">{orderedScenes.length===0?<div className="library-empty compact">No clips yet. Add saved keyframe videos below.</div>:orderedScenes.map((scene,index)=><article className="project-clip" key={scene.id}><span className="clip-index">{String(index+1).padStart(2,'0')}</span><div className="clip-info"><b>{scene.name}</b><small>{scene.payload.keyframes?.length??0} keyframes · {(project.durations[scene.id]??10).toFixed(1)}s</small></div><label>Duration<input type="number" min="1" max="120" step=".5" value={project.durations[scene.id]??10} onChange={e=>void updateProject({...project,durations:{...project.durations,[scene.id]:Math.max(1,Math.min(120,Number(e.target.value)||1))}})}/></label><button onClick={()=>moveScene(index,-1)} disabled={index===0} aria-label="Move clip up"><ChevronUp size={16}/></button><button onClick={()=>moveScene(index,1)} disabled={index===orderedScenes.length-1} aria-label="Move clip down"><ChevronDown size={16}/></button><button onClick={()=>openScene(scene)} title="Edit original scene"><Play size={14}/></button><button className="library-delete" onClick={()=>removeClip(scene.id)} aria-label="Remove clip"><X size={15}/></button></article>)}</div>
          <div className="add-scenes-heading"><b>ADD SAVED KEYFRAME VIDEOS</b></div>
          {scenes.filter(scene=>!project.sceneIds.includes(scene.id)).length===0?<p className="library-muted">All saved scenes have been added, or save more scenes in the editor.</p>:<div className="add-scenes-list">{scenes.filter(scene=>!project.sceneIds.includes(scene.id)).map(scene=><div key={scene.id}><span><b>{scene.name}</b><small>{scene.payload.keyframes?.length??0} keyframes · {scene.payload.duration??10}s</small></span><button onClick={()=>addScene(scene)}><Plus size={14}/> Add clip</button></div>)}</div>}
        </>}
      </div>}
      {message&&<div className="library-message" role="status">{message}</div>}
      <footer className="library-footer"><span>PARALLAX 2.5 · IndexedDB local storage</span><button onClick={onClose}>Back to editor</button></footer>
    </section>
  </div>;
}
