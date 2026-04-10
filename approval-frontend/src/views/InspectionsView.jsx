export default function InspectionsView({ apps }) {
  const all = apps.flatMap(a => a.assessment.inspections.map(i => ({ ...i, appId: a.id, owner: a.owner.name })));
  return <div>
    <h2 style={{ fontSize: 22, fontWeight: T.w.black, color: T.c.text, margin: "0 0 16px" }}>Inspections</h2>
    <div style={{ background: T.c.card, borderRadius: 14, border: `1px solid ${T.c.border}`, overflow: "hidden" }}>
      {all.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: T.c.textMuted }}>No inspections</div> :
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: T.c.bg }}>{["App","Owner","Type","Date","Inspector","Status"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,color:"#5a6a74",fontSize:10,textTransform:"uppercase",borderBottom:"1px solid #e4e9ec"}}>{h}</th>)}</tr></thead>
        <tbody>{all.map((ins,i) => <tr key={i}><td style={{padding:"9px 12px",fontWeight:700,color:"#2980b9",borderBottom:"1px solid #f0f3f5"}}>{ins.appId}</td><td style={{padding:"9px 12px",borderBottom:"1px solid #f0f3f5"}}>{ins.owner}</td><td style={{padding:"9px 12px",color:"#5a6a74",borderBottom:"1px solid #f0f3f5"}}>{ins.type}</td><td style={{padding:"9px 12px",borderBottom:"1px solid #f0f3f5"}}>{new Date(ins.date).toLocaleDateString("en-AU")}</td><td style={{padding:"9px 12px",color:"#5a6a74",borderBottom:"1px solid #f0f3f5"}}>{ins.inspector}</td><td style={{padding:"9px 12px",borderBottom:"1px solid #f0f3f5"}}><span style={{padding:"3px 8px",borderRadius:4,fontSize:11,fontWeight:700,background:ins.status==="passed"?"#eafaf1":"#fef5e7",color:ins.status==="passed"?"#27ae60":"#e67e22"}}>{ins.status}</span></td></tr>)}</tbody>
      </table>}
    </div>
  </div>;
}
