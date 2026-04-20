import { toPng } from "html-to-image";
import JSZip from "jszip";

export type DashboardDimension =
  | "topdown"
  | "sector"
  | "theme"
  | "riskCountry"
  | "gicIndustry"
  | "exchangeCountry";

export const DASHBOARD_EXPORT_DIMS: { key: DashboardDimension; label: string }[] = [
  { key: "topdown", label: "Topdown" },
  { key: "sector", label: "Sector" },
  { key: "theme", label: "Theme" },
  { key: "riskCountry", label: "RiskCountry" },
  { key: "gicIndustry", label: "GICIndustry" },
  { key: "exchangeCountry", label: "ExchangeCountry" },
];

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function nextPaint(): Promise<void> {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

function todayStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export async function exportDashboardCharts(opts: {
  panelEl: HTMLElement;
  currentDim: DashboardDimension;
  setDim: (dim: DashboardDimension) => void;
  onProgress?: (done: number, total: number, label: string) => void;
}): Promise<void> {
  const { panelEl, currentDim, setDim, onProgress } = opts;
  const zip = new JSZip();
  const originalDim = currentDim;

  for (let i = 0; i < DASHBOARD_EXPORT_DIMS.length; i++) {
    const { key, label } = DASHBOARD_EXPORT_DIMS[i];
    onProgress?.(i, DASHBOARD_EXPORT_DIMS.length, label);
    setDim(key);
    // Wait for React re-render + ECharts redraw. Two paints + a settle buffer
    // is empirically enough for Recharts animation-free + ECharts canvas redraw.
    await nextPaint();
    await sleep(400);

    const dataUrl = await toPng(panelEl, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      cacheBust: true,
    });
    const base64 = dataUrl.split(",")[1];
    zip.file(`${String(i + 1).padStart(2, "0")}_${label}.png`, base64, { base64: true });
  }

  // Restore the dimension the user was viewing
  setDim(originalDim);

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `portfolio-dashboard-${todayStamp()}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  onProgress?.(DASHBOARD_EXPORT_DIMS.length, DASHBOARD_EXPORT_DIMS.length, "done");
}
