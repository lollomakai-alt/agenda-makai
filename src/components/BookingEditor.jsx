import { tableCapacityWarning } from '../utils/tableConflicts';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { editableBookingValues, saveBookingEdit, validateBookingEdit } from '../utils/bookingEdit';

export default function BookingEditor({ booking, appointments, disabled, onSaved, onEditing, hideTableField = false }) {
  const [original, setOriginal] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  function close() { setOriginal(null); setError(''); onEditing(false); }
  function change(event) { setValues(previous => ({ ...previous, [event.target.name]: event.target.value })); }
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const validation = validateBookingEdit(values, original, { manualTables: true });
    setErrors(validation.errors);
    setError('');
    if (Object.keys(validation.errors).length) return;
    setSaving(true);
    try {
      const result = await saveBookingEdit(supabase, original, values, appointments, { manualTables: true });
      onSaved(result);
      close();
    } catch (failure) { setError(failure.message || 'Modifica non salvata.'); }
    finally { setSaving(false); }
  }
  if (!original) return <button className="admin-button admin-button-secondary" type="button" disabled={disabled}
    onClick={() => { setOriginal({ ...booking }); setValues(editableBookingValues(booking)); setErrors({}); setError(''); onEditing(true); }}>
    Modifica prenotazione
  </button>;

  return <form className="booking-admin-form manual-booking-form booking-detail-edit-form" noValidate onSubmit={save}>
    <h4>Modifica prenotazione</h4>
    <fieldset disabled={saving} className="booking-edit-fields">
      <label>Data<input name="booking_date" type="date" required value={values.booking_date} onChange={change} aria-invalid={Boolean(errors.booking_date)} />{errors.booking_date && <small className="field-error">{errors.booking_date}</small>}</label>
      <label>Orario<input name="booking_time" type="time" required min={booking.booking_type === 'dopocena' ? '22:00' : '18:00'} max={booking.booking_type === 'dopocena' ? '23:30' : '23:00'} step="1800" value={values.booking_time} onChange={change} aria-invalid={Boolean(errors.booking_time)} />{errors.booking_time && <small className="field-error">{errors.booking_time}</small>}</label>
      <label>Persone<input name="party_size" type="number" min="1" max="6" step="1" required value={values.party_size} onChange={change} aria-invalid={Boolean(errors.party_size)} />{errors.party_size && <small className="field-error">{errors.party_size}</small>}</label>
      {!hideTableField && <label>Tavolo/tavoli<input name="tables" value={values.tables} maxLength="200" placeholder="Es. 10+11,12" onChange={change} aria-invalid={Boolean(errors.tables)} />{errors.tables && <small className="field-error">{errors.tables}</small>}</label>}
      <label>Note<textarea name="notes" value={values.notes} maxLength="300" rows="3" onChange={change} aria-invalid={Boolean(errors.notes)} />{errors.notes && <small className="field-error">{errors.notes}</small>}</label>
    </fieldset>
    {tableCapacityWarning(values.tables, values.party_size) && <p role="status">{tableCapacityWarning(values.tables, values.party_size)}</p>}
    <button className="admin-button" type="submit" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva modifiche'}</button>
    <button className="admin-button admin-button-secondary" type="button" disabled={saving} onClick={close}>Annulla</button>
    {errors.form && <p className="manual-booking-feedback is-error" role="alert">{errors.form}</p>}
    {error && <p className="manual-booking-feedback is-error" role="alert">{error}</p>}
  </form>;
}
