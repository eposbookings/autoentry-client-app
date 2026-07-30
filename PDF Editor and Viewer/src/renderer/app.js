import * as pdfjsLib from "../../node_modules/pdfjs-dist/build/pdf.mjs";
import { PDFDocument, rgb, StandardFonts, drawLine, TextAlignment } from "../../node_modules/pdf-lib/dist/pdf-lib.esm.js";

// PDF.js 5 uses the new Uint8Array Base64/hex helpers. Electron versions
// released before those APIs reached Chromium need these small equivalents.
if (!Uint8Array.prototype.toHex) {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    configurable: true,
    value() {
      let result = "";
      for (const byte of this) result += byte.toString(16).padStart(2, "0");
      return result;
    }
  });
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "../../node_modules/pdfjs-dist/build/pdf.worker.mjs";

const $ = (id) => document.getElementById(id);
const state = { pdf:null, bytes:null, name:"", scale:1.15, tool:"select", fields:[], selected:null, seq:1 };
const pagesEl = $("pages");
const props = ["Name","SystemKey","Box","Type","Placeholder","Alignment","Required","Multiline","FontSize","Border"];

function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
function setStatus(message){$("statusText").textContent=message}
function updateCount(){$("fieldCount").textContent=`${state.fields.length} field${state.fields.length===1?"":"s"}`}
function fieldName(type){return `${type}_${String(state.seq++).padStart(2,"0")}`}

async function openPdf(){
  setStatus("Choose a PDF to open…");
  try {
    const file=await window.desktop.openPdf(); if(!file){setStatus("Ready");return}
    if(file.error)throw new Error(file.error);
    const raw=file.bytes?.data??file.bytes;
    state.bytes=raw instanceof ArrayBuffer?new Uint8Array(raw):new Uint8Array(raw); 
    if(!state.bytes.length)throw new Error("The selected PDF is empty.");
    state.name=file.name; state.fields=[];state.selected=null;$("formOverview").classList.add("hidden");
    state.pdf=await pdfjsLib.getDocument({data:state.bytes.slice()}).promise;
    $("documentTitle").textContent=file.name;
    $("welcome").classList.add("hidden");$("exportButton").disabled=false;$("exportPackageButton").disabled=false;$("detectButton").disabled=false;
    $("formCode").value=file.name.replace(/\.pdf$/i,"").replace(/[^A-Za-z0-9.-]+/g,"-").toUpperCase();
    await renderAll();await importExistingWidgets();setStatus(`${state.pdf.numPages} pages loaded`);updateCount();
  } catch(error) {
    console.error("Unable to open PDF",error);
    setStatus("Could not open the selected PDF");
    toast(`Could not open PDF: ${error.message||error}`);
  }
}

async function renderAll(){
  pagesEl.innerHTML="";
  for(let n=1;n<=state.pdf.numPages;n++){
    const page=await state.pdf.getPage(n), viewport=page.getViewport({scale:state.scale});
    const wrap=document.createElement("div");wrap.className="page-wrap";wrap.dataset.page=n;
    wrap.style.width=`${viewport.width}px`;wrap.style.height=`${viewport.height}px`;
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    wrap.append(canvas);const layer=document.createElement("div");layer.className="field-layer";wrap.append(layer);pagesEl.append(wrap);
    bindLayer(layer,n);await page.render({canvasContext:ctx,viewport}).promise;
    // Yield between pages so controls and scrolling remain responsive.
    await new Promise(requestAnimationFrame);
  }
  state.fields.forEach(renderField);
}

function bindLayer(layer,page){
  let start=null,box=null;
  layer.addEventListener("pointerdown",e=>{
    if(e.target!==layer||state.tool==="select")return;
    const r=layer.getBoundingClientRect();start={x:e.clientX-r.left,y:e.clientY-r.top};
    box=document.createElement("div");box.className="draw-box";layer.append(box);layer.setPointerCapture(e.pointerId);
  });
  layer.addEventListener("pointermove",e=>{
    if(!start)return;const r=layer.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    Object.assign(box.style,{left:`${Math.min(x,start.x)}px`,top:`${Math.min(y,start.y)}px`,width:`${Math.abs(x-start.x)}px`,height:`${Math.abs(y-start.y)}px`});
  });
  layer.addEventListener("pointerup",e=>{
    if(!start)return;const rect=box.getBoundingClientRect(),lr=layer.getBoundingClientRect();box.remove();
    if(rect.width>8&&rect.height>8)addField({page,type:state.tool,x:(rect.left-lr.left)/lr.width,y:(rect.top-lr.top)/lr.height,w:rect.width/lr.width,h:rect.height/lr.height});
    start=null;box=null;
  });
}

