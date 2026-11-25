import { RequireAuth } from "@/components/RequireAuth";
import { Session } from "@/components/session/Session";

export default function Home() {
  return (
    <RequireAuth>
      <Session />
    </RequireAuth>
  );
}
