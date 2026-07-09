import { Suspense } from "react";

import { LearningWorkspace } from "@/components/learning-workspace";

export default function WordsPage() {
  return (
    <Suspense fallback={null}>
      <LearningWorkspace view="words" />
    </Suspense>
  );
}
