import { Suspense } from "react";

import { LearningWorkspace } from "@/components/learning-workspace";

export default function IntensivePage() {
  return (
    <Suspense fallback={null}>
      <LearningWorkspace view="intensive" />
    </Suspense>
  );
}
