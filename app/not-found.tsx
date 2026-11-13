import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap section">
      <h1 className="title">That page isn&rsquo;t here.</h1>
      <p className="lede" style={{ marginTop: 28 }}>
        The address may be from the old version of this site. The work has moved to{" "}
        <Link className="link" href="/work">
          the work page
        </Link>
        .
      </p>
    </div>
  );
}
