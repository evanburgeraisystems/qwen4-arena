/* ASCENT — a 20.0s kinetic brand film. Self-contained: 2D canvas + WebAudio score.
   window.__film = { start(), stop(), state } — records canvas+audio to webm and POSTs it. */
'use strict';

const W = 1280, H = 720, DUR = 20, FPS_SHUTTER = 24;
const cv = document.getElementById('stage');
const ctx = cv.getContext('2d');

/* ---------- deterministic rng ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const R = mulberry32(20261116);

/* ---------- helpers ---------- */
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const easeOutExpo=t=>t>=1?1:1-Math.pow(2,-10*t);
const easeInCubic=t=>t*t*t;
const easeInOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const TAU=Math.PI*2;
function hash(n){const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s);}

const COL={bg0:'#02040a',bg1:'#0a1630',cyan:'#38e1ff',cyanDim:'#1a7fa8',gold:'#f2b84b',white:'#f4f7fb',navy:'#122448'};

/* ---------- static overlays ---------- */
const grain=document.createElement('canvas');grain.width=grain.height=180;
{const g=grain.getContext('2d'),id=g.createImageData(180,180),rr=mulberry32(7);
 for(let i=0;i<id.data.length;i+=4){const v=rr()*255|0;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255;}
 g.putImageData(id,0,0);}
const vign=document.createElement('canvas');vign.width=W;vign.height=H;
{const g=vign.getContext('2d');const rg=g.createRadialGradient(W/2,H/2,H*.32,W/2,H/2,H*.85);
 rg.addColorStop(0,'rgba(0,0,0,0)');rg.addColorStop(1,'rgba(0,0,0,0.62)');g.fillStyle=rg;g.fillRect(0,0,W,H);}
const scanTile=document.createElement('canvas');scanTile.width=4;scanTile.height=3;
{const g=scanTile.getContext('2d');g.fillStyle='rgba(0,0,0,0.22)';g.fillRect(0,0,4,1);}
const scanPat=ctx.createPattern(scanTile,'repeat');

/* ---------- particles ---------- */
const PARTS=[];
for(let i=0;i<230;i++){
  const z=0.3+R()*0.7;
  PARTS.push({x:R()*W,y:H*0.25+R()*H*0.95,z,ph:R()*TAU,
    gold:R()<0.12,w:0.8+z*1.8});
}

