import React, { useMemo, useState } from "react";
import Papa from "papaparse";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const S = {
  page:{minHeight:"100vh",background:"linear-gradient(180deg,#ffffff, #f3f6fb)",padding:"24px",fontFamily:"Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial"},
  container:{maxWidth:"1100px",margin:"0 auto"},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"},
  h1:{fontSize:"26px",fontWeight:800,letterSpacing:"-0.02em",margin:0},
  button:{padding:"10px 14px",borderRadius:"14px",border:"1px solid #d0d7de",background:"#fff",cursor:"pointer",fontWeight:600,boxShadow:"0 1px 6px rgba(0,0,0,.05)"},
  card:{background:"#fff",border:"1px solid #e6e8ef",borderRadius:"18px",boxShadow:"0 2px 14px rgba(0,0,0,0.06)",padding:"16px",marginBottom:"16px"},
  label:{display:"block",fontSize:"12px",opacity:.7,marginBottom:"6px"},
  input:{padding:"10px",borderRadius:"12px",border:"1px solid #d0d7de",width:"100%"},
  grid:{display:"grid",gap:"12px"},
  grid2:{display:"grid",gap:"16px",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))"},
  metrics:{display:"grid",gap:"12px",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"},
  metricTitle:{fontSize:"11px",textTransform:"uppercase",opacity:.7},
  metricValue:{fontSize:"22px",fontWeight:800,marginTop:"4px"},
  muted:{fontSize:"12px",opacity:.7}
};

function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data || []).map((r) => ({
          datetime: new Date(r.datetime || r.date || r.timestamp),
          load_kwh: Number(r.load_kwh ?? r.load ?? r.kwh ?? 0) || 0,
          pv_kwh: r.pv_kwh !== undefined ? Number(r.pv_kwh) || 0 : (r.solar_kwh ? Number(r.solar_kwh)||0 : null),
          price_eur_per_kwh: r.price_eur_per_kwh !== undefined ? Number(r.price_eur_per_kwh) || null : (r.price ? Number(r.price)||null : null),
        }))
        .filter(r => r.datetime.toString() !== "Invalid Date" && !Number.isNaN(r.load_kwh));
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

function groupByDay(rows){
  const map = new Map();
  for(const r of rows){
    const d = new Date(r.datetime);
    const key = d.toISOString().slice(0,10);
    const cur = map.get(key) || { day: key, load:0, pv:0, cost:0, pts:0 };
    cur.load += r.load_kwh;
    cur.pv += (r.pv_kwh ?? 0);
    if (r.price_eur_per_kwh != null) cur.cost += Math.max(r.load_kwh - (r.pv_kwh ?? 0), 0) * r.price_eur_per_kwh;
    cur.pts += 1;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a,b)=>a.day.localeCompare(b.day));
}

function hourlyProfile(rows){
  const buckets = Array.from({length:24}, (_,h)=>({hour:h, load:0, pv:0, n:0}));
  for(const r of rows){
    const h = new Date(r.datetime).getHours();
    buckets[h].load += r.load_kwh;
    buckets[h].pv += (r.pv_kwh ?? 0);
    buckets[h].n += 1;
  }
  return buckets.map(b=>({hour:b.hour, load: +(b.n? b.load/b.n : 0).toFixed(3), pv: +(b.n? b.pv/b.n : 0).toFixed(3)}));
}

