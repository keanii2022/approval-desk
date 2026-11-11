// The village prototype, ported as it is: scripted invented data, view only. Its human
// desk is the door to the robot-eye Human Desk at /approvals.
import VillageView from "./VillageView.tsx";

export const metadata = { title: "Village | Approval Desk" };

export default function VillagePage() {
  return (
    <main style={{ minHeight: "100vh", margin: 0, padding: "0 16px", background: "#24283f", boxSizing: "border-box" }}>
      <VillageView />
    </main>
  );
}