/* ---------- mountain shards (2-level subdivision of a peak triangle) ---------- */
function mid(a,b){return[(a[0]+b[0])/2,(a[1]+b[1])/2];}
function subdivide(tri){const[a,b,c]=tri,ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
  return[[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];}
const SHARDS=[];
{
  const apex=[0,-225],bl=[-250,165],br=[250,165];
  let tris=subdivide([apex,bl,br]);
  tris=tris.flatMap(subdivide);
  const rr=mulberry32(42);
  tris.forEach((tri,i)=>{
    const cx=(tri[0][0]+tri[1][0]+tri[2][0])/3, cy=(tri[0][1]+tri[1][1]+tri[2][1])/3;
    const rel=tri.map(p=>[(p[0]-cx)*0.9,(p[1]-cy)*0.9]);
    const hN=clamp((cy+225)/390,0,1);            // 0 apex → 1 base
    const ang=rr()*TAU, dist=340+rr()*460;
    const gold=(i===2||i===9||i===13);
    SHARDS.push({cx,cy,rel,gold,
      delay:0.15+hN*1.5+rr()*0.35,               // apex first, flanks follow
      sx:cx+Math.cos(ang)*dist, sy:cy+Math.sin(ang)*dist,
      rot:(rr()-0.5)*3.4, dur:1.05+rr()*0.3});
  });
}
const CHEV=[[-64,-252],[0,-308],[64,-252]];
const CHEV_LEN=158;

/* ---------- type ---------- */
const WORD='ASCENT';
const TYPE_T0=13.15, TYPE_STAG=0.5, SLAM_DUR=0.22;
const FONT_BIG='900 150px "Arial Black","Segoe UI",Arial,sans-serif';
const FONT_MONO='600 17px ui-monospace,"Cascadia Mono",Consolas,monospace';
ctx.font=FONT_BIG;
const LWIDTH=[...WORD].map(ch=>ctx.measureText(ch).width);
const TRACK=30;
const WORD_W=LWIDTH.reduce((a,b)=>a+b,0)+TRACK*(WORD.length-1);

/* ---------- audio ---------- */
let audio=null;
function buildAudio(){
  const AC=window.AudioContext||window.webkitAudioContext;
  const ac=new AC();
  const master=ac.createGain();master.gain.value=0.9;
  const comp=ac.createDynamicsCompressor();
  comp.threshold.value=-16;comp.ratio.value=6;
  const dest=ac.createMediaStreamDestination();
  master.connect(comp);comp.connect(dest);comp.connect(ac.destination);
  const t0=ac.currentTime+0.1;

  /* noise buffer */
  const nb=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate);
  const nd=nb.getChannelData(0);const rr=mulberry32(99);
  for(let i=0;i<nd.length;i++)nd[i]=rr()*2-1;

  /* rising detuned-saw pad through a sweeping lowpass */
  const filt=ac.createBiquadFilter();filt.type='lowpass';filt.Q.value=0.9;
  filt.frequency.setValueAtTime(150,t0);
  filt.frequency.exponentialRampToValueAtTime(3600,t0+13);
  filt.frequency.exponentialRampToValueAtTime(850,t0+18.6);
  const padG=ac.createGain();
  padG.gain.setValueAtTime(0.0001,t0);
  padG.gain.exponentialRampToValueAtTime(0.05,t0+3.2);
  padG.gain.setValueAtTime(0.05,t0+17.5);
  padG.gain.exponentialRampToValueAtTime(0.0001,t0+19.9);
  padG.connect(filt);filt.connect(master);
  [55,110,164.81,220,329.63,440].forEach((f,i)=>{
    [-7,7].forEach(det=>{
      const o=ac.createOscillator();o.type='sawtooth';o.frequency.value=f;o.detune.value=det;
      const g=ac.createGain();g.gain.value=i<2?0.5:0.3;
      o.connect(g);g.connect(padG);o.start(t0);o.stop(t0+20.1);
    });
  });

  /* sub pulse @100 BPM (0.6s) from 3s */
  for(let tt=3;tt<19.3;tt+=0.6){
    const o=ac.createOscillator();o.type='sine';
    o.frequency.setValueAtTime(52,t0+tt);
    o.frequency.exponentialRampToValueAtTime(38,t0+tt+0.3);
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t0+tt);
    g.gain.exponentialRampToValueAtTime(0.3,t0+tt+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+tt+0.42);
    o.connect(g);g.connect(master);o.start(t0+tt);o.stop(t0+tt+0.5);
  }

  /* noise riser into the type slam */
  {
    const s=ac.createBufferSource();s.buffer=nb;s.loop=true;
    const bp=ac.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.2;
    bp.frequency.setValueAtTime(280,t0+10.6);
    bp.frequency.exponentialRampToValueAtTime(6200,t0+13.14);
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t0+10.6);
    g.gain.exponentialRampToValueAtTime(0.17,t0+13.13);
    g.gain.linearRampToValueAtTime(0,t0+13.16);
    s.connect(bp);bp.connect(g);g.connect(master);
    s.start(t0+10.6);s.stop(t0+13.2);
  }

  /* impact booms — one per letter slam */
  function boom(at,big){
    const o=ac.createOscillator();o.type='sine';
    o.frequency.setValueAtTime(big?170:150,t0+at);
    o.frequency.exponentialRampToValueAtTime(40,t0+at+0.3);
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t0+at);
    g.gain.exponentialRampToValueAtTime(big?0.65:0.42,t0+at+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+at+0.55);
    o.connect(g);g.connect(master);o.start(t0+at);o.stop(t0+at+0.6);
    const s=ac.createBufferSource();s.buffer=nb;
    const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=900;
    const ng=ac.createGain();
    ng.gain.setValueAtTime(big?0.3:0.2,t0+at);
    ng.gain.exponentialRampToValueAtTime(0.0001,t0+at+0.2);
    s.connect(lp);lp.connect(ng);ng.connect(master);
    s.start(t0+at);s.stop(t0+at+0.25);
  }
  for(let i=0;i<WORD.length;i++)boom(TYPE_T0+i*TYPE_STAG,i===0);

  /* airy shimmer for the lockup */
  [1318.5,1760,2637].forEach((f,i)=>{
    const o=ac.createOscillator();o.type='sine';o.frequency.value=f;
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t0+17);
    g.gain.exponentialRampToValueAtTime(0.022/(i+1),t0+17.4);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+19.6);
    o.connect(g);g.connect(master);o.start(t0+17);o.stop(t0+19.7);
  });

  /* faint air bed */
  {
    const s=ac.createBufferSource();s.buffer=nb;s.loop=true;
    const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=420;
    const g=ac.createGain();g.gain.value=0.014;
    s.connect(lp);lp.connect(g);g.connect(master);
    s.start(t0);s.stop(t0+20);
  }
  return{ac,dest,master};
}

