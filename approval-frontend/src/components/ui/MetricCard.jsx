const MetricCard = ({label,value,sub,color="#1a3a4a"}) => <div style={{background:"#fff",borderRadius:14,padding:"18px 20px",border:"1px solid #e4e9ec",flex:1,minWidth:140}}><div style={{fontSize:11,color:"#7a8a94",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{label}</div><div style={{fontSize:28,fontWeight:800,color,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>{sub&&<div style={{fontSize:11,color:"#95a5a6",marginTop:4}}>{sub}</div>}</div>;

export default MetricCard;
