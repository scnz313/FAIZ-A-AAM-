/** V15 decorative star ornament — 24×24 viewBox, currentColor fill.
 *  Used on the hero record card head and as a quiet brand accent. */
export function StarOrn({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 2l2.1 5.4L19.5 4.5 16.6 9.9 22 12l-5.4 2.1 2.9 5.4-5.4-2.9L12 22l-2.1-5.4-5.4 2.9 2.9-5.4L2 12l5.4-2.1L4.5 4.5l5.4 2.9z"
        fill="currentColor"
      />
    </svg>
  );
}
