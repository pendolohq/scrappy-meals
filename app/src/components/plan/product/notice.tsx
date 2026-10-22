/** Something on the sheet to check before saving. */
export const Notice = ({ children }: { children: string }) => (
  <p className="rounded-control bg-highlight-soft px-3 py-2 text-sm text-highlight">
    {children}
  </p>
);
