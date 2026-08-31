import Link from "next/link";

export default function NotFound() {
  return (
    <div className="not-found">
      <p className="eyebrow">404 · Not found</p>
      <h1>Page not found</h1>
      <p>
        The page you followed has moved, or the address is incorrect. The school itself is very much
        where it always was — on the banks of the Jhelum, in Bandipora.
      </p>
      <Link className="link-arrow" href="/">
        Back to the school home →
      </Link>
    </div>
  );
}
