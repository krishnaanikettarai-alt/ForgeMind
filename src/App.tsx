import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cpu,
  Database,
  Factory,
  Gauge,
  LayoutDashboard,
  Menu,
  Package,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Thermometer,
  TrendingUp,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";

type Page = "Overview" | "Machines" | "Machine detail" | "Predictions" | "Maintenance" | "Assistant" | "Data sources";
type Status = "Healthy" | "Warning" | "Critical";

type Machine = {
  id: string;
  name: string;
  type: string;
  status: Status;
  health: number;
  vibration: string;
  temperature: string;
  maintenance: string;
  probability: number;
};

type SensorPoint = { timestamp: string; vibration: number; temperature: number; current: number };
type SensorAsset = { rows: number; points: SensorPoint[] };
type SensorAssets = Record<string, SensorAsset>;
type SensorMetric = {
  readingsAnalyzed: number;
  firstObserved: number;
  lastObserved: number;
  absoluteChange: number;
  percentageChange: number | null;
  recentMovingAverage: number | null;
  trendDirection: "increasing" | "decreasing" | "flat" | "insufficient_data";
};
type ThresholdFlag = {
  flagged: boolean;
  observedValue: number;
  threshold: number;
  comparison: string;
  source: string;
  status: string;
};
type SensorAnalysis = {
  machineId: string;
  source: "synthetic";
  timeRange: { firstTimestamp: string; lastTimestamp: string };
  analysis: {
    window: number;
    observedMeasurements: Record<"vibration" | "temperature" | "current", Pick<SensorMetric, "readingsAnalyzed" | "firstObserved" | "lastObserved">>;
    derivedMetrics: Record<"vibration" | "temperature" | "current", Omit<SensorMetric, "readingsAnalyzed" | "firstObserved" | "lastObserved">>;
    thresholdFlags: Record<"vibration" | "temperature" | "current", ThresholdFlag>;
    thresholds: { vibration: number; temperature: number; current: number; source: string; status: string };
  };
  limitations: string[];
};
type AnalysisState = { status: "loading" | "ready" | "unavailable"; data?: SensorAnalysis; error?: string };

type DecisionOption = {
  name: string;
  part_cost_inr: number;
  downtime_hours: number;
  downtime_cost_inr: number;
  total_cost_inr: number;
  lead_time_days: number;
  stock_available: boolean;
  trade_off: string;
};

type DecisionData = {
  data_status: string;
  part_id: string;
  currency: string;
  decision_status: string;
  recommendation_basis: string;
  recommended_option: string | null;
  lowest_immediate_cost_option: string;
  risk_assessment: string;
  requires_human_approval: boolean;
  decision_explanation: string;
  options: DecisionOption[];
  assumptions: string[];
};

type DecisionState = {
  status: "loading" | "ready" | "unavailable";
  data?: DecisionData;
  error?: string;
};

const dataFiles = [
  { name: "sensor_readings.csv", label: "Condition sensor samples", rows: "100,000", detail: "20 assets · minute-level vibration, temperature, and current", size: "7.7 MB" },
  { name: "PdM_machines.csv", label: "Machine registry", rows: "100", detail: "Model and age metadata for each machine", size: "1.5 KB" },
  { name: "PdM_telemetry.csv", label: "Historical telemetry", rows: "876,100", detail: "Voltage, rotation, pressure, and vibration signals", size: "76.4 MB" },
  { name: "PdM_maint.csv", label: "Maintenance history", rows: "3,286", detail: "Historical component service events", size: "102 KB" },
  { name: "PdM_failures.csv", label: "Failure records", rows: "761", detail: "Observed component failure events", size: "23.8 KB" },
  { name: "PdM_errors.csv", label: "Error events", rows: "3,919", detail: "Historical machine error codes", size: "126 KB" },
];

const machines: Machine[] = [
  { id: "M01", name: "CNC Milling Unit", type: "CNC", status: "Healthy", health: 98, vibration: "Normal", temperature: "Normal", maintenance: "4 days ago", probability: 3 },
  { id: "M05", name: "Hydraulic Pump 05", type: "Pump", status: "Warning", health: 71, vibration: "High", temperature: "Normal", maintenance: "21 days ago", probability: 18 },
  { id: "M12", name: "Conveyor Drive 12", type: "Conveyor", status: "Healthy", health: 94, vibration: "Normal", temperature: "Normal", maintenance: "8 days ago", probability: 6 },
  { id: "M17", name: "Industrial Compressor", type: "Compressor", status: "Critical", health: 42, vibration: "High", temperature: "High", maintenance: "38 days ago", probability: 91 },
  { id: "M24", name: "Press Line 24", type: "Hydraulic press", status: "Healthy", health: 89, vibration: "Normal", temperature: "Normal", maintenance: "11 days ago", probability: 9 },
  { id: "M42", name: "Cooling Pump 42", type: "Pump", status: "Warning", health: 68, vibration: "Elevated", temperature: "Normal", maintenance: "21 days ago", probability: 73 },
  { id: "M63", name: "Packaging Motor 63", type: "Motor", status: "Warning", health: 76, vibration: "Elevated", temperature: "Elevated", maintenance: "16 days ago", probability: 61 },
];

const navItems: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Machines", icon: Cpu },
  { label: "Predictions", icon: Activity },
  { label: "Maintenance", icon: Wrench },
  { label: "Assistant", icon: Bot },
  { label: "Data sources", icon: Database },
];

function parseSensorReadings(csv: string): SensorAssets {
  const groups = new Map<string, SensorPoint[]>();
  const lines = csv.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    const [machineId, timestamp, vibration, temperature, current] = lines[index].split(",");
    if (!machineId || !timestamp) continue;
    const group = groups.get(machineId) ?? [];
    group.push({ timestamp, vibration: Number(vibration), temperature: Number(temperature), current: Number(current) });
    groups.set(machineId, group);
  }
  return Object.fromEntries([...groups].map(([id, rows]) => {
    const tail = rows.slice(-60);
    const points = tail.filter((_, index) => index % 6 === 0);
    if (tail.length && points.at(-1) !== tail.at(-1)) points.push(tail[tail.length - 1]);
    return [id, { rows: rows.length, points }];
  }));
}

const history = [
  { date: "Sep 15, 2026", kind: "Corrective maintenance", note: "Motor bearing replaced", icon: Wrench },
  { date: "Aug 23, 2026", kind: "Inspection", note: "Bearing wear detected", icon: Search },
  { date: "Jul 18, 2026", kind: "Inspection", note: "Motor inspected", icon: Search },
  { date: "May 12, 2026", kind: "Preventive maintenance", note: "Bearing serviced", icon: Wrench },
];

