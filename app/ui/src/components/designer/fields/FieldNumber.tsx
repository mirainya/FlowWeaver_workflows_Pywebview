export default function FieldNumber({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="field-cell">
      <label className="field-cell-label">{label}</label>
      <input className="field-input" type="number" value={value ?? 0} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </div>
  );
}
