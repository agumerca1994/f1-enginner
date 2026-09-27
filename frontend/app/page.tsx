import { Dashboard } from "@/components/dashboard/Dashboard";
import { RequireAuth } from "@/components/RequireAuth";

export default function Home() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}