function StatusPill({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    Healthy: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
    Warning: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
    Critical: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${styles[status]}`}><span className="size-1.5 rounded-full bg-current" />{status}</span>;
}

function HealthBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const color = value < 50 ? "bg-rose-400" : value < 75 ? "bg-amber-300" : "bg-emerald-300";
  return <div className={`flex items-center gap-3 ${compact ? "min-w-28" : "w-full"}`}><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div><span className="w-9 text-right text-xs tabular-nums text-white/70">{value}%</span></div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone = "neutral", delta }: { label: string; value: string; detail: string; icon: typeof Activity; tone?: "neutral" | "green" | "amber" | "red"; delta?: string }) {
  const toneClass = { neutral: "text-slate-300", green: "text-emerald-300", amber: "text-amber-300", red: "text-rose-300" }[tone];
  return <div className="panel p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-3 text-[27px] font-semibold tracking-tight text-white">{value}</p></div><div className={`rounded-xl bg-white/[0.045] p-2.5 ${toneClass}`}><Icon className="size-[18px]" /></div></div><div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">{delta && <span className={toneClass}>{delta}</span>}{detail}</div></div>;
}

function TrendChart({ kind, points, labels, color, unit, min, max }: { kind: string; points: number[]; labels: string[]; color: string; unit: string; min: number; max: number }) {
  const coords = points.map((value, index) => ({ x: 34 + index * (650 / (points.length - 1)), y: 176 - ((value - min) / (max - min)) * 142 }));
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `34,176 ${line} 684,176`;
  return <div className="panel p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-sm font-medium text-white">{kind}</p><p className="mt-1 text-xs text-slate-500">Recent sensor samples · {unit}</p></div><span className={`text-xs font-semibold ${color}`}>{points[0]} → {points.at(-1)} {unit}</span></div><svg viewBox="0 0 710 220" className="h-44 w-full overflow-visible" role="img" aria-label={`${kind} trend over the last 24 hours`}><defs><linearGradient id={`area-${kind}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".18"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>{[35,82,129,176].map((y) => <line key={y} x1="34" x2="684" y1={y} y2={y} stroke="rgba(255,255,255,.075)" strokeDasharray="3 6"/>)}<polygon points={area} fill={`url(#area-${kind})`} className={color}/><polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={color}/>{coords.map((point, i) => i === coords.length - 1 ? <circle key={i} cx={point.x} cy={point.y} r="4.5" fill="currentColor" className={color}/> : null)}{labels.map((label, i) => <text key={label} x={34 + i * (650 / (labels.length - 1))} y="207" textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} fill="#667085" fontSize="10">{label}</text>)}</svg></div>;
}

