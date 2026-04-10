import "./ToggleSwitch.css";

type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
};

export function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  return (
    <label className={`nexus-toggle${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="nexus-toggle-track" aria-hidden>
        <span className="nexus-toggle-thumb" />
      </span>
      {label ? <span className="nexus-toggle-label">{label}</span> : null}
    </label>
  );
}