function addField(data,detected=false,shouldSelect=true){
  const f={id:crypto.randomUUID(),name:fieldName(data.type),systemKey:"",box:"",type:data.type,placeholder:"",alignment:"left",required:false,multiline:false,fontSize:11,border:1,...data,detected};
  state.fields.push(f);renderField(f);if(shouldSelect)selectField(f.id);updateCount();return f;
}
function renderField(f){
  const layer=document.querySelector(`.page-wrap[data-page="${f.page}"] .field-layer`);if(!layer)return;
  layer.querySelector(`[data-id="${f.id}"]`)?.remove();const el=document.createElement("div");
  el.className=`field ${f.detected?"detected":""} ${f.locked?"prepared":""} ${state.selected===f.id?"selected":""}`;el.dataset.id=f.id;el.dataset.kind=f.type;
  Object.assign(el.style,{left:`${f.x*100}%`,top:`${f.y*100}%`,width:`${f.w*100}%`,height:`${f.h*100}%`});
  el.innerHTML='<span class="resize"></span>';layer.append(el);bindField(el,f);
}
function bindField(el,f){
  el.addEventListener("pointerdown",e=>{
    e.stopPropagation();selectField(f.id);if(f.locked)return;const resizing=e.target.classList.contains("resize"),layer=el.parentElement,lr=layer.getBoundingClientRect();
    const sx=e.clientX,sy=e.clientY,base={...f};el.setPointerCapture(e.pointerId);
    const move=ev=>{const dx=(ev.clientX-sx)/lr.width,dy=(ev.clientY-sy)/lr.height;if(resizing){f.w=Math.max(.015,base.w+dx);f.h=Math.max(.012,base.h+dy)}else{f.x=Math.max(0,Math.min(1-f.w,base.x+dx));f.y=Math.max(0,Math.min(1-f.h,base.y+dy))}renderField(f)};
    const up=()=>{el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",up)};
    el.addEventListener("pointermove",move);el.addEventListener("pointerup",up);
  });
}
function selectField(id){
  state.selected=id;document.querySelectorAll(".field").forEach(e=>e.classList.toggle("selected",e.dataset.id===id));
  const f=state.fields.find(x=>x.id===id);$("noSelection").classList.toggle("hidden",!!f);$("properties").classList.toggle("hidden",!f);
  if(!f)return;for(const p of props){const el=$(`prop${p}`);if(el.type==="checkbox")el.checked=!!f[p[0].toLowerCase()+p.slice(1)];else el.value=f[p[0].toLowerCase()+p.slice(1)]}
  $("propPlaceholder").closest("label").classList.toggle("hidden",f.type!=="text");$("propMultiline").closest("label").classList.toggle("hidden",f.type!=="text");$("propAlignment").closest("label").classList.toggle("hidden",f.type==="checkbox");
}
for(const p of props){$(`prop${p}`).addEventListener("input",e=>{const f=state.fields.find(x=>x.id===state.selected);if(!f)return;const k=p[0].toLowerCase()+p.slice(1);f[k]=e.target.type==="checkbox"?e.target.checked:e.target.type==="number"?Number(e.target.value):e.target.value;renderField(f);selectField(f.id)})}
$("deleteField").onclick=()=>{state.fields=state.fields.filter(f=>f.id!==state.selected);document.querySelector(`[data-id="${state.selected}"]`)?.remove();state.selected=null;selectField(null);updateCount()};

async function importExistingWidgets(){
  for(let n=1;n<=state.pdf.numPages;n++){const page=await state.pdf.getPage(n),ann=await page.getAnnotations(),view=page.view;
    for(const a of ann.filter(x=>x.subtype==="Widget")){const [x1,y1,x2,y2]=a.rect;addField({page:n,type:a.fieldType==="Btn"?"checkbox":a.fieldType==="Sig"?"signature":"text",name:a.fieldName||fieldName("field"),x:(x1-view[0])/(view[2]-view[0]),y:1-(y2-view[1])/(view[3]-view[1]),w:(x2-x1)/(view[2]-view[0]),h:(y2-y1)/(view[3]-view[1])})}
  }
  selectField(null);
}

const multiplyMatrix=(a,b)=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
  a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]
];
const transformPoint=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];

