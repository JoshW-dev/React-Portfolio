import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap section">
      <h1 className="title">That page isn&rsquo;t here.</h1>
      <p className="lede" style={{ marginTop: 28 }}>
        The address may be from the old version of this site. The projects are on{" "}
        <Link className="link" href="/projects">
          the projects page
        </Link>
        .
      </p>
    </div>
  );
}
