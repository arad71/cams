import { STATUS_CONFIG } from '../../data/constants';
import { T, S, cx } from '../../styles/tokens';

// ─── Small UI Components ────────────────────────────────
const StatusBadge = ({status}) => { const c=STATUS_CONFIG[status]||STATUS_CONFIG.pending_review; return <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,background:c.bg,color:c.color,whiteSpace:"nowrap"}}>{c.icon} {c.label}</span>;};

export default StatusBadge;
