// The village prototype, ported as it is: scripted invented data, view only.
import VillageCanvas from "./VillageCanvas.tsx";

export const metadata = { title: "Village | Approval Desk" };

export default function VillagePage() {
  return (
    <main style={{ minHeight: "100vh", margin: 0, padding: "0 16px", background: "#24283f", boxSizing: "border-box" }}>
      <VillageCanvas />
    </main>
  );
}
