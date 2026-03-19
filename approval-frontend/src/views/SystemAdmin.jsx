import { useState, useEffect, useCallback } from "react";
import api from '../services/api';
import { apiUserToFrontend } from '../utils/transforms';
import { ROLE_CONFIG as ROLE_CONFIG_DEFAULT, SIGHT_DISTANCE_TABLE } from '../data/constants';

// ─── Shared styles ─────────────────────────────────────
const inputS = { padding: "5px 8px", borderRadius: 5, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" };
const thS = { padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e9ec" };
const tdS = { padding: "8px 12px", borderBottom: "1px solid #f5f7f8", fontSize: 12 };
const btnAdd = { padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" };
const btnSave = { padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnCancel = { padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer", fontFamily: "inherit" };
const btnEdit = { padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer", fontFamily: "inherit" };
const btnDel = { padding: "4px 10px", borderRadius: 4, border: "1px solid #fdedec", background: "#fdedec", fontSize: 10, color: "#c0392b", cursor: "pointer", fontFamily: "inherit" };

const RESULT_COLORS = { pass: "#27ae60", fail: "#e74c3c", review: "#e67e22" };
const SOURCE_LABELS = { app: "Application Field", sp: "Site Plan AI Data", doc: "Uploaded Document" };
const OPERATOR_LABELS = { gte: "≥", lte: "≤", gt: ">", lt: "<", eq: "=", neq: "≠", exists: "exists", not_exists: "empty", contains: "contains", true: "is true", false: "is false" };

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
          {Object.entries(ROLE_CONFIG).map(([role, cfg]) => {
            const cnt = users.filter(u => u.role === role && u.active).length;
            return <div key={role} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>{cfg.icon}</span>
              <div><div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{cnt}</div><div style={{ fontSize: 10, color: "#7a8a94" }}>{cfg.label}s</div></div>
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
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Full Name *</label>
              <input value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} style={inputS} placeholder="e.g. Jane Smith" /></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Email *</label>
              <input value={newUserForm.email} onChange={e => setNewUserForm({...newUserForm, email: e.target.value})} style={inputS} placeholder="jane@kalamunda.wa.gov.au" /></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Role</label>
              <select value={newUserForm.role} onChange={e => setNewUserForm({...newUserForm, role: e.target.value})} style={inputS}>
                {Object.entries(ROLE_CONFIG).map(([r, c]) => <option key={r} value={r}>{c.icon} {c.label}</option>)}
              </select></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Department</label>
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
              <div style={{ fontSize: 10, color: "#5a6a74", marginTop: 6 }}>Share this password with the user. They will be asked to change it on first login.</div>
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
          <tbody>{users.map(u => {
            const rc = ROLE_CONFIG[u.role] || { label: u.role, icon: "👤", color: "#5a6a74" }; const ed = editId === u.id;
            return (<tr key={u.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
              <td style={tdS}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: u.active ? rc.color : "#bdc3c7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 800 }}>{u.initials}</div>{ed ? <input value={form.name} onChange={e => setForm({...form, name: e.target.value, initials: e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)})} style={{ ...inputS, width: 130 }} /> : <span style={{ fontWeight: 600, color: "#1a3a4a" }}>{u.name}</span>}</div></td>
              <td style={tdS}>{ed ? <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ ...inputS, width: 200 }} /> : <span style={{ color: "#5a6a74" }}>{u.email}</span>}</td>
              <td style={tdS}>{ed ? <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} style={{ ...inputS, width: 120 }}>{Object.entries(ROLE_CONFIG).map(([r, c]) => <option key={r} value={r}>{c.icon} {c.label}</option>)}</select> : <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${rc.color}15`, color: rc.color }}>{rc.icon} {rc.label}</span>}</td>
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
                    <span style={{ marginLeft: 8, fontSize: 10, color: "#95a5a6" }}>{cat.items?.length || 0} items · <code style={{ fontSize: 9, background: "#f5f8fa", padding: "1px 4px", borderRadius: 2 }}>{cat.code}</code></span>
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
                          <td style={{ ...tdS, width: 140 }}><code style={{ fontSize: 10, background: "#f5f8fa", padding: "2px 5px", borderRadius: 3, color: "#5a6a74" }}>{item.code}</code></td>
                          <td style={tdS}>{isItemEdit ? <input value={itemForm.label} onChange={e => setItemForm({ ...itemForm, label: e.target.value })} style={inputS} /> : <span style={{ fontSize: 12, color: "#1a3a4a" }}>{item.label}</span>}</td>
                          <td style={{ ...tdS, width: 90 }}>{isItemEdit ? <input value={itemForm.reference} onChange={e => setItemForm({ ...itemForm, reference: e.target.value })} style={{ ...inputS, width: 70 }} /> : <span style={{ fontSize: 10, color: "#8e44ad", fontWeight: 600, background: "#f4ecf7", padding: "2px 6px", borderRadius: 3 }}>{item.reference}</span>}</td>
                          <td style={{ ...tdS, width: 60 }}><span style={{ fontSize: 10, fontWeight: 700, color: item.is_active ? "#27ae60" : "#e74c3c" }}>{item.is_active ? "Yes" : "No"}</span></td>
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
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Assessment Item</label>
              <select value={addForm.item_id} onChange={e => setAddForm({...addForm, item_id: e.target.value})} style={inputS}>
                <option value="">Select item...</option>
                {allItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.label.slice(0, 50)}</option>)}
              </select></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Priority</label>
              <input type="number" value={addForm.priority} onChange={e => setAddForm({...addForm, priority: parseInt(e.target.value)||0})} style={inputS} /></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Source</label>
              <select value={addForm.source} onChange={e => setAddForm({...addForm, source: e.target.value})} style={inputS}>
                <option value="app">Application Field</option><option value="sp">Site Plan AI Data</option>
              </select></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Field Path</label>
              <input value={addForm.field} onChange={e => setAddForm({...addForm, field: e.target.value})} style={inputS} placeholder="e.g. crossover_width" /></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Operator</label>
              <select value={addForm.operator} onChange={e => setAddForm({...addForm, operator: e.target.value})} style={inputS}>
                {Object.entries(OPERATOR_LABELS).map(([k,v]) => <option key={k} value={k}>{k} ({v})</option>)}
              </select></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Value / Threshold</label>
              <input value={addForm.value} onChange={e => setAddForm({...addForm, value: e.target.value})} style={inputS} placeholder="e.g. 3.0" /></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Result</label>
              <select value={addForm.result} onChange={e => setAddForm({...addForm, result: e.target.value})} style={inputS}>
                <option value="pass">Pass</option><option value="fail">Fail</option><option value="review">Review</option>
              </select></div>
            <div><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Confidence</label>
              <input type="number" step="0.05" min="0" max="1" value={addForm.confidence} onChange={e => setAddForm({...addForm, confidence: parseFloat(e.target.value)||0})} style={inputS} /></div>
          </div>
          <div style={{ marginTop: 10 }}><label style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Reason Template</label>
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
              <code style={{ fontSize: 10, background: "#e8f5e9", padding: "2px 6px", borderRadius: 3, color: "#27ae60", fontWeight: 700 }}>{itemCode}</code>
              <span style={{ fontSize: 11, color: "#1a3a4a", fontWeight: 600 }}>{item.label || "Unknown item"}</span>
              <span style={{ fontSize: 10, color: "#95a5a6", marginLeft: "auto" }}>{group.rules.length} rule{group.rules.length > 1 ? "s" : ""}</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#fafcfa" }}>{["Pri","Source","Field","Op","Value","Result","Conf","Reason","Actions"].map(h => <th key={h} style={{ ...thS, fontSize: 8, padding: "5px 8px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {group.rules.sort((a,b) => a.priority - b.priority).map(rule => {
                  const ed = editId === rule.id;
                  const rc = RESULT_COLORS[rule.result] || "#7a8a94";
                  return (
                    <tr key={rule.id} style={{ background: ed ? "#ebf5fb" : "transparent" }}>
                      <td style={{ ...tdS, width: 40, textAlign: "center" }}>{ed ? <input type="number" value={form.priority} onChange={e => setForm({...form, priority: parseInt(e.target.value)||0})} style={{ ...inputS, width: 40, textAlign: "center" }} /> : <span style={{ fontWeight: 800, color: "#1a3a4a" }}>{rule.priority}</span>}</td>
                      <td style={{ ...tdS, width: 60 }}>{ed ? <select value={form.source} onChange={e => setForm({...form, source: e.target.value})} style={{ ...inputS, width: 55 }}><option value="app">app</option><option value="sp">sp</option></select> : <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 3, background: rule.source === "sp" ? "#f4ecf7" : "#ebf5fb", color: rule.source === "sp" ? "#8e44ad" : "#2980b9", fontWeight: 700 }}>{rule.source}</span>}</td>
                      <td style={{ ...tdS, maxWidth: 140 }}>{ed ? <input value={form.field} onChange={e => setForm({...form, field: e.target.value})} style={{ ...inputS, width: 130 }} /> : <code style={{ fontSize: 9, color: "#5a6a74", wordBreak: "break-all" }}>{rule.field}</code>}</td>
                      <td style={{ ...tdS, width: 50 }}>{ed ? <select value={form.operator} onChange={e => setForm({...form, operator: e.target.value})} style={{ ...inputS, width: 50 }}>{Object.keys(OPERATOR_LABELS).map(k => <option key={k} value={k}>{k}</option>)}</select> : <span style={{ fontWeight: 800, color: "#1a3a4a" }}>{OPERATOR_LABELS[rule.operator] || rule.operator}</span>}</td>
                      <td style={{ ...tdS, width: 60 }}>{ed ? <input value={form.value || ""} onChange={e => setForm({...form, value: e.target.value})} style={{ ...inputS, width: 55 }} /> : <span style={{ fontWeight: 600, color: "#2980b9" }}>{rule.value || "—"}</span>}</td>
                      <td style={{ ...tdS, width: 55 }}>{ed ? <select value={form.result} onChange={e => setForm({...form, result: e.target.value})} style={{ ...inputS, width: 55 }}><option value="pass">pass</option><option value="fail">fail</option><option value="review">review</option></select> : <span style={{ padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 800, background: `${rc}18`, color: rc }}>{rule.result}</span>}</td>
                      <td style={{ ...tdS, width: 40, textAlign: "center" }}>{ed ? <input type="number" step="0.05" value={form.confidence} onChange={e => setForm({...form, confidence: parseFloat(e.target.value)||0})} style={{ ...inputS, width: 40 }} /> : <span style={{ fontSize: 10, color: "#5a6a74" }}>{(rule.confidence * 100).toFixed(0)}%</span>}</td>
                      <td style={tdS}>{ed ? <input value={form.reason_template} onChange={e => setForm({...form, reason_template: e.target.value})} style={inputS} /> : <span style={{ fontSize: 10, color: "#7a8a94" }}>{rule.reason_template}</span>}</td>
                      <td style={{ ...tdS, width: 80 }}>
                        {ed ? (
                          <div style={{ display: "flex", gap: 3 }}>
                            <button onClick={() => handleSave(rule)} style={btnSave}>Save</button>
                            <button onClick={() => setEditId(null)} style={btnCancel}>✕</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 3 }}>
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
function SystemAdmin({ users, setUsers, currentUser, ROLE_CONFIG: ROLE_CONFIG_PROP, roles, departments }) {
  const ROLE_CONFIG = ROLE_CONFIG_PROP || ROLE_CONFIG_DEFAULT;
  const [activeTab, setActiveTab] = useState('users');

  const tabs = [
    { id: 'users', icon: '👥', label: 'Users' },
    { id: 'assessment', icon: '✅', label: 'Assessment Items' },
    { id: 'rules', icon: '⚙️', label: 'Assessment Rules' },
    { id: 'sight_dist', icon: '👁', label: 'Sight Distances' },
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
    </div>
  );
}

export default SystemAdmin;