function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [selectedMachine, setSelectedMachine] = useState("M17");
  const [filter, setFilter] = useState<"All" | Status>("All");
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sensorAssets, setSensorAssets] = useState<SensorAssets>({});
  const [datasetState, setDatasetState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "agent"; text: string }[]>([
    {
      role: "agent",
      text: "I can analyze synthetic sensor readings, compare provisional maintenance costs, and explain what remains unknown. Failure-risk estimates are not validated for these demo machines, and operational decisions require human approval.",
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [apiMode, setApiMode] = useState(import.meta.env.VITE_AGENT_API_URL ? "Local API configured" : "Demo data");
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: import.meta.env.VITE_AGENT_API_URL ? "loading" : "unavailable", error: "Configure VITE_AGENT_API_URL to load backend analysis." });
  const [decisions, setDecisions] = useState<DecisionState>({
  status: "loading",
});
  const currentMachine = machines.find((machine) => machine.id === selectedMachine) ?? machines[3];
  const apiBase = (import.meta.env.VITE_AGENT_API_URL as string | undefined)?.replace(/\/$/, "");
  const filteredMachines = useMemo(() => machines.filter((machine) => (filter === "All" || machine.status === filter) && `${machine.id} ${machine.name} ${machine.type}`.toLowerCase().includes(query.toLowerCase())), [filter, query]);

  useEffect(() => {
    document.title = "ForgeMind | Predictive Maintenance";
    fetch("/dataset/sensor_readings.csv")
      .then((response) => {
        if (!response.ok) throw new Error("Sensor dataset unavailable");
        return response.text();
      })
      .then((csv) => { setSensorAssets(parseSensorReadings(csv)); setDatasetState("ready"); })
      .catch(() => setDatasetState("unavailable"));
  }, []);

  useEffect(() => {
    if (!apiBase) {
      setAnalysis({ status: "unavailable", error: "Backend analysis is not configured." });
      return;
    }
    const controller = new AbortController();
    setAnalysis({ status: "loading" });
    fetch(`${apiBase}/api/machines/${encodeURIComponent(selectedMachine)}/analysis`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Analysis request failed (${response.status})`);
        return response.json() as Promise<SensorAnalysis>;
      })
      .then((data) => { setAnalysis({ status: "ready", data }); setApiMode("Local API connected"); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAnalysis({ status: "unavailable", error: "Analysis is unavailable. Check that the local backend is running." });
      });
    return () => controller.abort();
  }, [apiBase, selectedMachine]);

  useEffect(() => {
    if (!apiBase) {
      setDecisions({ status: "unavailable", error: "Configure VITE_AGENT_API_URL to load maintenance decisions." });
      return;
    }
    const controller = new AbortController();
    setDecisions({ status: "loading" });
    fetch(`${apiBase}/api/decisions`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Decision request failed (${response.status})`);
        return response.json() as Promise<DecisionData>;
      })
      .then((data) => setDecisions({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDecisions({ status: "unavailable", error: "Maintenance decisions are unavailable. Check that the backend is running." });
      });
    return () => controller.abort();
  }, [apiBase]);

  const openMachine = (id: string) => { setSelectedMachine(id); setPage("Machine detail"); };
  const showNotice = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(""), 3200); };

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = message.trim();
    if (!question || isSending) return;

    setChat((items) => [...items, { role: "user", text: question }]);
    setMessage("");
    setIsSending(true);

    if (!apiBase) {
      window.setTimeout(() => {
        setChat((items) => [...items, { role: "agent", text: "Demo mode is active. Configure VITE_AGENT_API_URL to use the local AMD-powered assistant." }]);
        setIsSending(false);
      }, 300);
      return;
    }

    try {
      const response = await fetch(`${apiBase}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          machineId: selectedMachine,
          context: {
            machine: currentMachine,
            analysis: analysis.data ?? null,
            analysisStatus: analysis.status,
          },
        }),
      });

      if (!response.ok) {
        let detail = "The assistant request failed.";
        try {
          const errorData = await response.json();
          if (typeof errorData.detail === "string") detail = errorData.detail;
        } catch {
          // Keep the generic error when the response is not JSON.
        }

        // The backend may wrap an AMD provider error in HTTP 502.
        if (
          response.status === 429 ||
          /HTTP status:\s*429|rate.?limit|too many requests/i.test(detail)
        ) {
          throw new Error("FORGEMIND_PROVIDER_RATE_LIMITED");
        }

        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        ) {
          throw new Error("FORGEMIND_PROVIDER_UNAVAILABLE");
        }

        throw new Error(detail);
      }

      const data = await response.json();
      setChat((items) => [
        ...items,
        { role: "agent", text: data.response ?? data.answer ?? "The AMD agent returned no response." },
      ]);
      setApiMode("Local API connected");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown request error.";
      let userMessage: string;

      if (detail === "FORGEMIND_PROVIDER_RATE_LIMITED") {
        userMessage =
          "The AI provider is temporarily rate-limited. Please wait briefly and retry. No maintenance action was performed.";
      } else if (detail === "FORGEMIND_PROVIDER_UNAVAILABLE") {
        userMessage =
          "The AI provider is temporarily unavailable. Please retry shortly. No maintenance action was performed.";
      } else if (error instanceof TypeError) {
        userMessage =
          "Could not connect to the assistant API. Check that the backend is running and that VITE_AGENT_API_URL is correct. No maintenance action was performed.";
      } else {
        userMessage = `The assistant request failed: ${detail} No maintenance action was performed. Check the backend terminal for details.`;
      }

      setChat((items) => [...items, { role: "agent", text: userMessage }]);
    } finally {
      setIsSending(false);
    }
  }

  const pageTitle = page === "Machine detail" ? `${currentMachine.id} · Machine detail` : page;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand-lockup"><div className="brand-mark"><Factory className="size-5" /></div><div><p className="text-[15px] font-semibold tracking-tight text-white">ForgeMind</p><p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.2em] text-slate-500">Industrial intelligence</p></div><button className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-white/5 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={17}/></button></div>
      <div className="plant-select"><div className="plant-icon"><Factory size={16}/></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">North Plant</p><p className="mt-0.5 text-[10px] text-slate-500">Production line 01</p></div><ChevronDown size={14} className="text-slate-500"/></div>
      <p className="side-label">WORKSPACE</p>
      <nav className="space-y-1" aria-label="Main navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} onClick={() => { setPage(label); setMobileNav(false); }} className={`nav-item ${page === label || (page === "Machine detail" && label === "Machines") ? "nav-active" : ""}`}><Icon size={17}/><span>{label}</span>{label === "Predictions" && <span className="ml-auto rounded-full bg-rose-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">3</span>}</button>)}</nav>
      <p className="side-label mt-8">SYSTEM</p><button className="nav-item" onClick={() => showNotice("Settings are managed by your workspace administrator.")}><Settings2 size={17}/><span>Settings</span></button>
      <div className="sidebar-bottom"><div className="agent-status"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${apiMode.includes("connected") ? "bg-emerald-400" : "bg-amber-300"}`} /><span className="text-xs font-medium text-slate-200">{apiMode}</span></div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">{apiMode === "Demo data" ? "Demo mode · Configure VITE_AGENT_API_URL for the local backend." : "FastAPI + AMD assistant connected · synthetic demo data"}</p><div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-600"><ShieldCheck size={12}/>Secure connection</div></div><div className="profile-row"><div className="avatar">RM</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">Reliability Manager</p><p className="mt-0.5 text-[10px] text-slate-500">Operations team</p></div><ChevronDown size={14} className="text-slate-500"/></div></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><div className="flex items-center gap-3"><button className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.06] lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="hidden text-xs text-slate-500 sm:block">North Plant <span className="px-1.5 text-slate-700">/</span><span className="text-slate-300">{pageTitle}</span></div><div className="text-xs text-slate-300 sm:hidden">{pageTitle}</div></div><div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 md:flex"><span className={`size-1.5 rounded-full ${datasetState === "ready" ? "bg-emerald-400" : datasetState === "loading" ? "bg-amber-300" : "bg-rose-400"}`}/><span className="text-[11px] text-slate-400">{datasetState === "ready" ? `Sensor data · ${Object.keys(sensorAssets).length} assets` : datasetState === "loading" ? "Loading sensor dataset" : "Dataset unavailable"}</span></div><button onClick={() => setPage("Predictions")} className="relative rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5 text-slate-400 hover:text-white" aria-label="View alerts"><Bell size={16}/><span className="absolute right-2 top-2 size-1.5 rounded-full bg-rose-400 ring-2 ring-[#0c1011]"/></button><div className="avatar avatar-small">RM</div></div></header>

      <main className="page-content">
        {page === "Overview" && <Overview onOpen={openMachine} onNavigate={setPage}/>}
        {page === "Machines" && <MachinesPage filtered={filteredMachines} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} onOpen={openMachine}/>}
        {page === "Machine detail" && <MachineDetail machine={currentMachine} sensor={sensorAssets[currentMachine.id]} analysis={analysis} onAction={showNotice} onNavigate={setPage}/>}
        {page === "Predictions" && <Predictions onOpen={openMachine}/>}
        {page === "Maintenance" && <MaintenancePage onAction={showNotice} decisions={decisions}/>}
        {page === "Assistant" && <AssistantPage chat={chat} message={message} setMessage={setMessage} machine={currentMachine} analysis={analysis} isSending={isSending} onSend={sendMessage}/>}
        {page === "Data sources" && <DataSourcesPage sensorCount={Object.keys(sensorAssets).length} datasetState={datasetState}/>}
      </main>
    </div>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    {notice && <div className="toast"><span className="toast-icon"><Check size={15}/></span><span>{notice}</span></div>}
  </div>;
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow?: ReactNode; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-2 text-[10px] font-bold uppercase tracking-[.19em] text-emerald-300/75">{eyebrow}</p>}<h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[27px]">{title}</h1><p className="mt-1.5 text-xs text-slate-500 sm:text-[13px]">{subtitle}</p></div>{action}</div>;
}

