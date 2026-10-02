// Orbital service infrastructure. Decorative stations/asteroids never create
// floors, colliders, lights, timers or resources beyond the chunk's body/glow meshes.
const STEP = 576;
const point=(f,x,y,z)=>({x:f.x+f.lx*x+f.fx*z,y:f.y+y,z:f.z+f.lz*x+f.fz*z});

function station(b,s,index){
  const side=index%2?-1:1,d=side*185;
  if(b.themeAt(s-65)!=='space'||b.themeAt(s+65)!=='space'||!b.reserve(s,d,123))return;
  const P=b.palette,f=b.frame(s,d,24),body=b.body;
  const box=(x,y,z,w,h,l,col)=>body.col(...col).box(f,x-w/2,x+w/2,y-h/2,y+h/2,z-l/2,z+l/2,{bottom:true});
  // Open segmented docking wheel is the hero silhouette; the asymmetric
  // equipment spine and unequal radiator wings communicate a real purpose.
  const radius=43,segments=16,ringY=29;
  for(let i=0;i<segments;i++){
    const a=i*Math.PI*2/segments,c=(i+1)*Math.PI*2/segments;
    for(const z of [-4,4])b.tube(point(f,Math.cos(a)*radius,ringY+Math.sin(a)*radius,z),point(f,Math.cos(c)*radius,ringY+Math.sin(c)*radius,z),1.5,i%4===0?P.light:P.mid);
    if(i%2===0){
      b.tube(point(f,Math.cos(a)*radius,ringY+Math.sin(a)*radius,-4),point(f,Math.cos(a)*radius,ringY+Math.sin(a)*radius,4),.6,P.dark);
      b.tube(point(f,Math.cos(a)*8,ringY+Math.sin(a)*8,0),point(f,Math.cos(a)*(radius-2),ringY+Math.sin(a)*(radius-2),0),.5,P.dark);
    }
    if(i%4===0)b.tube(point(f,Math.cos(a)*(radius-2),ringY+Math.sin(a)*(radius-2),-4.1),point(f,Math.cos(c)*(radius-2),ringY+Math.sin(c)*(radius-2),-4.1),.18,P.accent,{glow:true});
  }
  box(0,ringY,0,12,12,22,P.dark);box(0,ringY,9,16,9,3,P.light);
  box(0,-2,13,15,15,53,P.mid);box(0,-10,9,20,3,62,P.dark);
  box(side*17,-1,15,12,10,22,P.light);box(-side*17,-3,23,9,7,14,P.mid);
  // One long radiator and one shorter docking service wing break symmetry.
  for(const [sign,width,z,len] of [[-side,60,18,44],[side,38,-5,30]]){
    const x=sign*(23+width/2);
    box(x,4,z,width,.6,len,P.dark);
    for(let k=0;k<=6;k++)box(x-width/2+k*width/6,4.35,z,.22,.12,len,P.mid);
    for(let k=-2;k<=2;k++)box(x,4.36,z+k*len/5,width,.10,.22,P.light);
    b.tube(point(f,sign*8,2,z),point(f,sign*(23+width),2,z),.55,P.mid);
  }
  for(const z of [-7,0,7,14,21,28]){
    box(-7.7,-1,z,.12,6,3.8,P.dark);box(7.7,-1,z,.12,6,3.8,P.dark);
  }
  box(side*17,4.1,15,13,.15,4,P.gold);
  b.tube(point(f,0,ringY,13),point(f,0,ringY,30),2.2,P.mid);
  b.tube(point(f,-4,ringY-2,30.1),point(f,4,ringY-2,30.1),.12,P.accent,{glow:true});
  box(0,-16,5,5,12,18,P.mid);
  // Antenna has a closed angular dish and offset boom, not another diamond.
  b.tube(point(f,side*13,5,7),point(f,side*23,19,7),.18,P.light);
  const dish=point(f,side*23,19,7),edge=[];
  for(let k=0;k<8;k++){const a=k*Math.PI/4;edge.push(point(f,side*23+Math.cos(a)*4.8,19+Math.sin(a)*4.8,8.2));}
  for(let k=0;k<8;k++)b.body.col(...P.mid).triW(dish,edge[k],edge[(k+1)%8],0,0,1,0,1,1);
}

function asteroid(b,s,index){
  const side=index%2?-1:1,d=side*(245+(index%3)*31),radius=13+(index%4)*3;
  if(b.themeAt(s)!=='space'||!b.reserve(s,d,radius*1.5))return;
  const f=b.frame(s,d,-20+(index%3)*31),P=b.palette;
  const top=point(f,-radius*.3,radius*.8,radius*.14),bottom=point(f,radius*.2,-radius*.7,-radius*.2),ring=[];
  for(let k=0;k<7;k++){
    const a=k*Math.PI*2/7,r=radius*(.72+(k%3)*.11);
    ring.push(point(f,Math.cos(a)*r,((k%3)-1)*radius*.17,Math.sin(a)*r));
  }
  for(let k=0;k<7;k++){
    b.body.col(...(k%3?P.dark:P.mid)).triW(ring[k],ring[(k+1)%7],top,0,0,1,0,.5,1);
    b.body.col(...P.dark).triW(ring[(k+1)%7],ring[k],bottom,0,0,1,0,.5,1);
  }
}

export function buildSpaceLandmarks(b){
  for(let s=Math.ceil((b.s0-96)/STEP)*STEP+96;s<b.s1;s+=STEP){if(s>=b.s0&&b.themeAt(s)==='space')station(b,s,Math.floor(s/STEP));}
  // Sparse irregular debris, leaving the docking wheel as the focal structure.
  for(let s=Math.ceil(b.s0/192)*192;s<b.s1;s+=192)if(b.themeAt(s)==='space')asteroid(b,s,Math.floor(s/192));
}
