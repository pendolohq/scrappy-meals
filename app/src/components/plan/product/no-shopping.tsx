export const NoShopping = ({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex min-h-tap items-center gap-3 text-sm">
    <input
      type="checkbox"
      className="size-5 accent-accent"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="font-medium">Don&rsquo;t add to the shopping list</span>{" "}
      <span className="text-muted">
        Bought out, like a coffee at the café. Untick it for fruit.
      </span>
    </span>
  </label>
);
