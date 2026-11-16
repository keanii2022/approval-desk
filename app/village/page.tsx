import { redirect } from "next/navigation";

// The village moved to the front page in step 19; old links still land there.
export default function VillagePage() {
  redirect("/");
}
