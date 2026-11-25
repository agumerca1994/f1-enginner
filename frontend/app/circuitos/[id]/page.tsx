"use client";

import { use } from "react";

import { Circuits } from "@/components/circuits/Circuits";
import { RequireAuth } from "@/components/RequireAuth";

export default function CircuitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <Circuits selected={Number(id)} />
    </RequireAuth>
  );
}
