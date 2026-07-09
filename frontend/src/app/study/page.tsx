import { Suspense } from "react";

import { LearningWorkspace } from "@/components/learning-workspace";

export default function StudyPage() {
  return (
    <Suspense fallback={null}>
      <LearningWorkspace view="study" />
    </Suspense>
  );
}
