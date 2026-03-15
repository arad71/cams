import { useState } from "react";
import api from '../services/api';
import { apiUserToFrontend } from '../utils/transforms';
import { ROLE_CONFIG, SIGHT_DISTANCE_TABLE, CHECKLIST_CATEGORIES } from '../data/constants';

// ─── System Administration ──────────────────────────────
function SystemAdmin({ users, setUsers, currentUser }) {
  const [activeAdminTab, setActiveAdminTab] = useState('users');
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});

  // ── User management (existing) ──
  const startEdit = (u) => { setEditId(u.id); setForm({ ...u }); };
  const saveEdit = async () => {
    try {
      const data = { name: form.name, email: form.email, role: form.role, department: form.department, initials: form.initials };
      await api.updateUser(form._dbId, data);
      const uList = await api.listUsers();
      setUsers(uList.map(apiUserToFrontend));
    } catch (e) { console.error("Save user failed:", e); }
    setEditId(null);
  };
  const toggleActive = async (u) => {
    try {
      await api.updateUser(u._dbId, { is_active: !u.active });
      const uList = await api.listUsers();
      setUsers(uList.map(apiUserToFrontend));
    } catch (e) { console.error("Toggle failed:", e); }
  };
  const addUser = async () => {
    try {
      const nu = await api.createUser({ name: "New User", email: `new${Date.now()}@kalamunda.wa.gov.au`, password: "engineer123", role: "engineer", department: "Engineering" });
      const uList = await api.listUsers();
      setUsers(uList.map(apiUserToFrontend));
      const converted = apiUserToFrontend(nu);
      startEdit(converted);
    } catch (e) { console.error("Add user failed:", e); }
  };

  // ── Master data state (local, editable) ──
  const [roadTypes, setRoadTypes] = useState([
    { id: 1, code: "local", label: "Local Road", color: "#5a6a74", referral: "None", description: "Council-managed local road" },
    { id: 2, code: "blue", label: "Blue Road (DPLH)", color: "#2980b9", referral: "DPLH", description: "Department of Planning, Lands & Heritage" },
    { id: 3, code: "red", label: "Red Road (MRWA)", color: "#c0392b", referral: "Main Roads WA", description: "Main Roads WA managed" },
    { id: 4, code: "private", label: "Private Road", color: "#7f8c8d", referral: "None", description: "Privately maintained road" },
  ]);
  const [surfaceTypes, setSurfaceTypes] = useState([
    { id: 1, code: "concrete", label: "Concrete", cost_per_sqm: 85, min_thickness: 100, spec: "N32 grade, SL82 mesh" },
    { id: 2, code: "asphalt", label: "Asphalt", cost_per_sqm: 65, min_thickness: 50, spec: "AC14, 2-coat seal" },
    { id: 3, code: "brick_paved", label: "Brick Paved", cost_per_sqm: 120, min_thickness: 60, spec: "80mm interlocking" },
    { id: 4, code: "gravel", label: "Gravel", cost_per_sqm: 35, min_thickness: 150, spec: "Laterite, compacted" },
    { id: 5, code: "exposed_agg", label: "Exposed Aggregate", cost_per_sqm: 110, min_thickness: 100, spec: "Decorative aggregate finish" },
  ]);
  const [drainageTypes, setDrainageTypes] = useState([
    { id: 1, code: "none", label: "None Required", requires_culvert: false, notes: "No drainage infrastructure needed" },
    { id: 2, code: "swale", label: "Swale Drain", requires_culvert: false, notes: "Grassed swale to manage stormwater" },
    { id: 3, code: "pipe", label: "Piped Drainage", requires_culvert: true, notes: "PVC/concrete pipe connection to system" },
    { id: 4, code: "soak_well", label: "Soak Well", requires_culvert: false, notes: "On-site infiltration via soak well" },
    { id: 5, code: "open_channel", label: "Open Channel", requires_culvert: true, notes: "Open channel with culvert crossing" },
  ]);
  const [crossoverRules, setCrossoverRules] = useState([
    { id: 1, rule: "Minimum crossover width", value: "3.0m", ref: "§4.1", category: "dimensions" },
    { id: 2, rule: "Max width (frontage ≤ 12.5m)", value: "4.5m", ref: "§4.1", category: "dimensions" },
    { id: 3, rule: "Max width (frontage > 12.5m)", value: "6.0m", ref: "§4.1", category: "dimensions" },
    { id: 4, rule: "Road edge widening max", value: "6.0m", ref: "§4.2", category: "dimensions" },
    { id: 5, rule: "Dual crossover min frontage", value: "20.0m", ref: "§4.3", category: "dimensions" },
    { id: 6, rule: "Side boundary setback", value: "0.5m", ref: "§4.4", category: "setback" },
    { id: 7, rule: "Observer eye height", value: "1.15m", ref: "AS 2890.1", category: "sight" },
    { id: 8, rule: "Object detect height (min)", value: "0.65m", ref: "AS 2890.1", category: "sight" },
    { id: 9, rule: "Object detect height (max)", value: "1.50m", ref: "AS 2890.1", category: "sight" },
    { id: 10, rule: "Contribution fee (standard)", value: "$474.00", ref: "LGA Sch 9.1", category: "fees" },
    { id: 11, rule: "Tree protection zone buffer", value: "12× DBH", ref: "AS 4970", category: "vegetation" },
    { id: 12, rule: "DWER clearing permit trigger", value: "Any native veg", ref: "EP Act §51C", category: "vegetation" },
  ]);
  const [sightDistData, setSightDistData] = useState(
    SIGHT_DISTANCE_TABLE.map((e, i) => ({ id: i + 1, ...e }))
  );

  // Editable assessment categories & items (seeded from CHECKLIST_CATEGORIES)
  const [assessCategories, setAssessCategories] = useState(() =>
    CHECKLIST_CATEGORIES.map((cat, ci) => ({
      ...cat, _uid: ci + 1,
      items: cat.items.map((item, ii) => ({ ...item, _uid: ci * 100 + ii + 1 }))
    }))
  );
  const [editCatId, setEditCatId] = useState(null);
  const [catForm, setCatForm] = useState({});
  const [editItemUid, setEditItemUid] = useState(null);
  const [itemForm, setItemForm] = useState({});
  const [expandedCat, setExpandedCat] = useState(null);

  // Generic master data edit state
  const [mdEditId, setMdEditId] = useState(null);
  const [mdForm, setMdForm] = useState({});
  const startMdEdit = (item) => { setMdEditId(item.id); setMdForm({ ...item }); };
  const cancelMdEdit = () => { setMdEditId(null); setMdForm({}); };

  const inputS = { padding: "5px 8px", borderRadius: 5, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%" };
  const thS = { padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e9ec" };
  const tdS = { padding: "8px 12px", borderBottom: "1px solid #f5f7f8", fontSize: 12 };

  const adminTabs = [
    { id: 'users', icon: '👥', label: 'Users' },
    { id: 'assessment', icon: '✅', label: 'Assessment Items' },
    { id: 'road_types', icon: '🛣️', label: 'Road Types' },
    { id: 'surfaces', icon: '🧱', label: 'Surface Types' },
    { id: 'drainage', icon: '💧', label: 'Drainage' },
    { id: 'rules', icon: '📏', label: 'Crossover Rules' },
    { id: 'sight_dist', icon: '👁', label: 'Sight Distances' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>System Administration</h2>
      <p style={{ color: "#7a8a94", fontSize: 13, margin: "0 0 16px" }}>Manage users, master data, rules, and configuration</p>

      {/* Admin Tab Bar */}
      <div style={{ display: "flex", gap: 3, marginBottom: 16, flexWrap: "wrap" }}>
        {adminTabs.map(tab => (
          <button key={tab.id} onClick={() => { setActiveAdminTab(tab.id); cancelMdEdit(); setEditId(null); }}
            style={{ padding: "8px 16px", borderRadius: 8, border: activeAdminTab === tab.id ? "2px solid #1abc9c" : "1px solid #d5dde2", background: activeAdminTab === tab.id ? "#e8f8f5" : "#fff", color: activeAdminTab === tab.id ? "#1abc9c" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
            <span>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {activeAdminTab === 'users' && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(ROLE_CONFIG).map(([role, cfg]) => {
                const cnt = users.filter(u => u.role === role && u.active).length;
                return <div key={role} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{cfg.icon}</span>
                  <div><div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{cnt}</div><div style={{ fontSize: 10, color: "#7a8a94" }}>{cfg.label}s</div></div>
                </div>;
              })}
            </div>
            <button onClick={addUser} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>+ Add User</button>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#f5f8fa" }}>
                {["User","Email","Role","Department","Status","Actions"].map(h => <th key={h} style={thS}>{h}</th>)}
              </tr></thead>
              <tbody>
                {users.map(u => {
                  const rc = ROLE_CONFIG[u.role];
                  const isEditing = editId === u.id;
                  return (
                    <tr key={u.id} style={{ background: isEditing ? "#ebf5fb" : "transparent" }}>
                      <td style={tdS}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: "50%", background: u.active ? rc.color : "#bdc3c7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 800 }}>{u.initials}</div>
                          {isEditing ? <input value={form.name} onChange={e => setForm({...form, name: e.target.value, initials: e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)})} style={{ ...inputS, width: 130 }} /> : <span style={{ fontWeight: 600, color: "#1a3a4a" }}>{u.name}</span>}
                        </div>
                      </td>
                      <td style={tdS}>{isEditing ? <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ ...inputS, width: 200 }} /> : <span style={{ color: "#5a6a74" }}>{u.email}</span>}</td>
                      <td style={tdS}>{isEditing ? <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} style={{ ...inputS, width: 120 }}>{Object.entries(ROLE_CONFIG).map(([r, c]) => <option key={r} value={r}>{c.icon} {c.label}</option>)}</select> : <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${rc.color}15`, color: rc.color }}>{rc.icon} {rc.label}</span>}</td>
                      <td style={tdS}>{isEditing ? <input value={form.department} onChange={e => setForm({...form, department: e.target.value})} style={{ ...inputS, width: 120 }} /> : <span style={{ color: "#5a6a74" }}>{u.department}</span>}</td>
                      <td style={tdS}><button onClick={() => toggleActive(u)} disabled={u.id === currentUser.id} style={{ padding: "3px 10px", borderRadius: 10, border: "none", fontSize: 10, fontWeight: 700, cursor: u.id === currentUser.id ? "default" : "pointer", fontFamily: "inherit", background: u.active ? "#eafaf1" : "#fdedec", color: u.active ? "#27ae60" : "#e74c3c" }}>{u.active ? "Active" : "Inactive"}</button></td>
                      <td style={tdS}>{isEditing ? <div style={{ display: "flex", gap: 4 }}><button onClick={saveEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save</button><button onClick={() => setEditId(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button></div> : <button onClick={() => startEdit(u)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer", fontFamily: "inherit" }}>Edit</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ ASSESSMENT ITEMS TAB ═══ */}
      {activeAdminTab === 'assessment' && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Assessment checklist categories and items (Guideline v3.1)</div>
              <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>{assessCategories.length} categories · {assessCategories.reduce((s, c) => s + c.items.length, 0)} total items</div>
            </div>
            <button onClick={() => {
              const nw = { id: "new_cat_" + Date.now(), _uid: Date.now(), label: "New Category", icon: "📋", items: [] };
              setAssessCategories([...assessCategories, nw]);
              setEditCatId(nw._uid); setCatForm({ label: nw.label, icon: nw.icon, id: nw.id });
              setExpandedCat(nw._uid);
            }} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ Add Category</button>
          </div>

          {assessCategories.map((cat) => {
            const isExpanded = expandedCat === cat._uid;
            const isCatEditing = editCatId === cat._uid;
            return (
              <div key={cat._uid} style={{ marginBottom: 8, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
                {/* Category header */}
                <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, background: isExpanded ? "#f5f8fa" : "transparent", cursor: "pointer", borderBottom: isExpanded ? "1px solid #e4e9ec" : "none" }}
                  onClick={() => { if (!isCatEditing) setExpandedCat(isExpanded ? null : cat._uid); }}>
                  <span style={{ fontSize: 18 }}>{cat.icon}</span>
                  {isCatEditing ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }} onClick={e => e.stopPropagation()}>
                      <input value={catForm.icon} onChange={e => setCatForm({ ...catForm, icon: e.target.value })} style={{ ...inputS, width: 36, textAlign: "center", fontSize: 16, padding: "2px" }} placeholder="🔹" />
                      <input value={catForm.id} onChange={e => setCatForm({ ...catForm, id: e.target.value })} style={{ ...inputS, width: 100 }} placeholder="category_id" />
                      <input value={catForm.label} onChange={e => setCatForm({ ...catForm, label: e.target.value })} style={{ ...inputS, width: 200 }} placeholder="Category Name" />
                      <button onClick={() => { setAssessCategories(assessCategories.map(c => c._uid === cat._uid ? { ...c, id: catForm.id, label: catForm.label, icon: catForm.icon } : c)); setEditCatId(null); }}
                        style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditCatId(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#1a3a4a" }}>{cat.label}</span>
                        <span style={{ marginLeft: 8, fontSize: 10, color: "#95a5a6" }}>{cat.items.length} items · <code style={{ fontSize: 9, background: "#f5f8fa", padding: "1px 4px", borderRadius: 2 }}>{cat.id}</code></span>
                      </div>
                      <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditCatId(cat._uid); setCatForm({ label: cat.label, icon: cat.icon, id: cat.id }); }}
                          style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, color: "#5a6a74", cursor: "pointer" }}>Edit</button>
                        <button onClick={() => setAssessCategories(assessCategories.filter(c => c._uid !== cat._uid))}
                          style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 9, color: "#c0392b", cursor: "pointer" }}>✕</button>
                      </div>
                      <span style={{ fontSize: 12, color: "#95a5a6", transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
                    </>
                  )}
                </div>

                {/* Items list (expanded) */}
                {isExpanded && (
                  <div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: "#f8fafb" }}>
                        {["Item ID", "Assessment Item Description", "Reference", "Actions"].map(h => <th key={h} style={{ ...thS, fontSize: 9, padding: "6px 12px" }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {cat.items.map((item) => {
                          const isItemEdit = editItemUid === item._uid;
                          return (
                            <tr key={item._uid} style={{ background: isItemEdit ? "#ebf5fb" : "transparent" }}>
                              <td style={{ ...tdS, width: 140 }}>
                                {isItemEdit ? <input value={itemForm.id} onChange={e => setItemForm({ ...itemForm, id: e.target.value })} style={{ ...inputS, width: 120 }} /> : <code style={{ fontSize: 10, background: "#f5f8fa", padding: "2px 5px", borderRadius: 3, color: "#5a6a74" }}>{item.id}</code>}
                              </td>
                              <td style={tdS}>
                                {isItemEdit ? <input value={itemForm.label} onChange={e => setItemForm({ ...itemForm, label: e.target.value })} style={{ ...inputS }} /> : <span style={{ fontSize: 12, color: "#1a3a4a" }}>{item.label}</span>}
                              </td>
                              <td style={{ ...tdS, width: 90 }}>
                                {isItemEdit ? <input value={itemForm.ref} onChange={e => setItemForm({ ...itemForm, ref: e.target.value })} style={{ ...inputS, width: 70 }} /> : <span style={{ fontSize: 10, color: "#8e44ad", fontWeight: 600, background: "#f4ecf7", padding: "2px 6px", borderRadius: 3 }}>{item.ref}</span>}
                              </td>
                              <td style={{ ...tdS, width: 100 }}>
                                {isItemEdit ? (
                                  <div style={{ display: "flex", gap: 3 }}>
                                    <button onClick={() => {
                                      setAssessCategories(assessCategories.map(c => c._uid === cat._uid ? { ...c, items: c.items.map(it => it._uid === item._uid ? { ...it, id: itemForm.id, label: itemForm.label, ref: itemForm.ref } : it) } : c));
                                      setEditItemUid(null);
                                    }} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>Save</button>
                                    <button onClick={() => setEditItemUid(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, cursor: "pointer" }}>✕</button>
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", gap: 3 }}>
                                    <button onClick={() => { setEditItemUid(item._uid); setItemForm({ id: item.id, label: item.label, ref: item.ref }); }}
                                      style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, color: "#5a6a74", cursor: "pointer" }}>Edit</button>
                                    <button onClick={() => setAssessCategories(assessCategories.map(c => c._uid === cat._uid ? { ...c, items: c.items.filter(it => it._uid !== item._uid) } : c))}
                                      style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 9, color: "#c0392b", cursor: "pointer" }}>✕</button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {/* Add item button */}
                    <div style={{ padding: "8px 12px", borderTop: "1px solid #f0f3f5" }}>
                      <button onClick={() => {
                        const newItem = { id: "new_item_" + Date.now(), _uid: Date.now(), label: "New assessment item", ref: "§—" };
                        setAssessCategories(assessCategories.map(c => c._uid === cat._uid ? { ...c, items: [...c.items, newItem] } : c));
                        setEditItemUid(newItem._uid);
                        setItemForm({ id: newItem.id, label: newItem.label, ref: newItem.ref });
                      }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px dashed #1abc9c", background: "transparent", color: "#1abc9c", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>
                        + Add Item to {cat.label}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ ROAD TYPES TAB ═══ */}
      {activeAdminTab === 'road_types' && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Road classifications and referral authorities</div>
            <button onClick={() => { const nw = { id: Date.now(), code: "new_road", label: "New Road Type", color: "#5a6a74", referral: "None", description: "" }; setRoadTypes([...roadTypes, nw]); startMdEdit(nw); }}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ Add Road Type</button>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f5f8fa" }}>{["Code","Label","Color","Referral Authority","Description","Actions"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>{roadTypes.map(r => {
                const ed = mdEditId === r.id;
                return <tr key={r.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
                  <td style={tdS}>{ed ? <input value={mdForm.code} onChange={e => setMdForm({...mdForm, code: e.target.value})} style={{ ...inputS, width: 90 }} /> : <code style={{ fontSize: 11, background: "#f5f8fa", padding: "2px 6px", borderRadius: 3 }}>{r.code}</code>}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.label} onChange={e => setMdForm({...mdForm, label: e.target.value})} style={{ ...inputS, width: 140 }} /> : <span style={{ fontWeight: 600 }}>{r.label}</span>}</td>
                  <td style={tdS}>{ed ? <input type="color" value={mdForm.color} onChange={e => setMdForm({...mdForm, color: e.target.value})} style={{ width: 32, height: 24, border: "none", cursor: "pointer" }} /> : <span style={{ display: "inline-block", width: 16, height: 16, borderRadius: 4, background: r.color, verticalAlign: "middle" }} />}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.referral} onChange={e => setMdForm({...mdForm, referral: e.target.value})} style={{ ...inputS, width: 140 }} /> : <span style={{ color: r.referral === "None" ? "#95a5a6" : "#2980b9", fontWeight: 600, fontSize: 11 }}>{r.referral}</span>}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.description} onChange={e => setMdForm({...mdForm, description: e.target.value})} style={{ ...inputS, width: 200 }} /> : <span style={{ color: "#7a8a94", fontSize: 11 }}>{r.description}</span>}</td>
                  <td style={tdS}>{ed ? <div style={{ display: "flex", gap: 4 }}><button onClick={() => { setRoadTypes(roadTypes.map(x => x.id === r.id ? { ...mdForm } : x)); cancelMdEdit(); }} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Save</button><button onClick={cancelMdEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button></div> : <div style={{ display: "flex", gap: 4 }}><button onClick={() => startMdEdit(r)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer" }}>Edit</button><button onClick={() => setRoadTypes(roadTypes.filter(x => x.id !== r.id))} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 10, color: "#c0392b", cursor: "pointer" }}>✕</button></div>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ SURFACE TYPES TAB ═══ */}
      {activeAdminTab === 'surfaces' && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Approved crossover surface materials and specifications</div>
            <button onClick={() => { const nw = { id: Date.now(), code: "new_surface", label: "New Surface", cost_per_sqm: 0, min_thickness: 0, spec: "" }; setSurfaceTypes([...surfaceTypes, nw]); startMdEdit(nw); }}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ Add Surface</button>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f5f8fa" }}>{["Code","Label","Cost/m²","Min Thick (mm)","Specification","Actions"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>{surfaceTypes.map(s => {
                const ed = mdEditId === s.id;
                return <tr key={s.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
                  <td style={tdS}>{ed ? <input value={mdForm.code} onChange={e => setMdForm({...mdForm, code: e.target.value})} style={{ ...inputS, width: 100 }} /> : <code style={{ fontSize: 11, background: "#f5f8fa", padding: "2px 6px", borderRadius: 3 }}>{s.code}</code>}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.label} onChange={e => setMdForm({...mdForm, label: e.target.value})} style={{ ...inputS, width: 130 }} /> : <span style={{ fontWeight: 600 }}>{s.label}</span>}</td>
                  <td style={tdS}>{ed ? <input type="number" value={mdForm.cost_per_sqm} onChange={e => setMdForm({...mdForm, cost_per_sqm: parseFloat(e.target.value)||0})} style={{ ...inputS, width: 70 }} /> : <span style={{ fontWeight: 700, color: "#27ae60" }}>${s.cost_per_sqm}</span>}</td>
                  <td style={tdS}>{ed ? <input type="number" value={mdForm.min_thickness} onChange={e => setMdForm({...mdForm, min_thickness: parseInt(e.target.value)||0})} style={{ ...inputS, width: 60 }} /> : <span>{s.min_thickness}mm</span>}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.spec} onChange={e => setMdForm({...mdForm, spec: e.target.value})} style={{ ...inputS, width: 180 }} /> : <span style={{ color: "#7a8a94", fontSize: 11 }}>{s.spec}</span>}</td>
                  <td style={tdS}>{ed ? <div style={{ display: "flex", gap: 4 }}><button onClick={() => { setSurfaceTypes(surfaceTypes.map(x => x.id === s.id ? { ...mdForm } : x)); cancelMdEdit(); }} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Save</button><button onClick={cancelMdEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button></div> : <div style={{ display: "flex", gap: 4 }}><button onClick={() => startMdEdit(s)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer" }}>Edit</button><button onClick={() => setSurfaceTypes(surfaceTypes.filter(x => x.id !== s.id))} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 10, color: "#c0392b", cursor: "pointer" }}>✕</button></div>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ DRAINAGE TAB ═══ */}
      {activeAdminTab === 'drainage' && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Drainage infrastructure types and requirements</div>
            <button onClick={() => { const nw = { id: Date.now(), code: "new_drain", label: "New Drainage", requires_culvert: false, notes: "" }; setDrainageTypes([...drainageTypes, nw]); startMdEdit(nw); }}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ Add Drainage Type</button>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f5f8fa" }}>{["Code","Label","Culvert Required","Notes","Actions"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>{drainageTypes.map(d => {
                const ed = mdEditId === d.id;
                return <tr key={d.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
                  <td style={tdS}>{ed ? <input value={mdForm.code} onChange={e => setMdForm({...mdForm, code: e.target.value})} style={{ ...inputS, width: 100 }} /> : <code style={{ fontSize: 11, background: "#f5f8fa", padding: "2px 6px", borderRadius: 3 }}>{d.code}</code>}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.label} onChange={e => setMdForm({...mdForm, label: e.target.value})} style={{ ...inputS, width: 140 }} /> : <span style={{ fontWeight: 600 }}>{d.label}</span>}</td>
                  <td style={tdS}>{ed ? <select value={mdForm.requires_culvert ? "yes" : "no"} onChange={e => setMdForm({...mdForm, requires_culvert: e.target.value === "yes"})} style={{ ...inputS, width: 80 }}><option value="no">No</option><option value="yes">Yes</option></select> : <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: d.requires_culvert ? "#fef5e7" : "#eafaf1", color: d.requires_culvert ? "#e67e22" : "#27ae60" }}>{d.requires_culvert ? "Yes" : "No"}</span>}</td>
                  <td style={tdS}>{ed ? <input value={mdForm.notes} onChange={e => setMdForm({...mdForm, notes: e.target.value})} style={{ ...inputS, width: 240 }} /> : <span style={{ color: "#7a8a94", fontSize: 11 }}>{d.notes}</span>}</td>
                  <td style={tdS}>{ed ? <div style={{ display: "flex", gap: 4 }}><button onClick={() => { setDrainageTypes(drainageTypes.map(x => x.id === d.id ? { ...mdForm } : x)); cancelMdEdit(); }} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Save</button><button onClick={cancelMdEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button></div> : <div style={{ display: "flex", gap: 4 }}><button onClick={() => startMdEdit(d)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer" }}>Edit</button><button onClick={() => setDrainageTypes(drainageTypes.filter(x => x.id !== d.id))} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 10, color: "#c0392b", cursor: "pointer" }}>✕</button></div>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ CROSSOVER RULES TAB ═══ */}
      {activeAdminTab === 'rules' && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74" }}>Crossover design rules, setbacks, sight distances & fees</div>
            <button onClick={() => { const nw = { id: Date.now(), rule: "New Rule", value: "", ref: "", category: "dimensions" }; setCrossoverRules([...crossoverRules, nw]); startMdEdit(nw); }}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ Add Rule</button>
          </div>
          {["dimensions", "setback", "sight", "fees", "vegetation"].map(cat => {
            const items = crossoverRules.filter(r => r.category === cat);
            if (!items.length) return null;
            const catLabels = { dimensions: "📏 Dimensions", setback: "↔️ Setbacks", sight: "👁 Sight Distance", fees: "💰 Fees", vegetation: "🌳 Vegetation" };
            return (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", marginBottom: 6 }}>{catLabels[cat] || cat}</div>
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
                  {items.map(r => {
                    const ed = mdEditId === r.id;
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #f5f7f8", background: ed ? "#ebf5fb" : "transparent", gap: 10 }}>
                        <div style={{ flex: 2 }}>{ed ? <input value={mdForm.rule} onChange={e => setMdForm({...mdForm, rule: e.target.value})} style={{ ...inputS }} /> : <span style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a" }}>{r.rule}</span>}</div>
                        <div style={{ flex: 1 }}>{ed ? <input value={mdForm.value} onChange={e => setMdForm({...mdForm, value: e.target.value})} style={{ ...inputS, width: 80 }} /> : <span style={{ fontSize: 13, fontWeight: 800, color: "#2980b9" }}>{r.value}</span>}</div>
                        <div style={{ flex: 1 }}>{ed ? <input value={mdForm.ref} onChange={e => setMdForm({...mdForm, ref: e.target.value})} style={{ ...inputS, width: 80 }} /> : <span style={{ fontSize: 10, color: "#95a5a6" }}>{r.ref}</span>}</div>
                        <div style={{ width: 100 }}>{ed ? <div style={{ display: "flex", gap: 3 }}><button onClick={() => { setCrossoverRules(crossoverRules.map(x => x.id === r.id ? { ...mdForm } : x)); cancelMdEdit(); }} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>Save</button><button onClick={cancelMdEdit} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, cursor: "pointer" }}>✕</button></div> : <div style={{ display: "flex", gap: 3 }}><button onClick={() => startMdEdit(r)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, color: "#5a6a74", cursor: "pointer" }}>Edit</button><button onClick={() => setCrossoverRules(crossoverRules.filter(x => x.id !== r.id))} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 9, color: "#c0392b", cursor: "pointer" }}>✕</button></div>}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ SIGHT DISTANCE TABLE TAB ═══ */}
      {activeAdminTab === 'sight_dist' && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6a74", marginBottom: 12 }}>AS 2890.1 / Austroads sight distance requirements by road speed</div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f5f8fa" }}>{["Speed (km/h)","Abs Min (m)","SSD Min (m)","Actions"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>{sightDistData.map(s => {
                const ed = mdEditId === s.id;
                return <tr key={s.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
                  <td style={{ ...tdS, fontWeight: 800, color: "#1a3a4a", fontSize: 14 }}>{ed ? <input type="number" value={mdForm.speed} onChange={e => setMdForm({...mdForm, speed: parseInt(e.target.value)||0})} style={{ ...inputS, width: 60 }} /> : s.speed}</td>
                  <td style={tdS}>{ed ? <input type="number" value={mdForm.abs_min} onChange={e => setMdForm({...mdForm, abs_min: parseInt(e.target.value)||0})} style={{ ...inputS, width: 60 }} /> : <span style={{ fontWeight: 700 }}>{s.abs_min}</span>}</td>
                  <td style={tdS}>{ed ? <input type="number" value={mdForm.ssd_min} onChange={e => setMdForm({...mdForm, ssd_min: parseInt(e.target.value)||0})} style={{ ...inputS, width: 60 }} /> : <span style={{ fontWeight: 700 }}>{s.ssd_min}</span>}</td>
                  <td style={tdS}>{ed ? <div style={{ display: "flex", gap: 4 }}><button onClick={() => { setSightDistData(sightDistData.map(x => x.id === s.id ? { ...mdForm } : x)); cancelMdEdit(); }} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Save</button><button onClick={cancelMdEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button></div> : <button onClick={() => startMdEdit(s)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer" }}>Edit</button>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: "#b0bdb2" }}>
            AS 2890.1:2004 Table 3.3 Minimum sight distance requirements for driveways and short access roads. <br />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════

export default SystemAdmin;
