import { WheelDash } from "@/components/live/WheelDash";
import { RequireAuth } from "@/components/RequireAuth";

export default function WheelPage() {
  return (
    <RequireAuth>
      <WheelDash />
    </RequireAuth>
  );
}
