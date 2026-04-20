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

const PIXEL_RATIO = 2;
// All measurements below are in CSS pixels; they'll be scaled by PIXEL_RATIO for rendering.
const HEADER_HEIGHT_CSS = 56;
const HEADER_PAD_X_CSS = 24;

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

function prettyDate() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function composeWithHeader(chartDataUrl: string, label: string): Promise<string> {
  const chartImg = await loadImage(chartDataUrl);
  const headerPx = HEADER_HEIGHT_CSS * PIXEL_RATIO;
  const padX = HEADER_PAD_X_CSS * PIXEL_RATIO;

  const canvas = document.createElement("canvas");
  canvas.width = chartImg.width;
  canvas.height = chartImg.height + headerPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return chartDataUrl;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Title
  ctx.fillStyle = "#0f172a";
  ctx.font = `600 ${20 * PIXEL_RATIO}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(`Portfolio · ${label}`, padX, headerPx * 0.42);

  // Subtitle (date, right-aligned)
  ctx.fillStyle = "#64748b";
  ctx.font = `400 ${12 * PIXEL_RATIO}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(prettyDate(), canvas.width - padX, headerPx * 0.42);

  // Thin divider between header and charts
  ctx.textAlign = "left";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, headerPx - PIXEL_RATIO, canvas.width, PIXEL_RATIO);

  ctx.drawImage(chartImg, 0, headerPx);

  return canvas.toDataURL("image/png");
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
    await sleep(450);

    const rawDataUrl = await toPng(panelEl, {
      pixelRatio: PIXEL_RATIO,
      backgroundColor: "#ffffff",
      cacheBust: true,
    });
    const framedDataUrl = await composeWithHeader(rawDataUrl, label);
    const base64 = framedDataUrl.split(",")[1];
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
