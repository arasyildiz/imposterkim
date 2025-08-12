import React from "react";

export default function SettingsModal({ open, onClose, onCreate }){
  const [rounds, setRounds] = React.useState(3);
  const [category, setCategory] = React.useState("All");
  const [votingType, setVotingType] = React.useState("secret");
  const [waitSeconds, setWaitSeconds] = React.useState(20);

  if(!open) return null;

  function submit(e){
    e.preventDefault();
    const r = Math.max(1, Math.min(10, Number(rounds)||3));
    onCreate({ rounds: r, category, votingType, waitSeconds: Number(waitSeconds) });
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={e=>e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{fontWeight:800,fontSize:18}}>Oda Ayarları</div>
          <button onClick={onClose} style={styles.close}>✕</button>
        </div>
        <form onSubmit={submit} style={{display:"grid", gap:10}}>
          <label style={styles.label}>
            <span>Tur sayısı</span>
            <input type="number" min="1" max="10" value={rounds} onChange={e=>setRounds(e.target.value)} />
          </label>

          <label style={styles.label}>
            <span>Kategori</span>
            <select value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="All">Tümü</option>
              <option value="Food">Yemek</option>
              <option value="Sports">Spor</option>
              <option value="Movies">Filmler</option>
              <option value="Animals">Hayvanlar</option>
            </select>
          </label>

          <label style={styles.label}>
            <span>Oylama türü</span>
            <select value={votingType} onChange={e=>setVotingType(e.target.value)}>
              <option value="secret">Gizli</option>
              <option value="open">Açık</option>
            </select>
          </label>

          <label style={styles.label}>
            <span>Bekleme süresi (saniye)</span>
            <select value={waitSeconds} onChange={e=>setWaitSeconds(Number(e.target.value))}>
              {[10,15,20,30,45,60,90,120].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <button type="submit" style={styles.create}>Odayı Oluştur</button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  backdrop: { position:"fixed", inset:0, background:"rgba(0,0,0,.55)", display:"grid", placeItems:"center", zIndex:9999, padding:"16px" },
  modal: { width:"100%", maxWidth:420, background:"#171a2f", color:"#eef2ff", borderRadius:16, padding:16, boxShadow:"0 20px 60px rgba(0,0,0,.5)" },
  header: { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 },
  close: { background:"#22284d", border:"none", color:"#cbd5ff", padding:"6px 10px", borderRadius:10, cursor:"pointer" },
  label: { display:"grid", gap:6 },
  create: { background:"#7c5cff", border:"none", padding:"12px", borderRadius:12, color:"#fff", fontWeight:700, cursor:"pointer" }
};
