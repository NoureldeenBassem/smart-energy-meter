import { redirect } from "next/navigation";

/**
 * /dashboard was the single combined screen. Its content is now split across
 * /overview, /budget and /recommendations.
 *
 * Kept as a permanent redirect rather than deleted: the route is in browser
 * history and in the earlier onboarding flow, and a 404 on it during a demo would
 * look like a broken app rather than a moved page.
 */
export default function DashboardPage() {
  redirect("/overview");
}