function Overview({ onOpen, onNavigate }: { onOpen: (id: string) => void; onNavigate: (page: Page) => void }) {
  return <>
    <PageHeading eyebrow="Tuesday · Shift A" title="Factory overview" subtitle="A ForgeMind demo snapshot with project sensor data and predictive maintenance workflows." action={<button className="outline-button"><CalendarDays size={14}/>Last 24 hours<ChevronDown size={13}/></button>}/>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
      <MetricCard label="Total machines" value="100" detail="Across 4 production lines" icon={Cpu}/><MetricCard label="Healthy" value="82" detail="Operating within range" icon={ShieldCheck} tone="green" delta="82%"/><MetricCard label="At risk" value="14" detail="Requires closer monitoring" icon={TriangleAlert} tone="amber"/><MetricCard label="Critical" value="4" detail="Immediate attention required" icon={CircleAlert} tone="red" delta="+2 today"/>
    </div>
    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 xl:mt-4 xl:gap-4"><MetricCard label="Predicted failures" value="3" detail="Within the next 7 days" icon={Activity} tone="red"/><MetricCard label="Current downtime" value="2.4 hrs" detail="Across all lines today" icon={Clock3} tone="amber" delta="−18%"/><MetricCard label="Est. maintenance cost" value="$8,240" detail="Projected this month" icon={TrendingUp} tone="green"/></div>
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_1fr]">
      <section className="panel overflow-hidden"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Factory machine health</h2><p className="mt-1 text-[11px] text-slate-500">Overall equipment health by machine</p></div><button className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200" onClick={() => onNavigate("Machines")}>All machines <ArrowRight size={13} className="ml-1 inline"/></button></div><div className="space-y-4 px-5 pb-5 pt-2">{machines.slice(0, 5).map((machine) => <button key={machine.id} onClick={() => onOpen(machine.id)} className="health-row"><span className="w-9 text-left text-[11px] font-semibold text-slate-400">{machine.id}</span><HealthBar value={machine.health}/>{machine.status === "Critical" && <span className="hidden w-16 text-right text-[9px] font-bold uppercase tracking-wider text-rose-300 sm:block">Critical</span>}</button>)}</div><div className="border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600">Showing 5 of 100 machines <span className="float-right">Updated 2 min ago</span></div></section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Failure predictions</h2><p className="mt-1 text-[11px] text-slate-500">Highest risk · next 7 days</p></div><button onClick={() => onNavigate("Predictions")} className="icon-link" aria-label="All failure predictions"><ArrowUpRight size={15}/></button></div><div className="divide-y divide-white/[0.055]">{machines.filter((m) => m.probability >= 60).sort((a,b) => b.probability-a.probability).map((m) => <button key={m.id} onClick={() => onOpen(m.id)} className="prediction-row"><div><p className="text-xs font-semibold text-slate-200">{m.id} <span className="font-normal text-slate-500">· {m.type}</span></p><p className="mt-1 text-[10px] text-slate-500">{m.id === "M17" ? "Motor bearing · ~2 days" : "Component analysis · ~5 days"}</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums text-rose-300">{m.probability}%</p><p className="mt-0.5 text-[9px] uppercase tracking-wider text-slate-600">Risk</p></div></button>)}</div></section>
        <section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Recent events</h2><p className="mt-1 text-[11px] text-slate-500">Latest activity across the plant</p></div><span className="live-dot"/></div><div className="space-y-4 px-5 pb-5">{[{id:"M17",event:"Vibration anomaly detected",time:"8 min ago",type:"critical"},{id:"M42",event:"Maintenance due in 3 days",time:"42 min ago",type:"warning"},{id:"M05",event:"Sensor threshold exceeded",time:"1 hr ago",type:"warning"}].map((item) => <button key={item.id} onClick={() => onOpen(item.id)} className="event-row"><span className={`event-icon ${item.type}`}><Activity size={14}/></span><span className="min-w-0 flex-1 text-left"><span className="block truncate text-[11px] font-medium text-slate-300">{item.id} · {item.event}</span><span className="mt-1 block text-[10px] text-slate-600">{item.time}</span></span><ArrowRight size={13} className="text-slate-600"/></button>)}</div></section>
      </div>
    </div>
  </>;
}

