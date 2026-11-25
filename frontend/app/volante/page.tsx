import { redirect } from "next/navigation";

// The old wheel dashboard is now a cockpit like any other.
export default function WheelPage() {
  redirect("/cockpit");
}
