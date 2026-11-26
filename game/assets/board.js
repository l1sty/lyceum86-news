import * as T from './three.module.min.js';

import {tray} from './dice-tray.js';
import {boardMotion} from './board-motion.js';

export const colors = ['#90aeff','#64d5a2','#c7a5ff','#ffbd73','#ff948f','#6ed8ee'];
const districts = ['#bd945b','#648d7f','#647f9c','#ab7669'];
function point(i) {
  const a = Math.floor(i / 5), k = i % 5;
  return [[-5 + 2*k,5],[5,5 - 2*k],[5 - 2*k,-5],[-5,-5 + 2*k]][a];
}
export function city(host, select, placeLabels, cue = () => {}) {
  const touch = matchMedia('(pointer: coarse)').matches;
  const compact = touch || matchMedia('(max-width: 780px)').matches;
  const lowMemory = touch && navigator.deviceMemory && navigator.deviceMemory<=4;
  const renderer = new T.WebGLRenderer({alpha:true, antialias:!lowMemory, powerPreference:'default'});
  let qualityLimit=compact ? (lowMemory ? 0.82 : 1.25) : 1.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  host.prepend(renderer.domElement);
  const scene = new T.Scene(), cam = new T.OrthographicCamera();
  scene.add(new T.HemisphereLight(0xf0f5ff,0x969a8b,1.65));
  const sun = new T.DirectionalLight(0xffefdc,2.4);
  sun.position.set(-6,10,5); sun.castShadow = true;
  Object.assign(sun.shadow.camera,{left:-10,right:10,top:10,bottom:-10});
  sun.shadow.mapSize.set(compact?512:1024,compact?512:1024); sun.shadow.bias=-.0007;
  scene.add(sun);
  const env = document.createElement('canvas'); env.width=256; env.height=128;
  const ec=env.getContext('2d'); ec.fillStyle='#24303a'; ec.fillRect(0,0,256,128);
  ec.fillStyle='#fff3db'; ec.fillRect(25,24,75,13); ec.fillStyle='#8699ac'; ec.fillRect(168,10,34,45);
  const tex=new T.CanvasTexture(env); tex.mapping=T.EquirectangularReflectionMapping; tex.colorSpace=T.SRGBColorSpace;
  const pmrem=new T.PMREMGenerator(renderer); const environment=pmrem.fromEquirectangular(tex); scene.environment=environment.texture; pmrem.dispose(); tex.dispose();
  // A few shared surfaces give the miniatures scale even in property close-ups.
  function surface(w,h,paint){
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    paint(canvas.getContext('2d'));
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
    map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return map;
  }
  const masonry=surface(128,128,ctx=>{
    ctx.fillStyle='#e3ddd2';ctx.fillRect(0,0,128,128);
    for(let row=0;row<12;row++)for(let col=-1;col<5;col++){
      const tint=237+Math.round(5*Math.sin(row*42+col*13));
      ctx.fillStyle='rgb('+[tint,tint-2,tint-5].join(',')+')';
      ctx.fillRect(col*32+(row%2)*16,row*128/12+1,31.5,9.8);
    }
  });
  const slate=surface(128,128,ctx=>{
    ctx.fillStyle='#b2bac0';ctx.fillRect(0,0,128,128);
    for(let r=0;r<12;r++)for(let c=-1;c<8;c++){
      const tint=212+Math.round(12*Math.cos(c*21+r*4));
      ctx.fillStyle='rgb('+[tint,tint+2,tint+4].join(',')+')';
      ctx.fillRect(c*16+(r%2)*8,r*128/12,15.4,9.7);
    }
  });
  const sash=surface(64,96,ctx=>{
    ctx.fillStyle='#d0bca0';ctx.fillRect(0,0,64,96);
    ctx.fillStyle='#a9957d';ctx.beginPath();ctx.roundRect(5,3,54,89,[25,25,2,2]);ctx.fill();
    const reflection=ctx.createLinearGradient(0,0,51,93);
    reflection.addColorStop(0,'#40545e');reflection.addColorStop(.5,'#77929c');reflection.addColorStop(.52,'#536771');reflection.addColorStop(1,'#263e49');
    ctx.fillStyle=reflection;ctx.beginPath();ctx.roundRect(10,10,44,77,[20,20,0,0]);ctx.fill();
    ctx.fillStyle='#ccbda8';ctx.fillRect(30,11,3,76);ctx.fillRect(10,39,44,4);ctx.fillRect(10,64,44,2);
  });
  const lanternProfile=[[.48,0],[.5,.08],[.4,.14],[.36,.25],[.38,.43],[.33,.57],[.21,.69],[.12,.78],[.055,.93],[.02,1]];
  const geo = {box:new T.BoxGeometry(), stone:new T.BoxGeometry(), window:new T.BoxGeometry(),
    spire:new T.LatheGeometry(lanternProfile.map(([r,y])=>new T.Vector2(r,y)),8),
    mansard:new T.CylinderGeometry(.42,.71,1,4,1,false,Math.PI/4),
    round:new T.CylinderGeometry(.5,.5,1,16),
    dome:new T.SphereGeometry(.5,16,10,0,2*Math.PI,0,Math.PI/2),
    tree:new T.IcosahedronGeometry(.6,1), roof:new T.CylinderGeometry(0,.71,1,4)};
  geo.roof.rotateY(Math.PI/4);
  const pediment=new T.Shape();
  pediment.moveTo(-.5,0);pediment.lineTo(.5,0);pediment.lineTo(0,1);pediment.closePath();
  geo.gable=new T.ExtrudeGeometry(pediment,{depth:1,bevelEnabled:false});geo.gable.translate(0,0,-.5);
  const parts = {}, dummy = new T.Object3D();
  function part(shape,x,y,z,w,h,d,color) {
    dummy.position.set(x,y,z); dummy.scale.set(w,h,d); dummy.updateMatrix();
    (parts[shape] ||= []).push([dummy.matrix.clone(), new T.Color(color)]);
  }
  const box=(...args)=>part('box',...args);
  function strut(start,end,diameter,color){
    const a=new T.Vector3(...start),b=new T.Vector3(...end),direction=b.clone().sub(a);
    dummy.position.copy(a).lerp(b,.5);
    dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction.clone().normalize());
    dummy.scale.set(diameter,direction.length(),diameter);dummy.updateMatrix();
    (parts.round ||= []).push([dummy.matrix.clone(),new T.Color(color)]);
    dummy.rotation.set(0,0,0);
  }
  box(0,-.53,0,12.36,.48,12.36,'#293848'); box(0,-.3,0,12.39,.038,12.39,'#8297a6');
  box(0,-.17,0,12.25,.24,12.25,'#a69e8d'); box(0,.01,0,7.85,.12,7.85,'#6c845d');
  for(const dir of [-1,1]){
    box(dir*3.84,.088,0,.07,.04,7.68,'#aaa798');
    box(0,.088,dir*3.84,7.68,.04,.07,'#aaa798');
  }
  const hit=[], picks=new T.InstancedMesh(geo.box,new T.MeshBasicMaterial(),20);
  for(let i=0;i<20;i++) {
    const [x,z]=point(i);
    box(x,.04,z,1.93,.2,1.93,i%5===0?'#b9b4a2':'#e5dfd0');
    const inner=Math.floor(i/5);
    box(x+(inner===1?-.82:inner===3?.82:0),.148,z+(inner===0?-.82:inner===2?.82:0),
      inner%2?.16:1.76,.03,inner%2?1.76:.16,districts[inner]);
    dummy.position.set(x,.17,z); dummy.scale.set(1.94,.15,1.94); dummy.updateMatrix(); picks.setMatrixAt(i,dummy.matrix);
    hit.push(new T.Vector3(x,.18,z));
  }
  picks.updateMatrixWorld();
  const plotItems=hit.map((center,tile)=>({tile,center,claim:0,level:0,color:new T.Color()}));
  const makeInstances=(geometry,capacity,material)=>{
    const mesh=new T.InstancedMesh(geometry,material,capacity);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.count=0;mesh.frustumCulled=false;scene.add(mesh);return mesh;
  };
  const enamel=new T.MeshStandardMaterial({roughness:.38,metalness:.32});
  const plates=makeInstances(geo.box,20,enamel);
  plates.setColorAt(0,new T.Color());
  const annexes=makeInstances(geo.stone,60,new T.MeshStandardMaterial({color:'#d8c8a5',roughness:.8}));
  const roofs=makeInstances(geo.mansard,60,new T.MeshStandardMaterial({color:'#586660',roughness:.6}));
  function instance(mesh,x,y,z,w,h,d,color){
    dummy.position.set(x,y,z);dummy.scale.set(w,h,d);dummy.updateMatrix();
    if(color)mesh.setColorAt(mesh.count,color);
    mesh.setMatrixAt(mesh.count++,dummy.matrix);
  }
  function writePlots(){
    plates.count=annexes.count=roofs.count=0;
    for(const {tile,center,claim,level,color} of plotItems){
      if(claim<.001)continue;
      const side=Math.floor(tile/5), sideways=side%2;
      const x=center.x+(side===1?-.81:side===3?.81:0);
      const z=center.z+(side===0?-.81:side===2?.81:0);
      const length=1.73*claim;
      instance(plates,x,.187,z,sideways?.23:length,.055,sideways?length:.23,color);
      for(let floor=0;floor<Math.ceil(level);floor++){
        const built=T.MathUtils.clamp(level-floor,0,1), offset=(floor-1)*.49;
        const px=x+(sideways?0:offset),pz=z+(sideways?offset:0);
        const h=.26*Math.min(1,built/.72);
        instance(annexes,px,.22+h/2,pz,.33,h,.33);
        if(built>.68){
          const fit=(built-.68)/.32;
          instance(roofs,px,.48+.074*fit+.11*(1-fit),pz,.41,.145*fit,.41);
        }
      }
    }
    for(const mesh of [plates,annexes,roofs])mesh.instanceMatrix.needsUpdate=true;
    if(plates.instanceColor)plates.instanceColor.needsUpdate=true;
  }
  function building(x,z,w,d,h,col,roof) {
    box(x,.18,z,w+.13,.23,d+.14,'#777470');
    part('stone',x,h/2+.23,z,w,h,d,col);
    for(let y=.46;y<h+.15;y+=.42) {
      for(let a=-w/2+.17;a<w/2-.08;a+=.37) {
        for(const dir of [-1,1]){
          part('window',x+a,y,z+dir*(d/2+.014),.235,.32,.034,'#fff3dd');
          box(x+a,y-.164,z+dir*(d/2+.022),.26,.037,.076,'#cbbba4');
        }
      }
      for(let a=-d/2+.18;a<d/2-.08;a+=.38) {
        for(const dir of [-1,1])part('window',x+dir*(w/2+.014),y,z+a,.033,.32,.235,'#efe0c6');
      }
    }
    box(x,h+.24,z,w+.14,.09,d+.14,'#ded0a6');
    part('mansard',x,h+.49,z,w+.23,.42,d+.22,roof);
    box(x,h+.718,z,(w+.23)*.6,.045,(d+.22)*.6,roof);
    for(const dx of [-1,1])for(const dz of [-1,1]){
      for(let course=0;course<h/.27;course++){
        box(x+dx*(w/2-.048),.32+course*.27,z+dz*(d/2-.04),.12,.115,.12,'#cebea7');
      }
    }
  }
  building(0,-1.54,4.85,1.4,1.8,'#ab9780','#33434c');
  for(const side of [-1,1]){
    building(side*2,-.33,1.06,2.28,1.42,'#aa9988','#38434b');
    building(side*2,.83,1.28,.94,1.69,'#b4a18c','#3b4851');
    for(const dz of [-1.04,.91]){
      const cx=side*2.24;
      const base=dz>0?2.39:2.12;
      box(cx,base+.16,dz,.15,.39,.20,'#995f4c');
      box(cx,base+.37,dz,.20,.065,.25,'#c1a38a');
      box(cx,base+.408,dz,.09,.018,.13,'#484440');
    }
    for(const dx of [-.32,.32]){
      const cx=side*2+dx;
      box(cx,2.12,1.27,.24,.38,.26,'#c6b39b');
      part('window',cx,2.11,1.411,.17,.23,.024,'#e6d5b7');
      part('gable',cx,2.30,1.29,.31,.16,.34,'#576569');
    }
    for(let k=0;k<3;k++){
      const x=side*(.79+.47*k);
      box(x,2.30,-.94,.24,.36,.27,'#c9bba4');
      part('window',x,2.30,-.797,.16,.22,.021,'#f1debd');
      part('gable',x,2.47,-.94,.34,.16,.35,'#475961');
    }
    for(let k=0;k<4;k++)box(side*(.7+k*.42),1.09,-.826,.075,1.67,.072,'#d3c5ae');
  }
  building(0,-.76,.98,.98,2.86,'#c5ad91','#364750');
  part('round',0,3.62,-.76,.86,.14,.86,'#b69967');
  part('round',0,3.91,-.76,.46,.5,.46,'#453f35');
  for(let k=0;k<8;k++){
    const a=k*Math.PI/4;
    part('round',.32*Math.cos(a),3.91,-.76+.32*Math.sin(a),.078,.52,.078,'#d6bf9b');
  }
  part('spire',0,4.16,-.76,1.02,.91,1.02,'#536d68');
  part('round',0,5.07,-.76,.09,.10,.09,'#d6af66');
  // Clock faces on both visible sides of the central tower.
  const faceCanvas=document.createElement('canvas');faceCanvas.width=faceCanvas.height=96;
  const clock=faceCanvas.getContext('2d');clock.translate(48,48);
  clock.fillStyle='#5b4b35';clock.beginPath();clock.arc(0,0,47,0,Math.PI*2);clock.fill();
  clock.fillStyle='#f8eac7';clock.beginPath();clock.arc(0,0,40,0,Math.PI*2);clock.fill();
  clock.fillStyle='#423c30';for(let i=0;i<12;i++){clock.rotate(Math.PI/6);clock.fillRect(-1.6,-36,3.2,6)}
  clock.fillRect(-2,-25,4,26);clock.rotate(2.1);clock.fillRect(-2,-19,4,20);
  const clockMap=new T.CanvasTexture(faceCanvas);clockMap.colorSpace=T.SRGBColorSpace;
  const dial=new T.Mesh(new T.PlaneGeometry(.71,.71),new T.MeshStandardMaterial({map:clockMap,transparent:true}));
  dial.position.set(0,2.67,-.192);scene.add(dial);const other=dial.clone();other.rotation.y=Math.PI/2;other.position.set(.55,2.67,-.76);scene.add(other);
  for(const x of [-.57,-.2,.2,.57])part('round',x,.69,.05,.11,1.05,.11,'#e2d1a9');
  box(0,1.23,.03,1.46,.13,.63,'#d5c1a0');
  part('gable',0,1.285,.09,1.52,.4,.61,'#c5af8d');
  part('gable',0,1.32,.403,1.19,.27,.024,'#846e58');
  part('gable',0,1.35,.422,.91,.17,.015,'#d5c6ab');
  for(let i=0;i<3;i++)box(0,.18+i*.06,.59-i*.13,1.58-i*.07,.09,.23,'#bdb398');
  box(0,5.23,-.76,.03,.35,.03,'#d6b274'); box(.14,5.32,-.76,.28,.10,.025,'#cca36d');
  box(0,.12,1.72,1.1,.07,4.24,'#a29b83');
  for(const dir of [-1,1]){
    box(dir*1.87,.113,2.3,2.46,.07,.32,'#908b7e');
    {
      const z=.94;
      part('round',dir*.78,.49,z,.045,.74,.045,'#9c865e');
      part('round',dir*.78,.9,z,.13,.16,.13,'#f2cf8c');
      box(dir*1.82,.29,z, .64,.10,.21,'#976f50');
      for(const foot of [-.2,.2])box(dir*1.82+foot,.19,z,.05,.16,.16,'#4a4946');
    }
    for(let z=-2.96;z<=3.3;z+=.47)box(dir*3.59,.29,z,.07,.36,.07,'#a39780');
    box(dir*3.59,.38,.14,.045,.075,6.48,'#7c7770');
  }
  for(let i=0;i<14;i++) {
    const x=(i%2?-1:1)*(i<8?3:2.13), z=i<8?-2.8+Math.floor(i/2)*1.35:1.55+Math.floor((i-8)/2)*.88;
    part('round',x,.40,z,.12,.72,.12,'#756452');
    const tones=['#42614e','#59785b','#74855e'];
    for(let lobe=0;lobe<4;lobe++){
      const a=i*2.18+lobe*2.09, spread=lobe===3?.035:.23;
      part('tree',x+spread*Math.cos(a),lobe===3?1.19:.92,z+spread*Math.sin(a),
        .66,.72+.09*Math.sin(a),.64,tones[(i+lobe)%3]);
    }
  }
  for(const i of [1,2,4]){
    const [x,z]=point(i);
    building(x,z,i===4?1.34:1.04,.77,i===1?.45:.67,'#beac92','#675749');
    if(i===1){
      for(let stripe=0;stripe<7;stripe++){
        box(x+(stripe-3)*.14,.62,z+.51,.14,.065,.35,stripe%2?'#d9caaa':'#9d5f4d');
        box(x+(stripe-3)*.14,.555,z+.675,.14,.105,.026,stripe%2?'#d9caaa':'#9d5f4d');
      }
    }
    if(i===4){for(const k of [-.47,-.16,.16,.47])part('round',x+k,.49,z+.46,.075,.61,.075,'#d0bfa8');
      box(x,.82,z+.47,1.22,.08,.26,'#cab89e');
      part('gable',x,.86,z+.47,1.27,.25,.29,'#cdb796')}
  }
  for(const i of [6,7,11,12,16]){
    const [x,z]=point(i), science=i===11||i===12, width=i===16?1.42:1.22;
    const h=i===12?.88:.58;
    box(x,.2,z,width+.1,.13,1.04,'#787976');
    box(x,.27+h/2,z,width,h,.94,science?'#53626a':'#a08d77');
    for(const y of [.43,...(i===12?[.86]:[])]){
      box(x,y,z+.474,width-.13,.16,.022,science?'#9baeb1':'#465257');
      box(x+width/2,y,z,.022,.16,.76,'#72858b');
      for(const k of [-.34,0,.34])box(x+k,y,z+.5,.035,.17,.022,'#baa98e');
    }
    box(x,h+.31,z,width+.1,.095,1.04,'#9c9c91');
    if(i===6||i===16){for(const k of [-.32,0,.32])part('roof',x,h+.47,z+k,width,.25,.32,'#506269')}
    else if(science){
      for(const dx of [-.32,.28]){
        box(x+dx,h+.419,z-.02,.48,.09,.65,'#384b59');
        for(const line of [-.18,0,.18])box(x+dx,h+.468,z+line,.45,.012,.015,'#8d9ba1');
      }
    }else{
      part('mansard',x,h+.49,z,.96,.34,.70,'#788d86');
      for(const dx of [-.28,0,.28])box(x+dx,h+.67,z,.025,.025,.40,'#b59e77');
    }
  }
  for(const i of [9,14]){
    const [x,z]=point(i);
    part('round',x,.43,z,1.16,.56,1.16,'#ad9981');
    part('round',x,.68,z,1.21,.1,1.21,'#d1b998');
    part('dome',x,.72,z,1.18,i===14?1.26:.63,1.18,i===14?'#738994':'#89705c');
    if(i===14){
      for(const dx of [-.12,.12])strut([x+dx,.77,z+.56],[x+dx,1.3,z+.19],.044,'#b5ab92');
      strut([x,1.02,z+.33],[x,1.48,z+.75],.16,'#455967');
      strut([x,1.43,z+.70],[x,1.50,z+.77],.20,'#bd9b65');
    }else{
      for(let k=0;k<12;k++){
        const a=k*Math.PI/6;
        part('round',x+.573*Math.cos(a),.45,z+.573*Math.sin(a),.078,.45,.078,'#cebaa0');
      }
      part('round',x,1.08,z,.19,.09,.19,'#bf9d6b');
    }
  }
  for(const i of [17,19]){
    const [x,z]=point(i);box(x,.21,z,1.3,.12,1.34,'#c2c3a6');
    box(x,.29,z,1.13,.05,1.18,i===17?'#57a8b0':'#5a8667');
    if(i===17){
      for(const lane of [-.29,0,.29]){
        box(x+lane,.324,z,.025,.021,1.12,'#e9d5b2');
        for(const end of [-.46,.46])box(x+lane,.332,z+end,.041,.025,.17,'#ba654e');
      }
      for(const dx of [-.4,-.14,.14,.4])box(x+dx,.36,z-.62,.13,.09,.13,'#f0e7d1');
    }else{
      box(x,.324,z,1.03,.014,.024,'#dcdcc1');
      for(const edge of [-.48,.48]){
        box(x+edge,.324,z,.022,.014,1.08,'#dedfc3');
        box(x,.324,z+edge,.99,.014,.023,'#dedfc3');
        for(const dx of [-.19,.19])box(x+dx,.424,z+edge,.03,.2,.032,'#e6dcc4');
        box(x,.522,z+edge,.41,.032,.032,'#e6dcc4');
      }
      for(let step=0;step<3;step++)box(x-.60-step*.08,.28+step*.07,z,.105,.10,1.15,'#b29a86');
    }
  }
  // A single texture atlas keeps the special-square engravings in one draw call.
  const signs=[[0,'➜'],[3,'✦'],[5,'Ⅱ'],[8,'✦'],[10,'✦'],[13,'✦'],[15,'❧'],[18,'✦']];
  const atlas=document.createElement('canvas');atlas.width=512;atlas.height=64;
  const ac=atlas.getContext('2d');ac.fillStyle='#717b84';ac.font='46px system-ui';ac.textAlign='center';
  const positions=[],uv=[],indices=[];
  signs.forEach(([i,s],j)=>{ac.fillText(s,32+64*j,49);const [x,z]=point(i);
    positions.push(x-.6,.153,z+.6,x+.6,.153,z+.6,x+.6,.153,z-.6,x-.6,.153,z-.6);
    uv.push(j/8,0,(j+1)/8,0,(j+1)/8,1,j/8,1);indices.push(j*4,j*4+1,j*4+2,j*4,j*4+2,j*4+3)});
  const engraving=new T.BufferGeometry();engraving.setAttribute('position',new T.Float32BufferAttribute(positions,3));engraving.setAttribute('uv',new T.Float32BufferAttribute(uv,2));engraving.setIndex(indices);
  const ink=new T.CanvasTexture(atlas);ink.colorSpace=T.SRGBColorSpace;
  scene.add(new T.Mesh(engraving,new T.MeshBasicMaterial({map:ink,transparent:true,depthWrite:false})));
  // The dice share a felt well and a low timber lip with the Rapier colliders.
  box(0,tray.floor-.045,tray.z,tray.halfWidth*2,.09,tray.halfDepth*2,'#536e62');
  for(const sign of [-1,1]){
    box(sign*(tray.halfWidth+.04),tray.floor+tray.rim/2,tray.z,.08,tray.rim,tray.halfDepth*2+.16,'#a28a64');
    box(0,tray.floor+tray.rim/2,tray.z+sign*(tray.halfDepth+.04),tray.halfWidth*2,tray.rim,.08,'#a28a64');
  }
  for(const [shape,items] of Object.entries(parts)) {
    const surfaces={
      stone:{map:masonry,roughness:.9},window:{map:sash,roughness:.42},
      mansard:{map:slate,roughness:.56,metalness:.24},
      spire:{roughness:.31,metalness:.62},dome:{roughness:.36,metalness:.51},
      tree:{roughness:1,flatShading:true}
    };
    const mesh=new T.InstancedMesh(geo[shape],new T.MeshStandardMaterial(surfaces[shape]||{roughness:.55,metalness:.16}),items.length);
    items.forEach(([matrix,c],i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,c)});
    mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  }
  function face(n) {
    const c=document.createElement('canvas'); c.width=c.height=96;const ctx=c.getContext('2d');
    ctx.fillStyle='#d9c8a6';ctx.fillRect(0,0,96,96);ctx.fillStyle='#fff0cf';ctx.beginPath();ctx.roundRect(2,2,92,92,13);ctx.fill();
    const dots=[[],[[1,1]],[[0,0],[2,2]],[[0,0],[1,1],[2,2]],[[0,0],[0,2],[2,0],[2,2]],
      [[0,0],[0,2],[1,1],[2,0],[2,2]],[[0,0],[0,1],[0,2],[2,0],[2,1],[2,2]]];
    ctx.fillStyle='#24282b'; for(const [x,y] of dots[n]){ctx.beginPath();ctx.arc(23+x*25,23+y*25,7,0,Math.PI*2);ctx.fill()}
    return c;
  }
  const diceAtlas=document.createElement('canvas');diceAtlas.width=576;diceAtlas.height=96;
  const paint=diceAtlas.getContext('2d');
  [3,4,1,6,2,5].forEach((n,i)=>paint.drawImage(face(n),i*96,0));
  const ivory=new T.CanvasTexture(diceAtlas);ivory.colorSpace=T.SRGBColorSpace;
  const dieMaterial=new T.MeshStandardMaterial({map:ivory,roughness:.22,metalness:.07});
  const dieGeometry=new T.BoxGeometry(1,1,1,8,8,8);
  const dieUV=dieGeometry.attributes.uv;
  for(const [side,group] of dieGeometry.groups.entries()){
    const first=dieGeometry.index.getX(group.start);
    const faceVertices=dieUV.count/6;
    for(let i=first;i<first+faceVertices;i++)dieUV.setX(i,(side+.025+dieUV.getX(i)*.95)/6);
  }
  dieGeometry.clearGroups();
  const vertex=new T.Vector3(), core=new T.Vector3(), normal=new T.Vector3();
  const verts=dieGeometry.attributes.position, normals=dieGeometry.attributes.normal;
  for(let i=0;i<verts.count;i++){
    vertex.fromBufferAttribute(verts,i);core.copy(vertex).clampScalar(-.413,.413);
    normal.copy(vertex).sub(core).normalize();vertex.copy(core).addScaledVector(normal,.087);
    verts.setXYZ(i,vertex.x,vertex.y,vertex.z);normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  const dice=[-1,1].map((v)=>{const m=new T.Mesh(dieGeometry,dieMaterial);m.position.set(v*.62,.62,2.55);m.scale.setScalar(tray.die);scene.add(m);return m});
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;
  const sc=shadowCanvas.getContext('2d'), gradient=sc.createRadialGradient(32,32,2,32,32,32);
  gradient.addColorStop(0,'rgba(0,0,0,.65)');gradient.addColorStop(1,'rgba(0,0,0,0)');sc.fillStyle=gradient;sc.fillRect(0,0,64,64);
  const shadowMap=new T.CanvasTexture(shadowCanvas);
  const shadowGeometry=new T.PlaneGeometry(1.4,1.4);
  const shadows=dice.map(()=>{
    const m=new T.Mesh(shadowGeometry,new T.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2;scene.add(m);return m;
  });
  const initialAngle=.47;
  let angle=initialAngle,targetAngle=angle,zoom=1,targetZoom=1,panX=0,panZ=0;
  let width,height,frame=0,previousFrame=0,inView=true,disposed=false;
  let intervals=0,overBudget=0,stableWindows=0,severeFrames=0;
  const maxQuality=qualityLimit;
  const simpleSurfaces=new Map();
  let lightweight=false;
  function lightingBudget(){
    const simplify=qualityLimit<=.82;
    if(simplify===lightweight)return;
    lightweight=simplify;
    // The static city is already instanced. On fill-limited devices, light its
    // vertices once per draw and retain the existing textures and instance colors.
    scene.traverse(mesh=>{
      if(!mesh.isInstancedMesh)return;
      if(simplify && mesh.material.isMeshStandardMaterial){
        const full=mesh.material;
        let simple=simpleSurfaces.get(full);
        if(!simple){
          simple=new T.MeshLambertMaterial({map:full.map,color:full.color});
          simpleSurfaces.set(full,simple);
        }
        mesh.material=simple;
      }else if(!simplify){
        for(const [full,simple] of simpleSurfaces)if(mesh.material===simple){mesh.material=full;break}
      }
    });
    renderer.shadowMap.enabled=!simplify;
    if(!simplify)renderer.shadowMap.needsUpdate=true;
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const pawn=new T.LatheGeometry([[.01,0],[.22,0],[.26,.07],[.23,.13],[.14,.17],[.105,.30],[.145,.35],[.17,.46],[.13,.55],[.01,.61]].map(([r,y])=>new T.Vector2(r,y)),16);
  const motion=boardMotion({scene,dice,shadows,pawn,colors,plots:{items:plotItems,write:writePlots},invalidate:redraw,cue,reduced});
  const projection=new T.Vector3(),labelPoints=hit.map(()=>[0,0]);
  function draw(t) {
    frame=0;
    const elapsed=previousFrame?t-previousFrame:0;
    previousFrame=t;
    if(elapsed>0){
      intervals++;
      if(elapsed>21)overBudget++;
      severeFrames=elapsed>45?severeFrames+1:0;
      if(severeFrames>=5 || intervals>=36){
        if((severeFrames>=5 || overBudget>=7) && qualityLimit>.62){
          qualityLimit=Math.max(.62,qualityLimit-(severeFrames>=5 ? .39 : .22));stableWindows=0;resolution();
        }else if(overBudget===0 && ++stableWindows>=10 && qualityLimit<maxQuality){
          qualityLimit=Math.min(maxQuality,qualityLimit+.12);stableWindows=0;resolution();
        }else if(overBudget>0)stableWindows=0;
        lightingBudget();intervals=overBudget=severeFrames=0;
      }
    }
    const dt=Math.min(elapsed/1000,.09);
    const active=motion.advance(dt);
    const focus=motion.focus;
    const tx=(focus.subject?.x||0)*focus.amount,tz=(focus.subject?.z||0)*focus.amount;
    const zTarget=targetZoom*(1+focus.magnify);
    const moving=Math.abs(angle-targetAngle)+Math.abs(zoom-zTarget)+Math.abs(panX-tx)+Math.abs(panZ-tz)>.0009;
    if(moving){
      const k=reduced.matches?1:1-Math.exp(-dt*13);
      angle+=(targetAngle-angle)*k;zoom+=(zTarget-zoom)*k;
      panX+=(tx-panX)*k;panZ+=(tz-panZ)*k;positionCamera();
    }
    renderer.render(scene,cam);
    if(active||moving)redraw();else previousFrame=0;
  }
  function redraw(){if(!frame&&!disposed&&inView&&!document.hidden)frame=requestAnimationFrame(draw)}
  function positionCamera(){
    const half=Math.max(8.0,9.25*height/width)/zoom;
    Object.assign(cam,{left:-half*width/height,right:half*width/height,top:half,bottom:-half,near:.1,far:100});
    cam.position.set(panX+18*Math.sin(angle),24,panZ+18*Math.cos(angle));cam.lookAt(panX,.40,panZ);
    cam.updateMatrixWorld();cam.updateProjectionMatrix();
    hit.forEach((p,i)=>{
      const outside=width<760||height<420?1.67:1.85;
      projection.set(p.x+(Math.abs(p.x)===5?Math.sign(p.x)*outside:0),.15,
        p.z+(Math.abs(p.z)===5?Math.sign(p.z)*outside:0)).project(cam);
      labelPoints[i][0]=(projection.x+1)*width/2;
      labelPoints[i][1]=(1-projection.y)*height/2;
    });
    placeLabels(labelPoints,width,height);
  }
  function resolution(){
    const pixelBudget=touch?(lowMemory?310000:535000):Infinity;
    const ratio=Math.min(devicePixelRatio,qualityLimit,Math.sqrt(pixelBudget/(width*height)));
    if(Math.abs(renderer.getPixelRatio()-ratio)>.02)renderer.setPixelRatio(ratio);
  }
  function size(){
    const nextWidth=host.clientWidth,nextHeight=host.clientHeight;
    if(!nextWidth||!nextHeight||(width===nextWidth&&height===nextHeight))return;
    width=nextWidth;height=nextHeight;
    host.classList.toggle('compact-labels',width<760||height<420);
    resolution();renderer.setSize(width,height,false);positionCamera();redraw();
  }
  lightingBudget();
  const resize=new ResizeObserver(size);resize.observe(host);size();
  const intersection=new IntersectionObserver(([entry])=>{
    inView=entry.isIntersecting;
    if(inView)redraw();
    else{cancelAnimationFrame(frame);frame=0;previousFrame=0;motion.settle()}
  });
  intersection.observe(host);
  const settle=()=>{motion.settle();previousFrame=0;redraw()};
  const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;settle()}else redraw()};
  reduced.addEventListener('change',settle);
  document.addEventListener('visibilitychange',visibility);
  const pointers=new Map(), canvas=renderer.domElement;
  let down=null, pinch=0;
  const setZoom=value=>{motion.releaseCamera();targetZoom=T.MathUtils.clamp(value,.75,1.7);redraw()};
  const gap=()=>{const [a,b]=pointers.values();return Math.hypot(a.x-b.x,a.y-b.y)};
  canvas.onpointerdown=e=>{
    if(pointers.size===2)return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);
    if(pointers.size===1)down={x:e.clientX,y:e.clientY,a:targetAngle};
    else{pinch=gap();down=null}
  };
  canvas.onpointermove=e=>{
    if(!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const next=gap();if(pinch>5)setZoom(targetZoom*next/pinch);pinch=next}
    else if(down&&Math.abs(e.clientX-down.x)>5){motion.releaseCamera();targetAngle=down.a-(e.clientX-down.x)*.007;redraw()}
  };
  canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(pointers.delete(e.pointerId))down=null};
  const wheel=e=>{e.preventDefault();setZoom(targetZoom*Math.exp(-Math.sign(e.deltaY)*.13))};
  canvas.addEventListener('wheel',wheel,{passive:false});
  canvas.onpointerup=e=>{pointers.delete(e.pointerId);if(!down)return;const dist=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(dist>7)return;
    const rect=canvas.getBoundingClientRect(), ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/width*2-1,1-2*(e.clientY-rect.top)/height),cam);
    const pick=ray.intersectObject(picks)[0];if(pick)select(pick.instanceId)};
  const portraits=new Map();
  function portrait(i){
    if(portraits.has(i))return portraits.get(i);
    const [x,z]=point(i), halfWidth=1.48, halfHeight=halfWidth*height/width;
    const lens=new T.OrthographicCamera(-halfWidth,halfWidth,halfHeight,-halfHeight,.1,50);
    const direction=Math.atan2(x,z)+.27;
    lens.position.set(x+5.4*Math.sin(direction),3.5,z+5.4*Math.cos(direction));lens.lookAt(x,.55,z);
    const pieces=[...dice,...shadows,...[...motion.tokens.values()].map(t=>t.mesh).filter(m=>m.visible),plates,annexes,roofs];
    pieces.forEach(piece=>piece.visible=false);
    try{
      renderer.render(scene,lens);
      const thumb=document.createElement('canvas');
      thumb.width=Math.min(compact?320:540,canvas.width);thumb.height=Math.round(thumb.width*canvas.height/canvas.width);
      thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);
      const picture=thumb.toDataURL('image/webp',.82);
      portraits.set(i,picture);return picture;
    }finally{
      pieces.forEach(piece=>piece.visible=true);
      renderer.render(scene,cam);
    }
  }
  return {portrait,dispose(){
    if(disposed)return;
    disposed=true;
    motion.dispose();portraits.clear();
    reduced.removeEventListener('change',settle);
    canvas.removeEventListener('wheel',wheel);
    canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=null;
    cancelAnimationFrame(frame);
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange',visibility);
    const resources=new Set([environment,picks.geometry,picks.material,pawn,...Object.values(geo)]);
    for(const [full,simple] of simpleSurfaces){resources.add(full);resources.add(simple)}
    scene.traverse(object=>{
      if(object.isInstancedMesh)object.dispose();
      if(object.geometry)resources.add(object.geometry);
      if(object.material){
        resources.add(object.material);
        if(object.material.map)resources.add(object.material.map);
      }
    });
    resources.forEach(resource=>resource?.dispose());
    sun.shadow.dispose();
    picks.dispose();renderer.dispose();
    if(!renderer.getContext().isContextLost())renderer.forceContextLoss();
    canvas.remove();
  },camera(action){
    motion.releaseCamera();
    if(action==='rotate'){targetAngle+=Math.PI/2;redraw()}
    if(action==='in')setZoom(targetZoom*1.2);
    if(action==='out')setZoom(targetZoom/1.2);
    if(action==='reset'){
      const difference=initialAngle-angle;
      targetAngle=angle+Math.atan2(Math.sin(difference),Math.cos(difference));
      setZoom(1);
    }
  },update(s){motion.update(s,!inView||document.hidden)}};
}