function MachinesPage({ filtered, filter, setFilter, query, setQuery, onOpen }: { filtered: Machine[]; filter: "All" | Status; setFilter: (filter: "All" | Status) => void; query: string; setQuery: (query: string) => void; onOpen: (id: string) => void }) {
  return <><PageHeading eyebrow="Asset monitoring" title="Machines" subtitle="Monitor condition, operating signals, and maintenance recency." action={<button className="primary-button" onClick={() => alert("Machine registration is available through your backend.")}><Cpu size={14}/>Add machine</button>}/><div className="panel overflow-hidden"><div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-1 rounded-xl bg-white/[0.025] p-1">{(["All","Healthy","Warning","Critical"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`filter-tab ${filter === value ? "filter-active" : ""}`}>{value}<span className="ml-1.5 text-[9px] opacity-50">{value === "All" ? "100" : value === "Healthy" ? "82" : value === "Warning" ? "14" : "4"}</span></button>)}</div><div className="searchbox"><Search size={14} className="text-slate-500"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search machines..."/><kbd>⌘ K</kbd></div></div><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Machine</th><th>Type</th><th>Status</th><th>Health</th><th>Vibration</th><th>Temperature</th><th>Last maintenance</th><th/></tr></thead><tbody>{filtered.map((machine) => <tr key={machine.id} onClick={() => onOpen(machine.id)} className="cursor-pointer"><td><span className="font-semibold text-slate-200">{machine.id}</span><span className="ml-2 text-[11px] text-slate-500">{machine.name}</span></td><td>{machine.type}</td><td><StatusPill status={machine.status}/></td><td><HealthBar value={machine.health} compact/></td><td><Signal value={machine.vibration}/></td><td><Signal value={machine.temperature}/></td><td>{machine.maintenance}</td><td><ArrowUpRight size={14} className="text-slate-600"/></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No machines match those filters.</div>}</div><div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-500"><span>Showing {filtered.length} of 100 machines</span><span>Live telemetry <span className="live-dot ml-1 inline-block align-middle"/></span></div></div></>;
}

function Signal({ value }: { value: string }) { const risk = value === "High"; const elevated = value === "Elevated"; return <span className={`text-[11px] ${risk ? "text-rose-300" : elevated ? "text-amber-300" : "text-slate-500"}`}>{value}</span>; }

function MachineDetail({ machine, sensor, analysis, onAction, onNavigate }: { machine: Machine; sensor?: SensorAsset; analysis: AnalysisState; onAction: (text: string) => void; onNavigate: (page: Page) => void }) {
  const severity = machine.status === "Critical";
  const samples = sensor?.points;
  const latest = samples?.[samples.length - 1];
  const sensorLabels = samples?.map((point) => point.timestamp.slice(11, 16));
  const vibrationPoints = samples?.map((point) => Number(point.vibration.toFixed(2)));
  const temperaturePoints = samples?.map((point) => Number(point.temperature.toFixed(1)));
  const currentPoints = samples?.map((point) => Number(point.current.toFixed(1)));
  const analysisSummary = analysis.status === "ready" && analysis.data ? analysis.data.analysis : undefined;
  return <><PageHeading eyebrow={<button onClick={() => onNavigate("Machines")} className="hover:text-emerald-200">MACHINES / </button>} title={`${machine.id} — ${machine.name}`} subtitle={`${machine.type} · North Plant · Line 01`} action={<div className="flex gap-2"><button className="outline-button" onClick={() => onAction(`Maintenance scheduled for ${machine.id}.`)}><CalendarDays size={14}/>Schedule</button><button className="primary-button" onClick={() => onNavigate("Assistant")}><Bot size={14}/>Ask agent</button></div>}/><div className="mb-4 flex flex-wrap items-center gap-3"><StatusPill status={machine.status}/><span className="text-[11px] text-slate-500">Last maintenance {machine.maintenance}</span><span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-600"><span className="live-dot"/>Telemetry updated just now</span></div><div className="grid grid-cols-2 gap-3 xl:grid-cols-5"><MetricCard label="Illustrative health score" value={`${machine.health}%`} detail="Demo UI value · not a model output" icon={Gauge} tone={severity ? "red" : "green"}/><MetricCard label="Illustrative failure risk" value={`${machine.probability}%`} detail="Demo UI value · not a prediction" icon={Activity} tone="red"/><MetricCard label="Vibration" value={latest ? `${latest.vibration.toFixed(1)} mm/s` : "2.4 mm/s"} detail={sensor ? `${sensor.rows.toLocaleString()} CSV samples` : "No observed sample loaded"} icon={Activity} tone="amber" delta={sensor ? undefined : undefined}/><MetricCard label="Temperature" value={latest ? `${latest.temperature.toFixed(1)}°C` : "Unavailable"} detail={sensor ? "Observed CSV reading" : "No observed sample loaded"} icon={Thermometer} tone="amber"/><MetricCard label="Motor current" value={latest ? `${latest.current.toFixed(1)} A` : "Unavailable"} detail={sensor ? "Observed CSV reading" : "No observed sample loaded"} icon={Zap} tone="amber"/></div>{sensor && <div className="mt-3 rounded-lg border border-amber-300/10 bg-amber-300/[0.035] px-4 py-3 text-[10px] leading-relaxed text-amber-100/60">Sensor charts use observed CSV samples. The health and risk values above are illustrative UI values, not predictions. Threshold checks below are configurable demo checks and are not validated operational limits.</div>}{analysis.status === "loading" && <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-[10px] text-slate-500">Loading deterministic sensor analysis…</div>}{analysis.status === "unavailable" && <div className="mt-3 rounded-lg border border-rose-300/10 bg-rose-300/[0.035] px-4 py-3 text-[10px] text-rose-200/70">{analysis.error ?? "Sensor analysis unavailable."}</div>}{analysisSummary && <div className="mt-3 rounded-lg border border-amber-300/10 bg-amber-300/[0.035] px-4 py-3 text-[10px] text-amber-100/70"><span className="font-semibold text-amber-200">Deterministic analysis:</span> {(["vibration", "temperature", "current"] as const).map((name) => `${name} ${analysisSummary.thresholdFlags[name].flagged ? "flagged" : "within demo threshold"}`).join(" · ")} <span className="text-amber-100/50">· Thresholds are unvalidated demo checks.</span></div>}<div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2"><TrendChart kind="Vibration" points={vibrationPoints ?? [2.1,2.3,2.5,2.6,2.9,3.1,3.8,4.1,4.4,5.2]} labels={sensorLabels ?? ["00:00","04:00","08:00","12:00","16:00","Now"]} color="text-amber-300" unit="mm/s" min={1.5} max={5.8}/><TrendChart kind="Temperature" points={temperaturePoints ?? [61,62,63,64,66,68,73,76,79,84]} labels={sensorLabels ?? ["00:00","04:00","08:00","12:00","16:00","Now"]} color="text-rose-300" unit="°C" min={55} max={90}/></div><div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_.8fr]"><TrendChart kind="Motor current" points={currentPoints ?? [18,18.5,19,19.5,20,21,22,23,24,26]} labels={sensorLabels ?? ["00:00","04:00","08:00","12:00","16:00","Now"]} color="text-sky-300" unit="A" min={16} max={28}/><section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Agent assessment</h2><p className="mt-1 text-[11px] text-slate-500">No predictive model connected</p></div><Bot size={16} className="text-emerald-300"/></div><div className="px-5 pb-5"><div className="rounded-xl border border-rose-400/15 bg-rose-400/[0.055] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">Illustrative scenario</p><p className="mt-1 text-sm font-semibold text-white">Motor bearing degradation</p><p className="mt-2 text-xs leading-relaxed text-slate-400">{sensor ? "Observed CSV sensor history is shown in the charts. The displayed component and risk assessment are sample UI data; the AMD model and ML predictor are not connected." : "No observed sensor history is loaded, and no AI diagnosis is available."}</p></div><div className="mt-4 flex items-center justify-between text-xs"><span className="text-slate-500">Estimated failure</span><span className="font-semibold text-white">Illustrative only</span></div><button onClick={() => onNavigate("Assistant")} className="mt-4 w-full rounded-lg border border-white/[0.08] bg-white/[0.035] py-2.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.07]">Ask about observed data <ArrowRight size={13} className="ml-2 inline"/></button></div></section></div></>;
}

function Predictions({ onOpen }: { onOpen: (id: string) => void }) {
  return <><PageHeading eyebrow="Predictive analytics" title="Failure predictions" subtitle="Prioritized machine risks with explainable contributing factors." action={<button className="outline-button"><Clock3 size={14}/>Next 7 days<ChevronDown size={13}/></button>}/><div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_.65fr]"><section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Priority queue</h2><p className="mt-1 text-[11px] text-slate-500">Machines ranked by probability and impact</p></div><span className="rounded-full bg-rose-400/10 px-2.5 py-1 text-[10px] font-semibold text-rose-300">3 require action</span></div><div className="divide-y divide-white/[0.055]">{machines.filter((m) => m.probability > 50).sort((a,b) => b.probability-a.probability).map((m) => <button key={m.id} onClick={() => onOpen(m.id)} className="risk-row"><div className="risk-score"><span>{m.probability}</span><small>%</small></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-white">{m.id} · {m.name}</span><StatusPill status={m.status}/></div><p className="mt-1.5 text-[10px] text-slate-500">{m.id === "M17" ? "Motor bearing · estimated failure in ~2 days" : "Drive assembly · estimated failure within 5 days"}</p><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-rose-400" style={{width:`${m.probability}%`}}/></div></div><ArrowUpRight className="ml-2 size-4 shrink-0 text-slate-600"/></button>)}</div></section><section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">M17 risk factors</h2><p className="mt-1 text-[11px] text-slate-500">Model contribution summary</p></div><span className="text-[10px] text-slate-600">91% risk</span></div><div className="space-y-5 px-5 pb-5">{[{label:"Vibration trend",value:92,tone:"bg-rose-300"},{label:"Temperature rise",value:84,tone:"bg-rose-300"},{label:"Motor current",value:78,tone:"bg-amber-300"},{label:"Maintenance age",value:72,tone:"bg-amber-300"},{label:"Recent errors",value:48,tone:"bg-sky-300"}].map((factor) => <div key={factor.label}><div className="mb-2 flex justify-between text-[11px]"><span className="text-slate-400">{factor.label}</span><span className="font-medium text-slate-300">{factor.value >= 70 ? "HIGH" : "MEDIUM"}</span></div><div className="h-1.5 rounded-full bg-white/[0.06]"><div className={`h-full rounded-full ${factor.tone}`} style={{width:`${factor.value}%`}}/></div></div>)}<div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-[10px] leading-relaxed text-slate-500"><ShieldCheck size={13} className="mr-1 inline text-emerald-300"/>Predictions are estimates. Verify with an inspection before taking a machine offline.</div></div></section></div><div className="mt-4"><section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Recent model runs</h2><p className="mt-1 text-[11px] text-slate-500">Latest scored assets</p></div><button className="icon-link" aria-label="Prediction settings"><Settings2 size={15}/></button></div><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Machine</th><th>Predicted component</th><th>Probability</th><th>Failure window</th><th>Last scored</th></tr></thead><tbody><tr onClick={() => onOpen("M17")} className="cursor-pointer"><td className="font-semibold text-slate-200">M17 · Compressor</td><td>Motor bearing</td><td className="font-semibold text-rose-300">91%</td><td>~2 days</td><td>8 minutes ago</td></tr><tr onClick={() => onOpen("M42")} className="cursor-pointer"><td className="font-semibold text-slate-200">M42 · Pump</td><td>Drive coupling</td><td className="font-semibold text-amber-300">73%</td><td>~5 days</td><td>12 minutes ago</td></tr><tr onClick={() => onOpen("M63")} className="cursor-pointer"><td className="font-semibold text-slate-200">M63 · Motor</td><td>Rotor assembly</td><td className="font-semibold text-amber-300">61%</td><td>~6 days</td><td>21 minutes ago</td></tr></tbody></table></div></section></div></>;
}

