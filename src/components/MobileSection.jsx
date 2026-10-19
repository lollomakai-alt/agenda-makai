import { useEffect, useState } from 'react';
import useMobileLayout from '../hooks/useMobileLayout';
export default function MobileSection({ title, children, className = '' }) {
 const mobile=useMobileLayout();
 const [open,setOpen]=useState(!mobile);
 useEffect(()=>setOpen(!mobile),[mobile]);
 useEffect(()=>{
  if(!className.split(/\s+/).includes('mobile-header-menu')) return undefined;
  const close=()=>setOpen(false);
  window.addEventListener('admin-header-notifications-open',close);
  return ()=>window.removeEventListener('admin-header-notifications-open',close);
 },[className]);
 return <details className={`mobile-section ${className}`} name={mobile?'mobile-agenda-area':undefined} open={open} onToggle={event=>{
  const isOpen=event.currentTarget.open;
  setOpen(isOpen);
  if(isOpen && className.split(/\s+/).includes('mobile-header-menu')) window.dispatchEvent(new Event('admin-header-menu-open'));
 }}>
  <summary>{title}</summary><div className="mobile-section-content">{children}</div>
 </details>;
}
