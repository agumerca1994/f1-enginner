import { Circuits } from "@/components/circuits/Circuits";
import { RequireAuth } from "@/components/RequireAuth";

export default function CircuitsPage() {
  return (
    <RequireAuth>
      <Circuits />
    </RequireAuth>
  );
}