async function vectorBoxesForPage(page){
  const list=await page.getOperatorList(),boxes=[],segments=[],stack=[];let matrix=[1,0,0,1,0,0];
  const addSegment=(from,to)=>{
    if(!from||!to)return;
    const a=transformPoint(matrix,from[0],from[1]),b=transformPoint(matrix,to[0],to[1]);
    if(Math.abs(a[1]-b[1])<.5)segments.push({kind:"h",y:(a[1]+b[1])/2,x1:Math.min(a[0],b[0]),x2:Math.max(a[0],b[0])});
    else if(Math.abs(a[0]-b[0])<.5)segments.push({kind:"v",x:(a[0]+b[0])/2,y1:Math.min(a[1],b[1]),y2:Math.max(a[1],b[1])});
  };
  for(let i=0;i<list.fnArray.length;i++){
    const fn=list.fnArray[i],args=list.argsArray[i]||[];
    if(fn===pdfjsLib.OPS.save){stack.push(matrix.slice());continue}
    if(fn===pdfjsLib.OPS.restore){matrix=stack.pop()||[1,0,0,1,0,0];continue}
    if(fn===pdfjsLib.OPS.transform){matrix=multiplyMatrix(matrix,args);continue}
    if(fn!==pdfjsLib.OPS.constructPath)continue;
    const pathOps=args[0]||[],pathArgs=args[1]||[];let cursor=0,points=[];
    const addPolygonBox=()=>{
      if(points.length<4){points=[];return}
      const transformed=points.map(([px,py])=>transformPoint(matrix,px,py));
      const xs=transformed.map(p=>p[0]),ys=transformed.map(p=>p[1]);
      const uniqueX=[...new Set(xs.map(v=>v.toFixed(3)))],uniqueY=[...new Set(ys.map(v=>v.toFixed(3)))];
      if(uniqueX.length===2&&uniqueY.length===2)boxes.push({x1:Math.min(...xs),y1:Math.min(...ys),x2:Math.max(...xs),y2:Math.max(...ys)});
      points=[];
    };
    for(const pathOp of pathOps){
      if(pathOp===pdfjsLib.OPS.rectangle){
        const x=pathArgs[cursor++],y=pathArgs[cursor++],width=pathArgs[cursor++],height=pathArgs[cursor++];
        const corners=[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([px,py])=>transformPoint(matrix,px,py));
        const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
        boxes.push({x1:Math.min(...xs),y1:Math.min(...ys),x2:Math.max(...xs),y2:Math.max(...ys)});
        addSegment([x,y],[x+width,y]);addSegment([x+width,y],[x+width,y+height]);
        addSegment([x+width,y+height],[x,y+height]);addSegment([x,y+height],[x,y]);
      }else if(pathOp===pdfjsLib.OPS.moveTo){addPolygonBox();points=[[pathArgs[cursor++],pathArgs[cursor++]]]}
      else if(pathOp===pdfjsLib.OPS.lineTo){const next=[pathArgs[cursor++],pathArgs[cursor++]];addSegment(points.at(-1),next);points.push(next)}
      else if(pathOp===pdfjsLib.OPS.closePath){addSegment(points.at(-1),points[0]);addPolygonBox()}
      else{const arity=pathOp===pdfjsLib.OPS.curveTo?6:pathOp===pdfjsLib.OPS.curveTo2||pathOp===pdfjsLib.OPS.curveTo3?4:0;cursor+=arity;points=[]}
    }
    addPolygonBox();
  }
  const horizontals=segments.filter(s=>s.kind==="h"&&s.x2-s.x1>=4),verticals=segments.filter(s=>s.kind==="v"&&s.y2-s.y1>=4);
  const cluster=(values,tolerance=.8)=>values.sort((a,b)=>a-b).reduce((out,value)=>{
    if(!out.length||Math.abs(out.at(-1)-value)>tolerance)out.push(value);
    else out[out.length-1]=(out.at(-1)+value)/2;
    return out;
  },[]);
  const yLevels=cluster(horizontals.map(s=>s.y));
  const hCovers=(y,x1,x2)=>horizontals.some(s=>Math.abs(s.y-y)<1.2&&s.x1<=x1+1&&s.x2>=x2-1);
  const vCovers=(x,y1,y2)=>verticals.some(s=>Math.abs(s.x-x)<1.2&&s.y1<=y1+1&&s.y2>=y2-1);
  const gridBoxes=[];
  for(let a=0;a<yLevels.length;a++)for(let b=a+1;b<yLevels.length;b++){
    const y1=yLevels[a],y2=yLevels[b],height=y2-y1;if(height>60)break;if(height<4)continue;
    const xLevels=cluster(verticals.filter(v=>v.y1<=y1+1&&v.y2>=y2-1).map(v=>v.x));
    for(let x=0;x<xLevels.length-1;x++){
      const x1=xLevels[x],x2=xLevels[x+1];if(x2-x1<4)continue;
      if(hCovers(y1,x1,x2)&&hCovers(y2,x1,x2)&&vCovers(x1,y1,y2)&&vCovers(x2,y1,y2))gridBoxes.push({x1,y1,x2,y2,grid:true});
    }
  }
  const minimalGrid=gridBoxes.filter((box,index,all)=>!all.some((inner,j)=>j!==index&&inner.x1>=box.x1-.5&&inner.x2<=box.x2+.5&&inner.y1>=box.y1-.5&&inner.y2<=box.y2+.5&&(inner.x2-inner.x1)*(inner.y2-inner.y1)<(box.x2-box.x1)*(box.y2-box.y1)*.8));
  boxes.push(...minimalGrid);
  const [vx1,vy1,vx2,vy2]=page.view,pageWidth=vx2-vx1,pageHeight=vy2-vy1;
  return boxes.filter(b=>{
    const w=b.x2-b.x1,h=b.y2-b.y1;
    return w>=4&&h>=4&&w<pageWidth*.9&&h<=72;
  }).filter((b,index,all)=>all.findIndex(a=>Math.abs(a.x1-b.x1)<.75&&Math.abs(a.y1-b.y1)<.75&&Math.abs(a.x2-b.x2)<.75&&Math.abs(a.y2-b.y2)<.75)===index);
}

