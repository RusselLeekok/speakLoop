import { Suspense } from "react";

import { LearningWorkspace } from "@/components/learning-workspace";

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LearningWorkspace view="library" />
    </Suspense>
  );
}
