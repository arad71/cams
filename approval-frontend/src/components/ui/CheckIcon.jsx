const CheckIcon = ({status}) => { const c={pass:"#27ae60",fail:"#c0392b",needs_review:"#e67e22"},i={pass:"✓",fail:"✕",needs_review:"?"}; return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:"50%",background:`${c[status]}18`,color:c[status],fontSize:12,fontWeight:800}}>{i[status]}</span>;};

export default CheckIcon;
