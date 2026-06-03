import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export function ActiveIdleDonut({ activeSec, idleSec }: { activeSec: number; idleSec: number }) {
  const data = [{ name: 'Active', value: activeSec }, { name: 'Idle', value: idleSec }];
  const colors = ['#111827', '#d1d5db'];
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-2 text-sm font-medium">Active vs idle</div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={60} outerRadius={90}>
            {data.map((_, i) => <Cell key={i} fill={colors[i]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
