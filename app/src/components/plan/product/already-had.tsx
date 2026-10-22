export const AlreadyHad = ({
  checked,
  future,
  onChange,
}: {
  checked: boolean;
  /** A day still to come can't be "already had". */
  future: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex min-h-tap items-center gap-3 text-sm">
    <input
      type="checkbox"
      className="size-5 accent-accent"
      checked={checked && !future}
      disabled={future}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="font-medium">Already had it?</span>{" "}
      <span className="text-muted">
        {future
          ? "That day is still to come."
          : "Logged as eaten, outside the plan."}
      </span>
    </span>
  </label>
);