async function textBoxesForPage(page){
  const content=await page.getTextContent();
  return content.items.filter(item=>item.str?.trim()).map(item=>{
    const t=item.transform,height=Math.max(Math.abs(t[3])||0,item.height||0,4);
    return {x1:t[4],x2:t[4]+Math.max(item.width||0,2),y1:t[5]-height*.25,y2:t[5]+height*.9,text:item.str.trim()};
  });
}

function overlapsExistingText(box,textBoxes){
  const inset=Math.min(1.5,(box.y2-box.y1)*.08);
  return textBoxes.some(text=>{
    const overlapX=Math.min(box.x2-inset,text.x2)-Math.max(box.x1+inset,text.x1);
    const overlapY=Math.min(box.y2-inset,text.y2)-Math.max(box.y1+inset,text.y1);
    if(overlapX<=0||overlapY<=0)return false;
    const textCenterX=(text.x1+text.x2)/2,relativeX=(textCenterX-box.x1)/(box.x2-box.x1);
    // Currency/unit labels at the extreme edges of a white calculation cell
    // are retained; centered identifiers and answers make the box non-editable.
    return relativeX>.17&&relativeX<.83;
  });
}

function hasWhiteInterior(page,box,pixelSource){
  const canvas=pixelSource?.canvas;
  if(!canvas||!pixelSource.data)return true;
  const viewport=page.getViewport({scale:state.scale});
  const rect=viewport.convertToViewportRectangle([box.x1,box.y1,box.x2,box.y2]);
  const left=Math.min(rect[0],rect[2]),right=Math.max(rect[0],rect[2]),top=Math.min(rect[1],rect[3]),bottom=Math.max(rect[1],rect[3]);
  const pixels=pixelSource.data.data;let white=0,total=0;
  for(let gy=1;gy<=5;gy++)for(let gx=1;gx<=7;gx++){
    const x=Math.max(0,Math.min(canvas.width-1,Math.round(left+(right-left)*gx/8)));
    const y=Math.max(0,Math.min(canvas.height-1,Math.round(top+(bottom-top)*gy/6)));
    const offset=(y*canvas.width+x)*4;
    if(pixels[offset]>244&&pixels[offset+1]>244&&pixels[offset+2]>244)white++;
    total++;
  }
  return white/total>=.66;
}

