type SimpleNodeWizardLabels = {
  assignedHost: string;
  customerName: string;
  listenPort: string;
  maxTraffic: string;
  remainingTime: string;
  unitDays: string;
  unitGb: string;
};

type SimpleNodeWizardServer = {
  address: string;
  label: string;
  value: string;
};

type SimpleNodeWizardValue = {
  agentId: string;
  customerName: string;
  listenPort: string;
  remainingDays: string;
  trafficLimitGb: string;
};

type SimpleNodeWizardProps = {
  labels: SimpleNodeWizardLabels;
  servers: SimpleNodeWizardServer[];
  value: SimpleNodeWizardValue;
  onChange: (field: keyof SimpleNodeWizardValue, value: string) => void;
  onServerChange: (server: SimpleNodeWizardServer) => void;
};

function SimpleField({
  label,
  suffix,
  type = 'text',
  value,
  onChange
}: {
  label: string;
  suffix?: string;
  type?: 'number' | 'text';
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <div className="mt-1 flex min-h-8 items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
        {suffix ? <span className="shrink-0 text-xs font-bold text-slate-400 dark:text-white/35">{suffix}</span> : null}
      </div>
    </label>
  );
}

export function SimpleNodeWizard({ labels, servers, value, onChange, onServerChange }: SimpleNodeWizardProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
          {labels.assignedHost}
        </span>
        <select
          aria-label={labels.assignedHost}
          className="glass-select-control mt-1 min-h-8 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
          onChange={(event) => {
            const server = servers.find((item) => item.value === event.target.value);
            if (server) {
              onServerChange(server);
            }
          }}
          value={value.agentId}
        >
          {servers.map((server) => (
            <option key={server.value} value={server.value}>
              {server.label}
            </option>
          ))}
        </select>
      </label>
      <SimpleField
        label={labels.customerName}
        value={value.customerName}
        onChange={(nextValue) => onChange('customerName', nextValue)}
      />
      <SimpleField
        label={labels.remainingTime}
        suffix={labels.unitDays}
        type="number"
        value={value.remainingDays}
        onChange={(nextValue) => onChange('remainingDays', nextValue)}
      />
      <SimpleField
        label={labels.maxTraffic}
        suffix={labels.unitGb}
        type="number"
        value={value.trafficLimitGb}
        onChange={(nextValue) => onChange('trafficLimitGb', nextValue)}
      />
      <SimpleField
        label={labels.listenPort}
        type="number"
        value={value.listenPort}
        onChange={(nextValue) => onChange('listenPort', nextValue)}
      />
    </div>
  );
}