function computeKPIs(rows, areaM2){
  if(!rows.length) return null;
  const sorted = [...rows].sort((a,b)=>a.datetime-b.datetime);
  const energy_kwh = sorted.reduce((s,r)=>s + r.load_kwh, 0);
  const solar_kwh = sorted.reduce((s,r)=>s + (r.pv_kwh ?? 0), 0);
  const import_kwh = sorted.reduce((s,r)=> s + Math.max(r.load_kwh - (r.pv_kwh ?? 0), 0), 0);
  const export_kwh = sorted.reduce((s,r)=> s + Math.max((r.pv_kwh ?? 0) - r.load_kwh, 0), 0);
  const cost_eur = sorted.reduce((s,r)=> s + (r.price_eur_per_kwh!=null ? Math.max(r.load_kwh - (r.pv_kwh ?? 0),0)*r.price_eur_per_kwh : 0), 0);
  const night = sorted.filter(r=>{ const h = new Date(r.datetime).getHours(); return h>=2 && h<=5; });
  const base_load_kw = night.length ? night.reduce((s,r)=>s+r.load_kwh,0)/night.length : 0;
  const peak_kw = sorted.reduce((m,r)=> Math.max(m, r.load_kwh), 0);
  const profile = hourlyProfile(sorted);
  const pv_used = sorted.reduce((s,r)=> s + Math.min((r.pv_kwh ?? 0), r.load_kwh), 0);
  const autoconsumo_pct = solar_kwh>0 ? (pv_used/solar_kwh*100) : null;
  const eui = areaM2 ? (energy_kwh/areaM2) : null;
  const maxHour = profile.reduce((m,b)=> Math.max(m, b.load), 0);
  const minHour = profile.reduce((m,b)=> Math.min(m, b.load), Infinity);
  const ratio_peak_valley = (minHour===Infinity||minHour===0) ? null : maxHour/minHour;
  return {
    energy_kwh: +energy_kwh.toFixed(2),
    solar_kwh: +solar_kwh.toFixed(2),
    import_kwh: +import_kwh.toFixed(2),
    export_kwh: +export_kwh.toFixed(2),
    cost_eur: +cost_eur.toFixed(2),
    base_load_kw: +base_load_kw.toFixed(2),
    peak_kw: +peak_kw.toFixed(2),
    hourly_profile: profile,
    daily: groupByDay(sorted),
    autoconsumo_pct: autoconsumo_pct != null ? +autoconsumo_pct.toFixed(1) : null,
    eui: eui != null ? +eui.toFixed(2) : null,
    ratio_peak_valley: ratio_peak_valley != null ? +ratio_peak_valley.toFixed(2) : null,
  };
}

function downloadPDF(site, kpis){
  const doc = new jsPDF({ unit: "pt" });
  const title = `Informe energético – ${site.name || "EnergIA"}`;
  doc.setFontSize(18);
  doc.text(title, 40, 40);
  doc.setFontSize(12);
  doc.text(`Periodo: ${site.period || "(según datos)"}`, 40, 64);
  doc.text(`Área (m²): ${site.areaM2 || "N/D"}`, 40, 80);

  const table = [
    ["Energía (kWh)", kpis.energy_kwh],
    ["Consumo base nocturno (kW)", kpis.base_load_kw],
    ["Pico horario (kW)", kpis.peak_kw],
    ["Importación (kWh)", kpis.import_kwh],
    ["Exportación/Excedentes (kWh)", kpis.export_kwh],
    ["Autoconsumo (%)", kpis.autoconsumo_pct ?? "N/D"],
    ["Coste estimado (€)", kpis.cost_eur],
    ["EUI (kWh/m²)", kpis.eui ?? "N/D"],
    ["Ratio punta/valle", kpis.ratio_peak_valley ?? "N/D"],
  ];

  autoTable(doc, { head: [["KPI", "Valor"]], body: table, startY: 110 });

  doc.addPage();
  doc.setFontSize(14);
  doc.text("Recomendaciones automáticas", 40, 40);
  const recs = [];
  if (kpis.base_load_kw > 0.3) recs.push("Reducir consumo base nocturno: programar apagados y temporizadores.");
  if (kpis.ratio_peak_valley && kpis.ratio_peak_valley > 2) recs.push("Desplazar cargas a horas valle para suavizar picos.");
  if (kpis.autoconsumo_pct != null && kpis.autoconsumo_pct < 60) recs.push("Bajo autoconsumo: valorar batería 3–7 kWh y reprogramar consumos.");
  if (kpis.export_kwh > 1) recs.push("Excedentes frecuentes: aprovechar para ACS programando resistencias o batería.");
  if (!recs.length) recs.push("Operación correcta. Mantener horarios y revisar trimestralmente.");
  autoTable(doc, { head: [["Prioridad", "Medida"]], body: recs.map((r,i)=>[i+1, r]), startY: 60 });

  doc.save(`informe_energetico_${(site.name||"EnergIA").replace(/\s+/g,'_')}.pdf`);
}

function FileDrop({ onFile }){
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{border:"2px dashed #cbd5e1",borderRadius:16,padding:24,textAlign:"center",background:hover?"#f1f5f9":"#fff"}}
      onDragOver={(e)=>{e.preventDefault(); setHover(true);}}
      onDragLeave={()=>setHover(false)}
      onDrop={(e)=>{e.preventDefault(); setHover(false); const f=e.dataTransfer.files?.[0]; if(f) onFile(f);}}
    >
      <div style={{fontSize:12,opacity:.8}}>Arrastra tu CSV aquí o pulsa para seleccionar</div>
      <input type="file" accept=".csv" style={{marginTop:12}} onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f);}}/>
    </div>
  );
}

