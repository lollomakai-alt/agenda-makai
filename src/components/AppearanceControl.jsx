const choices = [
  {
    value: 'auto',
    label: 'Automatico',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /><path d="M12 8v4l2.5 1.5" /></svg>,
  },
  {
    value: 'light',
    label: 'Tema chiaro',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>,
  },
  {
    value: 'dark',
    label: 'Tema scuro',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" /></svg>,
  },
];

export default function AppearanceControl({ preference, onChange }) {
  return <div className="appearance-control">
    <span>Aspetto</span>
    <div className="appearance-options" role="group" aria-label="Tema dell’Agenda">
      {choices.map(choice => <button
        key={choice.value}
        type="button"
        aria-label={choice.label}
        title={choice.label}
        aria-pressed={preference === choice.value}
        onClick={() => onChange(choice.value)}
      >{choice.icon}</button>)}
    </div>
  </div>;
}
