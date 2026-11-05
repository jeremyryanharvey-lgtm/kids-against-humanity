const $=id=>document.getElementById(id);
let code="",playerId="",socket=null,isHost=false;
const msg=t=>$("message").textContent=t;
async function api(path,body){
  const r=await fetch(path,{method:body?"POST":"GET",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Something went wrong.");return d;
}
function showRoom(){ $("home").classList.add("hidden");$("room").classList.remove("hidden");$("roomCode").textContent=code; }
function connect(){
  const scheme=location.protocol==="https:"?"wss":"ws";
  socket=new WebSocket(`${scheme}://${location.host}/api/rooms/${code}/socket?playerId=${encodeURIComponent(playerId)}`);
  socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==="state")render(d.state)};
  socket.onclose=()=>setTimeout(()=>{if(code)connect()},1800);
}
function send(type,extra={}){if(socket?.readyState===1)socket.send(JSON.stringify({type,playerId,...extra}));}
function render(s){
  $("status").textContent=`Round ${s.round||0} · ${s.status}`;
  $("players").innerHTML=s.players.map(p=>`<li>${escapeHtml(p.name)} — ${p.score} points ${p.id===s.judgeId?"👑 Judge":""}</li>`).join("");
  $("start").classList.toggle("hidden",!isHost||s.status!=="lobby");
  const area=$("gameArea");area.innerHTML="";
  if(s.status==="lobby"){area.innerHTML="<p>Waiting for everyone to join. You need at least 3 players.</p>";return}
  if(s.status==="finished"){area.innerHTML="<h2>Game over!</h2>";return}
  if(s.question){area.innerHTML=`<h2>${escapeHtml(s.question)}</h2>`}
  if(s.status==="playing"&&!s.revealed&&playerId!==s.judgeId){
    const box=document.createElement("div");box.innerHTML='<label>Your answer<input id="answer" maxlength="100" placeholder="Write something funny"></label><button id="submit">Submit answer</button>';area.append(box);
    box.querySelector("#submit").onclick=()=>{send("submit",{answer:box.querySelector("#answer").value});box.innerHTML="<p>Answer submitted. Waiting for the others…</p>"};
  } else if(s.status==="playing"&&!s.revealed){area.innerHTML+="<p>You're judging. Waiting for the answers…</p>"}
  if(s.revealed&&playerId===s.judgeId){
    area.innerHTML+="<h3>Choose the funniest answer</h3>";
    s.submissions.forEach(a=>{const b=document.createElement("button");b.className="answer";b.textContent=a.answer;b.onclick=()=>send("pick",{winnerId:a.playerId});area.append(b)});
  } else if(s.revealed&&s.status==="playing"){area.innerHTML+="<p>All answers are in. The judge is choosing…</p>"}
  if(s.status==="between"){
    const winner=s.players.find(p=>p.id===s.winnerId);area.innerHTML+=`<h3>Round winner: ${escapeHtml(winner?.name||"Player")}!</h3>`;
    if(isHost){const b=document.createElement("button");b.textContent="Next round";b.onclick=()=>send("next");area.append(b)}
  }
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("create").onclick=async()=>{try{const name=$("name").value.trim()||"Host";const d=await api("/api/rooms",{});code=d.code;playerId=d.playerId;isHost=true;showRoom();connect();msg("")}catch(e){msg(e.message)}};
$("join").onclick=async()=>{try{code=$("code").value.trim().toUpperCase();const name=$("name").value.trim();if(!name)throw Error("Enter your name first.");const d=await api(`/api/rooms/${code}/join`,{name});playerId=d.playerId;isHost=false;showRoom();connect();msg("")}catch(e){msg(e.message)}};
$("start").onclick=()=>send("start");
if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