function nearbyQuestionText(box,textBoxes){
  const centerY=(box.y1+box.y2)/2,boxHeight=box.y2-box.y1;
  return textBoxes.filter(text=>{
    const textCenterY=(text.y1+text.y2)/2;
    const verticallyRelevant=textCenterY>=centerY-boxHeight*1.2&&textCenterY<=centerY+Math.max(48,boxHeight*4);
    // Form instructions are often on the far left while their field is
    // aligned at the far right of the same row.
    const horizontallyRelevant=text.x2>=box.x1-1000&&text.x1<=box.x2+1000;
    return verticallyRelevant&&horizontallyRelevant;
  }).map(text=>text.text.toLowerCase()).join(" ");
}

function classifyPreparedBox(box,allBlankBoxes,textBoxes){
  const width=box.x2-box.x1,height=box.y2-box.y1,ratio=width/height,centerY=(box.y1+box.y2)/2;
  const closeRowNeighbour=allBlankBoxes.some(other=>{
    if(other===box)return false;
    const otherHeight=other.y2-other.y1,otherCenterY=(other.y1+other.y2)/2;
    if(Math.abs(centerY-otherCenterY)>Math.max(2.5,Math.min(height,otherHeight)*.35))return false;
    const gap=other.x1>=box.x2?other.x1-box.x2:box.x1>=other.x2?box.x1-other.x2:-1;
    return gap>=0&&gap<=Math.max(5,Math.min(width,other.x2-other.x1)*.7);
  });
  const context=nearbyQuestionText(box,textBoxes);
  const textQuestion=/date of birth|phone|telephone|mobile|name|address|postcode|post code|national insurance|insurance number|reference number|account number|email|e-mail|sort code|date|number/.test(context);
  const markQuestion=/tick|check|mark x|mark an x|put an x|enter an x|x in box|yes or no|select one|choose one/.test(context);
  const square=ratio>=.72&&ratio<=1.4&&Math.max(width,height)<=32;
  if(square&&markQuestion)return {type:"checkbox",confidence:.99,reason:"explicit X instruction"};
  if(closeRowNeighbour)return {type:"text",confidence:.97,reason:"character row"};
  if(ratio>1.6)return {type:"text",confidence:.96,reason:"wide entry box"};
  if(textQuestion&&!markQuestion)return {type:"text",confidence:.91,reason:"question context"};
  if(square)return {type:"checkbox",confidence:markQuestion ? .97 : .88,reason:markQuestion?"mark instruction":"isolated square"};
  return {type:"text",confidence:.78,reason:"entry geometry"};
}

function automaticAlignment(box,classification,textBoxes){
  if(classification.type!=="text")return "center";
  const width=box.x2-box.x1,height=box.y2-box.y1,context=nearbyQuestionText(box,textBoxes);
  if(classification.reason==="character row")return "center";
  if(width<=72&&height<=42)return "center";
  if(width<=110&&/year|date|rate of tax|percentage|number|postcode|sort code|national insurance|reference/.test(context))return "center";
  return "left";
}

