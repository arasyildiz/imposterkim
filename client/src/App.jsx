import React, { useEffect, useMemo, useState } from "react";
import io from "socket.io-client";
import initParticles from "./particles";
import SettingsModal from "./components/SettingsModal.jsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const socket = io(SERVER_URL, { transports: ["websocket"] });

export default function App(){
  const [view, setView] = useState("home");              // home | lobby | game | voting | results
  const [room, setRoom] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");

  const [privateCard, setPrivateCard] = useState(null);
  const [order, setOrder] = useState([]);
  const [round, setRound] = useState(0);

  const [clue, setClue] = useState("");
  const [clues, setClues] = useState([]);                // tüm turların ipuçları
  const [votingType, setVotingType] = useState("secret");
  const [results, setResults] = useState(null);

  const [currentSpeakerId, setCurrentSpeakerId] = useState(null);
  const [currentSpeakerNick, setCurrentSpeakerNick] = useState("-");
  const [endsAt, setEndsAt] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());

  const [showSettings, setShowSettings] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // tek tıkla oy verme
  const [myVote, setMyVote] = useState("");

  const isMyTurn = currentSpeakerId===socket.id;
  const me = room?.players?.find(p=>p.id===socket.id);

  const ding = useMemo(() => new Audio("/ding.mp3"), []);

  useEffect(()=>{ initParticles(); },[]);
  useEffect(()=>{ const t=setInterval(()=>setNowTs(Date.now()),250); return ()=>clearInterval(t); },[]);
  useEffect(()=>{ if(isMyTurn){ try{ ding.currentTime=0; ding.play(); }catch(e){} } },[isMyTurn, ding]);

  // duplicate ipucu engelleme
  function hasClue(r, nick, text){
    return clues.some(c => c.round===r && c.nickname===nick && c.text===text);
  }

  useEffect(()=>{
    socket.on("error_message", ({message}) => setError(message));
    socket.on("room_update", (r)=> setRoom(r));
    socket.on("game_started", ({room:r})=>{ setRoom(r); setView("game"); setMyVote(""); });
    socket.on("private_card", (pc)=> setPrivateCard(pc));
    socket.on("round_started", ({round, order})=>{
      setRound(round);
      setOrder(order);
      setClue("");                 // sadece input temizlenir
    });
    socket.on("clue_accepted", ({round, clue})=>{
      if(!hasClue(round, clue.nickname, clue.text)){
        setClues(prev => [...prev, {round, ...clue}]);
      }
    });
    socket.on("turn_update", ({ round, currentSpeakerId, currentSpeakerNickname, endsAt })=>{
      setRound(round);
      setCurrentSpeakerId(currentSpeakerId);
      setCurrentSpeakerNick(currentSpeakerNickname || "-");
      setEndsAt(endsAt || null);
    });
    socket.on("voting_started", ({ votingType })=>{
      setVotingType(votingType);
      setMyVote("");
      setTimeout(()=> setView("voting"), 700); // son ipucu görünür kalsın
    });
    socket.on("game_results", (res)=>{ setResults(res); setView("results"); });
    return ()=> socket.off();
  },[clues]);

  // sekme kapanırken otomatik leave
  useEffect(() => {
    const onUnload = () => {
      if (room?.id) { try { socket.emit('leave_room', { roomId: room.id }); } catch(e){} }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [room?.id]);

  // oda/katılım
  function createRoom(){ setShowSettings(true); }
  function confirmCreateRoom({ rounds, category, votingType, waitSeconds }){
    setShowSettings(false);
    socket.emit("create_room", { nickname, rounds, category, votingType, waitSeconds });
    setView("lobby");
  }
  function joinRoom(){ socket.emit("join_room", { roomId, nickname }); setView("lobby"); }
  function toggleReady(ready){ socket.emit("toggle_ready", { roomId: room?.id, ready }); }
  function startGame(){
    if(isStarting) return;
    setIsStarting(true);
    socket.emit("start_game", { roomId: room?.id });
    setTimeout(()=> setIsStarting(false), 1500);
  }

  // ipucu gönder — optimistic ekle
  function submitClue(){
    if(!clue.trim()) return;
    const optimistic = { round, nickname: me?.nickname || "Ben", text: clue.trim() };
    if(!hasClue(optimistic.round, optimistic.nickname, optimistic.text)){
      setClues(prev => [...prev, optimistic]);
    }
    socket.emit("submit_clue", { roomId: room?.id, text: clue.trim() });
    setClue("");
  }

  // tek tıkla oy ver
  function sendVote(targetId){
    if(!room?.id || myVote) return;   // ikinci oy engeli
    setMyVote(targetId);
    socket.emit("submit_vote", { roomId: room.id, targetId });
  }

  function playAgainSameRoom(){
    if (room?.id) socket.emit("reset_room", { roomId: room.id }); // server -> lobby + everyone isReady=false
    setResults(null);
    setClues([]);
    setMyVote("");
    setView("lobby");
  }

  function leaveRoom(){
    try { socket.emit("leave_room", { roomId: room?.id }); } catch(e){}
    setResults(null);
    setRoom(null);
    setRoomId("");
    setPrivateCard(null);
    setClues([]);
    setMyVote("");
    setView("home");
  }

  return (
    <div className='container'>
      <canvas id="particle-canvas"></canvas>

      {error && <div className='chip' style={{background:"#401b1b"}}>Hata: {error}</div>}

      {/* HOME */}
      {view==="home" && (
        <div className="container">
          <input placeholder="Takma ad" value={nickname} onChange={e=>setNickname(e.target.value)} />
          <input placeholder="Oda kodu (katılmak için)" value={roomId} onChange={e=>setRoomId(e.target.value)} />
          <button onClick={createRoom} disabled={!nickname}>Oda Oluştur</button>
          <button onClick={joinRoom} disabled={!nickname || !roomId}>Odaya Katıl</button>
        </div>
      )}

      {/* LOBBY */}
      {view==="lobby" && room && (
        <div className="container">
          <div className="room-info">
            <div><b>Oda:</b> {room.id}</div>
            <div><b>Tur:</b> {room.settings.rounds}</div>
            <div><b>Bekleme:</b> {room.settings.waitSeconds} sn</div>
          </div>

          <div className="player-list">
            {room.players.map((p) => (
              <div key={p.id} className="player-item">
                <span>{p.nickname} {p.id===room.hostId && "(Host)"}</span>
                <span className={`status-dot ${p.isReady ? "status-ready" : "status-not-ready"}`}></span>
              </div>
            ))}
          </div>

          <button onClick={()=>toggleReady(!me?.isReady)}>
            {me?.isReady ? "Hazır Değilim" : "Hazırım"}
          </button>
          {socket.id===room.hostId && <button onClick={startGame} disabled={isStarting}>Oyunu Başlat</button>}
        </div>
      )}

      {/* GAME */}
      {view==="game" && room && (
        <div className="container">
          <div className='room-info fade-slide' style={{width:320}}>
            <div><b>Tur:</b> {round} / {room.settings.rounds}</div>
            <div><b>Şimdi konuşan:</b> {currentSpeakerNick}</div>
            <div><b>Kalan süre:</b> {endsAt? Math.max(0, Math.ceil((endsAt-nowTs)/1000)) : 0} sn</div>
          </div>

          <div className='player-list' style={{width:320}}>
            <div style={{fontWeight:800, marginBottom:6}}>Kartın</div>
            {privateCard?.role==="player" && (<div>Gizli kelime: <b>{privateCard.word}</b></div>)}
            {privateCard?.role==="imposter" && (<div>İpucu: <b>{privateCard.hint}</b> <span className='badge'>İmposter</span></div>)}
          </div>

          <textarea className={isMyTurn?'glow':''}
            placeholder={isMyTurn? "Tek cümle ipucu (kelimeyi söyleme!)":"Sıra sende değil"}
            value={clue} onChange={e=>setClue(e.target.value)} disabled={!isMyTurn} />
          <button className={isMyTurn?'glow':''} onClick={submitClue} disabled={!isMyTurn}>İpucumu Gönder</button>

          {/* Turlara göre gruplanmış ipuçları */}
          <div style={{ marginTop: 12, width: 320 }}>
            {[...new Set(clues.map(c => c.round))].map((r) => (
              <div key={r} style={{ marginBottom: 10, background: "rgba(0,0,0,.45)", padding: 10, borderRadius: 10 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Tur {r}</div>
                {clues.filter(c => c.round === r).map((m, i) => (
                  <div key={i} style={{ margin: "4px 0" }}>
                    <b>{m.nickname}:</b> {m.text}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className='footer'>Tüm turlar bitince tek oylama yapılacak.</div>
        </div>
      )}

      {/* VOTING */}
      {view==="voting" && room && (
        <div className="container">
          <div style={{ fontSize: "1.2rem", marginBottom: 8 }}>Oylama</div>

          {room.players.map((p) => {
            const selected = myVote === p.id;
            return (
              <div key={p.id} className={`vote-card ${selected ? "selected" : ""}`}>
                <span className="vote-name">{p.nickname}</span>
                <button
                  className={`vote-btn ${selected ? "selected" : ""}`}
                  onClick={() => sendVote(p.id)}
                  disabled={!!myVote}
                >
                  {selected ? "Oy verildi" : "Seç"}
                </button>
              </div>
            );
          })}

          <div style={{ opacity:.8, marginTop:6 }}>
            {votingType==="open" ? "Açık oylama: herkesin seçimi görünür." : "Gizli oylama: seçimler görünmez."}
            {" "}Herkes oy verince sonuç ekranı açılır.
          </div>
        </div>
      )}

      {/* RESULTS + aksiyonlar */}
      {view==="results" && results && (() => {
        const playersWin = results.selectedNickname === results.imposterNickname;
        const winnerClass = playersWin ? "crew" : "imp";
        const winnerText  = playersWin ? "Oyuncular Kazandı! 🎉" : "İmposter Kazandı! 😈";

        return (
          <div className="container">
            <div className="results-box">
              <div className={`results-title ${winnerClass}`}>{winnerText}</div>

              <div className='room-info' style={{ width: "100%", margin: "0 auto" }}>
                <div><b>Seçilen:</b> {results.selectedNickname}</div>
                <div><b>Imposter:</b> {results.imposterNickname}</div>
                <div><b>Gizli kelime:</b> {results.secretWord}</div>
                <div><b>İmposter ipucu:</b> {results.imposterHint}</div>
              </div>

              <div style={{ marginTop: 12, textAlign:"left" }}>
                {[...new Set(results.clues.map(c => c.round))].map((r) => (
                  <div key={r} style={{ marginBottom: 10, background: "rgba(0,0,0,.25)", padding: 10, borderRadius: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Tur {r}</div>
                    {results.clues.filter(c => c.round === r).map((m, i) => (
                      <div key={i} style={{ margin: "4px 0" }}>
                        <b>{m.nickname}:</b> {m.text}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="actions-row">
                <button onClick={playAgainSameRoom}>Yeniden Oyna (Aynı Oda)</button>
                <button className="secondary" onClick={leaveRoom}>Odadan Çık</button>
              </div>

              {room?.hostId === socket.id && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={()=> socket.emit("start_game", { roomId: room?.id })}>
                    Host: Hemen Başlat
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <SettingsModal open={showSettings} onClose={()=>setShowSettings(false)} onCreate={confirmCreateRoom} />
    </div>
  );
}
