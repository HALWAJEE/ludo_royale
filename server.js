const express=require("express"),http=require("http"),path=require("path"),{WebSocketServer}=require("ws");
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server});
const rooms=new Map(); const colors=["red","green","yellow","blue"];
app.use(express.static(path.join(__dirname,"public")));
app.get("*",(q,r)=>r.sendFile(path.join(__dirname,"public","index.html")));
function send(ws,m){if(ws.readyState===1)ws.send(JSON.stringify(m))}
function code(){let s;do{s=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(s));return s}
function state(r){return{roomId:r.id,players:r.players.map(p=>({id:p.id,name:p.name,color:p.color})),started:r.started,game:r.game}}
function broadcast(r,m){r.players.forEach(p=>send(p.ws,m))}
function newGame(){return{turn:0,dice:null,rolled:false,winner:null}}
wss.on("connection",ws=>{
 ws.id=Math.random().toString(36).slice(2); ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="create"||m.type==="join"){
   let id=m.type==="create"?code():String(m.roomId||"").toUpperCase(),r=rooms.get(id);
   if(m.type==="join"&&!r)return send(ws,{type:"error",message:"Room not found."});
   if(!r){r={id,players:[],started:false,game:null};rooms.set(id,r)}
   if(r.players.length>=4)return send(ws,{type:"error",message:"Room is full."});
   const p={ws,id:ws.id,name:String(m.name||"Player").slice(0,16),color:colors[r.players.length]};
   r.players.push(p);ws.room=id;send(ws,{type:"joined",selfId:ws.id,state:state(r)});broadcast(r,{type:"state",state:state(r)});return;
  }
  const r=rooms.get(ws.room);if(!r)return;
  if(m.type==="start"){
   if(r.players.length<2)return send(ws,{type:"error",message:"At least 2 players are needed."});
   r.started=true;r.game=newGame();broadcast(r,{type:"state",state:state(r)});return;
  }
  if(m.type==="roll"){
   if(!r.started||!r.game)return;
   const p=r.players[r.game.turn%r.players.length];if(p.id!==ws.id||r.game.rolled)return;
   r.game.dice=1+Math.floor(Math.random()*6);r.game.rolled=true;
   if(r.game.dice!==6)r.game.turn=(r.game.turn+1)%r.players.length,r.game.rolled=false;
   else r.game.rolled=false;
   broadcast(r,{type:"state",state:state(r)});
  }
 });
 ws.on("close",()=>{const r=rooms.get(ws.room);if(!r)return;r.players=r.players.filter(p=>p.ws!==ws);if(!r.players.length)rooms.delete(r.id);else broadcast(r,{type:"state",state:state(r)})});
});
const PORT=process.env.PORT||3000;server.listen(PORT,"0.0.0.0",()=>console.log("Ludo online server on "+PORT));
