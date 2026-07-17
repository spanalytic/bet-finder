import { StrategyDashboard } from "@/components/strategy-dashboard";
import { getBacktestIndex } from "@/lib/backtest-data";

export default async function Home() {
  const index = await getBacktestIndex();
  return <StrategyDashboard filters={index.filters} meta={index.meta} />;
}