async function prepareForm(){
  $("detectButton").disabled=true;let count=0,checks=0,texts=0,skipped=0;
  const standardFontSize=Number($("prepareFontSize").value),markStyle=$("prepareMarkStyle").value,whiteOnly=$("prepareWhiteOnly").checked;
  state.fields=state.fields.filter(field=>!field.locked);
  document.querySelectorAll(".field.prepared").forEach(element=>element.remove());
  updateCount();
  for(let n=1;n<=state.pdf.numPages;n++){
    setStatus(`Preparing page ${n} of ${state.pdf.numPages}…`);
    await new Promise(requestAnimationFrame);
    const page=await state.pdf.getPage(n),[vx1,vy1,vx2,vy2]=page.view,pw=vx2-vx1,ph=vy2-vy1;
    const textBoxes=await textBoxesForPage(page),vectorBoxes=await vectorBoxesForPage(page);
    const pageCanvas=document.querySelector(`.page-wrap[data-page="${n}"] canvas`);
    const pixelSource=whiteOnly&&pageCanvas?{canvas:pageCanvas,data:pageCanvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,pageCanvas.width,pageCanvas.height)}:null;
    const blankBoxes=vectorBoxes.filter(box=>{
      if(overlapsExistingText(box,textBoxes)||whiteOnly&&!hasWhiteInterior(page,box,pixelSource)){skipped++;return false}
      return true;
    });
    for(const r of blankBoxes){
      const classification=classifyPreparedBox(r,blankBoxes,textBoxes);
      const f={page:n,type:classification.type,x:(r.x1-vx1)/pw,y:1-(r.y2-vy1)/ph,w:(r.x2-r.x1)/pw,h:(r.y2-r.y1)/ph,locked:true,confidence:classification.confidence,fontSize:standardFontSize,markStyle,alignment:automaticAlignment(r,classification,textBoxes)};
      if(!state.fields.some(e=>e.page===n&&Math.abs(e.x-f.x)<.002&&Math.abs(e.y-f.y)<.002&&Math.abs(e.w-f.w)<.002&&Math.abs(e.h-f.h)<.002)){addField(f,true,false);count++;if(classification.type==="checkbox")checks++;else texts++}
    }
  }
  $("detectButton").disabled=false;selectField(null);
  $("formOverview").classList.remove("hidden");$("overviewText").textContent=texts;$("overviewChecks").textContent=checks;$("overviewSkipped").textContent=skipped;
  $("overviewSummary").textContent=`Prepared ${count} blank fields while preserving ${skipped} boxes that already contain document content.`;
  setStatus(`Prepared ${count} fixed-size form fields`);toast(`${count} visible boxes converted to editable fields`);
}

function xMarkAppearance(_field,widget){
  const {width,height}=widget.getRectangle(),pad=Math.max(1.5,Math.min(width,height)*.18);
  const lineOptions={thickness:Math.max(1,Math.min(width,height)*.09),color:rgb(0,0,0),dashArray:[],dashPhase:0};
  const on=[
    ...drawLine({...lineOptions,start:{x:pad,y:pad},end:{x:width-pad,y:height-pad}}),
    ...drawLine({...lineOptions,start:{x:pad,y:height-pad},end:{x:width-pad,y:pad}})
  ];
  return {normal:{on,off:[]},down:{on,off:[]}};
}

async function exportPdf(){
  setStatus("Building fillable PDF…");
  try{
    const doc=await PDFDocument.load(state.bytes.slice(),{ignoreEncryption:true}),form=doc.getForm(),font=await doc.embedFont(StandardFonts.Helvetica);
    for(const f of state.fields){const page=doc.getPages()[f.page-1],{width,height}=page.getSize(),opts={x:f.x*width,y:height-(f.y+f.h)*height,width:f.w*width,height:f.h*height,borderWidth:f.locked?0:f.border,borderColor:f.locked?undefined:rgb(.15,.38,.65),backgroundColor:undefined,textColor:rgb(.08,.12,.16),font};
      let field;const safe=f.name.replace(/[^\w .-]/g,"_");
      try{if(f.type==="checkbox"){field=form.createCheckBox(safe);field.addToPage(page,opts);if(f.markStyle==="x")field.updateAppearances(xMarkAppearance)}else{field=form.createTextField(safe);if(f.type==="signature")field.setText("");if(f.multiline)field.enableMultiline();field.addToPage(page,opts);field.setFontSize(f.fontSize);field.setAlignment({left:TextAlignment.Left,center:TextAlignment.Center,right:TextAlignment.Right}[f.alignment]??TextAlignment.Left);field.updateAppearances(font)}}catch{continue}
      if(f.required)field.enableRequired?.();
    }
    form.updateFieldAppearances(font);const bytes=await doc.save();const base=state.name.replace(/\.pdf$/i,"");
    const saved=await window.desktop.savePdf({bytes,suggestedName:`${base}-fillable.pdf`});if(saved){setStatus(`Saved ${saved}`);toast("Fillable PDF exported successfully")}
  }catch(err){console.error(err);setStatus("Export failed");toast(`Export failed: ${err.message}`)}
}

function packageManifest(pdfFieldNames){
  const formCode=$("formCode").value.trim();
  if(!formCode)throw new Error("Enter the official form code before exporting a system package.");
  const usedKeys=new Set();
  const fields=state.fields.map((field,index)=>{
    const systemKey=String(field.systemKey||"").trim();
    if(!systemKey)throw new Error(`Field ${field.name} needs a system key.`);
    if(usedKeys.has(systemKey))throw new Error(`System key ${systemKey} is used more than once.`);
    usedKeys.add(systemKey);
    return {
      pdf_field_name:pdfFieldNames[index],
      system_key:systemKey,
      official_box:String(field.box||"").trim(),
      page:Number(field.page),
      type:field.type==="checkbox"?"boolean":field.type,
      required:!!field.required,
      max_length:field.maxLength||null,
      placeholder:field.placeholder||"",
      geometry:{x:field.x,y:field.y,width:field.w,height:field.h}
    };
  });
  return {
    schema_version:1,
    form_code:formCode,
    source_filename:state.name,
    generated_at:new Date().toISOString(),
    fields
  };
}

