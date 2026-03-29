import { useState } from "react";

// ─── AI Assessment Hook ─────────────────────────────────
export default function useAIAssessment() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const assess = async (app) => {
    setLoading(true);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500,
          messages: [{ role: "user", content: `You are a Council officer. Assess crossover app against Guideline v3.1.\n\n${app.id}: ${app.owner.name}, ${app.property.address}, Frontage ${app.property.frontage}m, Road: ${app.property.roadName}(${app.property.roadType}), Width ${app.crossover.width}m x${app.crossover.count}, Surface: ${app.crossover.surface}, DA: ${app.crossover.daNumber||"None"}, Trees: ${app.vegetation.treesNearby}, Clearing: ${app.vegetation.clearing}, Drainage: ${app.vegetation.drainage}\n\nJSON only: {"compliance_score":0-100,"recommendation":"approve"|"approve_with_conditions"|"request_info"|"reject","issues":[],"conditions":[],"referrals_needed":[],"risk_level":"low"|"medium"|"high","summary":"...","width_check":"pass"|"fail","vegetation_check":"pass"|"fail"|"needs_review","drainage_check":"pass"|"fail"|"needs_review","contribution_eligible":bool,"estimated_contribution":0}` }] }) });
      const d = await r.json(); const t = d.content?.map(b=>b.text||"").join("")||"";
      setResult(JSON.parse(t.replace(/```json|```/g,"").trim()));
    } catch {
      const f=app.property.frontage,w=app.crossover.width,mW=f<=12.5?4.5:6,iss=[];
      if(w<3||w>mW) iss.push(`Width ${w}m outside ${3}–${mW}m`);
      if(app.crossover.count>1&&f<=20) iss.push("2nd crossover needs >20m");
      if(app.vegetation.clearing) iss.push("Clearing needs DWER permit");
      if(app.property.roadType!=="local") iss.push(`Referral to ${app.property.roadType==="red"?"MRWA":"DPLH"}`);
      setResult({compliance_score:Math.max(0,100-iss.length*25),recommendation:iss.length===0?"approve":iss.length<=1?"approve_with_conditions":"reject",issues:iss,conditions:iss.length===0?["Standard"]:[], referrals_needed:app.property.roadType!=="local"?[app.property.roadType==="red"?"Main Roads WA":"DPLH"]:[],risk_level:iss.length===0?"low":iss.length<=2?"medium":"high",summary:iss.length===0?"Meets requirements.":`${iss.length} issue(s).`,width_check:w>=3&&w<=mW?"pass":"fail",vegetation_check:app.vegetation.clearing?"fail":"pass",drainage_check:"pass",contribution_eligible:!app.crossover.daNumber,estimated_contribution:!app.crossover.daNumber?474:0});
    }
    setLoading(false);
  };
  return {loading,result,assess,setResult};
}
