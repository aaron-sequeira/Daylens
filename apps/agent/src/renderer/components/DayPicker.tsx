export function DayPicker({ days, value, onChange }: { days: string[]; value: string; onChange: (d: string) => void }) {
  const options = days.includes(value) ? days : [value, ...days];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border bg-white px-3 py-1.5 text-sm">
      {options.map((d) => <option key={d} value={d}>{d}</option>)}
    </select>
  );
}