/* ---------- scene pieces ---------- */
function drawBackground(t){
  const g=ctx.createLinearGradient(0,0,0,H);
  const warm=smooth((t-8)/4)*0.5;
  g.addColorStop(0,'#020409');
  g.addColorStop(0.55,`rgba(${8+warm*10|0},${16+warm*14|0},${40+warm*18|0},1)`);
  g.addColorStop(1,'#04070f');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  /* cyan aurora glow behind the peak, grows with assembly */
  const a=smooth((t-7.6)/3)*(1-smooth((t-18.6)/1.2));
  if(a>0){
    const rg=ctx.createRadialGradient(640,330,20,640,330,560);
    rg.addColorStop(0,`rgba(56,225,255,${0.16*a})`);
    rg.addColorStop(0.5,`rgba(24,90,160,${0.1*a})`);
    rg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=rg;ctx.fillRect(0,0,W,H);
  }
}

function drawHorizon(t){
  const a=(1-smooth((t-3)/0.7));
  if(a<=0||t<0.3)return;
  const u=easeInOut(clamp((t-0.35)/1.9,0,1));
  const half=470*u, y=500;
  ctx.save();ctx.globalAlpha=a;
  ctx.strokeStyle=COL.cyan;ctx.lineWidth=1.6;
  ctx.shadowColor=COL.cyan;ctx.shadowBlur=14;
  ctx.beginPath();ctx.moveTo(640-half,y);ctx.lineTo(640+half,y);ctx.stroke();
  ctx.shadowBlur=0;
  /* endpoint ticks */
  if(u>0.98){ctx.fillStyle=COL.gold;
    ctx.fillRect(640-half-3,y-5,3,10);ctx.fillRect(640+half,y-5,3,10);}
  /* mono caption, typed on */
  const cap='SIGNAL ACQUIRED';
  const n=Math.floor(clamp((t-1.15)/1.3,0,1)*cap.length);
  ctx.font=FONT_MONO;ctx.textBaseline='middle';ctx.fillStyle='rgba(220,235,250,0.92)';
  let x=640-(cap.length*15)/2;
  for(let i=0;i<n;i++){ctx.fillText(cap[i],x,y+42);x+=15;}
  if(t<3&&Math.floor(t*2.4)%2===0&&n<cap.length){ctx.fillStyle=COL.cyan;ctx.fillRect(x+1,y+34,9,17);}
  ctx.restore();
}

