import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { editableBookingValues, saveBookingEdit, validateBookingEdit } from '../utils/bookingEdit';
import { bookingType } from '../utils/bookingType';
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments';

export default function BookingEditor({ booking, appointments, disabled, onSaved, onEditing, onDirtyChange, hideTableField = false }) {
  const [original, setOriginal] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const pending = useRef(false);
  const dirty = original !== null
    && Object.keys(validateBookingEdit(values, original, { manualTables: true }).changes).length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    function warn(event) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function close(force = false) {
    if (!force && dirty && !window.confirm('Scartare le modifiche non salvate?')) return;
    setOriginal(null); setError(''); onEditing(false);
  }
  function change(event) {
    const { name, value } = event.target;
    setValues(previous => name === 'booking_type' ? {
      ...previous, booking_type: value,
      booking_time: value === bookingType(original.booking_type) ? original.booking_time.slice(0, 5) : value === 'dopocena' ? '23:00' : '19:00',
      tables: value === bookingType(original.booking_type) ? original.tables || '' : '',
    } : { ...previous, [name]: value });
  }
  async function save(event) {
    event.preventDefault();
    if (saving || pending.current) return;
    const validation = validateBookingEdit(values, original, { manualTables: true });
    setErrors(validation.errors);
    setError('');
    if (Object.keys(validation.errors).length) return;
    pending.current = true;
    setSaving(true);
    try {
      const result = await saveBookingEdit(supabase, original, values, appointments, { manualTables: true });
      onSaved(result);
      close(true);
    } catch (failure) { setError(failure.message || 'Modifica non salvata.'); }
    finally { pending.current = false; setSaving(false); }
  }
  if (!original) return <button className="admin-button admin-button-secondary booking-edit-trigger" type="button" disabled={disabled}
    onClick={() => { setOriginal({ ...booking }); setValues(editableBookingValues(booking)); setErrors({}); setError(''); onEditing(true); }}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16 3 5 5L8 21H3v-5L16 3zM14 5l5 5" /></svg>
    <span>Modifica</span>
  </button>;

  return <form className="booking-admin-form manual-booking-form booking-detail-edit-form" noValidate onSubmit={save}>
    <h4>Modifica prenotazione</h4>
    <fieldset disabled={saving} className="booking-edit-fields">
      <label>Turno<select name="booking_type" value={values.booking_type} onChange={change} disabled={original.status !== 'confirmed'} aria-invalid={Boolean(errors.booking_type)}>
        <option value="normale">CENA</option>
        <option value="dopocena">DOPOCENA</option>
      </select>{errors.booking_type && <small className="field-error">{errors.booking_type}</small>}</label>
      <label className="booking-edit-date">Data<input name="booking_date" type="date" required value={values.booking_date} onChange={change} aria-invalid={Boolean(errors.booking_date)} />{errors.booking_date && <small className="field-error">{errors.booking_date}</small>}</label>
      <label className="booking-edit-time">Orario<input name="booking_time" type="time" step="60" required value={values.booking_time} onChange={change} aria-invalid={Boolean(errors.booking_time)} />{errors.booking_time && <small className="field-error">{errors.booking_time}</small>}</label>
      <label>Persone<input name="party_size" type="number" min="1" step="1" required value={values.party_size} onChange={change} aria-invalid={Boolean(errors.party_size)} />{errors.party_size && <small className="field-error">{errors.party_size}</small>}</label>
      {!hideTableField && <label>Tavolo/tavoli<input name="tables" value={values.tables} maxLength="200" placeholder="Es. 10+11,12" onChange={change} aria-invalid={Boolean(errors.tables)} />{errors.tables && <small className="field-error">{errors.tables}</small>}</label>}
      {hideTableField && values.booking_type === 'normale' && values.booking_type !== bookingType(original.booking_type) &&
        <label>Tavolo CENA<select name="tables" required value={values.tables} onChange={change} aria-invalid={Boolean(errors.tables)}>
          <option value="">Seleziona un tavolo</option>
          {Object.keys(TABLE_ASSIGNMENTS).map(group => <option key={group} value={group}>{group}</option>)}
        </select>{errors.tables && <small className="field-error">{errors.tables}</small>}</label>}
      {values.booking_type === 'normale' && values.booking_type !== bookingType(original.booking_type) &&
        Number(values.party_size) > TABLE_ASSIGNMENTS[values.tables] &&
        <p className="booking-edit-turn-note" role="status">Sovracapienza: {values.party_size} persone per {TABLE_ASSIGNMENTS[values.tables]} coperti. Conferma solo se gestibile durante il servizio.</p>}
      {values.booking_type !== bookingType(original.booking_type) && <p className="booking-edit-turn-note">{values.booking_type === 'dopocena'
        ? 'Il tavolo viene liberato. Il turno richiede disponibilità entro 26 persone.'
        : 'Scegli un tavolo CENA. La disponibilità viene verificata prima del salvataggio; eventuale sovracapienza resta una scelta dello staff.'}</p>}
      <label className="booking-edit-notes">Note<textarea name="notes" value={values.notes} maxLength="300" rows="3" onChange={change} aria-invalid={Boolean(errors.notes)} />{errors.notes && <small className="field-error">{errors.notes}</small>}</label>
    </fieldset>
    <button className="admin-button" type="submit" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva modifiche'}</button>
    <button className="admin-button admin-button-secondary" type="button" disabled={saving} onClick={() => close()}>Annulla</button>
    {errors.form && <p className="manual-booking-feedback is-error" role="alert">{errors.form}</p>}
    {error && <p className="manual-booking-feedback is-error" role="alert">{error}</p>}
  </form>;
}
