import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page notfound">
      <div className="serial">404</div>
      <h1 className="page-title">This page isn't on the tape.</h1>
      <p className="page-desc">
        The URL doesn't match anything in the journal. The desk itself is one click away.
      </p>
      <Link href="/" className="btn btn-primary">
        Back to the front door
      </Link>
    </div>
  );
}
