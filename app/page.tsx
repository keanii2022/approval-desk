import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem", font: "16px/1.5 system-ui, sans-serif" }}>
      <h1>Approval Desk</h1>
      <p>
        A refund agent for an invented online shop. The agent suggests, the gate decides, and a person decides the big
        ones.
      </p>
      <p>
        <Link href="/approvals">Approvals waiting for a person →</Link>
      </p>
    </main>
  );
}
