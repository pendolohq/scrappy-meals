const CONTRIBUTE_KEY = "scrappy:contribute-off";

/** The last choice on this device; on until someone turns it off. */
export const rememberedContribute = (): boolean => {
  try {
    return localStorage.getItem(CONTRIBUTE_KEY) !== "no";
  } catch {
    return true;
  }
};

export const rememberContribute = (on: boolean) => {
  try {
    localStorage.setItem(CONTRIBUTE_KEY, on ? "yes" : "no");
  } catch {
    // Private mode or storage off: the choice just isn't remembered.
  }
};

export const ContributeToggle = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex min-h-tap items-center gap-3 text-sm">
    <input
      type="checkbox"
      className="size-5 accent-accent"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="font-medium">
        Also add to Open Food Facts (public, ODbL)
      </span>{" "}
      <span className="text-muted">
        Only the product details go; nothing about who ate it.
      </span>
    </span>
  </label>
);
