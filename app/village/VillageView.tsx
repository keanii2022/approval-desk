"use client";

// The village with its door to the Human Desk: E, or a click on the desk in the scene,
// opens the robot-eye view at /approvals. The way back is B on that page.
import { useRouter } from "next/navigation";
import VillageCanvas from "./VillageCanvas.tsx";

export default function VillageView() {
  const router = useRouter();
  return <VillageCanvas onEnterDesk={() => router.push("/approvals")} />;
}
