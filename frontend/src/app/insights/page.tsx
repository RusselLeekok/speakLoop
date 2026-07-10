import type { Metadata } from "next";

import { InsightsDashboard } from "@/components/insights-dashboard";

export const metadata: Metadata = {
  title: "Insights",
};

export default function InsightsPage() {
  return <InsightsDashboard />;
}