function MaintenancePage({ onAction, decisions }: { onAction: (text: string) => void; decisions: DecisionState }) {
  const formatINR = (amount: number) => new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

  const optionLabels: Record<string, string> = {
    immediate_replacement: "Immediate replacement",
    scheduled_replacement: "Scheduled replacement",
    continue_monitoring: "Continue monitoring",
  };

  return <>
    <PageHeading
      eyebrow="Reliability operations"
      title="Maintenance & inventory"
      subtitle="Compare maintenance options, costs, and operational trade-offs."
      action={<button className="primary-button" onClick={() => onAction("Maintenance review requested. Human approval is required.")}><CalendarDays size={14}/>Request review</button>}
    />

    <section className="panel mb-4 overflow-hidden">
      <div className="panel-heading">
        <div>
          <h2 className="text-sm font-semibold text-white">Maintenance decision analysis</h2>
          <p className="mt-1 text-[11px] text-slate-500">Part {decisions.data?.part_id ?? "BR-204"} · Cost comparison</p>
        </div>
        <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">Provisional</span>
      </div>

      {decisions.status === "loading" && <p className="px-5 pb-5 text-xs text-slate-400">Loading decision options from the backend…</p>}
      {decisions.status === "unavailable" && <div className="px-5 pb-5 text-xs text-rose-300">{decisions.error ?? "Decision data unavailable."}</div>}

      {decisions.status === "ready" && decisions.data && <div className="space-y-4 px-5 pb-5">
        <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-4">
          <div className="flex items-center gap-2 text-amber-200"><CircleAlert size={16}/><span className="text-xs font-semibold">No operational recommendation selected</span></div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{decisions.data?.decision_explanation}</p>
          <p className="mt-2 text-[10px] text-slate-500">Data status: {decisions.data?.data_status} · Failure risk: {decisions.data.risk_assessment}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {decisions.data?.options.map((option) => <article key={option.name} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="text-xs font-semibold text-white">{optionLabels[option.name] ?? option.name}</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{formatINR(option.total_cost_inr)}</p>
            <p className="mt-1 text-[10px] text-slate-500">Estimated immediate cost</p>
            <div className="my-4 h-px bg-white/[0.07]"/>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Part cost</span><span className="text-slate-300">{formatINR(option.part_cost_inr)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Downtime cost</span><span className="text-slate-300">{formatINR(option.downtime_cost_inr)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Downtime</span><span className="text-slate-300">{option.downtime_hours} hours</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Lead time</span><span className="text-slate-300">{option.lead_time_days === 0 ? "Immediate" : `${option.lead_time_days} days`}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Stock available</span><span className="text-slate-300">{option.stock_available ? "Yes" : "No"}</span></div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-400">{option.trade_off}</p>
            {option.name === decisions.data?.lowest_immediate_cost_option && <p className="mt-3 rounded-lg bg-sky-400/10 px-3 py-2 text-[10px] text-sky-200">Lowest immediate cost only — not a safety recommendation.</p>}
          </article>)}
        </div>

        <div className="rounded-xl border border-rose-300/15 bg-rose-300/[0.035] p-4">
          <div className="flex items-center gap-2 text-rose-200"><ShieldCheck size={15}/><p className="text-xs font-semibold">Human approval required</p></div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{decisions.data.requires_human_approval ? "No maintenance or procurement action is automatically approved. A qualified person must review the options." : "Check the backend approval policy before taking action."}</p>
        </div>

        <details className="rounded-xl border border-white/[0.07] p-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">Demo assumptions and limitations</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[10px] leading-relaxed text-slate-500">{decisions.data.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        </details>
      </div>}
    </section>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_.95fr]">
      <section className="panel">
        <div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">M17 maintenance history</h2><p className="mt-1 text-[11px] text-slate-500">Industrial compressor · sample service record</p></div><button className="outline-button" onClick={() => onAction("Maintenance history export requested.")}>Export<ArrowUpRight size={13}/></button></div>
        <div className="relative px-5 pb-5"><div className="timeline-line"/>{history.map(({date,kind,note,icon:Icon}) => <div className="timeline-item" key={date}><span className="timeline-icon"><Icon size={14}/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-1"><p className="text-xs font-medium text-slate-200">{kind}</p><time className="text-[10px] text-slate-600">{date}</time></div><p className="mt-1 text-[11px] text-slate-500">{note}</p></div></div>)}</div>
      </section>
      <section className="panel p-5">
        <div className="flex items-center gap-2"><Zap size={15} className="text-amber-300"/><h2 className="text-sm font-semibold text-white">Decision constraints</h2></div>
        <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-400">
          <p>Cost estimates are synthetic demo values in Indian rupees (INR).</p>
          <p>Monitoring's immediate cost excludes future repairs, production losses, and unquantified failure risk.</p>
          <p>Supplier lead time and waiting-related operational risk have not been validated.</p>
          <p className="text-amber-200">Use these options for demonstration only. They are not approved maintenance instructions.</p>
        </div>
      </section>
    </div>
  </>;
}

function DataSourcesPage({ sensorCount, datasetState }: { sensorCount: number; datasetState: "loading" | "ready" | "unavailable" }) {
  const totalRows = "984,166";
  return <>
    <PageHeading eyebrow="Connected files" title="Data sources" subtitle="Project datasets included with ForgeMind and available to the dashboard." action={<span className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-400"><span className={`size-1.5 rounded-full ${datasetState === "ready" ? "bg-emerald-400" : datasetState === "loading" ? "bg-amber-300" : "bg-rose-400"}`}/>{datasetState === "ready" ? `${sensorCount} sensor assets loaded` : datasetState === "loading" ? "Loading sensor data" : "Sensor file not loaded"}</span>}/>
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard label="Source files" value="6" detail="CSV datasets in this project" icon={Database}/>
      <MetricCard label="Combined records" value={totalRows} detail="Across historic and sensor files" icon={Activity} tone="green"/>
      <MetricCard label="Sensor assets" value={datasetState === "ready" ? String(sensorCount) : "20"} detail="Minute-level condition samples" icon={Cpu} tone="amber"/>
      <MetricCard label="Historic machines" value="100" detail="Machine metadata rows" icon={Factory}/>
    </div>
    <section className="panel overflow-hidden"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Project dataset library</h2><p className="mt-1 text-[11px] text-slate-500">Open a CSV or download it for analysis.</p></div><Database size={16} className="text-emerald-300"/></div><div className="grid grid-cols-1 gap-px bg-white/[0.04] md:grid-cols-2 xl:grid-cols-3">{dataFiles.map((file) => <article key={file.name} className="flex flex-col bg-[#0d1213] p-5"><div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2.5"><div className="part-icon !size-9 !rounded-lg"><Database size={16}/></div><div><p className="text-xs font-semibold text-slate-200">{file.label}</p><p className="mt-1 font-mono text-[9px] text-slate-600">{file.name}</p></div></div><span className="rounded-md bg-white/[0.04] px-2 py-1 text-[9px] text-slate-500">CSV</span></div><p className="mt-4 min-h-8 text-[10px] leading-relaxed text-slate-500">{file.detail}</p><div className="mt-4 flex items-end justify-between border-t border-white/[0.055] pt-3"><div><p className="text-sm font-semibold text-white">{file.rows}</p><p className="mt-1 text-[9px] text-slate-600">records · {file.size}</p></div><a className="outline-button" href={`/dataset/${file.name}`} download><Package size={13}/>Download</a></div></article>)}</div></section>
    <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/[0.035] p-4"><div className="flex items-start gap-3"><CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-300"/><div><p className="text-xs font-medium text-slate-300">Two source formats, kept distinct</p><p className="mt-1 text-[10px] leading-relaxed text-slate-500">The historic PdM files use numeric machine IDs and 2014–2015 telemetry. The sensor readings use M01–M20 IDs and 2026 samples. ForgeMind keeps both sources visible without joining records that may refer to different assets.</p></div></div></div>
  </>;
}

function AssistantPage({ chat, message, setMessage, machine, analysis, isSending, onSend }: {
  chat: { role: "user" | "agent"; text: string }[];
  message: string;
  setMessage: (text: string) => void;
  machine: Machine;
  analysis: AnalysisState;
  isSending: boolean;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const summary = analysis.data?.analysis;

  return <>
    <PageHeading
      eyebrow="Maintenance copilot"
      title="AI assistant"
      subtitle="Investigate observed machine signals and compare provisional maintenance options."
      action={<span className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.05] px-3 py-1.5 text-[10px] text-emerald-200"><span className="live-dot" />AMD-hosted assistant</span>}
    />
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
      <section className="panel flex min-h-[560px] flex-col">
        <div className="panel-heading">
          <div className="flex items-center gap-3">
            <div className="agent-avatar"><Bot size={18} /></div>
            <div>
              <h2 className="text-sm font-semibold text-white">ForgeMind maintenance copilot</h2>
              <p className="mt-1 text-[10px] text-slate-500">Context: {machine.id} · {machine.name}</p>
            </div>
          </div>
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[9px] text-slate-500">
            {analysis.status === "ready" ? "Analysis ready" : analysis.status === "loading" ? "Loading analysis" : "Analysis unavailable"}
          </span>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {chat.map((item, index) => item.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-300 px-4 py-3 text-xs leading-relaxed text-[#07110e]">{item.text}</div>
            </div>
          ) : (
            <div key={index} className="flex items-start gap-3">
              <div className="agent-avatar small"><Bot size={14} /></div>
              <div className="markdown-answer max-w-[95%] min-w-0 rounded-2xl rounded-tl-sm border border-white/[0.065] bg-white/[0.025] px-4 py-3.5 text-xs leading-[1.8] text-slate-300">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 className="mb-3 mt-1 text-base font-semibold text-white">{children}</h1>,
                    h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold text-white">{children}</h2>,
                    h3: ({ children }) => <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-emerald-200">{children}</h3>,
                    p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                    ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
                    li: ({ children }) => <li className="pl-1">{children}</li>,
                    table: ({ children }) => <div className="mb-3 max-w-full overflow-x-auto rounded-lg border border-white/10"><table className="w-full min-w-[420px] border-collapse text-left text-[11px]">{children}</table></div>,
                    thead: ({ children }) => <thead className="bg-white/[0.06] text-slate-100">{children}</thead>,
                    th: ({ children }) => <th className="border-b border-white/10 px-3 py-2 font-semibold">{children}</th>,
                    td: ({ children }) => <td className="border-b border-white/[0.06] px-3 py-2 align-top">{children}</td>,
                    code: ({ children }) => <code className="rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[10px] text-emerald-200">{children}</code>,
                    blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 border-emerald-300/50 pl-3 text-slate-400">{children}</blockquote>,
                    hr: () => <hr className="my-4 border-white/10" />,
                  }}
                >
                  {item.text}
                </ReactMarkdown>
              </div>
            </div>
          ))}
          {isSending && <div className="flex items-center gap-3 text-xs text-slate-400" role="status" aria-live="polite"><div className="agent-avatar small"><Bot size={14} /></div><span className="inline-flex items-center gap-2"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />Analyzing sensor evidence and maintenance options…</span></div>}
        </div>

        <div className="border-t border-white/[0.06] p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {[`Why is ${machine.id} at high risk?`, "Review observed sensor changes", "Estimate downtime cost"].map((prompt) => <button key={prompt} onClick={() => setMessage(prompt)} disabled={isSending} className="rounded-full border border-white/[0.07] px-3 py-1.5 text-[10px] text-slate-400 transition hover:border-white/15 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">{prompt}</button>)}
          </div>
          <form onSubmit={onSend} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0b0f10] p-2">
            <input value={message} onChange={(event) => setMessage(event.target.value)} disabled={isSending} placeholder="Ask about observed signals or maintenance…" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 disabled:opacity-60" />
            <button className="rounded-lg bg-emerald-300 p-2.5 text-[#07110e] transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-50" type="submit" disabled={isSending || !message.trim()} aria-label="Send message"><Send size={15} /></button>
          </form>
          <p className="mt-2 px-1 text-[9px] text-slate-600">Responses use synthetic demo data. Failure risk is unvalidated; human approval is required for operational action.</p>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="panel">
          <div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Machine context</h2><p className="mt-1 text-[10px] text-slate-500">Observed and derived local analysis</p></div><Cpu size={15} className="text-slate-500" /></div>
          <div className="space-y-3 px-5 pb-5">
            <div className="flex justify-between gap-3 text-[10px]"><span className="text-slate-500">Asset</span><span className="text-right text-slate-300">{machine.id} · {machine.type}</span></div>
            {summary ? <>
              <div className="flex justify-between gap-3 text-[10px]"><span className="text-slate-500">Analysis</span><span className="text-right text-emerald-300">Deterministic</span></div>
              <div className="flex justify-between gap-3 text-[10px]"><span className="text-slate-500">Threshold checks</span><span className="text-right text-amber-200">Unvalidated demo</span></div>
            </> : <div className="text-[10px] text-slate-500">{analysis.error ?? "Analysis is not available."}</div>}
          </div>
        </section>
        <section className="panel p-5">
          <div className="flex items-center gap-2"><Settings2 size={15} className="text-emerald-300" /><h2 className="text-sm font-semibold text-white">Connected capabilities</h2></div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">The AMD-hosted assistant can call backend tools for sensor analysis, maintenance cost comparison, and failure-risk availability checks.</p>
          <div className="mt-4 space-y-2">{["analyze_machine()", "compare_maintenance_options()", "get_failure_risk()"].map((tool) => <div key={tool} className="rounded-lg bg-white/[0.025] px-3 py-2 font-mono text-[9px] text-slate-400"><span className="mr-2 text-emerald-300">›</span>{tool}</div>)}</div>
        </section>
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"><p className="text-[10px] font-semibold text-slate-400">Data and safety note</p><p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">Sensor values and maintenance costs are synthetic demo data. No validated failure probability is available for this machine, and no operational action is automatically approved.</p></section>
      </aside>
    </div>
  </>;
}

function AssistantPageLegacy({ chat, message, setMessage, onSend, onSchedule }: { chat: {role:"user"|"agent";text:string}[]; message: string; setMessage: (text:string)=>void; onSend: (event:FormEvent<HTMLFormElement>)=>void; onSchedule: ()=>void }) {
  return <><PageHeading eyebrow="Maintenance copilot" title="AI assistant" subtitle="Investigate machine signals and turn predictions into a maintenance plan." action={<span className="flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-1.5 text-[10px] text-emerald-300"><span className="live-dot"/>AMD AI agent bridge</span>}/><div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]"><section className="panel flex min-h-[560px] flex-col"><div className="panel-heading"><div className="flex items-center gap-3"><div className="agent-avatar"><Bot size={18}/></div><div><h2 className="text-sm font-semibold text-white">ForgeMind maintenance copilot</h2><p className="mt-1 text-[10px] text-slate-500">Context: M17 · Industrial compressor</p></div></div><span className="rounded-full bg-white/[0.04] px-2 py-1 text-[9px] text-slate-500">{import.meta.env.VITE_AGENT_API_URL ? "API mode" : "Demo mode"}</span></div><div className="flex-1 space-y-5 overflow-y-auto p-5">{chat.map((item,index) => item.role === "user" ? <div key={index} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-300 px-4 py-3 text-xs leading-relaxed text-[#07110e]">{item.text}</div></div> : <div key={index} className="flex items-start gap-3"><div className="agent-avatar small"><Bot size={14}/></div><div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-white/[0.065] bg-white/[0.025] px-4 py-3.5 text-xs leading-[1.8] text-slate-300">{item.text}{index===0&&<div className="mt-4 rounded-xl border border-emerald-300/10 bg-emerald-300/[0.045] p-3"><p className="text-[9px] font-bold uppercase tracking-[.15em] text-emerald-300">Recommended action</p><p className="mt-1 text-xs font-medium text-slate-200">Schedule maintenance within 48 hours.</p><button className="mt-3 rounded-lg bg-emerald-300 px-3 py-2 text-[10px] font-semibold text-[#07110e] hover:bg-emerald-200" onClick={onSchedule}>Schedule maintenance <ArrowRight size={12} className="ml-1 inline"/></button></div>}</div></div>)}</div><div className="border-t border-white/[0.06] p-4"><div className="mb-3 flex flex-wrap gap-2">{["Why is M17 at high risk?","Check bearing inventory","Estimate downtime cost"].map((prompt) => <button key={prompt} onClick={() => setMessage(prompt)} className="rounded-full border border-white/[0.07] px-3 py-1.5 text-[10px] text-slate-400 transition hover:border-white/15 hover:text-slate-200">{prompt}</button>)}</div><form onSubmit={onSend} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0b0f10] p-2"><input value={message} onChange={(e)=>setMessage(e.target.value)} placeholder="Ask about a machine, prediction, or maintenance plan..." className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"/><button className="rounded-lg bg-emerald-300 p-2.5 text-[#07110e] transition hover:bg-emerald-200" type="submit" aria-label="Send message"><Send size={15}/></button></form><p className="mt-2 px-1 text-[9px] text-slate-600">AI recommendations are decision support. Confirm with qualified maintenance staff.</p></div></section><aside className="space-y-4"><section className="panel"><div className="panel-heading"><div><h2 className="text-sm font-semibold text-white">Machine context</h2><p className="mt-1 text-[10px] text-slate-500">Available to the agent</p></div><Cpu size={15} className="text-slate-500"/></div><div className="space-y-3 px-5 pb-5">{[["Asset","M17 · Compressor"],["Health","42% · Critical"],["Failure risk","91% · ~2 days"],["Likely component","Motor bearing"],["Part stock","4 available"]].map(([k,v])=><div key={k} className="flex justify-between gap-3 text-[10px]"><span className="text-slate-500">{k}</span><span className="text-right text-slate-300">{v}</span></div>)}</div></section><section className="panel p-5"><div className="flex items-center gap-2"><Settings2 size={15} className="text-emerald-300"/><h2 className="text-sm font-semibold text-white">Agent tools</h2></div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">Your AMD agent can connect through the API bridge and call the maintenance tools below.</p><div className="mt-4 space-y-2">{["get_machine()","get_sensor_history()","predict_failure()","check_inventory()","calculate_downtime_cost()"].map((tool)=><div key={tool} className="rounded-lg bg-white/[0.025] px-3 py-2 font-mono text-[9px] text-slate-400"><span className="mr-2 text-emerald-300">›</span>{tool}</div>)}</div><div className="mt-4 flex items-center gap-2 text-[9px] text-slate-600"><span className="live-dot"/>{import.meta.env.VITE_AGENT_API_URL ? "API endpoint configured" : "Waiting for VITE_AGENT_API_URL"}</div></section><section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"><p className="text-[10px] font-semibold text-slate-400">Integration contract</p><p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">POST JSON: <code className="text-slate-400">message</code>, <code className="text-slate-400">machineId</code>, and <code className="text-slate-400">context</code>. Return <code className="text-slate-400">response</code> or <code className="text-slate-400">answer</code>.</p></section></aside></div></>;
}

export default App;
