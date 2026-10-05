import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { editableBookingValues, saveBookingEdit } from '../utils/bookingEdit';

export default function BookingTableControls({ booking, appointments, disabled = false, onOpenMap, onSaved, onSaving }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const container = useRef(null);
  const trigger = useRef(null);
  const table = String(booking.tables || '').trim();
  const menuId = `booking-table-menu-${booking.id}`;

  useEffect(() => {
    if (!open) return;
    function dismiss(event) {
      if (!container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function removeAssignment() {
    if (disabled || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    onSaving?.(true);
    try {
      const result = await saveBookingEdit(supabase, booking,
        { ...editableBookingValues(booking), tables: '' }, appointments, { manualTables: true });
      onSaved(result);
      setOpen(false);
    } catch (failure) {
      setError(failure.message || 'Assegnazione non rimossa.');
    } finally {
      pending.current = false;
      setSaving(false);
      onSaving?.(false);
    }
  }

  return <div className="booking-card-tables booking-table-controls" ref={container}>
    {table ? <>
      <span>Tavolo {table}</span>
      <button ref={trigger} type="button" className="admin-button admin-button-secondary booking-table-pencil"
        disabled={disabled || saving} aria-label={`Modifica tavolo di ${booking.name}`}
        aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16 3 5 5L8 21H3v-5L16 3zM14 5l5 5" /></svg>
      </button>
      {open && <div id={menuId} className="booking-table-menu" role="group" aria-label={`Gestione tavolo di ${booking.name}`}>
        <button type="button" className="admin-button admin-button-secondary" disabled={disabled || saving}
          onClick={() => { setOpen(false); onOpenMap(); }}>Cambia tavolo</button>
        <button type="button" className="admin-button admin-button-secondary" disabled={disabled || saving}
          onClick={removeAssignment}>{saving ? 'Salvataggio…' : 'Rimuovi assegnazione'}</button>
      </div>}
    </> : <>
      <span>Nessun tavolo assegnato</span>
      <button type="button" className="admin-button booking-detail-primary" disabled={disabled || saving}
        aria-label={`ASSEGNA TAVOLO per ${booking.name}`} onClick={onOpenMap}>ASSEGNA TAVOLO</button>
    </>}
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>;
}
