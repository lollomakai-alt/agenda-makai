import { useEffect, useState } from 'react';
export default function useMobileLayout() {
 const [mobile,setMobile]=useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 1100px)').matches));
 useEffect(()=>{
  const query=window.matchMedia('(max-width: 1100px)');
  const update=()=>setMobile(query.matches);
  update();query.addEventListener('change',update);
  return ()=>query.removeEventListener('change',update);
 },[]);
 return mobile;
}
