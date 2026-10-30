// A bare page for now: it only renders the village. The robot-eye chrome around it
// (header, stage frame, console, dialogue bar) is added by the Step 13 page work.
import VillageCanvas from "./VillageCanvas.tsx";

export const metadata = { title: "Village | Approval Desk" };

export default function VillagePage() {
  return (
    <main style={{ minHeight: "100vh", margin: 0, padding: "0 16px", background: "#24283f", boxSizing: "border-box" }}>
      <VillageCanvas />
    </main>
  );
}