export default function App(){
  const [rows, setRows] = useState([]);
  const [areaM2, setAreaM2] = useState(0);
  const [siteName, setSiteName] = useState("EnergIA");

  const kpis = useMemo(()=> computeKPIs(rows, areaM2), [rows, areaM2]);

  const daily = kpis?.daily || [];

  return (
    <div style={S.page}>
      <div style={S.container}>
        {/* ===== HEADER con branding + botones ===== */}
        <div style={S.header}>
          <h1 style={S.h1}>🔧 ENERGIA <span style={{fontWeight:600}}> | Auditor Energético Automático 🏭</span></h1>
          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            <button style={S.button} onClick={()=>{
              // Datos sintéticos de ejemplo (48 horas)
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const rows = Array.from({length:48}, (_,i)=>{
                const dt = new Date(start.getTime() + i*3600*1000);
                const h = dt.getHours();
                const pv = Math.max(0, 3*Math.exp(-((h-13)**2)/(2*3.5**2)) + (Math.random()*0.2-0.1));
                const base = 0.6 + 0.15*Math.sin(h/24*2*Math.PI);
                const morning = 0.8*Math.exp(-((h-9)**2)/(2*2));
                const evening = 1.2*Math.exp(-((h-20)**2)/(2*2.5));
                const load = Math.max(0.3, base+morning+evening + (Math.random()*0.2-0.1));
                const price = 0.14 + (h>=19&&h<=23?0.08:0) + (h>=2&&h<=5?-0.03:0) + (Math.random()*0.01-0.005);
                return { datetime: dt, load_kwh: +load.toFixed(3), pv_kwh: +pv.toFixed(3), price_eur_per_kwh: +price.toFixed(3)};
              });
              setRows(rows);
            }}>Cargar datos de ejemplo</button>

            <button style={S.button} onClick={()=>{
              const el = document.getElementById("instaladores");
              if (el) el.scrollIntoView({behavior:"smooth"});
            }}>Panel instaladores</button>

            <a
              href="mailto:online.lmg28@gmail.com?subject=Solicitud%20de%20acceso%20EnergIA&body=Hola%2C%20quiero%20probar%20EnergIA%20para%20mis%20clientes.%20Empresa%3A%20___%20%7C%20N%C2%BA%20instalaciones%20al%20a%C3%B1o%3A%20___"
              style={{...S.button, textDecoration:"none", display:"inline-block"}}
            >
              Solicitar acceso
            </a>
          </div>
        </div>

        {/* ===== FORM / INGESTA ===== */}
        <div style={S.card}>
          <div style={S.grid}>
            <div>
              <label style={S.label}>Nombre del sitio</label>
              <input style={S.input} placeholder="Oficina Centro / Casa Sol" value={siteName} onChange={(e)=>setSiteName(e.target.value)}/>
            </div>
            <div>
              <label style={S.label}>Área (m²) opcional</label>
              <input type="number" style={S.input} placeholder="ej. 120" value={areaM2} onChange={(e)=>setAreaM2(Number(e.target.value)||0)}/>
            </div>
          </div>
        </div>

        {/* ===== CSV UPLOAD ===== */}
        <div style={S.card}>
          <div style={{marginBottom:8, ...S.muted}}>Sube tu CSV (mínimo: <code>datetime, load_kwh</code>)</div>
          <FileDrop onFile={async(f)=>{
            const parsed = await parseCSV(f);
            setRows(parsed);
          }}/>
          <div style={{marginTop:8, ...S.muted}}>Opcionales: <code>pv_kwh</code>, <code>price_eur_per_kwh</code>. Coma o punto y coma.</div>
        </div>

        {/* ===== DASHBOARD ===== */}
        <div style={S.card}>
          {!kpis ? (
            <div style={S.muted}>Sube datos o usa “Cargar datos de ejemplo” para ver el dashboard.</div>
          ):(
            <>
              <div style={S.metrics}>
                <Metric title="Energía (kWh)" value={kpis.energy_kwh}/>
                <Metric title="Base nocturna (kW)" value={kpis.base_load_kw}/>
                <Metric title="Pico (kW)" value={kpis.peak_kw}/>
                <Metric title="Coste (€)" value={kpis.cost_eur}/>
              </div>

              <div style={S.grid2}>
                <div style={{height:300}}>
                  <h3 style={{margin:"8px 0 6px 0"}}>Perfil horario medio</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={kpis.hourly_profile}>
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="load" name="Demanda (kWh)" dot={false} />
                      {kpis.hourly_profile.some(d=>d.pv>0) && (
                        <Line type="monotone" dataKey="pv" name="PV (kWh)" dot={false} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{height:300}}>
                  <h3 style={{margin:"8px 0 6px 0"}}>Energía diaria</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={kpis.daily}>
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="load" name="Consumo (kWh)" />
                      {kpis.daily.some(d=>d.pv>0) && <Bar dataKey="pv" name="PV (kWh)" />}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={S.metrics}>
                <Metric title="Importación (kWh)" value={kpis.import_kwh}/>
                <Metric title="Excedentes (kWh)" value={kpis.export_kwh}/>
                <Metric title="Autoconsumo (%)" value={kpis.autoconsumo_pct ?? "N/D"}/>
              </div>
            </>
          )}
        </div>

        {/* ===== PDF ===== */}
        <div style={S.card}>
          {!kpis ? (
            <div style={S.muted}>Sube datos o usa los datos de ejemplo para generar el PDF.</div>
          ):(
            <>
              <div style={S.muted}>Genera un informe PDF profesional con KPIs y recomendaciones automáticas.</div>
              <button style={S.button} onClick={()=>downloadPDF({ name: siteName||"EnergIA", areaM2, period: "según datos" }, kpis)}>
                Descargar informe PDF
              </button>
            </>
          )}
        </div>

        {/* ===== LANDING INSTALADORES ===== */}
        <div id="instaladores" style={{...S.card, marginTop:24}}>
          <h2 style={{marginTop:0}}>Panel para instaladores</h2>
          <p style={S.muted}>
            Servicio profesional para instaladores solares y de climatización. Dashboard automático + informe PDF mensual
            listo para enviar al cliente. Marca blanca disponible.
          </p>

          <ul style={{margin:"8px 0 12px 18px"}}>
            <li>🔧 Reduce soporte post-instalación (el informe responde dudas).</li>
            <li>🏭 Detecta consumos fuera de horario y oportunidades de ahorro.</li>
            <li>☀️ Calcula autoconsumo, excedentes y recomendación de batería.</li>
            <li>📄 PDF mensual automático con KPIs y acciones recomendadas.</li>
            <li>💶 Nuevo ingreso recurrente por cliente (tu servicio post-venta).</li>
          </ul>

          <div style={{display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))"}}>
            <div style={{border:"1px solid #e6e8ef", borderRadius:12, padding:12}}>
              <div style={{fontWeight:700}}>Starter</div>
              <div style={{...S.muted}}>Hasta 10 clientes</div>
              <div style={{fontSize:22, fontWeight:800, margin:"6px 0"}}>49 €/mes</div>
            </div>
            <div style={{border:"1px solid #e6e8ef", borderRadius:12, padding:12}}>
              <div style={{fontWeight:700}}>Pro</div>
              <div style={{...S.muted}}>Hasta 50 clientes</div>
              <div style={{fontSize:22, fontWeight:800, margin:"6px 0"}}>99 €/mes</div>
            </div>
            <div style={{border:"1px solid #e6e8ef", borderRadius:12, padding:12}}>
              <div style={{fontWeight:700}}>Partner</div>
              <div style={{...S.muted}}>Hasta 200 clientes</div>
              <div style={{fontSize:22, fontWeight:800, margin:"6px 0"}}>199 €/mes</div>
            </div>
          </div>

          <div style={{marginTop:14, display:"flex", gap:8, flexWrap:"wrap"}}>
            <a
              href="mailto:online.lmg28@gmail.com?subject=Alta%20instalador%20EnergIA&body=Empresa%3A%20___%0AContacto%3A%20___%0AN%C2%BA%20clientes%20activos%3A%20___"
              style={{...S.button, textDecoration:"none"}}
            >
              Solicitar acceso
            </a>
            <a
              href="mailto:online.lmg28@gmail.com?subject=Demos%20EnergIA&body=Quiero%20ver%20una%20demo%20con%20nuestros%20datos."
              style={{...S.button, textDecoration:"none"}}
            >
              Pedir demo con mis datos
            </a>
          </div>
        </div>

        <div style={{...S.muted, textAlign:"center", paddingTop:12}}>EnergIA – MVP demo. CSV mínimo: datetime, load_kwh.</div>
      </div>
    </div>
  );
}

function Metric({ title, value }){
  return (
    <div style={{padding:14,borderRadius:16,background:"#fff",border:"1px solid #e6e8ef",boxShadow:"0 1px 8px rgba(0,0,0,.04)"}}>
      <div style={{fontSize:11,opacity:.7,textTransform:"uppercase"}}>{title}</div>
      <div style={{fontSize:22,fontWeight:800,marginTop:4}}>{value}</div>
    </div>
  );
}
