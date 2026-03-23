// ─── Data Transformers (API flat model ↔ Frontend nested model) ─
export function apiAppToFrontend(a) {
  return {
    id: a.ref_number,
    _dbId: a.id,
    submittedDate: a.submitted_date ? a.submitted_date.split("T")[0] : "",
    status: a.status,
    owner: { name: a.owner_name || "", phone: a.owner_phone || "", email: a.owner_email || "", postalAddress: a.owner_postal_address || "" },
    property: { address: a.property_address || "", lot: a.lot_number || "", plan: a.plan_number || "", lotType: a.lot_type || "", frontage: a.frontage || 0, depth: a.depth || 0, roadName: a.road_name || "", roadType: a.road_type || "local", roadWidth: a.road_width || 0, vergeWidth: a.verge_width || 0 },
    crossover: { width: a.crossover_width || 0, count: a.crossover_count || 1, surface: a.crossover_surface || "", estDate: a.crossover_est_date || "", daNumber: a.da_number || "", offsetFromLeft: a.offset_from_left || 0 },
    vegetation: { treesNearby: a.trees_nearby || false, treeProtection: a.tree_protection || "", clearing: a.clearing || false, drainage: a.drainage_type || "", culvert: a.culvert || false, trees: a.trees_data || [] },
    assessment: {
      officer: a.officer_name || "",
      officerId: a.officer_id || null,
      notes: (a.notes || []).map(n => ({ date: n.created_at ? n.created_at.split("T")[0] : "", author: n.author_name || "", text: n.text })),
      riskFlags: a.risk_flags || [],
      referral: a.referral_authority || null,
      inspections: (a.inspections || []).map(i => ({ type: i.inspection_type, date: i.scheduled_date, inspector: "", status: i.status })),
      contribution: { eligible: a.contribution_eligible || false, amount: a.contribution_amount || 0 },
    },
    documents: (a.documents || []).map(d => ({ id: String(d.id), name: d.name, type: d.file_type || "pdf", size: d.file_size || "", date: d.uploaded_at ? d.uploaded_at.split("T")[0] : "", category: d.category || "", status: d.status || "received", reviewNote: d.review_note || "", reviewedBy: d.reviewed_by_name || "", reviewedAt: d.reviewed_at ? d.reviewed_at.split("T")[0] : "" })),
    checklist_data: a.checklist_data || {},
    lot_polygon: a.lot_polygon || null,
    site_plan_data: a.site_plan_data || null,
    org_site_plan_data: a.org_site_plan_data || null,
    cor_site_plan_data: a.cor_site_plan_data || null,
  };
}

export function apiAppListToFrontend(a) {
  return { id: a.ref_number, _dbId: a.id, submittedDate: a.submitted_date ? a.submitted_date.split("T")[0] : "", status: a.status, owner: { name: a.owner_name }, property: { address: a.property_address }, assessment: { officer: a.officer_name || "" } };
}

export function apiUserToFrontend(u) {
  return { id: String(u.id), _dbId: u.id, name: u.name, email: u.email, role: u.role, initials: u.initials || u.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2), department: u.department || "", active: u.is_active, must_change_password: !!u.must_change_password };
}

export function frontendAppToApiUpdate(localApp) {
  return {
    status: localApp.status,
    officer_id: localApp.assessment?.officerId || null,
    risk_flags: localApp.assessment?.riskFlags || [],
    checklist_data: localApp.checklist_data || {},
    contribution_eligible: localApp.assessment?.contribution?.eligible,
    contribution_amount: localApp.assessment?.contribution?.amount,
  };
}