async function buildPdfAndNames(){
  const doc=await PDFDocument.load(state.bytes.slice(),{ignoreEncryption:true}),form=doc.getForm(),font=await doc.embedFont(StandardFonts.Helvetica),names=[];
  for(const f of state.fields){
    const page=doc.getPages()[f.page-1],{width,height}=page.getSize(),opts={x:f.x*width,y:height-(f.y+f.h)*height,width:f.w*width,height:f.h*height,borderWidth:f.locked?0:f.border,borderColor:f.locked?undefined:rgb(.15,.38,.65),backgroundColor:undefined,textColor:rgb(.08,.12,.16),font};
    const preferred=String(f.systemKey||f.name).trim(),safe=preferred.replace(/[^\w .-]/g,"_");names.push(safe);
    let field;
    if(f.type==="checkbox"){field=form.createCheckBox(safe);field.addToPage(page,opts);if(f.markStyle==="x")field.updateAppearances(xMarkAppearance)}
    else{field=form.createTextField(safe);if(f.type==="signature")field.setText("");if(f.multiline)field.enableMultiline();field.addToPage(page,opts);field.setFontSize(f.fontSize);field.setAlignment({left:TextAlignment.Left,center:TextAlignment.Center,right:TextAlignment.Right}[f.alignment]??TextAlignment.Left);field.updateAppearances(font)}
    if(f.required)field.enableRequired?.();
  }
  form.updateFieldAppearances(font);
  return {bytes:await doc.save(),names};
}

async function exportSystemPackage(){
  setStatus("Building system form packageâ€¦");
  try{
    const {bytes,names}=await buildPdfAndNames(),manifest=packageManifest(names),base=state.name.replace(/\.pdf$/i,"");
    const saved=await window.desktop.savePackage({bytes,manifest,suggestedName:`${base}-system-fillable.pdf`});
    if(saved){setStatus(`Saved ${saved.pdfPath}`);toast("PDF and field map exported successfully")}
  }catch(err){console.error(err);setStatus("Package export failed");toast(`Package export failed: ${err.message}`)}
}

document.querySelectorAll(".tool").forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;document.querySelectorAll(".tool").forEach(x=>x.classList.toggle("active",x===b));setStatus(state.tool==="select"?"Select and resize fields":`Drag to create a ${state.tool} field`)});
$("openButton").onclick=$("welcomeOpen").onclick=openPdf;$("exportButton").onclick=exportPdf;$("exportPackageButton").onclick=exportSystemPackage;$("detectButton").onclick=prepareForm;
$("zoomIn").onclick=async()=>{if(!state.pdf)return;state.scale=Math.min(2.4,state.scale+.15);$("zoomLabel").textContent=`${Math.round(state.scale/1.15*100)}%`;await renderAll()};
$("zoomOut").onclick=async()=>{if(!state.pdf)return;state.scale=Math.max(.55,state.scale-.15);$("zoomLabel").textContent=`${Math.round(state.scale/1.15*100)}%`;await renderAll()};
$("fitButton").onclick=async()=>{if(!state.pdf)return;const page=await state.pdf.getPage(1),v=page.getViewport({scale:1}),available=$("stage").clientWidth-90;state.scale=Math.max(.55,Math.min(1.8,available/v.width));$("zoomLabel").textContent="Fit";await renderAll()};
document.addEventListener("keydown",e=>{if((e.key==="Delete"||e.key==="Backspace")&&state.selected&&!["INPUT","TEXTAREA"].includes(e.target.tagName))$("deleteField").click()});
window.addEventListener("error",e=>{console.error(e.error||e.message);setStatus("An application error occurred");toast(`Application error: ${e.message}`)});
window.addEventListener("unhandledrejection",e=>{console.error(e.reason);setStatus("An application error occurred");toast(`Application error: ${e.reason?.message||e.reason}`)});
