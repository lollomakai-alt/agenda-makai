import { useEffect, useState } from 'react';
import useMobileLayout from '../hooks/useMobileLayout';
export default function MobileSection({ title, children, className = '' }) {
 const mobile=useMobileLayout();
 const [open,setOpen]=useState(!mobile);
 useEffect(()=>setOpen(!mobile),[mobile]);
 return <details className={`mobile-section ${className}`} name={mobile?'mobile-agenda-area':undefined} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>{title}</summary><div className="mobile-section-content">{children}</div>
 </details>;
}
