import { useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Undo2, RotateCcw, Check, X } from 'lucide-react';

type Props = {
  src: string;
  name: string;
  onApply: (blob: Blob) => void;
  onClose: () => void;
};

export default function MaskEditor({ src, name, onApply, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{x:number;y:number}|null>(null);
  const history = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<'erase'|'restore'>('erase');
  const [size, setSize] = useState(48);
  const [historyCount, setHistoryCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const max = 1800;
      const ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      originalRef.current = canvas;
      const target = canvasRef.current;
      if (target) {
        target.width = canvas.width;
        target.height = canvas.height;
        target.getContext('2d')?.drawImage(canvas, 0, 0);
        history.current = [target.getContext('2d')!.getImageData(0,0,target.width,target.height)];
        setHistoryCount(1);
      }
      setReady(true);
    };
    image.src = src;
  }, [src]);

  const saveHistory = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    history.current = [...history.current.slice(-14), ctx.getImageData(0,0,canvas.width,canvas.height)];
    setHistoryCount(history.current.length);
  };
  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height
    };
  };
  const paint = (x:number,y:number,from?:{x:number;y:number}) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.beginPath();
    if (from) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = size; ctx.moveTo(from.x,from.y); ctx.lineTo(x,y);
      if (tool === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.stroke();
      } else {
        const original = originalRef.current;
        if (original) {
          const distance = Math.hypot(x-from.x,y-from.y);
          const steps = Math.max(1,Math.ceil(distance/Math.max(2,size*0.18)));
          for(let i=0;i<=steps;i++){
            const px=from.x+(x-from.x)*i/steps, py=from.y+(y-from.y)*i/steps;
            ctx.save(); ctx.beginPath(); ctx.arc(px,py,size/2,0,Math.PI*2); ctx.clip();
            ctx.globalCompositeOperation='source-over'; ctx.drawImage(original,0,0); ctx.restore();
          }
        }
      }
    } else {
      ctx.arc(x,y,size/2,0,Math.PI*2);
      if (tool === 'erase') {
        ctx.globalCompositeOperation='destination-out'; ctx.fill();
      } else {
        const original = originalRef.current;
        if (original) {
          ctx.clip(); ctx.globalCompositeOperation='source-over'; ctx.drawImage(original,0,0);
        }
      }
    }
    ctx.restore();
  };
  const start = (event:React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    saveHistory();
    drawing.current = true;
    const point = pointFromEvent(event); lastPoint.current = point; paint(point.x,point.y);
  };
  const move = (event:React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    paint(point.x,point.y,lastPoint.current ?? undefined);
    lastPoint.current = point;
  };
  const end = () => { drawing.current=false; lastPoint.current=null; };
  const undo = () => {
    if (history.current.length < 2) return;
    history.current = history.current.slice(0,-1);
    const canvas=canvasRef.current, ctx=canvas?.getContext('2d');
    if(canvas && ctx) ctx.putImageData(history.current[history.current.length-1],0,0);
    setHistoryCount(history.current.length);
  };
  const reset = () => {
    const canvas=canvasRef.current, original=originalRef.current, ctx=canvas?.getContext('2d');
    if(!canvas || !original || !ctx) return;
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(original,0,0);
    history.current=[ctx.getImageData(0,0,canvas.width,canvas.height)]; setHistoryCount(1);
  };
  const apply = () => {
    const canvas=canvasRef.current;
    if(!canvas) return;
    canvas.toBlob(blob => { if(blob) onApply(blob); },'image/png');
  };

  return <div className="mask-overlay" role="dialog" aria-modal="true" aria-label="Manual mask editor">
    <section className="mask-dialog">
      <header className="mask-header"><div><span className="eyebrow">MANUAL CUTOUT WORKSPACE</span><strong>{name}</strong></div><button className="mask-close" onClick={onClose} aria-label="Close"><X size={19}/></button></header>
      <div className="mask-help">Erase unwanted areas or restore parts of the original image. Transparent areas appear as a checkerboard.</div>
      <div className="mask-canvas-wrap">
        {!ready && <span className="mask-loading">Preparing image…</span>}
        <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>
      </div>
      <div className="mask-tools">
        <button className={tool==='erase'?'active':''} onClick={()=>setTool('erase')}><Eraser size={16}/> Erase</button>
        <button className={tool==='restore'?'active':''} onClick={()=>setTool('restore')}><Brush size={16}/> Restore</button>
        <button onClick={undo} disabled={historyCount<2}><Undo2 size={16}/> Undo</button>
        <button onClick={reset}><RotateCcw size={16}/> Reset</button>
      </div>
      <label className="mask-size">Brush size <b>{size}px</b><input type="range" min="8" max="180" step="2" value={size} onChange={e=>setSize(+e.target.value)}/></label>
      <footer className="mask-footer"><span>Edits are non-destructive until applied.</span><button className="mask-apply" onClick={apply} disabled={!ready}><Check size={16}/> Apply mask</button></footer>
    </section>
  </div>;
}
