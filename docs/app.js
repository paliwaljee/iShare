const $ = s => document.querySelector(s);
// GitHub Pages is static. Set this to your deployed WebSocket signaling server.
// Example: const SIGNALING_URL = "wss://your-server.example.com";
const SIGNALING_URL = window.INTRASEND_SIGNALING_URL || "";
const ws = SIGNALING_URL ? new WebSocket(SIGNALING_URL) : null;
let myId, myCode, peerId, pc, dc, pendingFiles = [];
const CHUNK = 64 * 1024;
const incoming = new Map();

function msg(text){ $("#message").textContent = text; }
function sendSignal(to,data){ sendWS({type:"signal",to,data}); }

function sendWS(data){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); }
if(ws){
  ws.onopen = () => msg("Ready. Share your code or connect to another device.");
  ws.onclose = () => { $("#statusDot").style.background="#ef4444"; msg("Signaling server disconnected."); };
  ws.onmessage = async e => {
  const m = JSON.parse(e.data);
  if(m.type==="hello"){
    myId=m.id; myCode=m.pairingCode; $("#myCode").textContent=myCode;
    $("#qrCodeText").textContent=myCode;
  }
  if(m.type==="pair-error") msg(m.message);
  if(m.type==="paired"){
    peerId=m.peerId; msg("Device paired. Establishing secure P2P connection…");
    if(myId < peerId) await makeOffer();
  }
  if(m.type==="signal") await handleSignal(m.from,m.data);
  };
} else {
  msg("GitHub Pages mode: configure a WebSocket signaling server in app.js.");
  $("#statusDot").style.background="#ef4444";
}

async function makePC(){
  pc = new RTCPeerConnection({iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun.cloudflare.com:3478"}
  ]});
  pc.onicecandidate = e => { if(e.candidate) sendSignal(peerId,{candidate:e.candidate}); };
  pc.onconnectionstatechange = () => {
    if(["connected","completed"].includes(pc.connectionState)){
      $("#statusDot").style.background="#22c55e"; $("#peerText").textContent="Connected — ready to transfer";
      msg("Connected directly via WebRTC.");
    }
  };
  pc.ondatachannel = e => setupChannel(e.channel);
}
function setupChannel(channel){
  dc=channel; dc.binaryType="arraybuffer";
  dc.onopen=()=>{ $("#peerText").textContent="Connected — ready to transfer"; msg("Secure transfer channel is ready."); };
  dc.onmessage=e=>receiveData(e.data);
}
async function makeOffer(){
  await makePC(); setupChannel(pc.createDataChannel("files",{ordered:true}));
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
  sendSignal(peerId,{description:pc.localDescription});
}
async function handleSignal(from,data){
  peerId=from;
  if(!pc) await makePC();
  if(data.description){
    await pc.setRemoteDescription(data.description);
    if(data.description.type==="offer"){
      const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
      sendSignal(peerId,{description:pc.localDescription});
    }
  } else if(data.candidate) {
    try{ await pc.addIceCandidate(data.candidate); }catch{}
  }
}

$("#pairBtn").onclick=()=>{
  const c=$("#codeInput").value.replace(/\D/g,"").slice(0,6);
  if(c.length!==6) return msg("Enter a valid 6-digit code.");
  sendWS({type:"pair",code:c}); msg("Pairing…");
};
$("#codeInput").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,6);

$("#qrBtn").onclick=()=>{
  $("#modal").classList.remove("hidden");
  if(window.QRCode) QRCode.toCanvas($("#qrCanvas"), `${location.origin}/?pair=${myCode}`, {width:220,margin:2});
};
$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
$("#themeBtn").onclick=()=>document.body.classList.toggle("dark");

$("#fileInput").onchange=e=>addFiles([...e.target.files]);
const dz=$("#dropzone");
["dragenter","dragover"].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.opacity=.65}));
["dragleave","drop"].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.opacity=1}));
dz.addEventListener("drop",e=>addFiles([...e.dataTransfer.files]));

function addFiles(files){
  if(!dc || dc.readyState!=="open") return msg("Connect to another device first.");
  files.forEach(file=>sendFile(file));
}
function item(file){
  const id=crypto.randomUUID();
  const el=document.createElement("div"); el.className="transferItem"; el.id=id;
  el.innerHTML=`<div class="row"><span class="filename">${escapeHtml(file.name)}</span><span class="meta">${formatBytes(file.size)}</span></div><div class="bar"><i></i></div><div class="meta state">Preparing…</div>`;
  $("#queue").prepend(el); return el;
}
async function sendFile(file){
  const el=item(file), bar=el.querySelector("i"), state=el.querySelector(".state");
  dc.bufferedAmountLowThreshold=CHUNK*4;
  dc.send(JSON.stringify({kind:"file-start",id:file.name+"-"+file.size+"-"+Date.now(),name:file.name,size:file.size,type:file.type}));
  let offset=0;
  while(offset<file.size){
    if(dc.bufferedAmount > CHUNK*12) await new Promise(r=>{dc.onbufferedamountlow=r});
    const buf=await file.slice(offset,offset+CHUNK).arrayBuffer();
    dc.send(buf); offset+=buf.byteLength;
    const pct=Math.round(offset/file.size*100); bar.style.width=pct+"%"; state.textContent=`Sending… ${pct}%`;
  }
  dc.send(JSON.stringify({kind:"file-end"})); state.textContent="Sent ✓";
}
function receiveData(data){
  if(typeof data==="string"){
    let m; try{m=JSON.parse(data)}catch{return}
    if(m.kind==="file-start"){incoming.set("current",{name:m.name,size:m.size,type:m.type,chunks:[],received:0}); addIncoming(m)}
    if(m.kind==="file-end") finishIncoming();
    return;
  }
  const x=incoming.get("current"); if(!x)return;
  x.chunks.push(data); x.received+=data.byteLength; updateIncoming(x);
}
function addIncoming(x){
  const el=item({name:x.name,size:x.size}); el.dataset.incoming="1"; x.el=el;
}
function updateIncoming(x){
  if(!x.el)return; const pct=Math.round(x.received/x.size*100); x.el.querySelector("i").style.width=pct+"%"; x.el.querySelector(".state").textContent=`Receiving… ${pct}%`;
}
function finishIncoming(){
  const x=incoming.get("current"); if(!x)return;
  const blob=new Blob(x.chunks,{type:x.type||"application/octet-stream"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=x.name; a.click();
  x.el.querySelector(".state").textContent="Received ✓"; incoming.delete("current");
}
function formatBytes(n){if(n<1024)return n+" B";let u=["KB","MB","GB","TB"],i=-1;do{n/=1024;i++}while(n>=1024&&i<u.length-1);return n.toFixed(n<10?1:0)+" "+u[i]}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

const q=new URLSearchParams(location.search).get("pair");
if(q){ $("#codeInput").value=q; }
