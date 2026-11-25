import { RequireAuth } from "@/components/RequireAuth";
import { CockpitFull } from "@/components/cockpit/CockpitFull";

export default function CockpitPage() {
  return (
    <RequireAuth>
      <CockpitFull />
    </RequireAuth>
  );
}
