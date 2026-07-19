"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

const AXIS = "#6b7280";
const GRID = "#d3d6ea";
const FAULT_COLORS = ["#7c3aed", "#db2777", "#f59e0b", "#4f46e5", "#fb923c", "#ec4899"];

const tickStyle = {
  fill: AXIS,
  fontFamily: "var(--font-term), monospace",
  fontSize: 14,
};

const tooltipStyle = {
  background: "#20233a",
  border: "none",
  borderRadius: 10,
  fontFamily: "var(--font-term), monospace",
  color: "#fff",
};

export function FormScoreChart({
  data,
}: {
  data: { label: string; rate: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="label" tick={tickStyle} stroke={GRID} />
        <YAxis
          domain={[0, 100]}
          tick={tickStyle}
          stroke={GRID}
          unit="%"
          width={48}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#c9b8ff" }}
          formatter={(v) => [`${v}%`, "good-rep rate"] as [string, string]}
        />
        <Line
          type="linear"
          dataKey="rate"
          stroke="#7c3aed"
          strokeWidth={3}
          dot={{ fill: "#7c3aed", r: 4, strokeWidth: 0 }}
          activeDot={{ r: 6 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StreakChart({
  data,
}: {
  data: { label: string; streak: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="label" tick={tickStyle} stroke={GRID} />
        <YAxis tick={tickStyle} stroke={GRID} width={40} allowDecimals={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#f7b8d6" }}
          cursor={{ fill: "rgba(219,39,119,0.08)" }}
          formatter={(v) => [String(v), "best streak"] as [string, string]}
        />
        <Bar dataKey="streak" fill="#db2777" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FaultChart({
  data,
}: {
  data: { fault: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="4 4" horizontal={false} />
        <XAxis type="number" tick={tickStyle} stroke={GRID} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="fault"
          tick={tickStyle}
          stroke={GRID}
          width={96}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(124,58,237,0.08)" }}
          formatter={(v) => [String(v), "sessions"] as [string, string]}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={FAULT_COLORS[i % FAULT_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
