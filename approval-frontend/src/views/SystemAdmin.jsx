import { useState, useEffect, useCallback } from "react";
import api from '../services/api';
import { apiUserToFrontend } from '../utils/transforms';
import { ROLE_CONFIG as ROLE_CONFIG_DEFAULT, SIGHT_DISTANCE_TABLE } from '../data/constants';

// ─── Shared styles ─────────────────────────────────────
const inputS = { padding: "8px 12px", borderRadius: 6, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box", lineHeight: 1.4 };
const thS = { padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 11, textTransform: "uppercase", borderBottom: "2px solid #e4e9ec", letterSpacing: "0.03em" };
const tdS = { padding: "10px 14px", borderBottom: "1px solid #f0f3f5", fontSize: 13, lineHeight: 1.4 };
const btnAdd = { padding: "8px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const btnSave = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#27ae60", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnCancel = { padding: "6px 14px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit", color: "#5a6a74" };
const btnEdit = { padding: "6px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 12, color: "#5a6a74", cursor: "pointer", fontFamily: "inherit" };
const btnDel = { padding: "6px 12px", borderRadius: 6, border: "1px solid #fdedec", background: "#fdedec", fontSize: 12, color: "#c0392b", cursor: "pointer", fontFamily: "inherit" };

const RESULT_COLORS = { pass: "#27ae60", fail: "#e74c3c", review: "#e67e22", na: "#95a5a6" };
const SOURCE_LABELS = { app: "Application Field", sp: "Site Plan AI Data", doc: "Uploaded Document" };
const OPERATOR_LABELS = { gte: "≥", lte: "≤", gt: ">", lt: "<", eq: "=", neq: "≠", exists: "exists", not_exists: "empty", contains: "contains", true: "is true", false: "is false" };

// Field paths available per source type
const SOURCE_FIELDS = {
  app: [
    { path: "owner_name", label: "Owner Name" },
    { path: "owner_phone", label: "Owner Phone" },
    { path: "owner_email", label: "Owner Email" },
    { path: "property_address", label: "Property Address" },
    { path: "lot_number", label: "Lot Number" },
    { path: "plan_number", label: "Plan Number" },
    { path: "lot_type", label: "Lot Type" },
    { path: "frontage", label: "Frontage (m)" },
    { path: "depth", label: "Depth (m)" },
    { path: "road_name", label: "Road Name" },
    { path: "road_type", label: "Road Type (local/red/blue/rav)" },
    { path: "road_width", label: "Road Width (m)" },
    { path: "verge_width", label: "Verge Width (m)" },
    { path: "crossover_width", label: "Crossover Width (m)" },
    { path: "crossover_surface", label: "Crossover Surface" },
    { path: "crossover_count", label: "Crossover Count" },
    { path: "da_number", label: "DA Number" },
    { path: "application_type", label: "Application Type (da/subdivision/standalone)" },
    { path: "contribution_eligible", label: "Contribution Eligible" },
    { path: "contribution_amount", label: "Contribution Amount ($)" },
    { path: "trees_nearby", label: "Trees Nearby" },
    { path: "clearing", label: "Clearing Required" },
    { path: "drainage_type", label: "Drainage Type" },
    { path: "culvert", label: "Culvert Required" },
    { path: "declaration_signed", label: "Declaration Signed" },
    { path: "date_signed", label: "Date Signed" },
    { path: "status", label: "Application Status" },
    { path: "submitted_date", label: "Submitted Date" },
    { path: "completion_date", label: "Completion Date" },
  ],
  sp: [
    { path: "crossover_dimensions.width_at_boundary_m", label: "Width at Boundary (m)" },
    { path: "crossover_dimensions.splay_left_m", label: "Splay Left (m)" },
    { path: "crossover_dimensions.splay_right_m", label: "Splay Right (m)" },
    { path: "crossover_dimensions.total_width_at_road_m", label: "Total Width at Road (m)" },
    { path: "crossover_dimensions.verge_depth_m", label: "Verge Depth (m)" },
    { path: "crossover_dimensions.crossover_length_m", label: "Crossover Length (m)" },
    { path: "crossover_dimensions.alignment_degrees", label: "Alignment to Road (°)" },
    { path: "crossover_dimensions.distance_to_left_boundary_m", label: "→ Left Boundary (m)" },
    { path: "crossover_dimensions.distance_to_right_boundary_m", label: "→ Right Boundary (m)" },
    { path: "crossover_dimensions.distance_to_nearest_lot_corner_m", label: "→ Nearest Lot Corner (m)" },
    { path: "crossover_dimensions.nearest_lot_corner", label: "Which Corner" },
    { path: "crossover_dimensions.distance_to_intersection_tangent_m", label: "→ Intersection Tangent (m)" },
    { path: "crossover_dimensions.distance_to_building_corner_m", label: "→ Building Corner (m)" },
    { path: "crossover_dimensions.driveway_centreline_point_2_5m", label: "Point A (2.5m from verge)" },
    { path: "construction.material", label: "Material" },
    { path: "construction.thickness_mm", label: "Surface Thickness (mm)" },
    { path: "construction.base_course_specified", label: "Base Course Specified" },
    { path: "construction.base_course_depth_mm", label: "Base Course Depth (mm)" },
    { path: "construction.compaction_mdd_pct", label: "Compaction MDD (%)" },
    { path: "construction.expansion_joints", label: "Expansion Joints" },
    { path: "construction.kerb_type", label: "Kerb Type" },
    { path: "construction.footpath_exists", label: "Footpath Exists" },
    { path: "construction.footpath_flush_join", label: "Footpath Flush Join" },
    { path: "construction.construction_standard", label: "Construction Standard (Type 1/2)" },
    { path: "siteplan_measurements.lot_frontage_m", label: "Lot Frontage (m)" },
    { path: "siteplan_measurements.lot_depth_m", label: "Lot Depth (m)" },
    { path: "siteplan_measurements.existing_driveway_width_m", label: "Existing Driveway Width (m)" },
    { path: "siteplan_measurements.road_name", label: "Road Name" },
    { path: "siteplan_measurements.road_speed_zone_kmh", label: "Speed Zone (km/h)" },
    { path: "siteplan_measurements.road_classification", label: "Road Classification" },
    { path: "siteplan_measurements.number_of_crossovers", label: "Number of Crossovers" },
    { path: "siteplan_measurements.building_setback_front_m", label: "Front Setback (m)" },
    { path: "siteplan_measurements.building_setback_left_m", label: "Left Setback (m)" },
    { path: "siteplan_measurements.building_setback_right_m", label: "Right Setback (m)" },
    { path: "siteplan_measurements.building_setback_rear_m", label: "Rear Setback (m)" },
    { path: "utilities.power_conflict", label: "Power Conflict" },
    { path: "utilities.water_conflict", label: "Water Conflict" },
    { path: "utilities.gas_conflict", label: "Gas Conflict" },
    { path: "utilities.telco_conflict", label: "Telco/NBN Conflict" },
    { path: "utilities.sewer_conflict", label: "Sewer Conflict" },
    { path: "utilities.power_line_shown", label: "Power Line Shown" },
    { path: "utilities.water_main_shown", label: "Water Main Shown" },
    { path: "utilities.gas_main_shown", label: "Gas Main Shown" },
    { path: "utilities.telco_shown", label: "Telco Shown" },
    { path: "drainage.drainage_plan_included", label: "Drainage Plan Included" },
    { path: "drainage.soakwells_proposed", label: "Soakwells Proposed" },
    { path: "drainage.storage_tanks_proposed", label: "Storage Tanks Proposed" },
    { path: "drainage.pipe_diameter_mm", label: "Pipe Diameter (mm)" },
    { path: "additional_findings.vegetation_on_verge", label: "Vegetation on Verge" },
    { path: "additional_findings.trees_on_verge", label: "Trees on Verge" },
    { path: "additional_findings.street_light_near_crossover", label: "Street Light Nearby" },
    { path: "additional_findings.fire_hydrant_near_crossover", label: "Fire Hydrant Nearby" },
    { path: "additional_findings.is_subdivision", label: "Is Subdivision" },
    { path: "property.is_corner_lot", label: "Corner Lot" },
    { path: "property.is_battleaxe", label: "Battleaxe Lot" },
    { path: "property.da_linked", label: "DA-Linked" },
  ],
  doc: [
    { path: "Site Plan", label: "Site Plan" },
    { path: "Certificate of Title", label: "Certificate of Title" },
    { path: "Site Photos", label: "Site Photos" },
    { path: "Other Documents", label: "Other Documents" },
    { path: "Dial Before You Dig", label: "Dial Before You Dig" },
    { path: "Engineering Drawing", label: "Engineering Drawing" },
    { path: "Arborist Report", label: "Arborist Report" },
    { path: "Drainage Plan", label: "Drainage Plan" },
  ],
};

// ═══════════════════════════════════════════════════════
//  Users Tab
// ═══════════════════════════════════════════════════════
function UsersTab({ users, setUsers, currentUser, ROLE_CONFIG, departments }) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", role: "engineer", department: "Engineering" });
  const [tempPassword, setTempPassword] = useState(null);
  const [addError, setAddError] = useState(null);

  const startEdit = (u) => { setEditId(u.id); setForm({ ...u }); };
  const saveEdit = async () => {
    try {
      await api.updateUser(form._dbId, { name: form.name, email: form.email, role: form.role, department: form.department, initials: form.initials });
      const uList = await api.listUsers(); setUsers(uList.map(apiUserToFrontend));
    } catch (e) { console.error("Save user failed:", e); }
    setEditId(null);
  };
  const toggleActive = async (u) => {
    try { await api.updateUser(u._dbId, { is_active: !u.active }); const uList = await api.listUsers(); setUsers(uList.map(apiUserToFrontend)); } catch (e) { console.error(e); }
  };
  const addUser = async () => {
    if (!newUserForm.name.trim() || !newUserForm.email.trim()) { setAddError("Name and email are required"); return; }
    setAddError(null);
    try {
      const result = await api.createUser({ name: newUserForm.name.trim(), email: newUserForm.email.trim(), role: newUserForm.role, department: newUserForm.department });
      setTempPassword(result.temp_password);
      const uList = await api.listUsers(); setUsers(uList.map(apiUserToFrontend));
      setNewUserForm({ name: "", email: "", role: "engineer", department: "Engineering" });
    } catch (e) {
      setAddError(e.message || "Failed to create user");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(ROLE_CONFIG).filter(([, cfg]) => !cfg.hidden).map(([role, cfg]) => {
            const cnt = users.filter(u => u.role === role && u.active).length;
            return <div key={role} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>{cfg.icon}</span>
              <div><div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{cnt}</div><div style={{ fontSize: 12, color: "#7a8a94" }}>{cfg.label}s</div></div>
            </div>;
          })}
        </div>
        <button onClick={() => { setShowAddForm(!showAddForm); setTempPassword(null); setAddError(null); }} style={btnAdd}>{showAddForm ? "✕ Cancel" : "+ Add User"}</button>
      </div>

      {/* Add User Form */}
      {showAddForm && (
        <div style={{ background: "#fff", borderRadius: 12, border: "2px solid #1abc9c", padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a4a", marginBottom: 10 }}>New User</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px 12px" }}>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Full Name *</label>
              <input value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} style={inputS} placeholder="e.g. Jane Smith" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Email *</label>
              <input value={newUserForm.email} onChange={e => setNewUserForm({...newUserForm, email: e.target.value})} style={inputS} placeholder="jane@council.wa.gov.au" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Role</label>
              <select value={newUserForm.role} onChange={e => setNewUserForm({...newUserForm, role: e.target.value})} style={inputS}>
                {Object.entries(ROLE_CONFIG).filter(([, c]) => !c.hidden).map(([r, c]) => <option key={r} value={r}>{c.icon} {c.label}</option>)}
              </select></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Department</label>
              <select value={newUserForm.department} onChange={e => setNewUserForm({...newUserForm, department: e.target.value})} style={inputS}>
                {departments.length > 0
                  ? departments.filter(d => d.is_active).map(d => <option key={d.code} value={d.label}>{d.label}</option>)
                  : <option value="Engineering">Engineering</option>}
              </select></div>
          </div>
          {addError && <div style={{ marginTop: 8, padding: "6px 10px", background: "#fdedec", borderRadius: 6, fontSize: 11, color: "#c0392b" }}>⚠️ {addError}</div>}
          {tempPassword && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#eafaf1", borderRadius: 8, border: "1px solid #d4efdf" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#27ae60", marginBottom: 4 }}>✅ User Created — One-Time Password</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a4a", background: "#fff", padding: "8px 12px", borderRadius: 6, border: "1px solid #d4efdf", fontFamily: "monospace", letterSpacing: "0.1em", display: "inline-block" }}>{tempPassword}</div>
              <div style={{ fontSize: 12, color: "#5a6a74", marginTop: 6 }}>Share this password with the user. They will be asked to change it on first login.</div>
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowAddForm(false); setTempPassword(null); }} style={btnCancel}>Close</button>
            {!tempPassword && <button onClick={addUser} disabled={!newUserForm.name.trim() || !newUserForm.email.trim()} style={{ ...btnAdd, opacity: newUserForm.name.trim() && newUserForm.email.trim() ? 1 : 0.5 }}>Create User</button>}
          </div>
        </div>
      )}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f5f8fa" }}>{["User","Email","Role","Department","Status","Actions"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>{users.filter(u => u.role !== "superadmin").map(u => {
            const rc = ROLE_CONFIG[u.role] || { label: u.role, icon: "👤", color: "#5a6a74" }; const ed = editId === u.id;
            return (<tr key={u.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
              <td style={tdS}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: u.active ? rc.color : "#bdc3c7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 800 }}>{u.initials}</div>{ed ? <input value={form.name} onChange={e => setForm({...form, name: e.target.value, initials: e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)})} style={{ ...inputS, width: 190 }} /> : <span style={{ fontWeight: 600, color: "#1a3a4a" }}>{u.name}</span>}</div></td>
              <td style={tdS}>{ed ? <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ ...inputS, width: 200 }} /> : <span style={{ color: "#5a6a74" }}>{u.email}</span>}</td>
              <td style={tdS}>{ed ? <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} style={{ ...inputS, width: 120 }}>{Object.entries(ROLE_CONFIG).filter(([, c]) => !c.hidden).map(([r, c]) => <option key={r} value={r}>{c.icon} {c.label}</option>)}</select> : <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, background: `${rc.color}15`, color: rc.color }}>{rc.icon} {rc.label}</span>}</td>
              <td style={tdS}>{ed ? <select value={form.department} onChange={e => setForm({...form, department: e.target.value})} style={{ ...inputS, width: 140 }}>{departments.length > 0 ? departments.filter(d => d.is_active).map(d => <option key={d.code} value={d.label}>{d.label}</option>) : <option value={form.department}>{form.department}</option>}</select> : <span style={{ color: "#5a6a74" }}>{u.department}</span>}</td>
              <td style={tdS}><button onClick={() => toggleActive(u)} disabled={u.id === currentUser.id} style={{ padding: "3px 10px", borderRadius: 10, border: "none", fontSize: 10, fontWeight: 700, cursor: u.id === currentUser.id ? "default" : "pointer", fontFamily: "inherit", background: u.active ? "#eafaf1" : "#fdedec", color: u.active ? "#27ae60" : "#e74c3c" }}>{u.active ? "Active" : "Inactive"}</button></td>
              <td style={tdS}>{ed ? <div style={{ display: "flex", gap: 4 }}><button onClick={saveEdit} style={btnSave}>Save</button><button onClick={() => setEditId(null)} style={btnCancel}>Cancel</button></div> : <button onClick={() => startEdit(u)} style={btnEdit}>Edit</button>}</td>
            </tr>);
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  Assessment Categories & Items Tab (from API)
// ═══════════════════════════════════════════════════════
function AssessmentTab() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [editCatId, setEditCatId] = useState(null);
  const [catForm, setCatForm] = useState({});
  const [editItemId, setEditItemId] = useState(null);
  const [itemForm, setItemForm] = useState({});

  const load = useCallback(async () => {
    try { const data = await api.listCategories(); setCategories(data); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalItems = categories.reduce((s, c) => s + (c.items?.length || 0), 0);

  if (loading) return <div style={{ padding: 20, color: "#7a8a94" }}>Loading assessment data...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Assessment checklist categories and items</div>
          <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>{categories.length} categories · {totalItems} total items · Loaded from database</div>
        </div>
      </div>

      {categories.map(cat => {
        const isExp = expandedCat === cat.id;
        const isCatEdit = editCatId === cat.id;
        return (
          <div key={cat.id} style={{ marginBottom: 8, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, background: isExp ? "#f5f8fa" : "transparent", cursor: "pointer", borderBottom: isExp ? "1px solid #e4e9ec" : "none" }}
              onClick={() => { if (!isCatEdit) setExpandedCat(isExp ? null : cat.id); }}>
              <span style={{ fontSize: 18 }}>{cat.icon}</span>
              {isCatEdit ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }} onClick={e => e.stopPropagation()}>
                  <input value={catForm.icon} onChange={e => setCatForm({ ...catForm, icon: e.target.value })} style={{ ...inputS, width: 36, textAlign: "center", fontSize: 16 }} />
                  <input value={catForm.label} onChange={e => setCatForm({ ...catForm, label: e.target.value })} style={{ ...inputS, width: 200 }} placeholder="Category Name" />
                  <button onClick={async () => { try { await api.updateCategory(cat.id, catForm); await load(); } catch(e){console.error(e);} setEditCatId(null); }} style={btnSave}>Save</button>
                  <button onClick={() => setEditCatId(null)} style={btnCancel}>Cancel</button>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "#1a3a4a" }}>{cat.label}</span>
                    <span style={{ marginLeft: 8, fontSize: 12, color: "#95a5a6" }}>{cat.items?.length || 0} items · <code style={{ fontSize: 11, background: "#f5f8fa", padding: "1px 4px", borderRadius: 2 }}>{cat.code}</code></span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setEditCatId(cat.id); setCatForm({ label: cat.label, icon: cat.icon }); }} style={btnEdit}>Edit</button>
                  </div>
                  <span style={{ fontSize: 12, color: "#95a5a6", transform: isExp ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
                </>
              )}
            </div>

            {isExp && (
              <div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ background: "#f8fafb" }}>{["Code", "Description", "Reference", "Active", "Actions"].map(h => <th key={h} style={{ ...thS, fontSize: 9, padding: "6px 12px" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(cat.items || []).map(item => {
                      const isItemEdit = editItemId === item.id;
                      return (
                        <tr key={item.id} style={{ background: isItemEdit ? "#ebf5fb" : "transparent" }}>
                          <td style={{ ...tdS, width: 140 }}><code style={{ fontSize: 12, background: "#f5f8fa", padding: "2px 5px", borderRadius: 3, color: "#5a6a74" }}>{item.code}</code></td>
                          <td style={tdS}>{isItemEdit ? <input value={itemForm.label} onChange={e => setItemForm({ ...itemForm, label: e.target.value })} style={inputS} /> : <span style={{ fontSize: 12, color: "#1a3a4a" }}>{item.label}</span>}</td>
                          <td style={{ ...tdS, width: 90 }}>{isItemEdit ? <input value={itemForm.reference} onChange={e => setItemForm({ ...itemForm, reference: e.target.value })} style={{ ...inputS, width: 70 }} /> : <span style={{ fontSize: 12, color: "#8e44ad", fontWeight: 600, background: "#f4ecf7", padding: "2px 6px", borderRadius: 3 }}>{item.reference}</span>}</td>
                          <td style={{ ...tdS, width: 60 }}><span style={{ fontSize: 12, fontWeight: 600, color: item.is_active ? "#27ae60" : "#e74c3c" }}>{item.is_active ? "Yes" : "No"}</span></td>
                          <td style={{ ...tdS, width: 100 }}>
                            {isItemEdit ? (
                              <div style={{ display: "flex", gap: 3 }}>
                                <button onClick={async () => { try { await api.updateItem(cat.id, item.id, itemForm); await load(); } catch(e){console.error(e);} setEditItemId(null); }} style={btnSave}>Save</button>
                                <button onClick={() => setEditItemId(null)} style={btnCancel}>✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditItemId(item.id); setItemForm({ label: item.label, reference: item.reference }); }} style={btnEdit}>Edit</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  Assessment Rules Tab (from API — full CRUD)
// ═══════════════════════════════════════════════════════
function RulesTab() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [filterItem, setFilterItem] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ item_id: "", priority: 0, source: "app", field: "", operator: "exists", value: "", result: "review", confidence: 0.8, reason_template: "" });

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.listRules(), api.listCategories()]);
      setRules(r); setCategories(c);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Build item lookup
  const allItems = categories.flatMap(c => (c.items || []).map(i => ({ ...i, catLabel: c.label, catIcon: c.icon })));
  const itemMap = {}; allItems.forEach(i => { itemMap[i.id] = i; });

  const filtered = filterItem ? rules.filter(r => r.item_code === filterItem || String(r.item_id) === filterItem) : rules;

  // Group by item_code
  const grouped = {};
  filtered.forEach(r => {
    const key = r.item_code || `item_${r.item_id}`;
    if (!grouped[key]) grouped[key] = { item_code: r.item_code, item_id: r.item_id, rules: [] };
    grouped[key].rules.push(r);
  });

  const handleSave = async (rule) => {
    try {
      await api.updateRule(rule.id, form);
      await load();
    } catch (e) { console.error(e); }
    setEditId(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this rule?")) return;
    try { await api.deleteRule(id); await load(); } catch (e) { console.error(e); }
  };

  const handleAdd = async () => {
    try {
      await api.createRule({ ...addForm, item_id: parseInt(addForm.item_id) });
      await load();
      setShowAdd(false);
      setAddForm({ item_id: "", priority: 0, source: "app", field: "", operator: "exists", value: "", result: "review", confidence: 0.8, reason_template: "" });
    } catch (e) { console.error(e); alert("Failed: " + e.message); }
  };

  const handleSwap = async (groupRules, ruleIndex, direction) => {
    const sorted = [...groupRules].sort((a, b) => a.priority - b.priority);
    const targetIndex = ruleIndex + direction;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    const ruleA = sorted[ruleIndex];
    const ruleB = sorted[targetIndex];
    // Swap priorities
    try {
      await api.updateRule(ruleA.id, { priority: ruleB.priority });
      await api.updateRule(ruleB.id, { priority: ruleA.priority });
      await load();
    } catch (e) { console.error(e); }
  };

  if (loading) return <div style={{ padding: 20, color: "#7a8a94" }}>Loading rules...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Auto-assess rules — database-driven checklist evaluation</div>
          <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>{rules.length} rules across {Object.keys(grouped).length} items · Evaluated in priority order (first match wins)</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={filterItem} onChange={e => setFilterItem(e.target.value)} style={{ ...inputS, width: 180 }}>
            <option value="">All Items</option>
            {allItems.map(i => <option key={i.id} value={i.code}>{i.code} — {i.label.slice(0, 40)}</option>)}
          </select>
          <button onClick={() => setShowAdd(!showAdd)} style={btnAdd}>{showAdd ? "✕ Close" : "+ Add Rule"}</button>
        </div>
      </div>

      {/* Add rule form */}
      {showAdd && (
        <div style={{ background: "#fff", borderRadius: 12, border: "2px solid #1abc9c", padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a4a", marginBottom: 10 }}>New Assessment Rule</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px 12px" }}>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Assessment Item</label>
              <select value={addForm.item_id} onChange={e => setAddForm({...addForm, item_id: e.target.value})} style={inputS}>
                <option value="">Select item...</option>
                {allItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.label.slice(0, 50)}</option>)}
              </select></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Priority</label>
              <input type="number" value={addForm.priority} onChange={e => setAddForm({...addForm, priority: parseInt(e.target.value)||0})} style={inputS} /></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Source</label>
              <select value={addForm.source} onChange={e => setAddForm({...addForm, source: e.target.value, field: ""})} style={inputS}>
                <option value="app">Application Field</option><option value="sp">Site Plan AI Data</option><option value="doc">Uploaded Document</option>
              </select></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Field Path</label>
              <select value={addForm.field} onChange={e => setAddForm({...addForm, field: e.target.value})} style={inputS}>
                <option value="">Select field...</option>
                {(SOURCE_FIELDS[addForm.source] || []).map(f => <option key={f.path} value={f.path}>{f.label}</option>)}
                <option value="__custom__">— Custom field path —</option>
              </select>
              {addForm.field === "__custom__" && <input value="" onChange={e => setAddForm({...addForm, field: e.target.value})} style={{ ...inputS, marginTop: 4 }} placeholder="e.g. crossover_dimensions.width_m" />}
            </div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Operator</label>
              <select value={addForm.operator} onChange={e => setAddForm({...addForm, operator: e.target.value})} style={inputS}>
                {Object.entries(OPERATOR_LABELS).map(([k,v]) => <option key={k} value={k}>{k} ({v})</option>)}
              </select></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Value / Threshold</label>
              <input value={addForm.value} onChange={e => setAddForm({...addForm, value: e.target.value})} style={inputS} placeholder="e.g. 3.0" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Result</label>
              <select value={addForm.result} onChange={e => setAddForm({...addForm, result: e.target.value})} style={inputS}>
                <option value="pass">Pass</option><option value="fail">Fail</option><option value="review">Review</option><option value="na">N/A</option>
              </select></div>
            <div><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Confidence</label>
              <input type="number" step="0.05" min="0" max="1" value={addForm.confidence} onChange={e => setAddForm({...addForm, confidence: parseFloat(e.target.value)||0})} style={inputS} /></div>
          </div>
          <div style={{ marginTop: 10 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.03em" }}>Reason Template</label>
            <input value={addForm.reason_template} onChange={e => setAddForm({...addForm, reason_template: e.target.value})} style={inputS} placeholder="e.g. Width {field_value}m ≥ {threshold}m minimum" /></div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowAdd(false)} style={btnCancel}>Cancel</button>
            <button onClick={handleAdd} disabled={!addForm.item_id || !addForm.field} style={{ ...btnAdd, opacity: addForm.item_id && addForm.field ? 1 : 0.5 }}>Create Rule</button>
          </div>
        </div>
      )}

      {/* Rules grouped by item */}
      {Object.entries(grouped).map(([itemCode, group]) => {
        const item = allItems.find(i => i.code === itemCode) || {};
        return (
          <div key={itemCode} style={{ marginBottom: 10, background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", background: "#f5f8fa", borderBottom: "1px solid #e4e9ec", display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ fontSize: 12, background: "#e8f5e9", padding: "2px 6px", borderRadius: 3, color: "#27ae60", fontWeight: 700 }}>{itemCode}</code>
              <span style={{ fontSize: 11, color: "#1a3a4a", fontWeight: 600 }}>{item.label || "Unknown item"}</span>
              <span style={{ fontSize: 12, color: "#95a5a6", marginLeft: "auto" }}>{group.rules.length} rule{group.rules.length > 1 ? "s" : ""}</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#fafcfa" }}>{["Pri","Source","Field","Op","Value","Result","Conf","Reason","Actions"].map(h => <th key={h} style={{ ...thS, fontSize: 8, padding: "5px 8px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {group.rules.sort((a,b) => a.priority - b.priority).map((rule, ruleIdx, sortedArr) => {
                  const ed = editId === rule.id;
                  const rc = RESULT_COLORS[rule.result] || "#7a8a94";
                  const isFirst = ruleIdx === 0;
                  const isLast = ruleIdx === sortedArr.length - 1;
                  return (
                    <tr key={rule.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
                      <td style={{ ...tdS, width: 40, textAlign: "center" }}>{ed ? <input type="number" value={form.priority} onChange={e => setForm({...form, priority: parseInt(e.target.value)||0})} style={{ ...inputS, width: 40, textAlign: "center" }} /> : <span style={{ fontWeight: 800, color: "#1a3a4a" }}>{rule.priority}</span>}</td>
                      <td style={{ ...tdS, width: 60 }}>{ed ? <select value={form.source} onChange={e => setForm({...form, source: e.target.value, field: ""})} style={{ ...inputS, width: 55 }}><option value="app">app</option><option value="sp">sp</option><option value="doc">doc</option></select> : <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 3, background: rule.source === "sp" ? "#f4ecf7" : rule.source === "doc" ? "#fef5e7" : "#ebf5fb", color: rule.source === "sp" ? "#8e44ad" : rule.source === "doc" ? "#e67e22" : "#2980b9", fontWeight: 700 }}>{rule.source}</span>}</td>
                      <td style={{ ...tdS, maxWidth: 200 }}>{ed ? <select value={form.field} onChange={e => setForm({...form, field: e.target.value})} style={{ ...inputS, width: 190 }}><option value="">Select...</option>{(SOURCE_FIELDS[form.source] || []).map(f => <option key={f.path} value={f.path}>{f.label}</option>)}<option value={form.field}>{form.field}</option></select> : <code style={{ fontSize: 12, color: "#5a6a74", wordBreak: "break-all" }}>{rule.field}</code>}</td>
                      <td style={{ ...tdS, width: 50 }}>{ed ? <select value={form.operator} onChange={e => setForm({...form, operator: e.target.value})} style={{ ...inputS, width: 50 }}>{Object.keys(OPERATOR_LABELS).map(k => <option key={k} value={k}>{k}</option>)}</select> : <span style={{ fontWeight: 800, color: "#1a3a4a" }}>{OPERATOR_LABELS[rule.operator] || rule.operator}</span>}</td>
                      <td style={{ ...tdS, width: 60 }}>{ed ? <input value={form.value || ""} onChange={e => setForm({...form, value: e.target.value})} style={{ ...inputS, width: 55 }} /> : <span style={{ fontWeight: 600, color: "#2980b9" }}>{rule.value || "—"}</span>}</td>
                      <td style={{ ...tdS, width: 55 }}>{ed ? <select value={form.result} onChange={e => setForm({...form, result: e.target.value})} style={{ ...inputS, width: 55 }}><option value="pass">pass</option><option value="fail">fail</option><option value="review">review</option><option value="na">n/a</option></select> : <span style={{ padding: "2px 6px", borderRadius: 3, fontSize: 11, fontWeight: 700, background: `${rc}18`, color: rc }}>{rule.result}</span>}</td>
                      <td style={{ ...tdS, width: 40, textAlign: "center" }}>{ed ? <input type="number" step="0.05" value={form.confidence} onChange={e => setForm({...form, confidence: parseFloat(e.target.value)||0})} style={{ ...inputS, width: 40 }} /> : <span style={{ fontSize: 12, color: "#5a6a74" }}>{(rule.confidence * 100).toFixed(0)}%</span>}</td>
                      <td style={tdS}>{ed ? <input value={form.reason_template} onChange={e => setForm({...form, reason_template: e.target.value})} style={inputS} /> : <span style={{ fontSize: 12, color: "#7a8a94" }}>{rule.reason_template}</span>}</td>
                      <td style={{ ...tdS, width: 110 }}>
                        {ed ? (
                          <div style={{ display: "flex", gap: 3 }}>
                            <button onClick={() => handleSave(rule)} style={btnSave}>Save</button>
                            <button onClick={() => setEditId(null)} style={btnCancel}>✕</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                            <button onClick={() => handleSwap(sortedArr, ruleIdx, -1)} disabled={isFirst}
                              style={{ ...btnEdit, padding: "3px 5px", opacity: isFirst ? 0.3 : 1 }} title="Move up (higher priority)">▲</button>
                            <button onClick={() => handleSwap(sortedArr, ruleIdx, 1)} disabled={isLast}
                              style={{ ...btnEdit, padding: "3px 5px", opacity: isLast ? 0.3 : 1 }} title="Move down (lower priority)">▼</button>
                            <button onClick={() => { setEditId(rule.id); setForm({ priority: rule.priority, source: rule.source, field: rule.field, operator: rule.operator, value: rule.value, result: rule.result, confidence: rule.confidence, reason_template: rule.reason_template }); }} style={btnEdit}>Edit</button>
                            <button onClick={() => handleDelete(rule.id)} style={btnDel}>✕</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {Object.keys(grouped).length === 0 && <div style={{ padding: 20, color: "#95a5a6", textAlign: "center" }}>No rules found{filterItem ? ` for "${filterItem}"` : ""}. Click "+ Add Rule" to create one.</div>}
    </div>
  );
}


// ═══════════════════════════════════════════════════════
//  Sight Distance Reference Tab
// ═══════════════════════════════════════════════════════
function SightDistTab() {
  const data = SIGHT_DISTANCE_TABLE;
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74", marginBottom: 12 }}>AS 2890.1 / Austroads sight distance requirements by road speed</div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f5f8fa" }}>{["Speed (km/h)","Abs Min (m)","SSD Min (m)"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>{data.map(s => (
            <tr key={s.speed}>
              <td style={{ ...tdS, fontWeight: 800, color: "#1a3a4a", fontSize: 14 }}>{s.speed}</td>
              <td style={tdS}><span style={{ fontWeight: 700 }}>{s.abs_min}</span></td>
              <td style={tdS}><span style={{ fontWeight: 700 }}>{s.ssd_min}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 9, color: "#b0bdb2" }}>AS 2890.1:2004 Table 3.3 — Minimum sight distance for driveways and short access roads.</div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════
//  Main SystemAdmin Component
// ═══════════════════════════════════════════════════════
// ─── GeoData Tab (Data WA SLIP) ──────────────────────────
function GeoDataTab() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(null); // null | 'all' | 'lots' | 'roads' | 'speed_limits'
  const [msg, setMsg] = useState(null);

  const loadStatus = useCallback(async () => {
    try { const data = await api.getGeodataStatus(); setStatus(data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll status while refreshing
  useEffect(() => {
    if (!refreshing) return;
    const iv = setInterval(loadStatus, 3000);
    return () => clearInterval(iv);
  }, [refreshing, loadStatus]);

  const doRefresh = async (layer) => {
    setRefreshing(layer || 'all');
    setMsg(null);
    try {
      await api.refreshGeodata(layer);
      setMsg({ type: 'ok', text: `Refresh started for ${layer || 'all layers'}. Polling for updates...` });
      // Poll for ~60s then stop
      setTimeout(() => { setRefreshing(null); loadStatus(); }, 60000);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
      setRefreshing(null);
    }
  };

  if (loading) return <div style={{ padding: 20, color: "#7a8a94" }}>Loading GeoData status...</div>;

  const layers = [
    { key: 'lots', label: 'Lot Boundaries', file: 'lot.geojson', icon: '🏠', desc: 'Cadastre Address (LGATE-002) — land parcel polygons with addresses' },
    { key: 'roads', label: 'Road Network', file: 'Road_Network.geojson', icon: '🛣️', desc: 'Roads Simplified (LGATE-195) — road centrelines with classification' },
    { key: 'speed_limits', label: 'Speed Limits', file: 'Legal_Speed_Limits.geojson', icon: '⚡', desc: 'MRWA Road Network — gazetted speed limits per road segment' },
    { key: 'contours', label: '2m Contours', file: 'Contours_2m.geojson', icon: '⛰️', desc: 'DPIRD-072 — LiDAR-derived 2m contour lines for 3D sight analysis elevation' },
    { key: 'urban_forest', label: 'Urban Forest', file: 'Urban_Forest.geojson', icon: '🌳', desc: 'DPLH-109 — Tree canopy height strata per parcel (0-3m, 3-8m, 8-15m, 15m+)' },
    { key: 'drainage_pipes', label: 'Drainage Pipes', file: 'Drainage_Pipes.geojson', icon: '💧', desc: 'MRWA — Drainage pipes, culverts, open drains in Metro region' },
    { key: 'drainage_pits', label: 'Drainage Pits', file: 'Drainage_Pits.geojson', icon: '🕳️', desc: 'MRWA — Street gullies, soak wells, junction pits in Metro region' },
    { key: 'water_pipes', label: 'Water Pipes', file: 'Water_Pipes.geojson', icon: '🚰', desc: 'WaterCorp (WCORP-002) — Water main locations' },
  ];

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a4a" }}>GeoJSON Data — Data WA (SLIP)</div>
          <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>
            Lot boundaries, roads & speed limits from WA Landgate public services · LGA: {status?.config?.lga_name || 'Kalamunda'}
          </div>
        </div>
        <button onClick={() => doRefresh(null)} disabled={!!refreshing}
          style={{ ...btnAdd, opacity: refreshing ? 0.5 : 1 }}>
          {refreshing ? '⏳ Refreshing...' : '🔄 Refresh All'}
        </button>
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 12,
          background: msg.type === 'ok' ? "#e8f8f5" : "#fdf0ef",
          color: msg.type === 'ok' ? "#1abc9c" : "#e74c3c",
          border: `1px solid ${msg.type === 'ok' ? "#b8f0e0" : "#f5c6c2"}` }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {layers.map(layer => {
          const st = status?.layers?.[layer.key] || {};
          const fileInfo = status?.files?.[layer.file];
          const isRefreshing = refreshing === layer.key || refreshing === 'all';

          return (
            <div key={layer.key} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a" }}>
                    <span style={{ marginRight: 6 }}>{layer.icon}</span>{layer.label}
                    {isRefreshing && <span style={{ marginLeft: 8, fontSize: 10, color: "#f39c12" }}>⏳ updating...</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>{layer.desc}</div>

                  <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "#5a6a74" }}>
                    <span title="Feature count">📊 {st.feature_count?.toLocaleString() || (fileInfo ? '✓ file exists' : '—')} features</span>
                    <span title="File size">💾 {fileInfo ? `${fileInfo.size_mb} MB` : '—'}</span>
                    <span title="Last refresh">🕐 {fmtDate(st.last_refresh || fileInfo?.modified)}</span>
                    {st.duration_s > 0 && <span title="Refresh duration">⏱ {st.duration_s}s</span>}
                  </div>

                  {st.error && (
                    <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 4, padding: "4px 8px", background: "#fdf0ef", borderRadius: 4, display: "inline-block" }}>
                      ⚠ {st.error}
                    </div>
                  )}
                  {st.last_failed && (
                    <div style={{ fontSize: 10, color: "#c0392b", marginTop: 2 }}>
                      Last failed: {fmtDate(st.last_failed)}
                    </div>
                  )}
                </div>

                <button onClick={() => doRefresh(layer.key)} disabled={!!refreshing}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 11, cursor: refreshing ? "not-allowed" : "pointer", fontFamily: "inherit", color: "#5a6a74", fontWeight: 600 }}>
                  🔄 Refresh
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {status?.config && (
        <div style={{ marginTop: 14, padding: "10px 14px", background: "#f8f9fb", borderRadius: 8, fontSize: 11, color: "#7a8a94" }}>
          <strong>Config:</strong> BBOX {status.config.bbox} · {status.config.localities?.length || 0} localities · Output: {status.config.output_dir}
        </div>
      )}
    </div>
  );
}

function SystemAdmin({ users, setUsers, currentUser, ROLE_CONFIG: ROLE_CONFIG_PROP, roles, departments }) {
  const ROLE_CONFIG = ROLE_CONFIG_PROP || ROLE_CONFIG_DEFAULT;
  const [activeTab, setActiveTab] = useState('users');

  const tabs = [
    { id: 'users', icon: '👥', label: 'Users' },
    { id: 'assessment', icon: '✅', label: 'Assessment Items' },
    { id: 'rules', icon: '⚙️', label: 'Assessment Rules' },
    { id: 'sight_dist', icon: '👁', label: 'Sight Distances' },
    { id: 'geodata', icon: '🗺️', label: 'GeoData (Data WA)' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>System Administration</h2>
      <p style={{ color: "#7a8a94", fontSize: 13, margin: "0 0 16px" }}>Manage users, assessment items, rules, and reference data</p>

      <div style={{ display: "flex", gap: 3, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: "8px 16px", borderRadius: 8, border: activeTab === tab.id ? "2px solid #1abc9c" : "1px solid #d5dde2", background: activeTab === tab.id ? "#e8f8f5" : "#fff", color: activeTab === tab.id ? "#1abc9c" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
            <span>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && <UsersTab users={users} setUsers={setUsers} currentUser={currentUser} ROLE_CONFIG={ROLE_CONFIG} departments={departments || []} />}
      {activeTab === 'assessment' && <AssessmentTab />}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'sight_dist' && <SightDistTab />}
      {activeTab === 'geodata' && <GeoDataTab />}
    </div>
  );
}

export default SystemAdmin;