function drawParticles(t,camX){
  const env=smooth((t-3)/0.8)*(1-smooth((t-11.4)/1.6));
  if(env<=0)return;
  const dim=t>8?0.55:1;
  const u=clamp((t-3)/5,0,1.35);
  const vel=2.1*Math.pow(Math.max(u,0.02),1.1)*980/5; // px/s
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  for(const p of PARTS){
    const x=p.x+Math.sin(t*0.5+p.ph)*12*p.z+camX*(p.z-0.6)*46;
    const len=clamp(vel*p.z*0.055,3,64);
    const al=env*dim*(0.25+p.z*0.55);
    const col=p.gold?'242,184,75':'120,225,255';
    /* shutter ghosts at previous 24fps positions = motion-blur trails (pure in t) */
    for(let g=2;g>=0;g--){
      const tg=t-g/FPS_SHUTTER;
      const ug=clamp((tg-3)/5,0,1.35);
      let y=p.y-Math.pow(ug,2.1)*980*p.z;
      y=((y%H)+H)%H;
      const ga=al*(g===0?1:g===1?0.38:0.16);
      ctx.strokeStyle=`rgba(${col},${ga})`;
      ctx.lineWidth=p.w*(g===0?1:0.8);
      ctx.beginPath();ctx.moveTo(x,y+len);ctx.lineTo(x,y);ctx.stroke();
      /* chromatic fringe on the bright depth layer */
      if(g===0&&p.z>0.62){
        ctx.strokeStyle=`rgba(255,90,90,${al*0.35})`;
        ctx.lineWidth=p.w*0.8;
        ctx.beginPath();ctx.moveTo(x+2.5,y+len);ctx.lineTo(x+2.5,y);ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function shardColor(s){
  if(s.gold)return COL.gold;
  const hN=clamp((s.cy+225)/390,0,1);
  const r=lerp(56,18,hN)|0,g=lerp(225,60,hN)|0,b=lerp(255,120,hN)|0;
  return`rgb(${r},${g},${b})`;
}

function drawMountain(t,cx,cy,scale,alpha){
  if(alpha<=0)return;
  ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  for(const s of SHARDS){
    const u=easeOutExpo(clamp((t-8.1-s.delay)/s.dur,0,1));
    if(u<=0)continue;
    const x=lerp(s.sx,s.cx,u),y=lerp(s.sy,s.cy,u),rot=s.rot*(1-u);
    const breathe=t>12?Math.sin(t*1.7+s.cx*0.02)*1.6*(1-smooth((t-13)/1)):0;
    ctx.save();ctx.translate(x,y+breathe);ctx.rotate(rot);
    ctx.beginPath();ctx.moveTo(s.rel[0][0],s.rel[0][1]);
    ctx.lineTo(s.rel[1][0],s.rel[1][1]);ctx.lineTo(s.rel[2][0],s.rel[2][1]);ctx.closePath();
    ctx.fillStyle=shardColor(s);
    ctx.shadowColor=s.gold?COL.gold:COL.cyan;
    ctx.shadowBlur=18*u*(t<13?1:0.5);
    ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(2,6,14,0.85)';ctx.lineWidth=2;ctx.stroke();
    ctx.restore();
  }
  /* gold chevron draws on above the peak */
  const cu=easeInOut(clamp((t-11.2)/1.1,0,1));
  if(cu>0){
    ctx.strokeStyle=COL.gold;ctx.lineWidth=9;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.shadowColor=COL.gold;ctx.shadowBlur=16;
    ctx.setLineDash([CHEV_LEN]);ctx.lineDashOffset=CHEV_LEN*(1-cu);
    ctx.beginPath();ctx.moveTo(CHEV[0][0],CHEV[0][1]);
    ctx.lineTo(CHEV[1][0],CHEV[1][1]);ctx.lineTo(CHEV[2][0],CHEV[2][1]);ctx.stroke();
    ctx.setLineDash([]);ctx.shadowBlur=0;
  }
  ctx.restore();
}

function drawWord(t,scale,cy,alpha,glow){
  if(alpha<=0)return;
  ctx.save();ctx.globalAlpha=alpha;
  ctx.font=FONT_BIG;ctx.textBaseline='middle';
  let x=640-WORD_W*scale/2;
  for(let i=0;i<WORD.length;i++){
    const Ti=TYPE_T0+i*TYPE_STAG;
    const w=LWIDTH[i]*scale, cxL=x+w/2;
    x+=w+TRACK*scale;
    if(t<Ti)continue;
    const u=clamp((t-Ti)/SLAM_DUR,0,1);
    const sc=u<1?lerp(3,1,easeInCubic(u)):1;
    const la=u<1?clamp(u*2.2,0,1):1;
    ctx.save();ctx.translate(cxL,cy);ctx.scale(sc*scale,sc*scale); // slam scale around letter center
    /* chromatic double-image right after impact */
    const since=t-Ti;
    if(since<0.18&&u>=1){
      const ca=(1-since/0.18)*0.5;
      ctx.globalAlpha=alpha*ca;ctx.fillStyle='#ff5a5a';ctx.fillText(WORD[i],-LWIDTH[i]/2-4,0);
      ctx.fillStyle=COL.cyan;ctx.fillText(WORD[i],-LWIDTH[i]/2+4,0);
      ctx.globalAlpha=alpha;
    }
    ctx.fillStyle=COL.white;
    ctx.shadowColor=COL.cyan;ctx.shadowBlur=glow*(u<1?34:16);
    ctx.fillText(WORD[i],-LWIDTH[i]/2,0);
    ctx.restore();
  }
  ctx.restore();
}

function drawScanSweep(t){
  if(t<13||t>17.4)return;
  const a=(1-smooth((t-16.9)/0.5))*smooth((t-13)/0.3);
  ctx.save();ctx.globalAlpha=a;
  ctx.fillStyle=scanPat;ctx.fillRect(0,54,W,H-108);
  const sy=54+((t-13)/1.15%1)*(H-108);
  const g=ctx.createLinearGradient(0,sy-46,0,sy+46);
  g.addColorStop(0,'rgba(120,225,255,0)');
  g.addColorStop(0.5,'rgba(160,235,255,0.12)');
  g.addColorStop(1,'rgba(120,225,255,0)');
  ctx.fillStyle=g;ctx.fillRect(0,sy-46,W,92);
  ctx.restore();
}

function drawMeta(t){
  const a=0.4*smooth(t/0.8)*(1-smooth((t-12.6)/0.8));
  if(a<=0)return;
  ctx.save();ctx.globalAlpha=a;ctx.font='500 13px ui-monospace,Consolas,monospace';
  ctx.fillStyle='#9fb8d8';ctx.textBaseline='middle';
  ctx.fillText('ASCENT // T+'+t.toFixed(2).padStart(5,'0'),70,92);
  ctx.fillText('1280×720 · 24FPS',70,112);
  ctx.textAlign='right';ctx.fillText('QWEN4-MAX',W-70,92);ctx.textAlign='left';
  ctx.restore();
}

/* ---------- master render ---------- */
function render(tRaw){
  const t=Math.min(tRaw,DUR);
  const tq=Math.floor(t*FPS_SHUTTER)/FPS_SHUTTER;      // 24fps shutter cadence
  const frame=Math.floor(t*FPS_SHUTTER);

  /* impact shake + flash */
  let shake=0,flash=0;
  for(let i=0;i<WORD.length;i++){
    const Ti=TYPE_T0+i*TYPE_STAG, d=t-Ti;
    if(d>=0&&d<0.6){shake+=(i===0?15:10)*Math.exp(-d*9);flash+=(i===0?0.4:0.26)*Math.exp(-d*11);}
  }
  const sx=(hash(frame*3+1)-0.5)*2*shake, sy=(hash(frame*3+2)-0.5)*2*shake;
  const driftX=Math.sin(t*0.33)*9, driftY=Math.cos(t*0.27)*6;
  const zoom=1.03+0.02*Math.sin(t*0.21)+smooth((t-13)/4)*0.015;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  drawBackground(t);

  ctx.save();
  ctx.translate(W/2+sx+driftX,H/2+sy+driftY);ctx.scale(zoom,zoom);ctx.translate(-W/2,-H/2);
  drawHorizon(tq);
  drawParticles(tq,driftX);
  /* mountain: full motif 8–13, then lifts into logo mark */
  const mk=smooth((t-13)/0.7);
  const mScale=lerp(1,0.42,mk), mY=lerp(400,238,mk), mA=1-smooth((t-18.9)/0.9);
  drawMountain(tq,640,mY,mScale,mA*(t<8?0:1));
  /* ASCENT slams 13–17, then settles into lockup */
  const lk=smooth((t-17)/1.2);
  const wScale=lerp(1,0.6,lk), wAlpha=(t<TYPE_T0?0:1)*(1-smooth((t-18.9)/0.9));
  drawWord(tq,wScale,lerp(430,424,lk),wAlpha,1);
  /* tagline under lockup */
  if(lk>0){
    ctx.save();ctx.globalAlpha=lk*(1-smooth((t-18.9)/0.9));
    ctx.font=FONT_MONO;ctx.textBaseline='middle';ctx.fillStyle=COL.gold;
    const tag='RISE ABOVE THE NOISE';
    ctx.fillText(tag,640-tag.length*15/2,512);
    ctx.restore();
  }
  ctx.restore();

  drawScanSweep(t);
  drawMeta(t);

  /* impact flash */
  if(flash>0.003){ctx.fillStyle=`rgba(235,245,255,${clamp(flash,0,0.5)})`;ctx.fillRect(0,0,W,H);}

  /* fade to black 18.9–19.8 */
  const fade=smooth((t-18.9)/0.9);
  if(fade>0){ctx.fillStyle=`rgba(0,0,0,${fade})`;ctx.fillRect(0,0,W,H);}

  /* end tag — survives on the held final frame */
  const tagA=smooth((t-19.25)/0.6);
  if(tagA>0){
    ctx.save();ctx.globalAlpha=tagA*0.85;ctx.font='500 14px ui-monospace,Consolas,monospace';
    ctx.textBaseline='middle';ctx.fillStyle='#8fa8c8';
    const tag='QWEN4-MAX // 2026';
    ctx.fillText(tag,640-tag.length*9.5/2,628);
    ctx.restore();
  }

  /* letterbox */
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,54);ctx.fillRect(0,H-54,W,54);

  /* grain (frozen on hold) + vignette */
  const gx=(frame*37)%180, gy=(frame*61)%180;
  ctx.save();ctx.globalAlpha=0.07;ctx.globalCompositeOperation='overlay';
  for(let x=-gx;x<W;x+=180)for(let y=-gy;y<H;y+=180)ctx.drawImage(grain,x,y);
  ctx.restore();
  ctx.drawImage(vign,0,0);
}

/* ---------- clock ---------- */
const q=new URLSearchParams(location.search);
const FREEZE=q.get('t')!==null?clamp(parseFloat(q.get('t'))||0,0,DUR):null; /* deterministic still for verification */
let t0=performance.now()-(FREEZE!==null?FREEZE*1000:0), curT=0, mode='idle', lastRender=0;
function step(now){
  const t=FREEZE!==null?FREEZE:(now-t0)/1000;
  curT=Math.min(t,DUR);
  render(curT);
  if(capTrack&&mode==='recording'){try{capTrack.requestFrame();}catch(e){}}
  if(FREEZE===null&&mode==='recording'&&t>=DUR+0.35)stop();
}
function rafLoop(now){
  lastRender=performance.now();
  step(now);
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);
/* timer fallback: keeps the film advancing when rAF is throttled
   (headless virtual-time screenshots, background tabs) */
setInterval(()=>{
  if(performance.now()-lastRender>40){lastRender=performance.now();step(performance.now());}
},16);

/* ---------- recording API ---------- */
let recorder=null,chunks=[],capTrack=null;
function pickMime(){
  const c=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
  for(const m of c)if(window.MediaRecorder&&MediaRecorder.isTypeSupported(m))return m;
  return'';
}
async function saveRecording(){
  const blob=new Blob(chunks,{type:'video/webm'});
  chunks=[];
  const dataURL=await new Promise(res=>{const f=new FileReader();f.onload=()=>res(f.result);f.readAsDataURL(blob);});
  try{
    const b64=dataURL.slice(dataURL.indexOf(';base64,')+8);
    const CH=1000000, n=Math.ceil(b64.length/CH);
    for(let i=0;i<n;i++){
      const r=await fetch('/save?root=t2&name=ascent-v2.part'+i,{method:'POST',headers:{'Content-Type':'text/plain'},body:b64.slice(i*CH,(i+1)*CH)});
      if(i<3||i===n-1)console.log('[ASCENT] part',i,r.status,r.url);
      if(r.status!==200)throw new Error('part '+i+' status '+r.status);
    }
    await fetch('/save?root=t2&name=ascent-v2.done',{method:'POST',headers:{'Content-Type':'text/plain'},body:String(n)});
    mode='saved';console.log('[ASCENT] saved ascent-v2 in',n,'parts',blob.size,'bytes');
  }catch(e){mode='save-failed';console.warn('[ASCENT] POST failed (file:// or server down?)',e);}
}
function start(){
  if(mode==='recording'){if(audio&&audio.ac.state==='suspended')audio.ac.resume().catch(()=>{});return;}
  t0=performance.now();curT=0;
  if(audio){try{audio.ac.close();}catch(e){}}
  audio=buildAudio();
  if(audio.ac.state==='suspended')audio.ac.resume().catch(()=>{});
  const vs=cv.captureStream(0);
  capTrack=vs.getVideoTracks()[0];
  const ms=new MediaStream([...vs.getVideoTracks(),...audio.dest.stream.getAudioTracks()]);
  const mime=pickMime();
  recorder=new MediaRecorder(ms,mime?{mimeType:mime,videoBitsPerSecond:8e6,audioBitsPerSecond:192e3}:{videoBitsPerSecond:8e6});
  chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  recorder.onstop=saveRecording;
  recorder.start(250);
  mode='recording';
}
function stop(){
  if(recorder&&recorder.state!=='inactive'){mode='stopping';recorder.stop();}
}
window.__film={start,stop,get state(){return mode;},get time(){return curT;}};

/* audio unlock on first gesture (autoplay policies) */
const unlock=()=>{if(audio&&audio.ac.state==='suspended')audio.ac.resume().catch(()=>{});};
window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);

/* auto-record when driven with ?record=1 */
if(q.get('record')==='1'){
  document.getElementById('rec').style.display='flex';
  start();
}
