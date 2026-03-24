import { Routes, Route } from "react-router-dom";
import { Sidebar, MobileNav } from "../../components/portfolio-sidebar";
import "./portfolio-globals.css";

import DashboardPage from "./DashboardPage";
import PositionsPage from "./PositionsPage";
import TradePage from "./TradePage";
import AnalysisPage from "./AnalysisPage";
import ResearchPage from "./ResearchPage";
import ImportPage from "./ImportPage";
import SettingsPage from "./SettingsPage";

export default function PortfolioLayout() {
  return (
    <div className="portfolio-scope">
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="positions" element={<PositionsPage />} />
            <Route path="trade" element={<TradePage />} />
            <Route path="analysis" element={<AnalysisPage />} />
            <Route path="research" element={<ResearchPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
