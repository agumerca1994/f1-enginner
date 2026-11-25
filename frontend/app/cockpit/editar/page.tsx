import { RequireAuth } from "@/components/RequireAuth";
import { Editor } from "@/components/cockpit/Editor";

export default function EditCockpitPage() {
  return (
    <RequireAuth>
      <Editor />
    </RequireAuth>
  );
}
